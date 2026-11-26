import { createHash } from 'node:crypto'
import { DateTime } from 'luxon'
import { z } from 'zod'
import { query, rosterWrite } from './db.js'
import { audit, json } from './roster.js'
import { httpError, interval, rosterTimeZone, shiftView } from './domain.js'
import { parse, range } from './validation.js'

export function matchingTemplates(row, templates, timezone = rosterTimeZone) {
  const start = DateTime.fromMillis(Number(row.starts_at), { zone: timezone })
  const end = DateTime.fromMillis(Number(row.ends_at), { zone: timezone })
  if (start.second || start.millisecond || end.second || end.millisecond) return []
  const offset = Math.round(end.startOf('day').diff(start.startOf('day'), 'days').days)
  return templates.filter(template => template.archived_at == null && template.start_time === start.toFormat('HH:mm') && template.end_time === end.toFormat('HH:mm') && Number(template.end_day_offset) === offset)
}

const selectedRows = 'SELECT s.*, u.name AS engineer_name FROM shifts s JOIN users u ON u.id=s.engineer_id'
async function preview(run, from, to) {
  const templates = await run('SELECT id, name, start_time, end_time, end_day_offset FROM shift_templates WHERE archived_at IS NULL ORDER BY id')
  const pending = new Set((await run("SELECT shift_id, swap_shift_id FROM change_requests WHERE status='pending'")).flatMap(row => [row.shift_id, row.swap_shift_id].filter(Boolean)))
  const rows = await run(selectedRows + ' WHERE s.cancelled=0 AND s.template_id IS NULL AND s.starts_at < ? AND s.ends_at > ? ORDER BY s.starts_at, s.id', [to, from])
  const units = []
  const seen = new Set()
  const groupCache = new Map()
  for (const row of rows) {
    const grouped = row.group_id && !row.is_exception
    const key = (grouped ? 'group:' + row.group_id : 'shift:' + row.id)
    if (seen.has(key)) continue
    seen.add(key)
    if (row.group_id && !groupCache.has(row.group_id)) {
      const [group] = await run('SELECT * FROM duty_groups WHERE id=?', [row.group_id])
      const duties = await run(selectedRows + ' WHERE s.group_id=? ORDER BY s.starts_at, s.id', [row.group_id])
      groupCache.set(row.group_id, { group, duties })
    }
    const cached = groupCache.get(row.group_id)
    const group = cached?.group
    const all = grouped ? cached.duties : [row]
    const duties = grouped ? all.filter(item => !item.is_exception) : all
    let status, reason
    if ((cached?.duties || all).some(item => pending.has(item.id))) {
      status = 'pending'; reason = 'Resolve the pending request first.'
    } else if ((row.group_id && !group) || group?.cancelled || (grouped && duties.some(item => item.template_id || json(group.rule_json).templateId))) {
      status = 'unmatched'; reason = 'This group already has a type or is cancelled. Review it in the calendar.'
    }
    const matches = templates.filter(template => duties.every(duty => matchingTemplates(duty, [template]).length))
    if (!status) {
      status = matches.length === 1 ? 'matched' : matches.length ? 'ambiguous' : 'unmatched'
      reason = status === 'matched' ? '' : status === 'ambiguous' ? 'Several templates share these times. Choose a type in the calendar.' : 'No exact time match. Choose a type in the calendar.'
    }
    units.push({ key, groupId: row.group_id || null, groupVersion: group?.version || null, groupRule: group ? json(group.rule_json) : null,
      grouped: Boolean(grouped), status, reason, matches: matches.map(template => ({ id: template.id, name: template.name })),
      duties: duties.map(shiftView),
    })
  }
  const fingerprint = createHash('sha256').update(JSON.stringify({ templates, units })).digest('hex')
  return { from: new Date(from).toISOString(), to: new Date(to).toISOString(), fingerprint, units }
}

export function previewClassification(user, from, to) {
  if (user.role !== 'admin') throw httpError(403, 'Only admins can classify existing duties.')
  return preview(query, from, to)
}

export function applyClassification(user, input) {
  if (user.role !== 'admin') throw httpError(403, 'Only admins can classify existing duties.')
  const { startsAt, endsAt } = interval(input.from, input.to, 63)
  return rosterWrite(async run => {
    const current = await preview(run, startsAt, endsAt)
    if (current.fingerprint !== input.fingerprint) throw httpError(409, 'Duties or templates changed. Refresh the preview before classifying.')
    const keys = new Set(input.keys)
    if (!keys.size || keys.size !== input.keys.length) throw httpError(400, 'Select distinct preview entries.')
    const units = [...keys].map(key => current.units.find(unit => unit.key === key && unit.status === 'matched'))
    if (units.some(unit => !unit)) throw httpError(409, 'Only exact, available matches can be classified. Refresh the preview.')
    const groups = new Map()
    let count = 0
    for (const unit of units) {
      const templateId = unit.matches[0].id
      for (const duty of unit.duties) {
        const result = await run('UPDATE shifts SET template_id=?, version=version+1 WHERE id=? AND version=? AND template_id IS NULL', [templateId, duty.id, duty.version])
        if (result.affectedRows !== 1) throw httpError(409, 'A duty changed. Refresh the preview before classifying.')
        count++
      }
      if (unit.groupId) {
        const previous = groups.get(unit.groupId) || { rule: unit.groupRule, version: unit.groupVersion }
        if (unit.grouped) previous.rule = { ...previous.rule, templateId }
        groups.set(unit.groupId, previous)
      }
      await audit(run, user.id, 'duty.classified', unit.grouped ? unit.groupId : unit.duties[0].id, { templateId, shifts: unit.duties.map(duty => ({ id: duty.id, version: duty.version })) })
    }
    for (const [id, group] of groups) {
      const result = await run('UPDATE duty_groups SET rule_json=?, version=version+1 WHERE id=? AND version=?', [JSON.stringify(group.rule), id, group.version])
      if (result.affectedRows !== 1) throw httpError(409, 'A group changed. Refresh the preview before classifying.')
    }
    return { classified: count }
  })
}

export function registerClassification(app, admin) {
  app.get('/api/app/report/classification-preview', admin((user, request) => {
    const { from, to } = parse(range, request.query)
    const { startsAt, endsAt } = interval(from, to, 63)
    return previewClassification(user, startsAt, endsAt)
  }))
  app.post('/api/app/report/classification', { bodyLimit: 128 * 1024 }, admin((user, request) => applyClassification(user,
    parse(range.extend({ fingerprint: z.string().regex(/^[a-f0-9]{64}$/), keys: z.array(z.string().max(50)).min(1).max(1000) }), request.body))))
}
