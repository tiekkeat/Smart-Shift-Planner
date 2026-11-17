import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { query } from './db.js'
import { id, parse } from './validation.js'
import { httpError } from './domain.js'
const clock = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/)
const minutes = (time) => Number(time.slice(0,2))*60 + Number(time.slice(3))
export const templateSchema = z.object({name:z.string().trim().min(1).max(80),startTime:clock,endTime:clock,endDayOffset:z.number().int().min(0).max(7)})
  .refine((value) => {const duration=value.endDayOffset*1440+minutes(value.endTime)-minutes(value.startTime);return duration>0&&duration<=7*1440}, 'The end must follow the start, within seven days.')
export function registerTemplates(app,admin,signedIn) {
  app.get('/api/app/shift-templates',signedIn(async()=> {
    const rows=await query('SELECT id, name, start_time, end_time, end_day_offset FROM shift_templates ORDER BY name')
    return rows.map(row=>({id:row.id,name:row.name,startTime:row.start_time,endTime:row.end_time,endDayOffset:row.end_day_offset}))
  }))
  for(const method of ['post','put']) app[method]('/api/app/shift-templates'+(method==='put'?'/:id':''),admin(async(_user,request,reply)=>{
    const fields=parse(templateSchema,request.body);const templateId=method==='put'?parse(id,request.params.id):randomUUID()
    if(method==='put') {
      const [existing]=await query('SELECT id FROM shift_templates WHERE id = ?',[templateId]);if(!existing)throw httpError(404,'Shift template not found.')
      await query('UPDATE shift_templates SET name = ?, start_time = ?, end_time = ?, end_day_offset = ? WHERE id = ?',[fields.name,fields.startTime,fields.endTime,fields.endDayOffset,templateId])
    } else await query('INSERT INTO shift_templates (id, name, start_time, end_time, end_day_offset) VALUES (?, ?, ?, ?, ?)',[templateId,fields.name,fields.startTime,fields.endTime,fields.endDayOffset])
    return reply.code(method==='post'?201:200).send({id:templateId,...fields})
  }))
  app.delete('/api/app/shift-templates/:id',admin(async(_user,request,reply)=>{await query('DELETE FROM shift_templates WHERE id = ?',[parse(id,request.params.id)]);return reply.code(204).send()}))
}
