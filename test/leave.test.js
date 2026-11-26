import { registerHooks } from 'node:module'
import { readFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { randomUUID } from 'node:crypto'
import test from 'node:test'
import assert from 'node:assert/strict'
import Fastify from 'fastify'
import { DateTime } from 'luxon'

const mysqlDb = process.env.LEAVE_MYSQL_TEST === '1' ? await import('../server/db.js') : null
const database = new DatabaseSync(':memory:')
const schema = readFileSync(new URL('../server/schema.sql', import.meta.url), 'utf8').replaceAll(/ENUM\([^)]*\)/g, 'TEXT').replaceAll(/^  INDEX \([^\n]*\),?\n/gm, '').replaceAll(/,\n\);/g, '\n);').replace('INSERT IGNORE', 'INSERT OR IGNORE')
if (mysqlDb) {
  const raw = readFileSync(new URL('../server/schema.sql', import.meta.url), 'utf8')
  for (const statement of raw.split(';').map(s => s.trim()).filter(Boolean)) await mysqlDb.query(statement)
} else database.exec(schema)
const query = async (sql, args = []) => {
  if (mysqlDb) return mysqlDb.query(sql, args)
  const statement = database.prepare(sql)
  if (/^\s*SELECT\b/i.test(sql)) return statement.all(...args)
  return { affectedRows: statement.run(...args).changes }
}
let previous = Promise.resolve()
function rosterWrite(work) {
  if (mysqlDb) return mysqlDb.rosterWrite(work)
  const result = previous.then(async () => { database.exec('BEGIN'); try { const value = await work(query); database.exec('COMMIT'); return value } catch (error) { database.exec('ROLLBACK'); throw error } })
  previous = result.catch(() => {})
  return result
}
const key = Symbol.for('leave.test.database')
globalThis[key] = { query, rosterWrite }
const db = new URL('../server/db.js', import.meta.url).href
const hooks = registerHooks({ resolve(specifier, context, next) { const r = next(specifier, context); return r.url === db ? { url: 'data:text/javascript,' + encodeURIComponent("export const {query,rosterWrite}=globalThis[Symbol.for('leave.test.database')]"), shortCircuit: true } : r } })
const leave = await import('../server/leave.js')
const { saveShift, cancelShift, requestChange, reviewChange, previewRevert, revertChange } = await import('../server/roster.js')
const { saveGroup, cancelGroup } = await import('../server/group-service.js')
const { applyClassification, previewClassification } = await import('../server/classification.js')
hooks.deregister()
const now = DateTime.now().setZone('Asia/Kuala_Lumpur')
const future = now.plus({ weeks: 4 }).startOf('week')
const day = future.toISODate()
const overnight = (engineer, start, templateId) => ({ engineerId: engineer.id, start: start.toISO(), end: start.plus({ hours: 24 }).toISO(), templateId, note: '', allowOverlap: true })
async function user(name, role = 'engineer') {
  const p = { id: randomUUID(), name, role }
  await query('INSERT INTO users (id,name,email,role,password_hash) VALUES (?,?,?,?,?)', [p.id, name, p.id + '@example.com', role, 'test'])
  return p
}
async function template(name) { const id = randomUUID(); await query('INSERT INTO shift_templates (id,name,start_time,end_time,end_day_offset) VALUES (?,?,?,?,?)', [id, name, '09:00', '09:00', 1]); return id }
function request(from, to = from, halves = []) { return { from, to, halves } }
async function apply(engineer, input) { const p = await leave.previewLeave(engineer, input); return leave.submitLeave(engineer, { ...input, reason: 'Family time', operationId: randomUUID(), fingerprint: p.fingerprint }) }
async function act(actor, id, action, reason = '') { const [r] = await query('SELECT version FROM leave_requests WHERE id=?', [id]); return leave.transitionLeave(actor, id, { version: r.version, action, reason }) }
async function bal(engineer) { return (await leave.leaveOverview(engineer)).people[0] }

test('leave credits, approvals and roster changes retain a complete accounting history', async t => {
  const admin = await user('Admin', 'admin'), manager = await user('Manager', 'manager'), a = await user('A'), b = await user('B'), viewer = await user('Viewer', 'viewer')
  const weekend = await template('Weekend'), holiday = await template('Public holiday'), night = await template('Night')
  const historical = now.minus({ days: 7 }).set({ hour: 9, minute: 0, second: 0, millisecond: 0 })
  const past = await saveShift(admin, overnight(a, historical, weekend))
  await saveShift(admin, overnight(a, historical.minus({ days: 2 }), holiday))
  await saveShift(admin, overnight(a, historical.minus({ days: 4 }), null))
  const start = historical.minus({ days: 10 }).toISODate()
  await t.test('permissions, initialization preview, retries and manual credit', async () => {
    await assert.rejects(async () => leave.leaveOverview(viewer), { statusCode: 403 })
    await assert.rejects(async () => leave.leaveHistory(a, b.id), { statusCode: 403 })
    await assert.rejects(async () => leave.saveLeaveRule(manager, { templateId: weekend, effectiveOn: start, units: 2 }), { statusCode: 403 })
    await leave.saveLeaveRule(admin, { templateId: weekend, effectiveOn: start, units: 2 })
    await leave.saveLeaveRule(admin, { templateId: holiday, effectiveOn: start, units: 4 })
    assert.equal((await bal(a)).balance, 0)
    const p = await leave.previewLeaveSetup(admin, { from: start, openingDebits: [{ engineerId: a.id, units: 1 }] })
    assert.equal(p.duties.filter(d => !d.templateId).length, 1)
    await leave.saveLeaveRule(admin, { templateId: night, effectiveOn: start, units: 0 })
    await assert.rejects(async () => leave.activateLeave(admin, { ...p, fingerprint: p.fingerprint }), { statusCode: 409 })
    const fresh = await leave.previewLeaveSetup(admin, { from: start, openingDebits: [{ engineerId: a.id, units: 1 }] })
    await leave.activateLeave(admin, fresh)
    assert.equal((await bal(a)).balance, 5)
    await assert.rejects(async () => leave.activateLeave(admin, fresh), { statusCode: 409 })
    await Promise.all([leave.accrueLeave(), leave.accrueLeave()])
    assert.equal((await bal(a)).balance, 5)
    const adjustment = { engineerId: a.id, units: 6, reason: 'Additional work', operationId: randomUUID() }
    await Promise.all([leave.adjustLeave(manager, adjustment), leave.adjustLeave(manager, adjustment)])
    assert.equal((await bal(a)).balance, 11)
    await assert.rejects(async () => leave.adjustLeave(manager, { ...adjustment, operationId: randomUUID(), units: -1 }), { statusCode: 403 })
    await assert.rejects(async () => leave.adjustLeave(admin, { ...adjustment, units: 8 }), { statusCode: 409 })
    await assert.rejects(async () => leave.saveLeaveRule(admin, { templateId: weekend, effectiveOn: start, units: 4 }), { statusCode: 400 })
  })
  await t.test('reservations prevent concurrent overspending; approvals spend once and cancellation refunds once', async () => {
    await leave.adjustLeave(admin, { engineerId: b.id, units: 2, reason: 'Opening credit', operationId: randomUUID() })
    const first = request(day), second = request(future.plus({ days: 1 }).toISODate())
    const p1 = await leave.previewLeave(b, first), p2 = await leave.previewLeave(b, second)
    const outcomes = await Promise.allSettled([
      leave.submitLeave(b, { ...first, reason: 'One', operationId: randomUUID(), fingerprint: p1.fingerprint }),
      leave.submitLeave(b, { ...second, reason: 'Two', operationId: randomUUID(), fingerprint: p2.fingerprint }),
    ])
    assert.equal(outcomes.filter(r => r.status === 'fulfilled').length, 1)
    const id = outcomes.find(r => r.status === 'fulfilled').value.id
    assert.equal((await bal(b)).available, 0)
    await assert.rejects(act(b, id, 'approve'), { statusCode: 403 })
    await assert.rejects(async () => leave.previewLeave(b, first), { statusCode: 409 })
    await act(manager, id, 'approve')
    await leave.transitionLeave(manager, id, { version: 1, action: 'approve' })
    assert.equal((await bal(b)).balance, 0)
    assert.equal((await bal(b)).reserved, 0)
    await act(b, id, 'cancel', 'Plans changed')
    await leave.transitionLeave(b, id, { version: 2, action: 'cancel', reason: 'Plans changed' })
    assert.equal((await bal(b)).available, 2)
    assert.equal((await leave.listLeave(b)).length, 1)
  })
  await t.test('holidays, weekends and half days are itemized, and holiday changes block stale approval', async () => {
    const tuesday = future.plus({ days: 1 }).toISODate()
    const ics = 'BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:holiday\r\nDTSTART;VALUE=DATE:' + tuesday.replaceAll('-', '') + '\r\nSUMMARY:Public holiday\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n'
    const feedId = randomUUID()
    await query('INSERT INTO holiday_feeds (id,name,url,color,calendar_data,attempted_at) VALUES (?,?,?,?,?,?)', [feedId, 'Holiday', 'https://example.com/cal', '#ffffff', ics, Date.now()])
    const p = await leave.previewLeave(a, request(day, future.plus({ days: 6 }).toISODate(), [{ date: day, part: 'am' }]))
    assert.equal(p.units, 7)
    assert.equal(p.dates.filter(d => d.excluded).length, 3)
    const r = await apply(a, request(day))
    await query('UPDATE holiday_feeds SET calendar_data=? WHERE id=?', [ics.replaceAll(tuesday.replaceAll('-', ''), day.replaceAll('-', '')), feedId])
    await assert.rejects(act(manager, r.id, 'approve'), { statusCode: 409 })
    await act(manager, r.id, 'reject', 'Updated holiday')
    await query('DELETE FROM holiday_feeds WHERE id=?', [feedId])
    const next = await apply(a, request(day))
    await act(a, next.id, 'withdraw')
    assert.equal((await bal(a)).reserved, 0)
  })
  await t.test('approved half-day leave blocks ordinary duties and grouped occurrences, including exact boundaries', async () => {
    const r = await apply(a, request(day, day, [{ date: day, part: 'am' }]))
    await act(admin, r.id, 'approve')
    const morning = future.set({ hour: 9 })
    await assert.rejects(saveShift(admin, { engineerId: a.id, start: morning.toISO(), end: morning.plus({ hours: 1 }).toISO(), note: '', allowOverlap: true }), { statusCode: 409 })
    await saveShift(admin, { engineerId: a.id, start: future.set({ hour: 12 }).toISO(), end: future.set({ hour: 13 }).toISO(), note: '', allowOverlap: true })
    await assert.rejects(saveGroup(admin, { engineerId: a.id, firstDate: day, lastDate: day, weekdays: [1,2,3,4,5,6,7], startTime: '09:00', endTime: '10:00', endDayOffset: 0, timezone: 'Asia/Kuala_Lumpur', allowOverlap: true }), { statusCode: 409 })
    await act(a, r.id, 'cancel', 'Changed plans')
    const ordinary = await saveShift(admin, { engineerId: a.id, start: morning.toISO(), end: morning.plus({ hours: 1 }).toISO(), note: '', allowOverlap: true })
    await assert.rejects(async () => leave.previewLeave(a, request(day)), { statusCode: 409 })
    await cancelShift(admin, ordinary.id, ordinary.version)
  })
  await t.test('approval rechecks duties scheduled after submission and releases no funds on failure', async () => {
    const leaveDate = future.plus({ days: 10 }).toISODate()
    const input = request(leaveDate), p = await leave.previewLeave(b, input), operationId = randomUUID()
    const body = { ...input, reason: 'Trip', operationId, fingerprint: p.fingerprint }
    const r = await leave.submitLeave(b, body)
    assert.equal((await leave.submitLeave(b, body)).id, r.id)
    const booked = await saveShift(admin, { engineerId: b.id, start: future.plus({ days: 10, hours: 9 }).toISO(), end: future.plus({ days: 10, hours: 10 }).toISO(), note: '', allowOverlap: true })
    const before = (await bal(b)).balance
    await assert.rejects(act(manager, r.id, 'approve'), { statusCode: 409 })
    assert.equal((await bal(b)).balance, before)
    assert.equal((await bal(b)).reserved, 2)
    await cancelShift(admin, booked.id, booked.version)
    await act(b, r.id, 'withdraw')
  })
  await t.test('duty reassignment transfers credit; cancellation and restore reconcile without duplicates', async () => {
    const beforeA = (await bal(a)).balance, beforeB = (await bal(b)).balance
    const updated = await saveShift(admin, { ...overnight(b, historical, weekend), version: past.version }, past.id)
    assert.equal((await bal(a)).balance, beforeA - 2)
    assert.equal((await bal(b)).balance, beforeB + 2)
    await cancelShift(admin, updated.id, updated.version)
    assert.equal((await bal(b)).balance, beforeB)
    await leave.accrueLeave()
    assert.equal((await bal(b)).balance, beforeB)
  })
  await t.test('repeated duty credits are per occurrence and cancel as an atomic group', async () => {
    const before = (await bal(a)).balance
    const first = historical.minus({ days: 10 }).toISODate(), last = historical.minus({ days: 8 }).toISODate()
    const group = await saveGroup(admin, { engineerId: a.id, templateId: weekend, firstDate: first, lastDate: last, weekdays: [1,2,3,4,5,6,7], startTime: '09:00', endTime: '09:00', endDayOffset: 1, timezone: 'Asia/Kuala_Lumpur', allowOverlap: true })
    assert.equal((await bal(a)).balance, before + 6)
    await Promise.all([leave.accrueLeave(), leave.accrueLeave()])
    assert.equal((await bal(a)).balance, before + 6)
    await cancelGroup(admin, group.id, group.version)
    assert.equal((await bal(a)).balance, before)
  })
  await t.test('swaps and approved-change restores cannot assign duty during approved leave', async () => {
    await leave.adjustLeave(admin, { engineerId: b.id, units: 10, reason: 'More credit', operationId: randomUUID() })
    const leaveDay = future.plus({ days: 2 }).toISODate()
    const absence = await apply(a, request(leaveDay))
    await act(manager, absence.id, 'approve')
    const source = await saveShift(admin, { engineerId: b.id, start: future.plus({ days: 2, hours: 9 }).toISO(), end: future.plus({ days: 2, hours: 10 }).toISO(), note: '', allowOverlap: true })
    const target = await saveShift(admin, { engineerId: a.id, start: future.plus({ days: 3, hours: 9 }).toISO(), end: future.plus({ days: 3, hours: 10 }).toISO(), note: '', allowOverlap: true })
    await assert.rejects(requestChange(b, { engineerId: b.id, shiftId: source.id, version: source.version, start: target.start, end: target.end, swapShiftId: target.id, swapVersion: target.version, reason: 'Swap', allowOverlap: true }), { statusCode: 409 })
    const original = await saveShift(admin, { engineerId: b.id, start: future.plus({ days: 4, hours: 9 }).toISO(), end: future.plus({ days: 4, hours: 10 }).toISO(), note: '', allowOverlap: true })
    const change = await requestChange(b, { engineerId: a.id, shiftId: original.id, version: original.version, start: original.start, end: original.end, reason: 'Replacement', allowOverlap: true })
    await reviewChange(admin, change.id, 'approved', '', true)
    const bLeave = await apply(b, request(future.plus({ days: 4 }).toISODate()))
    await act(manager, bLeave.id, 'approve')
    const preview = await previewRevert(admin, change.id)
    await assert.rejects(revertChange(admin, change.id, { versions: preview.shifts.map(s => ({ id: s.current.id, version: s.current.version })), confirmLaterChanges: true, allowOverlap: true, note: '' }), { statusCode: 409 })
    const [after] = await query('SELECT engineer_id FROM shifts WHERE id=?', [original.id])
    assert.equal(after.engineer_id, a.id)
  })
  await t.test('retroactive classification earns credit and corrections may make the available balance negative', async () => {
    const startTime = historical.minus({ days: 4 })
    const p = await previewClassification(admin, startTime.startOf('day').toMillis(), startTime.plus({ days: 2 }).toMillis())
    // Two templates share these times, so classification correctly needs a manual choice.
    assert.equal(p.units[0].status, 'ambiguous')
    const [untyped] = await query('SELECT * FROM shifts WHERE template_id IS NULL AND engineer_id=?', [a.id])
    const before = (await bal(a)).balance
    await saveShift(admin, { ...overnight(a, startTime, weekend), version: untyped.version }, untyped.id)
    assert.equal((await bal(a)).balance, before + 2)
    await leave.adjustLeave(admin, { engineerId: a.id, units: -100, reason: 'Historical correction', operationId: randomUUID() })
    assert.ok((await bal(a)).available < 0)
    await assert.rejects(apply(a, request(future.plus({ days: 8 }).toISODate())), { statusCode: 409 })
  })
  database.close()
  if (mysqlDb) await mysqlDb.pool.end()
})

test('duty rates use local start dates and completion, independent of group outer spans', () => {
  const r = [{ id: 'old', template_id: 'weekend', effective_on: '2040-01-01', units: 2 }, { id: 'new', template_id: 'weekend', effective_on: '2040-02-01', units: 4 }]
  const s = { template_id: 'weekend', starts_at: Date.parse('2040-01-31T23:00:00+08:00'), ends_at: Date.parse('2040-02-01T09:00:00+08:00') }
  assert.equal(leave.dutyEntitlement(s, r, '2040-01-01', s.ends_at - 1).units, 0)
  assert.equal(leave.dutyEntitlement(s, r, '2040-01-01', s.ends_at).units, 2)
  assert.equal(leave.dutyEntitlement({ ...s, cancelled: 1 }, r, '2040-01-01', s.ends_at).units, 0)
})
