import { dateField, fromField } from './lib.js'

export const MAX_REQUEST_DUTIES = 63
export const changeKinds = [
  { id: 'replace', title: 'Replace engineer', hint: 'Ask someone to cover your duties.' },
  { id: 'dates', title: 'Change dates', hint: 'Move your own duty times.' },
  { id: 'swap', title: 'Swap duties', hint: 'Exchange duties with another engineer.' },
]

export function requestDraft(shift, timezone) {
  return { start: dateField(shift.start, timezone), end: dateField(shift.end, timezone), engineerId: '', editTimes: false, swap: null, searchDate: dateField(shift.start, timezone).slice(0, 10) }
}

export function buildProposal(shift, draft, { kind, replacementId, individual, timezone, userId, reason = '' }) {
  const swapping = kind === 'swap'
  if (swapping && !draft.swap) throw new Error('Choose a duty to swap.')
  const engineerId = kind === 'replace' ? (individual ? draft.engineerId || replacementId : replacementId) : userId
  if (!engineerId) throw new Error('Choose a replacement engineer.')
  const editTimes = kind === 'dates' || (kind === 'replace' && draft.editTimes)
  const start = swapping ? draft.swap.start : editTimes ? fromField(draft.start, timezone) : shift.start
  const end = swapping ? draft.swap.end : editTimes ? fromField(draft.end, timezone) : shift.end
  if (Date.parse(end) <= Date.parse(start)) throw new Error('End must follow start.')
  if (Date.parse(end) - Date.parse(start) > 7 * 86400000) throw new Error('A duty can span up to 7 days.')
  if (Date.parse(end) <= Date.now()) throw new Error('Choose a duty that has not ended.')
  if (engineerId === shift.engineerId && Date.parse(start) === Date.parse(shift.start) && Date.parse(end) === Date.parse(shift.end)) throw new Error('Choose new dates or a different engineer.')
  return { shiftId: shift.id, version: shift.version, engineerId, start, end, reason,
    ...(swapping && { swapShiftId: draft.swap.id, swapVersion: draft.swap.version }),
  }
}
