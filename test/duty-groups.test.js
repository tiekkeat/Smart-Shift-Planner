import test from 'node:test'
import assert from 'node:assert/strict'
import { expandDutyGroup } from '../server/duty-groups.js'
const rule={engineerId:'11111111-1111-4111-8111-111111111111',firstDate:'2026-11-16',lastDate:'2026-11-20',weekdays:[1,2,3,4,5],startTime:'18:30',endTime:'09:00',endDayOffset:1,timezone:'Asia/Kuala_Lumpur'}
test('weekly night duty expands to five nights and 72.5 hours without daytime coverage',()=>{
 const nights=expandDutyGroup(rule)
 assert.equal(nights.length,5)
 assert.equal(nights[0].start,'2026-11-16T10:30:00.000Z')
 assert.equal(nights[4].end,'2026-11-21T01:00:00.000Z')
 assert.equal(nights.reduce((sum,n)=>sum+(Date.parse(n.end)-Date.parse(n.start))/3600000,0),72.5)
 const covered=at=>nights.some(n=>Date.parse(n.start)<=Date.parse(at)&&Date.parse(n.end)>Date.parse(at))
 assert.equal(covered('2026-11-17T08:59:00+08:00'),true)
 assert.equal(covered('2026-11-17T09:00:00+08:00'),false)
 assert.equal(covered('2026-11-17T18:29:00+08:00'),false)
 assert.equal(covered('2026-11-17T18:30:00+08:00'),true)
 assert.equal(covered('2026-11-21T09:00:00+08:00'),false)
})
test('rejects invalid ranges, empty weekday matches and invalid duty windows',()=>{
 for(const extra of [{lastDate:'2026-11-15'},{lastDate:'2027-11-20'},{firstDate:'2026-02-30'},{weekdays:[7]},{endDayOffset:0},{endTime:'19:00',endDayOffset:1}]) assert.throws(()=>expandDutyGroup({...rule,...extra}),{statusCode:400})
})
