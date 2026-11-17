import { z } from 'zod'
import { rosterWrite } from './db.js'
import { audit } from './roster.js'
import { httpError, rosterTimeZone } from './domain.js'
import { id,parse } from './validation.js'
export function registerCalendarOrder(app,staff) {
  app.post('/api/app/calendar-order',staff(async(actor,request)=>{
    const input=parse(z.object({sourceId:id,sourceKind:z.enum(['shift','group']),targetId:id,targetKind:z.enum(['shift','group']),placement:z.enum(['before','after'])}),request.body)
    return rosterWrite(async run=>{
      const shifts=await run('SELECT id, starts_at, ends_at, display_order FROM shifts WHERE cancelled=0 AND group_id IS NULL')
      const groups=await run('SELECT g.id, g.display_order, MIN(s.starts_at) AS starts_at, MAX(s.ends_at) AS ends_at FROM duty_groups g JOIN shifts s ON s.group_id=g.id AND s.cancelled=0 WHERE g.cancelled=0 GROUP BY g.id,g.display_order')
      const rows=[...shifts.map(s=>({...s,kind:'shift'})),...groups.map(g=>({...g,kind:'group'}))].sort((a,b)=>Number(a.display_order)-Number(b.display_order)||a.id.localeCompare(b.id))
      const source=rows.find(r=>r.id===input.sourceId&&r.kind===input.sourceKind),target=rows.find(r=>r.id===input.targetId&&r.kind===input.targetKind)
      if(!source||!target)throw httpError(404,'Calendar entry no longer exists.')
      if(source===target)throw httpError(400,'Choose another calendar entry.')
      const day=new Intl.DateTimeFormat('en-CA',{timeZone:rosterTimeZone})
      if(day.format(new Date(Number(source.starts_at)))>day.format(new Date(Number(target.ends_at)-1))||day.format(new Date(Number(target.starts_at)))>day.format(new Date(Number(source.ends_at)-1)))throw httpError(400,'Choose entries on the same calendar date.')
      const ordered=rows.filter(r=>r!==source);ordered.splice(ordered.indexOf(target)+(input.placement==='after'?1:0),0,source)
      for(let i=0;i<ordered.length;i++)await run('UPDATE '+(ordered[i].kind==='group'?'duty_groups':'shifts')+' SET display_order=? WHERE id=?',[(i+1)*1024,ordered[i].id])
      await audit(run,actor.id,'calendar.reordered',source.id,input)
      return {id:source.id}
    })
  }))
}
