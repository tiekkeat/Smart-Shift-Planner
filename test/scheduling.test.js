import test from 'node:test'
import assert from 'node:assert/strict'
import { holidayOccurrences, parseHolidayFeed, feedUrl, isPublicAddress, downloadFeed } from '../server/holiday-feed.js'
import { templateSchema } from '../server/templates.js'
import { applyShiftTemplate, fromField } from '../src/lib.js'
const calendar = (...events) => 'BEGIN:VCALENDAR\r\nVERSION:2.0\r\n'+events.join('\r\n')+'\r\nEND:VCALENDAR'
const event = lines => 'BEGIN:VEVENT\r\n'+lines.join('\r\n')+'\r\nEND:VEVENT'
test('holiday feeds preserve dates, exclusive ends, yearly recurrence and exclusions', () => {
  const feed = calendar(event(['UID:annual','DTSTART;VALUE=DATE:20200101','DTEND;VALUE=DATE:20200102','RRULE:FREQ=YEARLY','EXDATE;VALUE=DATE:20270101','SUMMARY:New Year']),event(['UID:multi','DTSTART;VALUE=DATE:20261224','DTEND;VALUE=DATE:20261227','SUMMARY:Holiday break']))
  assert.deepEqual(holidayOccurrences(feed,'2026-01-01','2027-01-01'),[{title:'New Year',start:'2026-01-01',end:'2026-01-02'},{title:'Holiday break',start:'2026-12-24',end:'2026-12-27'}])
  assert.equal(holidayOccurrences(feed,'2027-01-01','2027-02-01').length,0)
  assert.equal(holidayOccurrences(feed,'2026-12-25','2026-12-26').length,1)
  assert.throws(()=>parseHolidayFeed('<html>Not a calendar</html>'))
})
test('holiday recurrence exceptions and cancellations are respected', () => {
  const feed=calendar(event(['UID:one','DTSTART;VALUE=DATE:20260101','DTEND;VALUE=DATE:20260102','RRULE:FREQ=YEARLY;COUNT=3','SUMMARY:Original']),event(['UID:one','RECURRENCE-ID;VALUE=DATE:20270101','DTSTART;VALUE=DATE:20270102','DTEND;VALUE=DATE:20270103','SUMMARY:Observed']),event(['UID:cancel','DTSTART;VALUE=DATE:20270102','STATUS:CANCELLED','SUMMARY:Cancelled']))
  assert.deepEqual(holidayOccurrences(feed,'2027-01-01','2027-02-01'),[{title:'Observed',start:'2027-01-02',end:'2027-01-03'}])
})
test('feed downloads restrict internal addresses and insecure URLs', async () => {
  for(const address of ['127.0.0.1','10.0.0.1','172.18.0.1','192.168.1.1','169.254.169.254','::1','fc00::1','::ffff:127.0.0.1']) assert.equal(isPublicAddress(address),false,address)
  for(const address of ['8.8.8.8','104.26.12.160','2606:4700:20::681a:ca0'])assert.equal(isPublicAddress(address),true,address)
  for(const url of ['http://example.com/x.ics','https://name:password@example.com/a','https://example.com:8443/a'])assert.throws(()=>feedUrl(url))
  assert.equal(feedUrl('webcal://example.com/x.ics').href,'https://example.com/x.ics')
  await assert.rejects(downloadFeed('https://127.0.0.1/feed.ics'),{statusCode:400})
})
test('night and weekend templates apply explicit next-day times', () => {
  const night=templateSchema.parse({name:'Night duty',startTime:'18:30',endTime:'01:00',endDayOffset:1})
  const weekend=templateSchema.parse({name:'Weekend duty',startTime:'09:00',endTime:'09:00',endDayOffset:1})
  const values=applyShiftTemplate(night,'2026-11-30T00:00','Asia/Kuala_Lumpur')
  assert.deepEqual(values,{start:'2026-11-30T18:30',end:'2026-12-01T01:00'})
  assert.equal((Date.parse(fromField(values.end,'Asia/Kuala_Lumpur'))-Date.parse(fromField(values.start,'Asia/Kuala_Lumpur')))/3600000,6.5)
  assert.deepEqual(applyShiftTemplate(weekend,'2026-12-31','Asia/Kuala_Lumpur'),{start:'2026-12-31T09:00',end:'2027-01-01T09:00'})
  assert.equal(templateSchema.safeParse({...night,endDayOffset:0}).success,false)
  assert.equal(templateSchema.safeParse({...night,startTime:'25:00'}).success,false)
})
