import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { query, rosterWrite } from './db.js'
import { id, parse } from './validation.js'
import { httpError } from './domain.js'
const clock = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/)
const minutes = (time) => Number(time.slice(0,2))*60 + Number(time.slice(3))
export const templateSchema = z.object({name:z.string().trim().min(1).max(80),startTime:clock,endTime:clock,endDayOffset:z.number().int().min(0).max(7)})
  .refine((value) => {const duration=value.endDayOffset*1440+minutes(value.endTime)-minutes(value.startTime);return duration>0&&duration<=7*1440}, 'The end must follow the start, within seven days.')
export function registerTemplates(app,admin,signedIn) {
  app.get('/api/app/shift-templates',signedIn(async()=> {
    const rows=await query('SELECT id, name, start_time, end_time, end_day_offset FROM shift_templates WHERE archived_at IS NULL ORDER BY name')
    return rows.map(row=>({id:row.id,name:row.name,startTime:row.start_time,endTime:row.end_time,endDayOffset:row.end_day_offset}))
  }))
  for(const method of ['post','put']) app[method]('/api/app/shift-templates'+(method==='put'?'/:id':''),admin(async(_user,request,reply)=>{
    const fields=parse(templateSchema,request.body);const templateId=method==='put'?parse(id,request.params.id):randomUUID()
    await rosterWrite(async run => {
    if(method==='put') {
      const [existing]=await run('SELECT id FROM shift_templates WHERE id = ? AND archived_at IS NULL',[templateId]);if(!existing)throw httpError(404,'Shift template not found.')
      await run('UPDATE shift_templates SET name = ?, start_time = ?, end_time = ?, end_day_offset = ? WHERE id = ?',[fields.name,fields.startTime,fields.endTime,fields.endDayOffset,templateId])
    } else await run('INSERT INTO shift_templates (id, name, start_time, end_time, end_day_offset) VALUES (?, ?, ?, ?, ?)',[templateId,fields.name,fields.startTime,fields.endTime,fields.endDayOffset])
    })
    return reply.code(method==='post'?201:200).send({id:templateId,...fields})
  }))
  app.delete('/api/app/shift-templates/:id',admin(async(_user,request,reply)=>{await rosterWrite(run => run('UPDATE shift_templates SET archived_at = ? WHERE id = ? AND archived_at IS NULL',[Date.now(),parse(id,request.params.id)]));return reply.code(204).send()}))
}

// Omitted fields preserve existing metadata; only trusted swaps/restores can
// introduce an archived type from another saved assignment.
export async function resolveTemplate(run, templateId, before = null, allowArchived = false) {
  if (templateId === undefined) return before?.template_id || null
  if (templateId === null) return null
  const [template] = await run('SELECT id, archived_at FROM shift_templates WHERE id = ?', [templateId])
  if (!template || (template.archived_at != null && templateId !== before?.template_id && !allowArchived)) throw httpError(400, 'Choose an active shift type.')
  return template.id
}
