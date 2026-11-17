import { DateTime } from 'luxon'

// Month summaries span consecutive local start dates only. Exceptions retain
// their own editable shift blocks, even when moved outside the original rule.
export function monthGroupSegments(groups, timezone, matches = () => true) {
  return groups.flatMap(group => {
    const occurrences = group.occurrences
      .filter(item => !item.cancelled && !item.isException && matches(item))
      .toSorted((a, b) => Date.parse(a.start) - Date.parse(b.start) || a.id.localeCompare(b.id))
    const segments = []
    for (const occurrence of occurrences) {
      const date = DateTime.fromISO(occurrence.start, { zone: timezone }).toISODate()
      const previous = segments.at(-1)
      if (previous && DateTime.fromISO(previous.lastDate, { zone: timezone }).plus({ days: 1 }).toISODate() === date) {
        previous.occurrences.push(occurrence)
        previous.lastDate = date
        if (Date.parse(occurrence.end) > Date.parse(previous.end)) previous.end = occurrence.end
      } else {
        segments.push({ group, occurrences: [occurrence], start: occurrence.start, end: occurrence.end, firstDate: date, lastDate: date })
      }
    }
    return segments
  })
}
