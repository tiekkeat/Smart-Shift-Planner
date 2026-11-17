import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { query, rosterWrite } from './db.js'
import { httpError, instant, interval, iso, rosterTimeZone } from './domain.js'
import { encrypt, hash, secret } from './security.js'
import { audit, json, listShifts, onCall } from './roster.js'
import { id, parse, range, timestamp } from './validation.js'
import { openapi } from './openapi.js'

export const scopes = [
  'on_call:read', 'shifts:read', 'engineers:read', 'contact:phone', 'contact:email', 'contact:dingtalk',
]
const name = z.string().trim().min(1).max(120)
const issueToken = z.object({
  name, scopes: z.array(z.enum(scopes)).min(1).max(scopes.length),
  expiresInDays: z.number().int().min(1).max(365),
})
const createWebhook = z.object({ name, url: z.url().max(2048) })

function asIso(value) {
  return value == null ? null : iso(value)
}

function contact(row, granted) {
  return {
    id: row.engineer_id || row.id, name: row.engineer_name || row.name,
    ...(granted.includes('contact:phone') && { phone: row.phone }),
    ...(granted.includes('contact:email') && { email: row.email }),
    ...(granted.includes('contact:dingtalk') && { dingtalkId: row.dingtalk_id }),
  }
}

async function authorize(request, scope) {
  const match = /^Bearer (st_[A-Za-z0-9_-]{43})$/i.exec(request.headers.authorization || '')
  if (!match) throw httpError(401, 'A service token is required.')
  const now = Date.now()
  const [token] = await query('SELECT id, scopes FROM api_tokens WHERE token_hash = ? AND revoked_at IS NULL AND expires_at > ?', [
    hash(match[1]), now,
  ])
  if (!token) throw httpError(401, 'The service token is invalid, expired, or revoked.')
  const granted = json(token.scopes)
  if (!granted.includes(scope)) throw httpError(403, 'This token requires the ' + scope + ' scope.')
  await query('UPDATE api_tokens SET last_used_at = ? WHERE id = ? AND (last_used_at IS NULL OR last_used_at < ?)', [
    now, token.id, now - 60_000,
  ])
  return granted
}

export function webhookUrl(input) {
  let url
  try { url = new URL(input) } catch { throw httpError(400, 'Enter a valid webhook URL.') }
  const allowed = (process.env.WEBHOOK_ALLOWED_ORIGINS || '').split(',').map((value) => value.trim())
  if (url.protocol !== 'https:' || url.username || url.password || url.hash || !allowed.includes(url.origin)) {
    throw httpError(400, 'Use an HTTPS webhook URL on a configured allowed origin.')
  }
  return url.href
}

export function registerIntegrations(app, admin) {
  app.get('/api/v1/openapi.json', async () => openapi)

  app.get('/api/v1/on-call', async (request) => {
    const granted = await authorize(request, 'on_call:read')
    const { at } = parse(z.object({ at: timestamp.optional() }), request.query)
    const time = at ? instant(at) : Date.now()
    const row = await onCall(time)
    const context = { at: iso(time), timezone: rosterTimeZone }
    if (!row) return { status: 'uncovered', ...context, shift: null, engineer: null }
    return {
      status: 'covered', ...context, engineer: contact(row, granted),
      shift: { id: row.id, ...(row.group_id && { groupId: row.group_id }), start: iso(row.starts_at), end: iso(row.ends_at) },
    }
  })

  app.get('/api/v1/shifts', async (request) => {
    await authorize(request, 'shifts:read')
    const { from, to } = parse(range, request.query)
    const { startsAt, endsAt } = interval(from, to, 63)
    const rows = await listShifts(startsAt, endsAt)
    return { shifts: rows.map((row) => ({
      id: row.id, engineerId: row.engineer_id, engineerName: row.engineer_name,
      start: iso(row.starts_at), end: iso(row.ends_at), version: row.version, ...(row.group_id && { groupId: row.group_id }),
    })) }
  })

  app.get('/api/v1/engineers/:id', async (request) => {
    const granted = await authorize(request, 'engineers:read')
    const [row] = await query("SELECT * FROM users WHERE id = ? AND role = 'engineer' AND active = 1", [
      parse(id, request.params.id),
    ])
    if (!row) throw httpError(404, 'Active engineer not found.')
    return contact(row, granted)
  })

  app.get('/api/app/tokens', admin(async () => {
    const rows = await query('SELECT id, name, scopes, expires_at, last_used_at, revoked_at FROM api_tokens ORDER BY created_at DESC')
    return rows.map((row) => ({
      id: row.id, name: row.name, scopes: json(row.scopes), expiresAt: iso(row.expires_at),
      lastUsedAt: asIso(row.last_used_at), revokedAt: asIso(row.revoked_at),
    }))
  }))

  app.post('/api/app/tokens', admin(async (user, request, reply) => {
    const fields = parse(issueToken, request.body)
    const granted = [...new Set(fields.scopes)]
    if (!granted.some((scope) => scope.endsWith(':read'))) throw httpError(400, 'Select at least one read scope.')
    const token = secret('st_')
    const tokenId = randomUUID()
    await rosterWrite(async (run) => {
      const now = Date.now()
      await run('INSERT INTO api_tokens (id, name, token_hash, scopes, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?)', [
        tokenId, fields.name, hash(token), JSON.stringify(granted), now + fields.expiresInDays * 86_400_000, now,
      ])
      await audit(run, user.id, 'token.issued', tokenId, { scopes: granted })
    })
    return reply.code(201).send({ id: tokenId, token })
  }))

  app.delete('/api/app/tokens/:id', admin(async (user, request, reply) => {
    const tokenId = parse(id, request.params.id)
    await rosterWrite(async (run) => {
      const result = await run('UPDATE api_tokens SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL', [Date.now(), tokenId])
      if (result.affectedRows) await audit(run, user.id, 'token.revoked', tokenId, {})
    })
    return reply.code(204).send()
  }))

  app.delete('/api/app/tokens/:id/permanent', admin(async (user, request, reply) => {
    const tokenId = parse(id, request.params.id)
    await rosterWrite(async (run) => {
      const [token] = await run('SELECT revoked_at FROM api_tokens WHERE id = ?', [tokenId])
      if (!token) throw httpError(404, 'Token not found.')
      if (token.revoked_at == null) throw httpError(409, 'Revoke this token before deleting it.')
      await run('DELETE FROM api_tokens WHERE id = ? AND revoked_at IS NOT NULL', [tokenId])
      await audit(run, user.id, 'token.deleted', tokenId, {})
    })
    return reply.code(204).send()
  }))

  app.get('/api/app/webhooks', admin(async () => {
    const rows = await query('SELECT id, name, url, active FROM webhooks ORDER BY created_at DESC')
    return rows.map((row) => ({ ...row, active: Boolean(row.active) }))
  }))

  app.post('/api/app/webhooks', admin(async (user, request, reply) => {
    const fields = parse(createWebhook, request.body)
    const url = webhookUrl(fields.url)
    const signatureSecret = secret('wh_')
    const hookId = randomUUID()
    await rosterWrite(async (run) => {
      await run('INSERT INTO webhooks (id, name, url, encrypted_secret, created_at) VALUES (?, ?, ?, ?, ?)', [
        hookId, fields.name, url, encrypt(signatureSecret), Date.now(),
      ])
      await audit(run, user.id, 'webhook.created', hookId, {})
    })
    return reply.code(201).send({ id: hookId, secret: signatureSecret })
  }))

  app.delete('/api/app/webhooks/:id', admin(async (user, request, reply) => {
    const hookId = parse(id, request.params.id)
    await rosterWrite(async (run) => {
      const result = await run('UPDATE webhooks SET active = 0 WHERE id = ? AND active = 1', [hookId])
      await run("UPDATE webhook_deliveries SET state = 'cancelled' WHERE webhook_id = ? AND state = 'queued'", [hookId])
      if (result.affectedRows) await audit(run, user.id, 'webhook.disabled', hookId, {})
    })
    return reply.code(204).send()
  }))

  app.get('/api/app/deliveries', admin(async () => {
    const rows = await query(`SELECT d.id, w.name, d.state, d.attempts, d.last_error, d.created_at, d.payload
      FROM webhook_deliveries d JOIN webhooks w ON w.id = d.webhook_id ORDER BY d.created_at DESC LIMIT 50`)
    return rows.map((row) => ({
      id: row.id, name: row.name, state: row.state, attempts: row.attempts,
      lastError: row.last_error, createdAt: iso(row.created_at), event: json(row.payload).type,
    }))
  }))
}
