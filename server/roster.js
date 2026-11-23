import { expandDutyGroup } from './duty-groups.js'
import { randomUUID } from 'node:crypto'
import { query, rosterWrite } from './db.js'
import { dutyTotals, httpError, interval, iso, rosterTimeZone, shiftView } from './domain.js'

const shiftSelect = `SELECT s.*, u.name AS engineer_name
  FROM shifts s JOIN users u ON u.id = s.engineer_id`

export const json = (value) => typeof value === 'string' ? JSON.parse(value) : value

export async function audit(run, actorId, action, entityId, detail) {
  await run('INSERT INTO audit_log VALUES (?, ?, ?, ?, ?, ?)', [
    randomUUID(), actorId, action, entityId, JSON.stringify(detail), Date.now(),
  ])
}

async function notify(run, users, title, body) {
  for (const userId of new Set(users)) {
    await run('INSERT INTO notifications (id, user_id, title, body, created_at) VALUES (?, ?, ?, ?, ?)', [
      randomUUID(), userId, title, body, Date.now(),
    ])
  }
}

const describeTime = new Intl.DateTimeFormat('en-MY', {
  timeZone: rosterTimeZone, dateStyle: 'medium', timeStyle: 'short',
})

export async function recordShiftChange(run, actor, type, before, after) {
  const current = shiftView(after)
  const previous = before ? shiftView(before) : null
  const titles = {
    'duty.assigned': 'Duty assigned', 'duty.updated': 'Duty changed', 'duty.cancelled': 'Duty cancelled',
  }
  const affected = [after.engineer_id]
  if (before) affected.push(before.engineer_id)
  const time = describeTime.formatRange(new Date(after.starts_at), new Date(after.ends_at))
  const message = before && type === 'duty.updated'
    ? before.engineer_name + ' (' + describeTime.formatRange(new Date(before.starts_at), new Date(before.ends_at)) +
      ') → ' + after.engineer_name + ' (' + time + ').'
    : after.engineer_name + ' · ' + time + '.'
  await notify(run, affected, titles[type], message)
  const now = Date.now()
  const forIntegration = (shift) => shift && ({
    id: shift.id, engineerId: shift.engineerId, start: shift.start, end: shift.end,
    version: shift.version, cancelled: shift.cancelled, ...(shift.groupId && { groupId: shift.groupId }),
  })
  const record = {
    id: randomUUID(), type, occurredAt: iso(now),
    shift: forIntegration(current), previousShift: forIntegration(previous),
  }
  await audit(run, actor.id, type, after.id, { before: previous, after: current })
  const webhooks = await run('SELECT id FROM webhooks WHERE active = 1')
  for (const webhook of webhooks) {
    await run(`INSERT INTO webhook_deliveries (id, webhook_id, payload, next_attempt, created_at)
      VALUES (?, ?, ?, ?, ?)`, [randomUUID(), webhook.id, JSON.stringify(record), now, now])
  }
}

export async function findShift(run, id) {
  const [shift] = await run(shiftSelect + ' WHERE s.id = ?', [id])
  if (!shift || shift.cancelled) throw httpError(404, 'This assignment is no longer on the roster.')
  return shift
}

function checkVersion(shift, version) {
  if (shift.version !== version) throw httpError(409, 'The assignment changed. Refresh and review the latest version.')
}

async function validateAssignment(run, input, skipId, swapId) {
  const { startsAt, endsAt } = interval(input.start, input.end)
  const [engineer] = await run("SELECT id, name FROM users WHERE id = ? AND active = 1 AND role = 'engineer'", [input.engineerId])
  if (!engineer) throw httpError(400, 'Choose an active engineer.')
  const [conflict] = await run(shiftSelect +
    ' WHERE s.cancelled = 0 AND s.starts_at < ? AND s.ends_at > ? AND s.id <> ?' + (input.skipGroupId ? ' AND (s.group_id IS NULL OR s.group_id <> ?)' : '') + (swapId ? ' AND s.id <> ?' : '') + ' LIMIT 1',
  [endsAt, startsAt, skipId || '', ...(input.skipGroupId ? [input.skipGroupId] : []), ...(swapId ? [swapId] : [])])
  if (conflict && !input.allowOverlap) throw httpError(409, 'This time overlaps existing duty for ' + conflict.engineer_name + '.')
  return { startsAt, endsAt }
}

export async function applyAssignment(run, actor, input, before, swapId, restoreCancelled = false) {
  const { startsAt, endsAt } = await validateAssignment(run, input, before?.id, swapId)
  const id = before?.id || randomUUID()
  const values = [input.engineerId, startsAt, endsAt, input.note, input.color === undefined ? (before?.color || null) : input.color, id]
  if (before) {
    await run('UPDATE shifts SET ' + (restoreCancelled ? 'cancelled = 0, ' : '') + 'engineer_id = ?, starts_at = ?, ends_at = ?, note = ?, color = ?, version = version + 1 WHERE id = ?', values)
  } else {
    await run('INSERT INTO shifts (engineer_id, starts_at, ends_at, note, color, id, display_order, group_id, occurrence_date) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)', [...values, startsAt, input.groupId || null, input.occurrenceDate || null])
  }
  const after = await findShift(run, id)
  await recordShiftChange(run, actor, before ? 'duty.updated' : 'duty.assigned', before, after)
  return shiftView(after)
}

export function saveShift(actor, input, id) {
  return rosterWrite(async (run) => {
    const before = id ? await findShift(run, id) : null
    if (before) checkVersion(before, input.version)
    const result = await applyAssignment(run, actor, input, before)
    if (before?.group_id) await markGroupException(run, before)
    return result
  })
}

export function cancelShift(actor, id, version) {
  return rosterWrite(async (run) => {
    const before = await findShift(run, id)
    checkVersion(before, version)
    await run('UPDATE shifts SET cancelled = 1, version = version + 1 WHERE id = ?', [id])
    if (before.group_id) await markGroupException(run, before)
    await recordShiftChange(run, actor, 'duty.cancelled', before, {
      ...before, cancelled: 1, version: before.version + 1,
    })
  })
}

export async function listShifts(from, to, engineerId) {
  const params = [to, from]
  if (engineerId) params.push(engineerId)
  return query(shiftSelect + ' WHERE s.cancelled = 0 AND s.starts_at < ? AND s.ends_at > ?' +
    (engineerId ? ' AND s.engineer_id = ?' : '') + ' ORDER BY s.starts_at', params)
}

export async function onCall(at) {
  const [row] = await query(`SELECT s.id, s.starts_at, s.ends_at, u.id AS engineer_id,
    s.group_id, u.name AS engineer_name, u.phone, u.email, u.dingtalk_id
    FROM shifts s JOIN users u ON u.id = s.engineer_id
    WHERE s.cancelled = 0 AND s.starts_at <= ? AND s.ends_at > ? ORDER BY s.starts_at DESC, s.id LIMIT 1`, [at, at])
  return row
}

export async function report(user, from, to) {
  return dutyTotals(await listShifts(from, to, user.role === 'engineer' ? user.id : null), from, to)
}

async function createChangeRequest(run, user, input) {
  const current = await findShift(run, input.shiftId)
  if (current.engineer_id !== user.id) throw httpError(403, 'You can request changes to your own shifts.')
  checkVersion(current, input.version)
  if (current.ends_at <= Date.now()) throw httpError(400, 'This duty shift has already ended.')
  const target = input.swapShiftId ? await findShift(run, input.swapShiftId) : null
  if (target) {
    checkVersion(target, input.swapVersion)
    if (target.ends_at <= Date.now()) throw httpError(400, 'The swap duty has already ended.')
    if (target.id === current.id || target.engineer_id === current.engineer_id) throw httpError(400, 'Choose a shift assigned to another engineer.')
    if (input.engineerId !== current.engineer_id || Date.parse(input.start) !== target.starts_at || Date.parse(input.end) !== target.ends_at) throw httpError(400, 'Review the selected swap shift and its exact dates.')
    await validateAssignment(run, { engineerId: target.engineer_id, start: iso(current.starts_at), end: iso(current.ends_at), allowOverlap: input.allowOverlap }, target.id, current.id)
  }
  for (const shiftId of [current.id, ...(target ? [target.id] : [])]) {
    const [pending] = await run("SELECT id FROM change_requests WHERE (shift_id = ? OR swap_shift_id = ?) AND status = 'pending'", [shiftId, shiftId])
    if (pending) throw httpError(409, 'An open request already exists for one of these assignments.')
  }
  const { startsAt, endsAt } = await validateAssignment(run, input, current.id, target?.id)
  if (endsAt <= Date.now()) throw httpError(400, 'The requested shift has already ended.')
  if (startsAt === current.starts_at && endsAt === current.ends_at && input.engineerId === current.engineer_id) {
    throw httpError(400, 'Change the time or select a different engineer.')
  }
  const id = randomUUID()
  await run(`INSERT INTO change_requests
    (id, shift_id, requester_id, engineer_id, starts_at, ends_at, original_shift, reason, created_at, swap_shift_id, swap_shift)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [
    id, current.id, user.id, input.engineerId, startsAt, endsAt,
    JSON.stringify(shiftView(current)), input.reason, Date.now(), target?.id || null, target ? JSON.stringify({ id: target.id, version: target.version, engineerId: target.engineer_id, engineerName: target.engineer_name, start: iso(target.starts_at), end: iso(target.ends_at) }) : null,
  ])
  const admins = await run("SELECT id FROM users WHERE role = 'admin' AND active = 1")
  await notify(run, admins.map((admin) => admin.id), 'Duty change requested', user.name + ' requested a schedule change.')
  await audit(run, user.id, 'change.requested', id, { shiftId: current.id })
  return { id }
}

export function requestChange(user, input) {
  if (user.role !== 'engineer') throw httpError(403, 'Only engineers can request duty changes.')
  return rosterWrite(run => createChangeRequest(run, user, input))
}

export function requestChanges(user, inputs) {
  if (user.role !== 'engineer') throw httpError(403, 'Only engineers can request duty changes.')
  if (!Array.isArray(inputs) || inputs.length < 1 || inputs.length > 63) throw httpError(400, 'Select between 1 and 63 duties.')
  return rosterWrite(async run => {
    const used = new Set()
    const requests = []
    for (const input of inputs) {
      try {
        for (const shiftId of [input.shiftId, input.swapShiftId].filter(Boolean)) {
          if (used.has(shiftId)) throw httpError(400, 'Each duty can only be used once in this submission.')
          used.add(shiftId)
        }
        // Proposals remain independent: never exclude another selected source
        // from roster validation as though it had already moved or been approved.
        const collision = inputs.slice(0, requests.length).find(previous =>
          Date.parse(previous.start) < Date.parse(input.end) && Date.parse(previous.end) > Date.parse(input.start))
        if (collision && !input.allowOverlap) throw httpError(409, 'This time overlaps existing duty in another selected request.')
        requests.push({ ...await createChangeRequest(run, user, input), shiftId: input.shiftId })
      } catch (error) {
        if (error.statusCode >= 400 && error.statusCode < 500) error.shiftId = input.shiftId
        throw error
      }
    }
    return { requests }
  })
}

export async function listChanges(user) {
  const engineer = user.role === 'engineer'
  const rows = await query(`SELECT c.*, u.name AS requester_name, e.name AS proposed_engineer
    FROM change_requests c JOIN users u ON u.id = c.requester_id JOIN users e ON e.id = c.engineer_id
    ${engineer ? 'WHERE c.requester_id = ?' : ''}
    ORDER BY (c.status = 'pending') DESC, c.created_at DESC LIMIT 200`, engineer ? [user.id] : [])
  return rows.map((row) => ({
    id: row.id, requester: row.requester_name, reason: row.reason, status: row.reverted_at ? 'reverted' : row.status,
    revertedAt: row.reverted_at ? iso(row.reverted_at) : null, revertNote: row.revert_note,
    reviewNote: row.review_note, createdAt: iso(row.created_at), original: json(row.original_shift),
    swap: row.swap_shift ? json(row.swap_shift) : null,
    proposed: { engineerName: row.proposed_engineer, start: iso(row.starts_at), end: iso(row.ends_at) },
  }))
}

export function reviewChange(user, id, decision, note, allowOverlap = false) {
  return rosterWrite(async (run) => {
    const [request] = await run('SELECT * FROM change_requests WHERE id = ?', [id])
    if (!request) throw httpError(404, 'Change request not found.')
    if (decision === 'withdrawn' && request.requester_id !== user.id) {
      throw httpError(403, 'You can withdraw your own requests.')
    }
    if (request.status !== 'pending') throw httpError(409, 'This request has already been resolved.')
    if (decision === 'approved') {
      const current = await findShift(run, request.shift_id)
      checkVersion(current, json(request.original_shift).version)
      if (current.ends_at <= Date.now() || request.ends_at <= Date.now()) {
        throw httpError(409, 'This assignment or proposed shift has already ended.')
      }
      const target = request.swap_shift_id ? await findShift(run, request.swap_shift_id) : null
      if (target) {
        checkVersion(target, json(request.swap_shift).version)
        if (target.ends_at <= Date.now()) throw httpError(409, 'The swap shift has already ended.')
      }
      const proposed = { engineerId: request.engineer_id, start: iso(request.starts_at), end: iso(request.ends_at), note: current.note, allowOverlap }
      const replacement = target && { engineerId: target.engineer_id, start: iso(current.starts_at), end: iso(current.ends_at), note: target.note, allowOverlap }
      // Validate both final assignments, excluding only the two exchanged rows.
      await validateAssignment(run, proposed, current.id, target?.id)
      if (target) await validateAssignment(run, replacement, target.id, current.id)
      await applyAssignment(run, user, proposed, current, target?.id)
      if (target) {
        await applyAssignment(run, user, replacement, target, current.id)
        if (target.group_id) await markGroupException(run, target)
      }
      if (current.group_id) await markGroupException(run, current)
    }
    await run('UPDATE change_requests SET status = ?, reviewer_id = ?, review_note = ?, reviewed_at = ? WHERE id = ?', [
      decision, user.id, note, Date.now(), id,
    ])
    await audit(run, user.id, 'change.' + decision, id, { note })
    if (decision !== 'withdrawn') {
      await notify(run, [request.requester_id], 'Duty change ' + decision, note || 'Open Change requests to see the decision.')
    }
  })
}

// Reversion is a new audited roster change; the original approval stays in history.
async function revertState(run, id) {
  const [request] = await run('SELECT * FROM change_requests WHERE id = ?', [id])
  if (!request) throw httpError(404, 'Change request not found.')
  if (request.status !== 'approved' || request.reverted_at) throw httpError(409, 'Only an approved request that has not been reverted can be restored.')
  const originals = [json(request.original_shift), ...(request.swap_shift ? [json(request.swap_shift)] : [])]
  const shifts = []
  for (const original of originals) {
    const [current] = await run(shiftSelect + ' WHERE s.id = ?', [original.id])
    if (!current) throw httpError(409, 'An assignment no longer exists. Review the roster manually.')
    if (current.group_id) {
      const [group] = await run('SELECT cancelled FROM duty_groups WHERE id = ?', [current.group_id])
      if (!group || group.cancelled) throw httpError(409, 'The duty group has been cancelled. Review the group before restoring this request.')
    }
    const [pending] = await run("SELECT id FROM change_requests WHERE (shift_id = ? OR swap_shift_id = ?) AND status = 'pending'", [current.id, current.id])
    if (pending) throw httpError(409, 'Resolve the pending change request for this assignment before reverting.')
    shifts.push({ original, current, laterChanged: current.version !== original.version + 1 || Boolean(current.cancelled) })
  }
  return { request, shifts }
}

export async function previewRevert(user, id) {
  if (user.role !== 'admin') throw httpError(403, 'Only admins can revert approved changes.')
  const { shifts } = await revertState(query, id)
  return { shifts: shifts.map(({ original, current, laterChanged }) => ({ original, current: shiftView(current), laterChanged })) }
}

export function revertChange(user, id, input) {
  if (user.role !== 'admin') throw httpError(403, 'Only admins can revert approved changes.')
  return rosterWrite(async run => {
    const { shifts } = await revertState(run, id)
    if (input.versions.length !== shifts.length) throw httpError(409, 'Refresh the restore preview before continuing.')
    for (const { current, laterChanged } of shifts) {
      checkVersion(current, input.versions.find(item => item.id === current.id)?.version)
      if (laterChanged && !input.confirmLaterChanges) throw httpError(409, 'This assignment was edited or cancelled after approval. Review and confirm replacing those later changes.')
    }
    const planned = shifts.map(({ original, current }) => ({ original, current, input: {
      engineerId: original.engineerId, start: original.start, end: original.end,
      note: current.note, color: current.color, allowOverlap: input.allowOverlap,
    } }))
    for (const entry of planned) await validateAssignment(run, entry.input, entry.current.id, planned.find(other => other !== entry)?.current.id)
    for (const entry of planned) {
      await applyAssignment(run, user, entry.input, entry.current, planned.find(other => other !== entry)?.current.id, true)
      if (entry.current.group_id) {
        const [group] = await run('SELECT rule_json FROM duty_groups WHERE id = ?', [entry.current.group_id])
        const baseline = expandDutyGroup(json(group.rule_json)).find(item => item.occurrenceDate === entry.current.occurrence_date)
        const matchesRule = baseline && baseline.engineerId === entry.input.engineerId && Date.parse(baseline.start) === Date.parse(entry.input.start) && Date.parse(baseline.end) === Date.parse(entry.input.end) && (baseline.note || '') === (entry.input.note || '') && (baseline.color || null) === (entry.input.color || null)
        await run('UPDATE shifts SET is_exception = ? WHERE id = ?', [entry.original.isException || !matchesRule ? 1 : 0, entry.current.id])
        await run('UPDATE duty_groups SET version = version + 1 WHERE id = ?', [entry.current.group_id])
      }
    }
    await run('UPDATE change_requests SET reverted_at = ?, reverted_by = ?, revert_note = ? WHERE id = ?', [Date.now(), user.id, input.note || '', id])
    await audit(run, user.id, 'change.reverted', id, { note: input.note || '', shifts: shifts.map(({ current, original }) => ({ before: shiftView(current), restored: original })) })
  })
}

// Display order is separate from duty times, shift versions, and integration events.
export function reorderShift(actor, shiftId, targetId, placement) {
  return rosterWrite(async (run) => {
    if (shiftId === targetId) throw httpError(400, 'Choose a different shift to reorder against.')
    const rows = await run('SELECT id, starts_at, ends_at, display_order FROM shifts WHERE cancelled = 0')
    rows.sort((a, b) => Number(a.display_order ?? a.starts_at) - Number(b.display_order ?? b.starts_at) || a.starts_at - b.starts_at || a.id.localeCompare(b.id))
    const source = rows.find((row) => row.id === shiftId)
    const target = rows.find((row) => row.id === targetId)
    if (!source || !target) throw httpError(404, 'A shift is no longer on the roster. Refresh and try again.')
    const day = new Intl.DateTimeFormat('en-CA', { timeZone: rosterTimeZone })
    if (day.format(new Date(source.starts_at)) > day.format(new Date(target.ends_at - 1)) || day.format(new Date(target.starts_at)) > day.format(new Date(source.ends_at - 1))) {
      throw httpError(400, 'Reorder shifts that appear on the same calendar date.')
    }
    const before = rows.map((row) => row.id)
    const reordered = rows.filter((row) => row.id !== shiftId)
    const position = reordered.findIndex((row) => row.id === targetId) + (placement === 'after' ? 1 : 0)
    reordered.splice(position, 0, source)
    if (reordered.every((row, index) => row.id === before[index])) return { id: shiftId }
    const rank = (row) => Number(row.display_order ?? row.starts_at)
    const previous = reordered[position - 1]
    const next = reordered[position + 1]
    const value = previous && next ? (rank(previous) + rank(next)) / 2 : previous ? rank(previous) + 1024 : rank(next) - 1024
    if (!Number.isFinite(value) || (previous && value <= rank(previous)) || (next && value >= rank(next))) {
      for (let index = 0; index < reordered.length; index++) await run('UPDATE shifts SET display_order = ? WHERE id = ?', [(index + 1) * 1024, reordered[index].id])
    } else await run('UPDATE shifts SET display_order = ? WHERE id = ?', [value, shiftId])
    await audit(run, actor.id, 'calendar.reordered', shiftId, { targetId, placement })
    return { id: shiftId }
  })
}

async function markGroupException(run, shift) {
  await run('UPDATE shifts SET is_exception = 1 WHERE id = ?', [shift.id])
  await run('UPDATE duty_groups SET version = version + 1 WHERE id = ?', [shift.group_id])
}
