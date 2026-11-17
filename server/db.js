import mysql from 'mysql2/promise'

export const pool = mysql.createPool({
  host: process.env.DB_HOST || '127.0.0.1',
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER || 'timetable',
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME || 'timetable',
  connectionLimit: 10,
  timezone: 'Z',
})

function executor(connection) {
  return async (sql, params = []) => (await connection.execute(sql, params))[0]
}

export const query = executor(pool)

export async function transaction(work) {
  const connection = await pool.getConnection()
  try {
    await connection.beginTransaction()
    const result = await work(executor(connection))
    await connection.commit()
    return result
  } catch (error) {
    await connection.rollback()
    throw error
  } finally {
    connection.release()
  }
}

export function rosterWrite(work) {
  return transaction(async (run) => {
    await run('SELECT id FROM roster_lock WHERE id = 1 FOR UPDATE')
    return work(run)
  })
}
