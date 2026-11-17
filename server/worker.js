import { refreshDueHolidayFeeds } from './holidays.js'
import { createHmac, randomUUID } from 'node:crypto'
import { setTimeout as delay } from 'node:timers/promises'
import { pool, query, transaction } from './db.js'
import { webhookUrl } from './integrations.js'
import { decrypt } from './security.js'
import { json } from './roster.js'

const MAX_ATTEMPTS = 6
let stopping = false
process.on('SIGTERM', () => { stopping = true })
process.on('SIGINT', () => { stopping = true })

async function claim() {
  return transaction(async (run) => {
    const now = Date.now()
    const [job] = await run(`SELECT id, webhook_id, payload, attempts FROM webhook_deliveries
      WHERE state = 'queued' AND next_attempt <= ? AND (lease_until IS NULL OR lease_until < ?)
      ORDER BY next_attempt, created_at LIMIT 1 FOR UPDATE SKIP LOCKED`, [now, now])
    if (!job) return null
    const leaseId = randomUUID()
    await run('UPDATE webhook_deliveries SET lease_until = ?, lease_id = ? WHERE id = ?', [now + 30_000, leaseId, job.id])
    return { ...job, leaseId }
  })
}

async function deliver(job) {
  const [hook] = await query('SELECT url, encrypted_secret, active FROM webhooks WHERE id = ?', [job.webhook_id])
  let state = 'sent'
  let errorMessage = null
  const attempt = job.attempts + 1
  if (!hook?.active) {
    state = 'cancelled'
  } else {
    try {
      const body = JSON.stringify(json(job.payload))
      const timestamp = String(Math.floor(Date.now() / 1000))
      const signature = createHmac('sha256', decrypt(hook.encrypted_secret)).update(timestamp + '.' + body).digest('hex')
      const response = await fetch(webhookUrl(hook.url), {
        method: 'POST', body, redirect: 'error', signal: AbortSignal.timeout(8000),
        headers: {
          'Content-Type': 'application/json', 'X-Timetable-Event': json(job.payload).id,
          'X-Timetable-Timestamp': timestamp, 'X-Timetable-Signature': 'sha256=' + signature,
        },
      })
      await response.body?.cancel()
      if (!response.ok) throw new Error('Destination returned HTTP ' + response.status)
    } catch (error) {
      state = attempt >= MAX_ATTEMPTS ? 'failed' : 'queued'
      errorMessage = String(error.message).slice(0, 255)
    }
  }
  await query(`UPDATE webhook_deliveries SET state = ?, attempts = ?, last_error = ?,
    lease_until = NULL, lease_id = NULL, next_attempt = ? WHERE id = ? AND lease_id = ? AND state = 'queued'`, [
    state, attempt, errorMessage, Date.now() + 15_000 * 2 ** (attempt - 1), job.id, job.leaseId,
  ])
}

let holidaySync = null
function syncHolidays() {
  if (holidaySync || stopping) return
  holidaySync = refreshDueHolidayFeeds().catch(() => console.error('Holiday feed refresh failed.')).finally(() => { holidaySync = null })
}
syncHolidays()
const holidayTimer = setInterval(syncHolidays, 60 * 60 * 1000)
holidayTimer.unref()

while (!stopping) {
  try {
    const job = await claim()
    if (job) await deliver(job)
    else await delay(2000)
  } catch (error) {
    console.error('Webhook worker could not process the queue.', error.code || error.name)
    await delay(5000)
  }
}
clearInterval(holidayTimer)
if (holidaySync) await holidaySync
await pool.end()
