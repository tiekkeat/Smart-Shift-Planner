import test from 'node:test'
import assert from 'node:assert/strict'
import { monthGroupSegments } from '../src/calendar-events.js'
const zone = 'Asia/Kuala_Lumpur'
const night = (date, extra = {}) => ({ id: date, start: `${date}T18:30:00+08:00`, end: `${date}T09:00:00+08:00`, ...extra })

test('approved moved night stays separate from remaining December duty', () => {
  const moved = night('2026-11-24', { isException: true, end: '2026-11-25T09:00:00+08:00' })
  const group = { id: 'group', occurrences: [moved, ...[1,2,3,4].map(day => night(`2026-12-0${day}`, { end: `2026-12-0${day+1}T09:00:00+08:00` }))] }
  const before = structuredClone(group)
  const segments = monthGroupSegments([group], zone)
  assert.equal(segments.length, 1)
  assert.equal(segments[0].firstDate, '2026-12-01')
  assert.equal(segments[0].end, '2026-12-05T09:00:00+08:00')
  assert.equal(segments[0].occurrences.length, 4)
  assert.deepEqual(group, before)
})

test('cancellations, changed nights and filters break summaries; month boundaries do not', () => {
  const group = { occurrences: ['2026-11-29','2026-11-30','2026-12-01','2026-12-02','2026-12-03','2026-12-04'].map(date => night(date)) }
  assert.equal(monthGroupSegments([group], zone).length, 1)
  group.occurrences[2].cancelled = true
  group.occurrences[4].isException = true
  assert.deepEqual(monthGroupSegments([group], zone).map(s => s.occurrences.length), [2,1,1])
  assert.equal(monthGroupSegments([group], zone, o => o.id !== '2026-11-30')[0].lastDate, '2026-11-29')
  assert.equal(monthGroupSegments([group], zone, () => false).length, 0)
})

test('start dates use roster timezone rather than UTC date', () => {
  const group = { occurrences: [night('unused', { id:'a', start:'2026-11-30T16:30:00Z', end:'2026-12-01T10:00:00Z' }), night('unused', { id:'b', start:'2026-12-01T16:30:00Z', end:'2026-12-02T10:00:00Z' })] }
  assert.deepEqual(monthGroupSegments([group], zone).map(s => [s.firstDate,s.lastDate]), [['2026-12-01','2026-12-02']])
})
