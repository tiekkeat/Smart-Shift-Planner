import { DateTime } from 'luxon'
import { z } from 'zod'
import { httpError, rosterTimeZone } from './domain.js'

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
const clock = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/)
export const dutyGroupSchema = z.object({
  engineerId: z.uuid(), firstDate: date, lastDate: date,
  weekdays: z.array(z.number().int().min(1).max(7)).min(1).max(7),
  startTime: clock, endTime: clock, endDayOffset: z.number().int().min(0).max(1),
  timezone: z.string().default(rosterTimeZone),
  note: z.string().trim().max(400).default(''),
  color: z.enum(['blue','purple','green','orange','pink','cyan']).nullable().default(null),
})

// These intervals, rather than the outer group span, define real duty coverage.
export function expandDutyGroup(input) {
  const result = dutyGroupSchema.safeParse(input)
  if (!result.success) throw httpError(400, result.error.issues[0].message)
  const rule = result.data
  const first = DateTime.fromISO(rule.firstDate, { zone: rule.timezone })
  const last = DateTime.fromISO(rule.lastDate, { zone: rule.timezone })
  if (!first.isValid || !last.isValid || first.toISODate() !== rule.firstDate || last.toISODate() !== rule.lastDate || last < first || last.diff(first,'days').days > 62) throw httpError(400,'Choose a valid range of up to 63 start dates.')
  const at = (day, time) => day.set({hour:Number(time.slice(0,2)),minute:Number(time.slice(3)),second:0,millisecond:0})
  const occurrences = []
  for (let day = first; day <= last; day = day.plus({days:1})) {
    if (!rule.weekdays.includes(day.weekday)) continue
    const start = at(day,rule.startTime)
    const end = at(day.plus({days:rule.endDayOffset}),rule.endTime)
    if (start.toFormat('HH:mm') !== rule.startTime || end.toFormat('HH:mm') !== rule.endTime || start.getPossibleOffsets().length !== 1 || end.getPossibleOffsets().length !== 1) throw httpError(400,'A duty time is ambiguous or unavailable in this timezone.')
    const hours = end.diff(start,'hours').hours
    if (hours <= 0 || hours > 24) throw httpError(400,'Each duty occurrence must last more than zero and at most 24 hours.')
    occurrences.push({engineerId:rule.engineerId,occurrenceDate:day.toISODate(),start:start.toUTC().toISO(),end:end.toUTC().toISO(),note:rule.note,color:rule.color})
  }
  if (!occurrences.length) throw httpError(400,'No selected weekdays fall within this date range.')
  return occurrences
}
