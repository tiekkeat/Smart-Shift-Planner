import { resolveTemplate } from './templates.js'
import {memberships} from './teams.js'
import { randomUUID } from 'node:crypto'
import { DateTime } from 'luxon'
import { z } from 'zod'
import { query, rosterWrite } from './db.js'
import { expandDutyGroup, dutyGroupSchema } from './duty-groups.js'
import { applyAssignment, audit, findShift, json, recordShiftChange } from './roster.js'
import { httpError, shiftView } from './domain.js'
import { id, parse, range, version } from './validation.js'

const inputSchema = dutyGroupSchema.extend({ version: version.optional(), allowOverlap: z.boolean().default(false), confirmRemoveExceptions: z.boolean().default(false), moveDays: z.number().int().min(-3660).max(3660).default(0), sourceShiftId: id.optional(), sourceVersion: version.optional() })
const selectOccurrences = `SELECT s.*, u.name AS engineer_name, t.name AS template_name, t.archived_at AS template_archived_at FROM shifts s JOIN users u ON u.id=s.engineer_id LEFT JOIN shift_templates t ON t.id=s.template_id WHERE s.group_id=? ORDER BY s.occurrence_date, s.starts_at`

export async function readGroup(groupId, run = query, actor = null) {
  const [row] = await run('SELECT * FROM duty_groups WHERE id = ?', [groupId])
  if (!row || row.cancelled) throw httpError(404, 'Duty group not found.')
  const rule = { ...json(row.rule_json) }
  const teams=await memberships(run)
  const occurrences = (await run(selectOccurrences, [groupId])).map(row=>({...shiftView(row),teamIds:teams[row.engineer_id]||[]}))
  if (['engineer','viewer'].includes(actor?.role)) {
    if (actor.role === 'viewer' || rule.engineerId !== actor.id) delete rule.note
    for (const occurrence of occurrences) if (actor.role === 'viewer' || occurrence.engineerId !== actor.id) delete occurrence.note
  }
  const active = occurrences.filter(item => !item.cancelled)
  return { id: row.id, version: row.version, rule, displayOrder: Number(row.display_order), sourceShiftId: row.source_shift_id, occurrences,
    start: active.length ? active.reduce((a,b) => a.start < b.start ? a : b).start : null,
    end: active.length ? active.reduce((a,b) => a.end > b.end ? a : b).end : null,
    totalHours: active.reduce((sum,item) => sum + (Date.parse(item.end)-Date.parse(item.start))/3600000,0) }
}

async function cancelOccurrence(run, actor, row) {
  if (row.cancelled) return
  await run('UPDATE shifts SET cancelled=1, version=version+1 WHERE id=?', [row.id])
  await recordShiftChange(run, actor, 'duty.cancelled', row, {...row,cancelled:1,version:row.version+1})
}

export function saveGroup(actor, input, groupId = null) {
  const fields = parse(inputSchema, input)
  const rule = dutyGroupSchema.parse(fields)
  if (groupId && fields.sourceShiftId) throw httpError(400, 'Only new groups can convert a continuous shift.')
  return rosterWrite(async run => {
    const gid = groupId || randomUUID()
    let existing = null
    if (groupId) {
      const [row] = await run('SELECT * FROM duty_groups WHERE id=?', [groupId])
      if (!row || row.cancelled) throw httpError(404,'Duty group not found.')
      if (row.version !== fields.version) throw httpError(409,'The duty group changed. Refresh and review its latest version.')
      existing = row
    }
    if (rule.templateId === undefined && existing) rule.templateId = json(existing.rule_json).templateId
    const generated = expandDutyGroup(rule)
    await resolveTemplate(run, rule.templateId, existing ? { template_id: json(existing.rule_json).templateId } : null)
    const [engineer] = await run("SELECT id FROM users WHERE id=? AND active=1 AND role='engineer'",[rule.engineerId])
    if (!engineer) throw httpError(400,'Choose an active engineer.')
    if (fields.sourceShiftId) {
      const source = await findShift(run, fields.sourceShiftId)
      if (source.group_id || source.version !== fields.sourceVersion) throw httpError(409,'The original assignment changed. Refresh before converting it.')
      const [pending] = await run("SELECT id FROM change_requests WHERE shift_id=? AND status='pending' LIMIT 1",[source.id])
      if (pending) throw httpError(409,'Resolve the original shift’s pending change request before converting.')
      await cancelOccurrence(run,actor,source)
    }
    const rows = existing ? await run(selectOccurrences,[gid]) : []
    if (fields.moveDays) {
      if (!existing) throw httpError(400,'Only existing groups can be moved.')
      const oldRule = json(existing.rule_json)
      const shifted = (date) => DateTime.fromISO(date,{zone:oldRule.timezone}).plus({days:fields.moveDays}).toISODate()
      const weekdays = oldRule.weekdays.map(day => ((day-1+fields.moveDays)%7+7)%7+1).sort()
      if (rule.firstDate !== shifted(oldRule.firstDate) || rule.lastDate !== shifted(oldRule.lastDate) || [...rule.weekdays].sort().join() !== weekdays.join()) throw httpError(400,'Review the moved group date range and weekdays.')
      for (const row of rows) {
        row.occurrence_date = shifted(row.occurrence_date)
        if (row.is_exception) {
          row.starts_at = DateTime.fromMillis(Number(row.starts_at),{zone:oldRule.timezone}).plus({days:fields.moveDays}).toMillis()
          row.ends_at = DateTime.fromMillis(Number(row.ends_at),{zone:oldRule.timezone}).plus({days:fields.moveDays}).toMillis()
        }
      }
    }
    const byDate = new Map(rows.map(row => [row.occurrence_date,row]))
    const dates = new Set(generated.map(item => item.occurrenceDate))
    const removedExceptions = rows.filter(row => row.is_exception && !dates.has(row.occurrence_date))
    if (removedExceptions.length && !fields.confirmRemoveExceptions) throw httpError(409,'This range removes individually changed nights: '+removedExceptions.map(row=>row.occurrence_date).join(', ')+'. Confirm removal before saving.')
    const planned = generated.map(item => {
      const before = byDate.get(item.occurrenceDate)
      return { item: before?.is_exception ? { engineerId:before.engineer_id,start:new Date(Number(before.starts_at)).toISOString(),end:new Date(Number(before.ends_at)).toISOString(),note:before.note,color:before.color,templateId:before.template_id || null,allowArchivedTemplate:true,occurrenceDate:before.occurrence_date } : item, before, cancelled: Boolean(before?.is_exception && before.cancelled) }
    })
    const active = planned.filter(item => !item.cancelled)
    if (!fields.allowOverlap) for(let i=0;i<active.length;i++) for(let j=i+1;j<active.length;j++) {
      if (Date.parse(active[i].item.start)<Date.parse(active[j].item.end) && Date.parse(active[j].item.start)<Date.parse(active[i].item.end)) throw httpError(409,'This time overlaps existing duty within the group. Review the individually changed nights.')
    }
    if (!existing) await run('INSERT INTO duty_groups (id,rule_json,display_order,source_shift_id) VALUES (?,?,?,?)',[gid,JSON.stringify(rule),Date.parse(generated[0].start),fields.sourceShiftId||null])
    for (const row of rows.filter(row => !dates.has(row.occurrence_date))) {
      await cancelOccurrence(run,actor,row)
      if (fields.moveDays) await run('UPDATE shifts SET occurrence_date=? WHERE id=?',[row.occurrence_date,row.id])
    }
    for (const plan of planned) {
      const {item,before} = plan
      if (before?.is_exception && !fields.moveDays) continue
      if (plan.cancelled) {
        await run('UPDATE shifts SET occurrence_date=?,starts_at=?,ends_at=? WHERE id=?',[item.occurrenceDate,Date.parse(item.start),Date.parse(item.end),before.id])
        continue
      }
      if (before?.cancelled) await run('UPDATE shifts SET cancelled=0 WHERE id=?',[before.id])
      const saved = await applyAssignment(run,actor,{...item,groupId:gid,skipGroupId:gid,allowOverlap:fields.allowOverlap},before)
      await run('UPDATE shifts SET group_id=?,occurrence_date=? WHERE id=?',[gid,item.occurrenceDate,saved.id])
    }
    // Unmoved exceptions still need checking against newly generated normal nights and external duty.
    for (const plan of active.filter(plan=>plan.before?.is_exception && !fields.moveDays)) {
      const conflicts=await run('SELECT id FROM shifts WHERE cancelled=0 AND starts_at < ? AND ends_at > ? AND id <> ? AND (group_id IS NULL OR group_id <> ?) LIMIT 1',[Date.parse(plan.item.end),Date.parse(plan.item.start),plan.before.id,gid])
      if (conflicts.length && !fields.allowOverlap) throw httpError(409,'This time overlaps existing duty for an individually changed night.')
    }
    if (existing) await run('UPDATE duty_groups SET rule_json=?,version=version+1 WHERE id=?',[JSON.stringify(rule),gid])
    await audit(run,actor.id,existing?'group.updated':'group.created',gid,{rule,sourceShiftId:fields.sourceShiftId||null})
    return readGroup(gid,run,actor)
  })
}

export function cancelGroup(actor, groupId, expectedVersion) {
  return rosterWrite(async run => {
    const group=await readGroup(groupId,run)
    if(group.version!==expectedVersion) throw httpError(409,'The duty group changed. Refresh before cancelling.')
    for(const row of await run(selectOccurrences,[groupId])) await cancelOccurrence(run,actor,row)
    await run('UPDATE duty_groups SET cancelled=1,version=version+1 WHERE id=?',[groupId])
    await audit(run,actor.id,'group.cancelled',groupId,{})
  })
}

export function registerGroups(app,staff,signedIn) {
  app.get('/api/app/duty-groups',signedIn(async(user,request)=>{
    const {from,to}=parse(range,request.query)
    if(Date.parse(to)<=Date.parse(from)||Date.parse(to)-Date.parse(from)>63*86400000)throw httpError(400,'Choose a range of up to 63 days.')
    const rows=await query('SELECT g.id FROM duty_groups g WHERE g.cancelled=0 AND EXISTS (SELECT 1 FROM shifts s WHERE s.group_id=g.id AND s.cancelled=0 AND s.starts_at < ? AND s.ends_at > ?)',[Date.parse(to),Date.parse(from)])
    return Promise.all(rows.map(row=>readGroup(row.id,query,user)))
  }))
  app.get('/api/app/duty-groups/:id',signedIn((user,request)=>readGroup(parse(id,request.params.id),query,user)))
  app.post('/api/app/duty-groups',staff(async(user,request,reply)=>reply.code(201).send(await saveGroup(user,request.body))))
  app.put('/api/app/duty-groups/:id',staff((user,request)=>saveGroup(user,request.body,parse(id,request.params.id))))
  app.delete('/api/app/duty-groups/:id',staff(async(user,request,reply)=>{await cancelGroup(user,parse(id,request.params.id),parse(version,Number(request.query.version)));return reply.code(204).send()}))
}
