import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { query, rosterWrite } from './db.js'
import { id, parse, range } from './validation.js'
import { httpError, interval, iso } from './domain.js'
import { downloadFeed, feedUrl, holidayOccurrences, parseHolidayFeed } from './holiday-feed.js'

const schema = z.object({ name: z.string().trim().min(1).max(120), url: z.string().max(2048), color: z.string().regex(/^#[0-9a-f]{6}$/i).default('#fff0d4') })
export async function refreshHolidayFeed(feed) {
  try {
    const ics = await downloadFeed(feed.url)
    parseHolidayFeed(ics)
    await query('UPDATE holiday_feeds SET calendar_data = ?, refreshed_at = ?, attempted_at = ?, last_error = NULL WHERE id = ?', [ics, Date.now(), Date.now(), feed.id])
  } catch (error) {
    await query('UPDATE holiday_feeds SET attempted_at = ?, last_error = ? WHERE id = ?', [Date.now(), String(error.message).slice(0,255), feed.id])
    throw httpError(400, 'Could not refresh holiday feed: ' + error.message)
  }
}
export async function refreshDueHolidayFeeds() {
  const feeds = await query('SELECT id, url FROM holiday_feeds WHERE attempted_at < ?', [Date.now() - 24*60*60*1000])
  for (const feed of feeds) { try { await refreshHolidayFeed(feed) } catch { /* Last good calendar stays available; settings shows the error. */ } }
}
export function registerHolidays(app, admin, signedIn) {
  app.get('/api/app/holiday-feeds', admin(async () => {
    const rows = await query('SELECT id, name, url, color, refreshed_at, last_error FROM holiday_feeds ORDER BY name')
    return rows.map((row) => ({id:row.id,name:row.name,url:row.url,color:row.color,refreshedAt:row.refreshed_at ? iso(row.refreshed_at) : null,error:row.last_error}))
  }))
  app.post('/api/app/holiday-feeds', admin(async (_user, request, reply) => {
    const fields = parse(schema, request.body); const url = feedUrl(fields.url).href
    let ics
    try { ics = await downloadFeed(url); parseHolidayFeed(ics) } catch (error) { throw httpError(400, 'Could not subscribe: ' + error.message) }
    const feedId = randomUUID()
    await rosterWrite(async (run) => {
      const [count] = await run('SELECT COUNT(*) AS total FROM holiday_feeds')
      if (count.total >= 10) throw httpError(400, 'You can subscribe to up to 10 holiday feeds.')
      await run('INSERT INTO holiday_feeds (id, name, url, color, calendar_data, refreshed_at, attempted_at) VALUES (?, ?, ?, ?, ?, ?, ?)', [feedId,fields.name,url,fields.color,ics,Date.now(),Date.now()])
    })
    return reply.code(201).send({id:feedId})
  }))
  app.post('/api/app/holiday-feeds/:id/refresh', admin(async (_user, request, reply) => {
    const [feed] = await query('SELECT id, url FROM holiday_feeds WHERE id = ?', [parse(id,request.params.id)])
    if (!feed) throw httpError(404, 'Holiday feed not found.')
    await refreshHolidayFeed(feed);return reply.code(204).send()
  }))
  app.delete('/api/app/holiday-feeds/:id', admin(async (_user, request, reply) => {
    await query('DELETE FROM holiday_feeds WHERE id = ?', [parse(id,request.params.id)]);return reply.code(204).send()
  }))
  app.get('/api/app/holidays', signedIn(async (_user, request) => {
    const {from,to} = parse(range,request.query);interval(from,to,63)
    const feeds = await query('SELECT id, name, color, calendar_data FROM holiday_feeds')
    const events = []; const errors = []
    for (const feed of feeds) {
      try { for (const item of holidayOccurrences(feed.calendar_data,from.slice(0,10),to.slice(0,10))) events.push({...item,feed:feed.name,color:feed.color,id:feed.id+':'+item.start+':'+item.title}) }
      catch { errors.push('Could not display holidays from ' + feed.name + '. Ask an admin to refresh the subscription.') }
    }
    return {events,errors}
  }))
}
