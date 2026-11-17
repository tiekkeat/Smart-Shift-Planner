import {memberships,saveMemberships} from './teams.js'
import { randomUUID } from 'node:crypto'
import { query, rosterWrite } from './db.js'
import { httpError } from './domain.js'
import { passwordHash } from './security.js'
import { audit } from './roster.js'

export function publicUser(row) {
  return { id: row.id, name: row.name, role: row.role, active: Boolean(row.active), color: row.color || null }
}

export function staffUser(row) {
  return { ...publicUser(row), email: row.email, phone: row.phone, dingtalkId: row.dingtalk_id }
}

export async function listPeople(actor) {
  const canManage = ['admin','manager'].includes(actor.role)
  const rows = await query(`SELECT id, name, role, active, email, phone, dingtalk_id, color FROM users
    WHERE deleted_at IS NULL ${actor.role === 'admin' ? '' : "AND role = 'engineer'"} ORDER BY active DESC, name`)
  const teams=await memberships()
  return (canManage ? rows.map(staffUser) : rows.filter((row) => row.active).map(publicUser)).map(person=>({...person,teamIds:teams[person.id]||[]}))
}

export async function savePerson(actor, fields, id) {
  if (fields.role === 'engineer' && fields.active && !fields.phone) throw httpError(400, 'Add an international phone number for the engineer.')
  if (!id && !fields.password) throw httpError(400, 'Provide an initial password of at least 12 characters.')
  const newPasswordHash = fields.password ? await passwordHash(fields.password) : null
  return rosterWrite(async (run) => {
    if (actor.role === 'manager' && fields.role !== 'engineer') throw httpError(403, 'Managers can register engineers.')
    const [before] = id ? await run('SELECT * FROM users WHERE id = ?', [id]) : []
    if (id && (!before || before.deleted_at)) throw httpError(404, 'Account not found.')
    if (before && actor.role === 'manager' && before.role !== 'engineer') throw httpError(403, 'Managers can edit engineer accounts.')
    if (id === actor.id && (!fields.active || fields.role !== actor.role)) {
      throw httpError(400, 'Your account must remain active and keep its current role.')
    }
    const [duplicate] = await run('SELECT id FROM users WHERE email = ? AND id <> ?', [fields.email, id || ''])
    if (duplicate) throw httpError(409, 'This email is already registered.')
    if (before?.role === 'engineer' && (!fields.active || fields.role !== 'engineer' || !fields.phone)) {
      const [upcoming] = await run(
        'SELECT id FROM shifts WHERE engineer_id = ? AND cancelled = 0 AND ends_at > ? LIMIT 1',
        [id, Date.now()],
      )
      if (upcoming) throw httpError(409, 'Reassign the engineer’s active and upcoming duty before making this account change.')
    }
    const accountColor = actor.role === 'admin' && fields.color !== undefined ? fields.color : before?.color || null
    const personId = id || randomUUID()
    const details = [
      fields.name, fields.email, fields.phone || null, fields.dingtalkId || null, fields.role,
      fields.active, newPasswordHash || before.password_hash, accountColor, personId,
    ]
    if (before) {
      await run(`UPDATE users SET name = ?, email = ?, phone = ?, dingtalk_id = ?,
        role = ?, active = ?, password_hash = ?, color = ? WHERE id = ?`, details)
      if (newPasswordHash || !fields.active || fields.role !== before.role) {
        await run('DELETE FROM sessions WHERE user_id = ?', [personId])
      }
    } else {
      await run('INSERT INTO users (name, email, phone, dingtalk_id, role, active, password_hash, color, id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)', details)
    }
    if(fields.teamIds!==undefined)await saveMemberships(run,personId,fields.teamIds)
    await audit(run, actor.id, before ? 'account.updated' : 'account.created', personId, {
      role: fields.role, active: fields.active, ...(fields.teamIds!==undefined&&{teamIds:fields.teamIds}),
    })
    return { id: personId }
  })
}

export function deletePerson(actor, personId) {
  if (actor.role !== 'admin') throw httpError(403, 'Only admins can delete accounts.')
  if (personId === actor.id) throw httpError(400, 'You cannot delete your own account.')
  return rosterWrite(async run => {
    const [person] = await run('SELECT * FROM users WHERE id = ?', [personId])
    if (!person || person.deleted_at) throw httpError(404, 'Account not found.')
    const [upcoming] = await run('SELECT id FROM shifts WHERE engineer_id = ? AND cancelled = 0 AND ends_at > ? LIMIT 1', [personId,Date.now()])
    if (upcoming) throw httpError(409, 'Reassign or cancel this user’s active and upcoming duty before deleting the account.')
    if (person.role === 'admin' && person.active) {
      const [count] = await run("SELECT COUNT(*) AS total FROM users WHERE role='admin' AND active=1 AND deleted_at IS NULL")
      if (count.total <= 1) throw httpError(409, 'The last active admin cannot be deleted.')
    }
    await run('DELETE FROM sessions WHERE user_id = ?', [personId])
    await run('UPDATE users SET active=0, deleted_at=?, email=?, phone=NULL, dingtalk_id=NULL, password_hash=? WHERE id=?', [Date.now(),'deleted-'+personId+'@deleted.invalid',randomUUID(),personId])
    await audit(run,actor.id,'account.deleted',personId,{name:person.name,role:person.role})
  })
}
