import { readFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { pool, query } from './db.js'
import { passwordHash } from './security.js'

try {
  const sql = await readFile(new URL('./schema.sql', import.meta.url), 'utf8')
  for (const statement of sql.split(';').map((part) => part.trim()).filter(Boolean)) {
    await query(statement)
  }
  const [colorColumn] = await query("SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'shifts' AND COLUMN_NAME = 'color'")
  if (!colorColumn) await query('ALTER TABLE shifts ADD COLUMN color VARCHAR(16) NULL')
  const [displayOrder] = await query("SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'shifts' AND COLUMN_NAME = 'display_order'")
  if (!displayOrder) {
    await query('ALTER TABLE shifts ADD COLUMN display_order DOUBLE NOT NULL DEFAULT 0')
    await query('UPDATE shifts SET display_order = starts_at')
  }
  const [userColor] = await query("SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users' AND COLUMN_NAME = 'color'")
  if (!userColor) await query('ALTER TABLE users ADD COLUMN color VARCHAR(16) NULL')
  for (const [column, definition] of [['group_id', 'CHAR(36) NULL'], ['occurrence_date', 'CHAR(10) NULL'], ['is_exception', 'BOOLEAN NOT NULL DEFAULT FALSE']]) {
    const [existing] = await query("SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'shifts' AND COLUMN_NAME = ?", [column])
    if (!existing) await query('ALTER TABLE shifts ADD COLUMN ' + column + ' ' + definition)
  }
  for (const [column, definition] of [['swap_shift_id', 'CHAR(36) NULL'], ['swap_shift', 'JSON NULL'], ['reverted_at', 'BIGINT NULL'], ['reverted_by', 'CHAR(36) NULL'], ['revert_note', 'VARCHAR(400) NULL']]) {
    const [existing] = await query("SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'change_requests' AND COLUMN_NAME = ?", [column])
    if (!existing) await query('ALTER TABLE change_requests ADD COLUMN ' + column + ' ' + definition)
  }
  const [roleColumn] = await query("SELECT COLUMN_TYPE FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='users' AND COLUMN_NAME='role'")
  if (!roleColumn.COLUMN_TYPE.includes("'viewer'")) await query("ALTER TABLE users MODIFY role ENUM('admin','manager','engineer','viewer') NOT NULL")
  const [deletedColumn] = await query("SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='users' AND COLUMN_NAME='deleted_at'")
  if (!deletedColumn) await query('ALTER TABLE users ADD COLUMN deleted_at BIGINT NULL')
  const [admin] = await query("SELECT id FROM users WHERE role = 'admin' AND active = 1 LIMIT 1")
  if (!admin) {
    const email = process.env.ADMIN_EMAIL?.trim().toLowerCase()
    const password = process.env.ADMIN_PASSWORD
    if (!email || !password || password.length < 12 || password.length > 128) {
      throw new Error('Set ADMIN_EMAIL and an ADMIN_PASSWORD of 12–128 characters for initial setup.')
    }
    await query("INSERT INTO users (id, name, email, role, password_hash) VALUES (?, ?, ?, 'admin', ?)", [
      randomUUID(), process.env.ADMIN_NAME || 'Roster Admin', email, await passwordHash(password),
    ])
  }
  console.log('Smart Timetable database is ready.')
} finally {
  await pool.end()
}
