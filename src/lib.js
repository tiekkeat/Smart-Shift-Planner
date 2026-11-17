import { DateTime } from 'luxon'

export class ApiError extends Error {
  constructor(message, status) {
    super(message)
    this.status = status
  }
}

export async function api(path, { method = 'GET', body, signal } = {}) {
  const response = await fetch('/api/app' + path, {
    method, signal, credentials: 'same-origin',
    ...(body !== undefined && { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
  })
  if (response.status === 204) return null
  const payload = await response.json().catch(() => null)
  if (!response.ok) {
    if (response.status === 401 && path !== '/login' && path !== '/me') {
      window.dispatchEvent(new Event('session-ended'))
    }
    throw new ApiError(payload?.error || 'The server could not complete this request.', response.status)
  }
  return payload
}

export const local = (value, zone) => DateTime.fromISO(value, { zone })
export const dateField = (value, zone) => local(value, zone).toFormat("yyyy-MM-dd'T'HH:mm")
export function fromField(value, zone) {
  const date = local(value, zone)
  if (!date.isValid || date.toFormat("yyyy-MM-dd'T'HH:mm") !== value || date.getPossibleOffsets().length !== 1) {
    throw new Error('Enter an unambiguous local date and time.')
  }
  return date.toUTC().toISO()
}
export const timeLabel = (value, zone) => local(value, zone).toFormat('h:mm a')
export const dateLabel = (value, zone) => local(value, zone).toFormat('dd LLL yyyy, h:mm a')
export const initials = (name = '') => name.trim().split(/\s+/).slice(0, 2).map((word) => word[0]).join('').toUpperCase()
export const rangeQuery = (start, end) => '?' + new URLSearchParams({ from: start, to: end })
export const teamColors = ['blue', 'purple', 'green', 'orange', 'pink', 'cyan']

export function shiftTime(start, end, zone) {
  const first = local(start, zone)
  const last = local(end, zone)
  const rollover = first.hasSame(last, 'day') ? '' : ' ' + last.toFormat('ccc')
  return first.toFormat('h:mm a') + ' – ' + last.toFormat('h:mm a') + rollover
}


export function applyShiftTemplate(template, selected, zone) {
  const date = local(selected, zone).startOf('day')
  const clock = (time) => ({ hour: Number(time.slice(0, 2)), minute: Number(time.slice(3)), second: 0, millisecond: 0 })
  return { start: date.set(clock(template.startTime)).toFormat("yyyy-MM-dd'T'HH:mm"), end: date.plus({ days: template.endDayOffset }).set(clock(template.endTime)).toFormat("yyyy-MM-dd'T'HH:mm") }
}
