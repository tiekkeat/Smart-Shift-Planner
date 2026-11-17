export const rosterTimeZone = process.env.ROSTER_TIMEZONE || 'Asia/Kuala_Lumpur'
export const DAY = 86_400_000

export function httpError(statusCode, message) {
  return Object.assign(new Error(message), { statusCode })
}

export function instant(input) {
  const value = Date.parse(input)
  if (!Number.isFinite(value)) throw httpError(400, 'Enter a valid date and time.')
  return value
}

export function interval(start, end, maxDays = 7) {
  const startsAt = instant(start)
  const endsAt = instant(end)
  if (startsAt >= endsAt || endsAt - startsAt > maxDays * DAY) {
    throw httpError(400, 'End must follow start. Maximum span is ' + maxDays + ' days.')
  }
  return { startsAt, endsAt }
}

export const iso = (time) => new Date(Number(time)).toISOString()

export function shiftView(row) {
  return {
    id: row.id, engineerId: row.engineer_id, engineerName: row.engineer_name,
    start: iso(row.starts_at), end: iso(row.ends_at), note: row.note,
    ...(row.group_id && { groupId: row.group_id, occurrenceDate: row.occurrence_date, isException: Boolean(row.is_exception) }),
    color: row.color || null, displayOrder: Number(row.display_order ?? row.starts_at), version: row.version, cancelled: Boolean(row.cancelled),
  }
}

export function dutyTotals(shifts, from, to) {
  const totals = new Map()
  for (const shift of shifts) {
    if (shift.cancelled) continue
    const durationMs = Math.min(to, shift.ends_at) - Math.max(from, shift.starts_at)
    if (durationMs <= 0) continue
    if (!totals.has(shift.engineer_id)) {
      totals.set(shift.engineer_id, {
        engineerId: shift.engineer_id, name: shift.engineer_name, durationMs: 0, shiftCount: 0,
      })
    }
    const total = totals.get(shift.engineer_id)
    total.durationMs += durationMs
    total.shiftCount += 1
  }
  return [...totals.values()].sort((a, b) => b.durationMs - a.durationMs || a.name.localeCompare(b.name))
}
