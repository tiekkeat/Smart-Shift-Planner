import { buildApp } from './app.js'
import { pool } from './db.js'

const app = await buildApp()
let stopping = false
async function stop() {
  if (stopping) return
  stopping = true
  await app.close()
  await pool.end()
}
process.on('SIGINT', stop)
process.on('SIGTERM', stop)
await app.listen({ host: process.env.HOST || '127.0.0.1', port: Number(process.env.PORT || 3000) })
