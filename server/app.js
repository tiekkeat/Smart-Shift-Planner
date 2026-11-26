import { registerLeave } from './leave.js'
import { registerClassification } from './classification.js'
import {registerTeams,memberships} from './teams.js'
import { registerCalendarOrder } from './calendar-order.js'
import { registerGroups } from './group-service.js'
import { registerTemplates } from './templates.js'
import { registerHolidays } from './holidays.js'
import { readBranding, saveBranding } from './branding.js'
import Fastify from 'fastify'
import cookie from '@fastify/cookie'
import rateLimit from '@fastify/rate-limit'
import { z } from 'zod'
import { query } from './db.js'
import { hash, passwordMatches, secret } from './security.js'
import { httpError, interval, iso, rosterTimeZone, shiftView } from './domain.js'
import { publicUser, listPeople, savePerson, deletePerson } from './accounts.js'
import { cancelShift, listChanges, listShifts, report, requestChange, requestChanges, reviewChange, previewRevert, revertChange, saveShift, reorderShift } from './roster.js'
import { registerIntegrations } from './integrations.js'
import { assignment, batchProposal, email, id, note, parse, person, proposal, range, version } from './validation.js'

const SESSION_COOKIE = 'timetable_session'
const SESSION_SECONDS = 12 * 60 * 60
const writer = ['admin', 'manager']

export async function buildApp({ logger = true } = {}) {
  const app = Fastify({ logger, bodyLimit: 48 * 1024, trustProxy: Number(process.env.TRUST_PROXY_HOPS || 0) || false })
  const secure = process.env.COOKIE_SECURE !== 'false'
  const appOrigin = process.env.APP_ORIGIN || 'http://localhost:8080'
  const cookieOptions = { path: '/', httpOnly: true, sameSite: 'strict', secure }
  await app.register(cookie)
  await app.register(rateLimit, { max: 300, timeWindow: '1 minute' })

  app.addHook('onRequest', async (request, reply) => {
    reply.header('Cache-Control', 'no-store')
    reply.header('X-Content-Type-Options', 'nosniff')
    if (request.url.startsWith('/api/app/') && !['GET', 'HEAD'].includes(request.method)) {
      if (request.headers.origin !== appOrigin) throw httpError(403, 'The request origin is not allowed.')
    }
  })

  app.setErrorHandler((error, request, reply) => {
    const status = error.statusCode >= 400 && error.statusCode < 500 ? error.statusCode : 500
    if (status === 500) request.log.error({ code: error.code, name: error.name }, 'Request failed')
    if (status === 401 && request.url.startsWith('/api/v1/')) reply.header('WWW-Authenticate', 'Bearer')
    return reply.code(status).send({ error: status === 500 ? 'An unexpected error occurred.' : error.message,
      ...(status !== 500 && error.shiftId && { shiftId: error.shiftId }),
    })
  })

  const authenticated = (roles, action) => async (request, reply) => {
    const token = request.cookies[SESSION_COOKIE] || ''
    if (!/^ws_[A-Za-z0-9_-]{43}$/.test(token)) throw httpError(401, 'Sign in to continue.')
    const [user] = await query(`SELECT u.id, u.name, u.role, u.active FROM sessions s
      JOIN users u ON u.id = s.user_id WHERE s.token_hash = ? AND s.expires_at > ? AND u.active = 1 AND u.deleted_at IS NULL`,
    [hash(token), Date.now()])
    if (!user) throw httpError(401, 'Your session ended. Sign in again.')
    if (roles.length && !roles.includes(user.role)) throw httpError(403, 'Your role does not allow this action.')
    return action(user, request, reply)
  }
  const admin = (action) => authenticated(['admin'], action)
  const staff = (action) => authenticated(writer, action)
  const signedIn = (action) => authenticated([], action)

  app.get('/api/app/branding', readBranding)
  app.put('/api/app/settings', { bodyLimit: 800 * 1024 }, admin((user, request) => saveBranding(user, request.body)))

  app.get('/api/health', async () => {
    await query('SELECT id FROM roster_lock WHERE id = 1')
    return { status: 'ok' }
  })

  app.post('/api/app/login', { config: { rateLimit: { max: 12, timeWindow: '1 minute' } } }, async (request, reply) => {
    const fields = parse(z.object({ email, password: z.string().min(1).max(128) }), request.body)
    const [user] = await query('SELECT * FROM users WHERE email = ? AND active = 1 AND deleted_at IS NULL', [fields.email])
    const valid = await passwordMatches(fields.password, user?.password_hash)
    if (!valid || !user?.active) throw httpError(401, 'Email or password is incorrect.')
    const token = secret('ws_')
    const now = Date.now()
    await query('DELETE FROM sessions WHERE expires_at <= ?', [now])
    const result = await query(`INSERT INTO sessions (token_hash, user_id, expires_at)
      SELECT ?, id, ? FROM users WHERE id = ? AND password_hash = ? AND active = 1`, [
      hash(token), now + SESSION_SECONDS * 1000, user.id, user.password_hash,
    ])
    if (!result.affectedRows) throw httpError(401, 'Email or password is incorrect.')
    reply.setCookie(SESSION_COOKIE, token, { ...cookieOptions, maxAge: SESSION_SECONDS })
    return { user: publicUser(user), timezone: rosterTimeZone }
  })

  app.post('/api/app/logout', async (request, reply) => {
    const token = request.cookies[SESSION_COOKIE]
    if (token) await query('DELETE FROM sessions WHERE token_hash = ?', [hash(token)])
    return reply.clearCookie(SESSION_COOKIE, cookieOptions).code(204).send()
  })

  app.get('/api/app/me', signedIn(async (user) => ({ user: publicUser(user), timezone: rosterTimeZone })))
  app.get('/api/app/people', signedIn(listPeople))
  app.post('/api/app/people', staff(async (user, request, reply) =>
    reply.code(201).send(await savePerson(user, parse(person, request.body)))))
  app.delete('/api/app/people/:id', admin(async (user,request,reply) => { await deletePerson(user,parse(id,request.params.id)); return reply.code(204).send() }))
  app.put('/api/app/people/:id', staff(async (user, request) =>
    savePerson(user, parse(person, request.body), parse(id, request.params.id))))

  function readRange(request) {
    const { from, to } = parse(range, request.query)
    return interval(from, to, 63)
  }

  app.get('/api/app/shifts', signedIn(async (user, request) => {
    const { startsAt, endsAt } = readRange(request)
    const rows = await listShifts(startsAt, endsAt)
    const teams=await memberships()
    return rows.map((row) => {
      const shift = {...shiftView(row),teamIds:teams[row.engineer_id]||[]}
      if (user.role === 'viewer' || (user.role === 'engineer' && shift.engineerId !== user.id)) delete shift.note
      return shift
    })
  }))
  app.post('/api/app/shifts/:id/reorder', staff(async (user, request) => {
    const fields = parse(z.object({ targetId: id, placement: z.enum(['before', 'after']) }), request.body)
    return reorderShift(user, parse(id, request.params.id), fields.targetId, fields.placement)
  }))
  app.post('/api/app/shifts', staff(async (user, request, reply) =>
    reply.code(201).send(await saveShift(user, parse(assignment, request.body)))))
  app.put('/api/app/shifts/:id', staff(async (user, request) =>
    saveShift(user, parse(assignment.extend({ version }), request.body), parse(id, request.params.id))))
  app.delete('/api/app/shifts/:id', staff(async (user, request, reply) => {
    await cancelShift(user, parse(id, request.params.id), parse(z.coerce.number().pipe(version), request.query.version))
    return reply.code(204).send()
  }))

  app.get('/api/app/report', authenticated(['admin','manager','engineer'], async (user, request) => {
    const { startsAt, endsAt } = readRange(request)
    const templateId = request.query.templateId === undefined ? undefined : request.query.templateId === 'unclassified' ? null : parse(id, request.query.templateId)
    return report(user, startsAt, endsAt, templateId)
  }))

  registerLeave(app, authenticated)
  registerClassification(app, admin)

  app.get('/api/app/changes', authenticated(['admin','manager','engineer'], listChanges))
  app.post('/api/app/changes', authenticated(['engineer'], async (user, request, reply) =>
    reply.code(201).send(await requestChange(user, parse(proposal, request.body)))))
  app.post('/api/app/changes/batch', { bodyLimit: 256 * 1024 }, authenticated(['engineer'], async (user, request, reply) =>
    reply.code(201).send(await requestChanges(user, parse(batchProposal, request.body).proposals))))
  app.post('/api/app/changes/:id/review', admin(async (user, request, reply) => {
    const fields = parse(z.object({ decision: z.enum(['approved', 'rejected']), note, allowOverlap: z.boolean().default(false) }), request.body)
    await reviewChange(user, parse(id, request.params.id), fields.decision, fields.note, fields.allowOverlap)
    return reply.code(204).send()
  }))
  app.get('/api/app/changes/:id/revert-preview', admin((user, request) => previewRevert(user, parse(id, request.params.id))))
  app.post('/api/app/changes/:id/revert', admin(async (user, request, reply) => {
    const fields = parse(z.object({ versions: z.array(z.object({ id, version })).min(1).max(2), confirmLaterChanges: z.boolean().default(false), allowOverlap: z.boolean().default(false), note }), request.body)
    await revertChange(user, parse(id, request.params.id), fields)
    return reply.code(204).send()
  }))
  app.post('/api/app/changes/:id/withdraw', authenticated(['engineer'], async (user, request, reply) => {
    await reviewChange(user, parse(id, request.params.id), 'withdrawn', '')
    return reply.code(204).send()
  }))

  app.get('/api/app/notifications', signedIn(async (user) => {
    const rows = await query('SELECT id, title, body, created_at, read_at FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 100', [user.id])
    return rows.map((row) => ({
      id: row.id, title: row.title, body: row.body, createdAt: iso(row.created_at), unread: row.read_at == null,
    }))
  }))
  app.post('/api/app/notifications/read', signedIn(async (user, request, reply) => {
    const { notificationId } = parse(z.object({ notificationId: id.optional() }), request.body)
    const params = [Date.now(), user.id]
    if (notificationId) params.push(notificationId)
    await query('UPDATE notifications SET read_at = ? WHERE user_id = ? AND read_at IS NULL' +
      (notificationId ? ' AND id = ?' : ''), params)
    return reply.code(204).send()
  }))

  registerCalendarOrder(app, staff)
  registerTeams(app, admin, signedIn)
  registerGroups(app, staff, signedIn)
  registerTemplates(app, admin, signedIn)
  registerHolidays(app, admin, signedIn)
  registerIntegrations(app, admin)
  return app
}
