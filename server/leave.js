import { randomUUID, createHash } from 'node:crypto'
import { DateTime } from 'luxon'
import { z } from 'zod'
import { query, rosterWrite } from './db.js'
import { httpError, rosterTimeZone } from './domain.js'
import { holidayOccurrences } from './holiday-feed.js'
import { id, parse, version } from './validation.js'

const json = value => typeof value === 'string' ? JSON.parse(value) : value
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical)
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]))
  return value
}
const digest = value => createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex')
const today = () => DateTime.now().setZone(rosterTimeZone).toISODate()
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => DateTime.fromISO(value, { zone: rosterTimeZone }).isValid, 'Choose a valid date.')
const reason = z.string().trim().min(1).max(500)
const units = z.number().int().min(0).max(7300)
const selection = z.object({ from: date, to: date, halves: z.array(z.object({ date, part: z.enum(['am', 'pm']) })).max(63).default([]) })
const setupInput = z.object({ from: date, openingDebits: z.array(z.object({ engineerId: id, units })).max(1000).default([]) })
const fingerprint = z.string().regex(/^[a-f0-9]{64}$/)
function role(user, roles) { if (!roles.includes(user.role)) throw httpError(403, 'Your role does not allow this leave action.') }
function own(user, engineerId) { role(user, ['admin', 'manager', 'engineer']); if (user.role === 'engineer' && engineerId !== user.id) throw httpError(403, 'You can only access your own leave.') }
async function log(run, actor, action, entity, detail) {
  await run('INSERT INTO audit_log (id,actor_id,action,entity_id,detail,created_at) VALUES (?,?,?,?,?,?)', [randomUUID(), actor.id, action, entity, JSON.stringify(detail), Date.now()])
}
async function notify(run, userId, title, body) {
  await run('INSERT INTO notifications (id,user_id,title,body,created_at) VALUES (?,?,?,?,?)', [randomUUID(), userId, title, body, Date.now()])
}
async function activeEngineer(run, engineerId) {
  const [user] = await run("SELECT id FROM users WHERE id=? AND role='engineer' AND active=1 AND deleted_at IS NULL", [engineerId])
  if (!user) throw httpError(400, 'Choose an active engineer.')
}
async function ledger(run, engineerId, amount, kind, key, note, actor = null) {
  if (!amount) return
  await run('INSERT INTO leave_ledger (id,engineer_id,units,kind,source_key,reason,actor_id,created_at) VALUES (?,?,?,?,?,?,?,?)', [randomUUID(), engineerId, amount, kind, key, note, actor?.id || null, Date.now()])
  await notify(run, engineerId, 'Compensation leave updated', `${amount > 0 ? '+' : ''}${amount / 2} days · ${note}`)
}
async function settings(run) { const [row] = await run('SELECT * FROM leave_settings WHERE id=1'); return row || null }
async function rules(run) { return run('SELECT r.*, t.name AS template_name, t.archived_at FROM leave_rules r JOIN shift_templates t ON t.id=r.template_id ORDER BY r.effective_on DESC, r.id') }
export function dutyEntitlement(shift, allRules, startOn, now = Date.now(), projected = false) {
  const day = DateTime.fromMillis(Number(shift.starts_at), { zone: rosterTimeZone }).toISODate()
  if (shift.cancelled || day < startOn || (!projected && Number(shift.ends_at) > now)) return { units: 0, ruleId: null }
  const rule = allRules.filter(rule => rule.template_id === shift.template_id && rule.effective_on <= day).sort((a, b) => b.effective_on.localeCompare(a.effective_on))[0]
  return { units: rule ? Number(rule.units) : 0, ruleId: rule?.id || null }
}
export async function reconcileDuty(run, shift, actor = null, context = null) {
  const config = context?.config || await settings(run)
  if (!config) return
  const allRules = context?.rules || await rules(run)
  const desired = dutyEntitlement(shift, allRules, config.starts_on)
  const [before] = await run('SELECT * FROM leave_duty_credits WHERE shift_id=?', [shift.id])
  if (!before && !desired.units) return
  if (before && Number(before.units) === desired.units && before.engineer_id === shift.engineer_id && before.rule_id === desired.ruleId) return
  const revision = Number(before?.revision || 0) + 1
  if (before?.units) await ledger(run, before.engineer_id, -Number(before.units), 'duty_reversal', `duty:${shift.id}:${revision}:reverse`, 'Correction to previously credited duty', actor)
  if (desired.units) await ledger(run, shift.engineer_id, desired.units, 'duty_credit', `duty:${shift.id}:${revision}:credit`, 'Completed duty · ' + (allRules.find(rule => rule.id === desired.ruleId)?.template_name || 'Saved template'), actor)
  if (before) await run('UPDATE leave_duty_credits SET engineer_id=?,units=?,rule_id=?,revision=? WHERE shift_id=?', [shift.engineer_id, desired.units, desired.ruleId, revision, shift.id])
  else await run('INSERT INTO leave_duty_credits (shift_id,engineer_id,units,rule_id,revision) VALUES (?,?,?,?,?)', [shift.id, shift.engineer_id, desired.units, desired.ruleId, revision])
}
export async function syncLeave(run, actor = null) {
  const config = await settings(run)
  if (!config) return
  const allRules = await rules(run)
  const rows = await run('SELECT s.* FROM shifts s WHERE s.ends_at<=? OR EXISTS (SELECT 1 FROM leave_duty_credits c WHERE c.shift_id=s.id)', [Date.now()])
  for (const shift of rows) await reconcileDuty(run, shift, actor, { config, rules: allRules })
}
export function accrueLeave() { return rosterWrite(run => syncLeave(run)) }
async function balance(run, engineerId) {
  const [earned] = await run('SELECT COALESCE(SUM(units),0) AS units FROM leave_ledger WHERE engineer_id=?', [engineerId])
  const [held] = await run("SELECT COALESCE(SUM(units),0) AS units FROM leave_requests WHERE engineer_id=? AND status='pending'", [engineerId])
  const config = await settings(run)
  let projected = 0
  if (config) {
    const allRules = await rules(run)
    for (const shift of await run('SELECT * FROM shifts WHERE engineer_id=? AND cancelled=0 AND ends_at>?', [engineerId, Date.now()])) projected += dutyEntitlement(shift, allRules, config.starts_on, Date.now(), true).units
  }
  return { balance: Number(earned.units), reserved: Number(held.units), available: Number(earned.units) - Number(held.units), projected }
}
export async function leaveOverview(user) {
  role(user, ['admin', 'manager', 'engineer'])
  return rosterWrite(async run => {
    await syncLeave(run)
    const people = await run("SELECT id,name,active,deleted_at FROM users WHERE role='engineer'" + (user.role === 'engineer' ? ' AND id=?' : '') + ' ORDER BY name', user.role === 'engineer' ? [user.id] : [])
    const result = []
    for (const person of people) result.push({ ...person, ...await balance(run, person.id) })
    return { enabled: Boolean(await settings(run)), people: result }
  })
}
export async function leaveHistory(user, engineerId) {
  own(user, engineerId)
  return query('SELECT l.*, u.name AS actor_name FROM leave_ledger l LEFT JOIN users u ON u.id=l.actor_id WHERE l.engineer_id=? ORDER BY l.created_at DESC,l.id DESC LIMIT 500', [engineerId])
}
export function adjustLeave(user, input) {
  role(user, ['admin', 'manager'])
  const fields = parse(z.object({ engineerId: id, units: z.number().int().min(-7300).max(7300).refine(n => n !== 0), reason, operationId: id }), input)
  if (fields.units < 0) role(user, ['admin'])
  return rosterWrite(async run => {
    await activeEngineer(run, fields.engineerId)
    const key = 'manual:' + fields.operationId
    const [previous] = await run('SELECT * FROM leave_ledger WHERE source_key=?', [key])
    if (previous) {
      if (previous.actor_id !== user.id || previous.engineer_id !== fields.engineerId || Number(previous.units) !== fields.units || previous.reason !== fields.reason) throw httpError(409, 'This operation was already used for a different adjustment.')
      return balance(run, fields.engineerId)
    }
    await ledger(run, fields.engineerId, fields.units, 'manual', key, fields.reason, user)
    await log(run, user, 'leave.adjusted', fields.engineerId, fields)
    return balance(run, fields.engineerId)
  })
}
export async function leaveSettings(user) {
  role(user, ['admin'])
  return { config: await settings(query), rules: await rules(query), templates: await query('SELECT id,name FROM shift_templates WHERE archived_at IS NULL ORDER BY name') }
}
export function saveLeaveRule(user, input) {
  role(user, ['admin'])
  const fields = parse(z.object({ templateId: id, effectiveOn: date, units }), input)
  return rosterWrite(async run => {
    const config = await settings(run)
    if (config && fields.effectiveOn <= today()) throw httpError(400, 'After activation, new rates must start on a future date.')
    const [template] = await run('SELECT id FROM shift_templates WHERE id=? AND archived_at IS NULL', [fields.templateId])
    if (!template) throw httpError(400, 'Choose an active template.')
    const [existing] = await run('SELECT id FROM leave_rules WHERE template_id=? AND effective_on=?', [fields.templateId, fields.effectiveOn])
    if (existing && config) throw httpError(409, 'A rate already exists for this date. Choose a different date.')
    const ruleId = existing?.id || randomUUID()
    if (existing) await run('UPDATE leave_rules SET units=?,created_by=?,created_at=? WHERE id=?', [fields.units, user.id, Date.now(), ruleId])
    else await run('INSERT INTO leave_rules (id,template_id,effective_on,units,created_by,created_at) VALUES (?,?,?,?,?,?)', [ruleId, fields.templateId, fields.effectiveOn, fields.units, user.id, Date.now()])
    await log(run, user, 'leave.rule_saved', ruleId, fields)
    return { id: ruleId }
  })
}
async function setupPreview(run, input) {
  if (await settings(run)) throw httpError(409, 'Automatic earning is already activated.')
  if (input.from > today()) throw httpError(400, 'Choose today or an earlier earning start date.')
  if (new Set(input.openingDebits.map(x => x.engineerId)).size !== input.openingDebits.length) throw httpError(400, 'Choose each engineer once.')
  const allRules = await rules(run)
  const shifts = await run('SELECT s.*,u.name AS engineer_name,t.name AS template_name FROM shifts s JOIN users u ON u.id=s.engineer_id LEFT JOIN shift_templates t ON t.id=s.template_id WHERE s.cancelled=0 AND s.ends_at<=? ORDER BY s.starts_at,s.id', [Date.now()])
  const duties = shifts.filter(s => DateTime.fromMillis(Number(s.starts_at), { zone: rosterTimeZone }).toISODate() >= input.from).map(s => ({ id: s.id, engineerId: s.engineer_id, name: s.engineer_name, templateId: s.template_id, templateName: s.template_name || null, start: Number(s.starts_at), end: Number(s.ends_at), version: s.version, ...dutyEntitlement(s, allRules, input.from) }))
  for (const debit of input.openingDebits) await activeEngineer(run, debit.engineerId)
  const prior = await run('SELECT id,engineer_id,units FROM leave_ledger ORDER BY id')
  return { ...input, duties, fingerprint: digest({ input, duties, rules: allRules, prior }) }
}
export function previewLeaveSetup(user, input) { role(user, ['admin']); const fields = parse(setupInput, input); return rosterWrite(run => setupPreview(run, fields)) }
export function activateLeave(user, input) {
  role(user, ['admin'])
  const fields = parse(setupInput.extend({ fingerprint }), input)
  return rosterWrite(async run => {
    const p = await setupPreview(run, { from: fields.from, openingDebits: fields.openingDebits })
    if (p.fingerprint !== fields.fingerprint) throw httpError(409, 'Setup changed. Review a new preview before activating.')
    await run('INSERT INTO leave_settings (id,starts_on,activated_at,activated_by) VALUES (1,?,?,?)', [fields.from, Date.now(), user.id])
    for (const debit of fields.openingDebits) await ledger(run, debit.engineerId, -debit.units, 'opening_usage', 'opening:' + debit.engineerId, 'Compensation leave already taken since ' + fields.from, user)
    await syncLeave(run, user)
    await log(run, user, 'leave.activated', user.id, { from: fields.from, openingDebits: fields.openingDebits })
    return { activated: true }
  })
}

export function leaveDays(input, holidays = new Set(), now = Date.now()) {
  const fields = parse(selection, input)
  const start = DateTime.fromISO(fields.from, { zone: rosterTimeZone }), end = DateTime.fromISO(fields.to, { zone: rosterTimeZone })
  if (end < start || end.diff(start, 'days').days > 62) throw httpError(400, 'Choose a leave range of up to 63 days.')
  if (fields.from < DateTime.fromMillis(now, { zone: rosterTimeZone }).toISODate()) throw httpError(400, 'Leave must start today or later.')
  const parts = new Map()
  for (const half of fields.halves) {
    if (parts.has(half.date) || half.date < fields.from || half.date > fields.to) throw httpError(400, 'Choose one half-day option per date within the range.')
    parts.set(half.date, half.part)
  }
  const dates = []
  for (let d = start; d <= end; d = d.plus({ days: 1 })) {
    const day = d.toISODate(), part = parts.get(day) || 'full'
    const excluded = d.weekday > 5 ? 'Weekend' : holidays.has(day) ? 'Public holiday' : null
    const from = part === 'pm' ? d.set({ hour: 12 }) : d
    const to = part === 'am' ? d.set({ hour: 12 }) : d.plus({ days: 1 })
    dates.push({ date: day, part, excluded, units: excluded ? 0 : part === 'full' ? 2 : 1, start: from.toMillis(), end: to.toMillis() })
  }
  return { selection: fields, dates, units: dates.reduce((n, d) => n + d.units, 0) }
}
async function holidayDates(run, input) {
  const holidays = new Set()
  const end = DateTime.fromISO(input.to, { zone: rosterTimeZone }).plus({ days: 1 }).toISODate()
  for (const feed of await run('SELECT calendar_data FROM holiday_feeds')) {
    let events
    try { events = holidayOccurrences(feed.calendar_data, input.from, end) } catch { throw httpError(409, 'A public holiday calendar cannot be read. Ask an admin to refresh it before applying.') }
    for (const event of events) {
      let d = DateTime.fromISO(event.start.slice(0, 10) < input.from ? input.from : event.start.slice(0, 10), { zone: rosterTimeZone })
      const until = DateTime.fromISO(event.end.slice(0, 10), { zone: rosterTimeZone })
      while (d < until && d.toISODate() <= input.to) { if (d.toISODate() >= input.from) holidays.add(d.toISODate()); d = d.plus({ days: 1 }) }
    }
  }
  return holidays
}
export async function assertNoLeave(run, engineerId, start, end) {
  const [conflict] = await run("SELECT i.id FROM leave_intervals i JOIN leave_requests r ON r.id=i.request_id WHERE i.engineer_id=? AND r.status='approved' AND i.starts_at<? AND i.ends_at>? LIMIT 1", [engineerId, end, start])
  if (conflict) throw httpError(409, 'This engineer has approved leave during the duty. Reassign the duty or cancel the leave first.')
}
async function checkRequestConflicts(run, engineerId, dates, requestId = '') {
  for (const d of dates.filter(d => d.units)) {
    const [duty] = await run('SELECT id FROM shifts WHERE engineer_id=? AND cancelled=0 AND starts_at<? AND ends_at>? LIMIT 1', [engineerId, d.end, d.start])
    if (duty) throw httpError(409, 'Requested leave overlaps assigned duty on ' + d.date + '. Reassign it first.')
    const [other] = await run("SELECT i.id FROM leave_intervals i JOIN leave_requests r ON r.id=i.request_id WHERE i.engineer_id=? AND r.status IN ('pending','approved') AND r.id<>? AND i.starts_at<? AND i.ends_at>? LIMIT 1", [engineerId, requestId, d.end, d.start])
    if (other) throw httpError(409, 'You already have pending or approved leave on ' + d.date + '.')
  }
}
async function applicationPreview(run, user, input) {
  await activeEngineer(run, user.id)
  const p = leaveDays(input, await holidayDates(run, input))
  if (!p.units) throw httpError(400, 'The selected range has no chargeable working days.')
  await checkRequestConflicts(run, user.id, p.dates)
  const b = await balance(run, user.id)
  return { ...p, ...b, remaining: b.available - p.units, fingerprint: digest(p) }
}
export function previewLeave(user, input) {
  role(user, ['engineer']); const fields = parse(selection, input)
  return rosterWrite(async run => { await syncLeave(run); return applicationPreview(run, user, fields) })
}
export function submitLeave(user, input) {
  role(user, ['engineer'])
  const fields = parse(selection.extend({ reason, fingerprint, operationId: id }), input)
  return rosterWrite(async run => {
    const [previous] = await run('SELECT * FROM leave_requests WHERE id=?', [fields.operationId])
    if (previous) {
      if (previous.engineer_id !== user.id || previous.reason !== fields.reason || digest(json(previous.selection_json)) !== digest({ from: fields.from, to: fields.to, halves: fields.halves })) throw httpError(409, 'This operation was already submitted with different details.')
      return { id: previous.id }
    }
    await syncLeave(run)
    const p = await applicationPreview(run, user, fields)
    if (p.fingerprint !== fields.fingerprint) throw httpError(409, 'Dates or holidays changed. Preview the request again.')
    if (p.remaining < 0) throw httpError(409, 'Insufficient available compensation leave.')
    const rid = fields.operationId
    await run('INSERT INTO leave_requests (id,engineer_id,reason,status,units,selection_json,snapshot_json,created_at) VALUES (?,?,?,?,?,?,?,?)', [rid, user.id, fields.reason, 'pending', p.units, JSON.stringify(p.selection), JSON.stringify(p), Date.now()])
    for (const d of p.dates.filter(d => d.units)) await run('INSERT INTO leave_intervals (id,request_id,engineer_id,starts_at,ends_at) VALUES (?,?,?,?,?)', [randomUUID(), rid, user.id, d.start, d.end])
    for (const staff of await run("SELECT id FROM users WHERE active=1 AND deleted_at IS NULL AND role IN ('admin','manager')")) await notify(run, staff.id, 'Leave application submitted', user.name + ' requested compensation leave.')
    await log(run, user, 'leave.submitted', rid, { units: p.units })
    return { id: rid }
  })
}
export async function listLeave(user) {
  role(user, ['engineer', 'admin', 'manager'])
  const rows = await query('SELECT r.*,u.name AS engineer_name FROM leave_requests r JOIN users u ON u.id=r.engineer_id' + (user.role === 'engineer' ? ' WHERE r.engineer_id=?' : '') + ' ORDER BY r.created_at DESC,r.id DESC LIMIT 500', user.role === 'engineer' ? [user.id] : [])
  return rows.map(r => ({ ...r, selection: json(r.selection_json), snapshot: json(r.snapshot_json) }))
}
export function transitionLeave(user, requestId, input) {
  const fields = parse(z.object({ version, action: z.enum(['approve', 'reject', 'withdraw', 'cancel']), reason: z.string().trim().max(500).default('') }), input)
  return rosterWrite(async run => {
    role(user, ['engineer', 'admin', 'manager'])
    const [r] = await run('SELECT * FROM leave_requests WHERE id=?', [requestId])
    if (!r) throw httpError(404, 'Leave application not found.')
    own(user, r.engineer_id)
    const expected = { approve: 'approved', reject: 'rejected', withdraw: 'withdrawn', cancel: 'cancelled' }[fields.action]
    if (r.status === expected && r.reviewed_by === user.id && Number(r.version) === fields.version + 1) return { status: r.status }
    if (Number(r.version) !== fields.version) throw httpError(409, 'The application changed. Refresh before continuing.')
    const snapshot = json(r.snapshot_json)
    const dates = snapshot.dates.filter(d => d.units)
    if (fields.action === 'approve' || fields.action === 'reject') {
      role(user, ['admin', 'manager'])
      if (r.status !== 'pending') throw httpError(409, 'Only pending applications can be reviewed.')
      if (fields.action === 'approve') {
        await activeEngineer(run, r.engineer_id)
        await syncLeave(run)
        const selected = json(r.selection_json)
        const current = leaveDays(selected, await holidayDates(run, selected))
        if (digest(current.dates) !== digest(snapshot.dates)) throw httpError(409, 'Public holidays changed. Reject this request and ask the engineer to preview and submit again.')
        await checkRequestConflicts(run, r.engineer_id, dates, r.id)
        const b = await balance(run, r.engineer_id)
        if (b.available < 0) throw httpError(409, 'The reserved balance is no longer covered. Add credit or reject the request.')
        await ledger(run, r.engineer_id, -Number(r.units), 'leave_taken', 'request:' + r.id + ':approved', 'Approved compensation leave', user)
      }
    } else if (fields.action === 'withdraw') {
      role(user, ['engineer'])
      if (r.status !== 'pending') throw httpError(409, 'Only pending applications can be withdrawn.')
    } else {
      if (r.status !== 'approved') throw httpError(409, 'Only approved leave can be cancelled.')
      if (user.role !== 'admin' && (user.id !== r.engineer_id || Math.min(...dates.map(d => d.start)) <= Date.now())) throw httpError(403, 'Only the engineer can cancel future leave; started leave requires an admin correction.')
      if (!fields.reason) throw httpError(400, 'Provide a cancellation reason.')
      await ledger(run, r.engineer_id, Number(r.units), 'leave_refund', 'request:' + r.id + ':cancelled', fields.reason, user)
    }
    await run('UPDATE leave_requests SET status=?,version=version+1,reviewed_by=?,review_note=?,reviewed_at=? WHERE id=?', [expected, user.id, fields.reason, Date.now(), r.id])
    await log(run, user, 'leave.' + expected, r.id, { reason: fields.reason })
    await notify(run, r.engineer_id, 'Leave application ' + expected, fields.reason || 'Open Leave applications for details.')
    return { status: expected }
  })
}
export function registerLeave(app, authenticated) {
  const allowed = fn => authenticated(['admin', 'manager', 'engineer'], fn)
  app.get('/api/app/leave/balances', allowed(user => leaveOverview(user)))
  app.get('/api/app/leave/history/:id', allowed((user, req) => leaveHistory(user, parse(id, req.params.id))))
  app.post('/api/app/leave/adjustments', allowed((user, req) => adjustLeave(user, req.body)))
  app.get('/api/app/leave/settings', allowed(user => leaveSettings(user)))
  app.post('/api/app/leave/rules', allowed((user, req) => saveLeaveRule(user, req.body)))
  app.post('/api/app/leave/setup-preview', allowed((user, req) => previewLeaveSetup(user, req.body)))
  app.post('/api/app/leave/activate', allowed((user, req) => activateLeave(user, req.body)))
  app.post('/api/app/leave/preview', allowed((user, req) => previewLeave(user, req.body)))
  app.post('/api/app/leave/requests', allowed((user, req) => submitLeave(user, req.body)))
  app.get('/api/app/leave/requests', allowed(user => listLeave(user)))
  app.post('/api/app/leave/requests/:id/action', allowed((user, req) => transitionLeave(user, parse(id, req.params.id), req.body)))
}
