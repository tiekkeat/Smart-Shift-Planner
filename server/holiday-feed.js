import https from 'node:https'
import { lookup } from 'node:dns/promises'
import { BlockList, isIP } from 'node:net'
import ICAL from 'ical.js'
import { DateTime } from 'luxon'
import { httpError, rosterTimeZone } from './domain.js'

const blocked = new BlockList()
const blocked6 = new BlockList()
for (const [address, prefix] of [['0.0.0.0',8],['10.0.0.0',8],['100.64.0.0',10],['127.0.0.0',8],['169.254.0.0',16],['172.16.0.0',12],['192.0.0.0',24],['192.0.2.0',24],['192.168.0.0',16],['198.18.0.0',15],['198.51.100.0',24],['203.0.113.0',24],['224.0.0.0',4],['240.0.0.0',4]]) blocked.addSubnet(address, prefix)
for (const [address, prefix] of [['::',128],['::1',128],['::ffff:0:0',96],['fc00::',7],['fe80::',10],['ff00::',8]]) blocked6.addSubnet(address, prefix, 'ipv6')
export function isPublicAddress(address) {
  const family = isIP(address)
  return Boolean(family) && !(family === 6 ? blocked6.check(address, 'ipv6') : blocked.check(address, 'ipv4'))
}
export function feedUrl(input) {
  let url
  try { url = new URL(input.replace(/^webcal:/i, 'https:')) } catch { throw httpError(400, 'Enter a public HTTPS iCalendar feed URL.') }
  if (url.protocol !== 'https:' || url.username || url.password || url.hash || (url.port && url.port !== '443')) throw httpError(400, 'Use a public HTTPS feed on port 443 without embedded credentials.')
  return url
}
export async function downloadFeed(input, redirects = 0) {
  const url = feedUrl(input)
  const host = url.hostname.replace(/^\[|\]$/g, '')
  const addresses = await lookup(host, { all: true })
  if (!addresses.length || addresses.some(({address}) => !isPublicAddress(address))) throw httpError(400, 'Holiday feeds must use a public internet address.')
  const address = addresses[0]
  return new Promise((resolve, reject) => {
    const request = https.get(url, {
      headers: { Accept: 'text/calendar', 'User-Agent': 'SmartTimetable/1.0', 'Accept-Encoding': 'identity' },
      lookup: (_host, options, callback) => options.all ? callback(null, [address]) : callback(null, address.address, address.family),
      signal: AbortSignal.timeout(12000),
    }, (response) => {
      if ([301,302,303,307,308].includes(response.statusCode)) {
        response.resume()
        if (redirects >= 3 || !response.headers.location) return reject(new Error('The holiday feed redirected too many times.'))
        resolve(downloadFeed(new URL(response.headers.location, url).href, redirects + 1)); return
      }
      if (response.statusCode !== 200) { response.resume(); reject(new Error('Holiday feed returned HTTP ' + response.statusCode)); return }
      let size = 0; const chunks = []
      response.on('data', (chunk) => { size += chunk.length; if (size > 1024 * 1024) response.destroy(new Error('Holiday feed exceeds 1 MB.')); else chunks.push(chunk) })
      response.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
      response.on('error', reject)
    })
    request.on('error', reject)
  })
}
export function parseHolidayFeed(text) {
  if (!text.trimStart().startsWith('BEGIN:VCALENDAR')) throw new Error('The URL did not return an iCalendar (.ics) calendar.')
  const calendar = new ICAL.Component(ICAL.parse(text))
  const components = calendar.getAllSubcomponents('vevent')
  if (components.length > 5000) throw new Error('Holiday feed contains too many events.')
  for (const item of components) {
    for (const rule of item.getAllProperties('rrule')) if (!['DAILY','WEEKLY','MONTHLY','YEARLY'].includes(rule.getFirstValue().freq)) throw new Error('Holiday feeds support daily, weekly, monthly, or yearly recurrence.')
    if (!item.getFirstPropertyValue('dtstart')) throw new Error('Holiday event is missing its start date.')
  }
  return calendar
}
function day(time) {
  if (time.isDate) return time.toString()
  return DateTime.fromJSDate(time.toJSDate(), { zone: rosterTimeZone }).toISODate()
}
export function holidayOccurrences(text, from, to) {
  const calendar = parseHolidayFeed(text)
  const found = new Map(); let steps = 0
  for (const component of calendar.getAllSubcomponents('vevent')) {
    if (component.hasProperty('recurrence-id')) continue
    const event = new ICAL.Event(component)
    if (component.getFirstPropertyValue('status') === 'CANCELLED') continue
    const iterator = event.iterator()
    let occurrence
    while ((occurrence = iterator.next())) {
      if (++steps > 20000) throw new Error('Holiday recurrence exceeds the supported expansion limit.')
      if (day(occurrence) >= to) break
      const detail = event.getOccurrenceDetails(occurrence)
      if (detail.item.component.getFirstPropertyValue('status') === 'CANCELLED') continue
      const start = day(detail.startDate)
      let end = day(detail.endDate)
      if (!detail.endDate.isDate && (detail.endDate.hour || detail.endDate.minute || detail.endDate.second)) end = DateTime.fromISO(end).plus({days:1}).toISODate()
      if (end <= start) end = DateTime.fromISO(start).plus({days:1}).toISODate()
      if (start >= to || end <= from) continue
      const title = (detail.item.summary || 'Public holiday').slice(0,200)
      found.set(start + ':' + end + ':' + title, { title, start, end })
    }
  }
  return [...found.values()]
}
