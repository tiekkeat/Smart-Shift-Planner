import test from 'node:test'
import assert from 'node:assert/strict'
import { dutyTotals } from '../server/domain.js'
import { matchingTemplates } from '../server/classification.js'
const at = text => Date.parse(text)

test('duty counts belong to start period while overnight hours are clipped', () => {
  const duty = { id:'one',engineer_id:'a',engineer_name:'A',template_id:'night',template_name:'Night',starts_at:at('2045-01-31T18:30:00+08:00'),ends_at:at('2045-02-01T09:00:00+08:00') }
  const boundary=at('2045-02-01T00:00:00+08:00')
  const january=dutyTotals([duty],at('2045-01-01T00:00:00+08:00'),boundary)[0]
  const february=dutyTotals([duty],boundary,at('2045-03-01T00:00:00+08:00'))[0]
  assert.equal(january.shiftCount,1)
  assert.equal(january.durationMs,5.5*3600000)
  assert.equal(february.shiftCount,0)
  assert.equal(february.durationMs,9*3600000)
  assert.equal(february.types[0].shiftCount,0)
  assert.equal(dutyTotals([{...duty,cancelled:1}],boundary,boundary+86400000).length,0)
  assert.equal(dutyTotals([duty],duty.ends_at,duty.ends_at+86400000).length,0)
  assert.equal(dutyTotals([duty],duty.starts_at-86400000,duty.starts_at).length,0)
})

test('type matching uses exact local clocks and day offsets, not duration alone', () => {
  const templates=[{id:'night',start_time:'18:30',end_time:'09:00',end_day_offset:1},{id:'day',start_time:'09:00',end_time:'18:00',end_day_offset:0},{id:'archived',start_time:'18:30',end_time:'09:00',end_day_offset:1,archived_at:1}]
  const duty={starts_at:at('2045-11-24T18:30:00+08:00'),ends_at:at('2045-11-25T09:00:00+08:00')}
  assert.deepEqual(matchingTemplates(duty,templates).map(item=>item.id),['night'])
  assert.equal(matchingTemplates({...duty,ends_at:duty.ends_at+1000},templates).length,0)
  assert.equal(matchingTemplates({...duty,ends_at:duty.ends_at+86400000},templates).length,0)
  const dst={starts_at:at('2045-11-04T18:30:00-04:00'),ends_at:at('2045-11-05T09:00:00-05:00')}
  assert.deepEqual(matchingTemplates(dst,templates,'America/New_York').map(item=>item.id),['night'])
})
