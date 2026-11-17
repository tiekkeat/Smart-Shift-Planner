import { useState } from 'react'
import { DateTime } from 'luxon'
import { api, dateLabel, local, teamColors } from './lib.js'
import { Button, Field, Modal, Status, useAction } from './ui.jsx'
const days=['Mon','Tue','Wed','Thu','Fri','Sat','Sun']
export function groupRule(shift,timezone) {
  const first=local(shift.start,timezone),end=local(shift.end,timezone)
  const last=end.hour===0&&end.minute===0?end.minus({days:1}):end.hour<first.hour?end.minus({days:1}):end
  return {engineerId:shift.engineerId||'',firstDate:first.toISODate(),lastDate:last<first?first.toISODate():last.toISODate(),weekdays:[1,2,3,4,5],startTime:first.toFormat('HH:mm'),endTime:end.toFormat('HH:mm'),endDayOffset:1,timezone,note:shift.note||'',color:shift.color||null}
}
function preview(rule) {
  const first=DateTime.fromISO(rule.firstDate,{zone:rule.timezone}),last=DateTime.fromISO(rule.lastDate,{zone:rule.timezone})
  if(!first.isValid||!last.isValid||last<first||last.diff(first,'days').days>62)return []
  const clock=time=>({hour:Number(time.slice(0,2)),minute:Number(time.slice(3)),second:0,millisecond:0})
  if(!/^\d{2}:\d{2}$/.test(rule.startTime)||!/^\d{2}:\d{2}$/.test(rule.endTime))return []
  const items=[]
  for(let day=first;day<=last;day=day.plus({days:1}))if(rule.weekdays.includes(day.weekday)){
    const start=day.set(clock(rule.startTime)),end=day.plus({days:rule.endDayOffset}).set(clock(rule.endTime))
    if(end<=start||end.diff(start,'hours').hours>24)return []
    items.push({start:start.toISO(),end:end.toISO(),date:day.toISODate()})
  }
  return items
}
export function GroupDialog({dialog,session,people,templates,onClose,onSaved,onOccurrence}) {
  const group=dialog.group, writable=['admin','manager'].includes(session.user.role)
  const [editing,setEditing]=useState(!group||Boolean(dialog.rule))
  const [rule,setRule]=useState(dialog.rule||group?.rule||dialog.initialRule)
  const [warning,setWarning]=useState('')
  const [accepted,setAccepted]=useState({overlap:false,removal:false})
  const [confirmCancel,setConfirmCancel]=useState(false)
  const action=useAction(onSaved)
  const items=preview(rule)
  const occurrences=group?.occurrences||[]
  const exceptions=occurrences.filter(item=>item.isException)
  const removed=exceptions.filter(item=>!items.some(p=>p.date===local(item.occurrenceDate,rule.timezone).plus({days:dialog.moveDays||0}).toISODate()))
  const hours=items.reduce((sum,item)=>sum+(Date.parse(item.end)-Date.parse(item.start))/3600000,0)
  function submit(event){
    event.preventDefault()
    const confirm=event.nativeEvent.submitter?.dataset.confirm==='true'
    const approvals={overlap:accepted.overlap||(confirm&&warning.startsWith('This time overlaps')),removal:accepted.removal||(confirm&&warning.startsWith('This range removes'))}
    setAccepted(approvals)
    action.run(async()=>{
      try{return await api('/duty-groups'+(group?'/'+group.id:''),{method:group?'PUT':'POST',body:{...rule,version:group?.version,allowOverlap:approvals.overlap,confirmRemoveExceptions:approvals.removal,moveDays:dialog.moveDays||0,...(dialog.sourceShift&&{sourceShiftId:dialog.sourceShift.id,sourceVersion:dialog.sourceShift.version})}})}
      catch(error){if(error.status===409&&(error.message.startsWith('This time overlaps')||error.message.startsWith('This range removes')))setWarning(error.message);throw error}
    })
  }
  return <Modal title={group?'Repeated duty group':'Create repeated duty group'} description={'Only the listed occurrences provide coverage. Times are in '+rule.timezone+'.'} onClose={onClose}>
    {editing&&writable?<form className="form-stack" onSubmit={submit} onChange={()=>{setWarning('');setAccepted({overlap:false,removal:false})}}>
      {dialog.sourceShift&&<div className="inline-note">Converts the continuous shift into separate coverage intervals, displayed as one group.</div>}
      <Field label="Engineer"><select required value={rule.engineerId} onChange={e=>setRule({...rule,engineerId:e.target.value})}><option value="">Select an engineer</option>{people.filter(p=>p.role==='engineer'&&p.active).map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></Field>
      <div className="form-grid"><Field label="First start date"><input type="date" required value={rule.firstDate} onChange={e=>setRule({...rule,firstDate:e.target.value})}/></Field><Field label="Last start date"><input type="date" required value={rule.lastDate} onChange={e=>setRule({...rule,lastDate:e.target.value})}/></Field></div>
      <fieldset className="scope-list"><legend>Duty starts on</legend><div className="heading-actions">{days.map((label,index)=><label className="checkbox" key={label}><input type="checkbox" checked={rule.weekdays.includes(index+1)} onChange={e=>setRule({...rule,weekdays:e.target.checked?[...rule.weekdays,index+1].sort():rule.weekdays.filter(day=>day!==index+1)})}/>{label}</label>)}</div></fieldset>
      {templates.length>0&&<Field label="Shift time template"><select defaultValue="" onChange={e=>{const t=templates.find(t=>t.id===e.target.value);if(t)setRule({...rule,startTime:t.startTime,endTime:t.endTime,endDayOffset:t.endDayOffset})}}><option value="">Choose a template</option>{templates.filter(t=>t.endDayOffset<=1).map(t=><option key={t.id} value={t.id}>{t.name}</option>)}</select></Field>}
      <div className="form-grid"><Field label="Starts at"><input required type="time" value={rule.startTime} onChange={e=>setRule({...rule,startTime:e.target.value})}/></Field><Field label="Ends at"><input required type="time" value={rule.endTime} onChange={e=>setRule({...rule,endTime:e.target.value})}/></Field></div>
      <Field label="End day"><select value={rule.endDayOffset} onChange={e=>setRule({...rule,endDayOffset:Number(e.target.value)})}><option value={0}>Same day</option><option value={1}>Next day</option></select></Field>
      <Field label="Shift color"><select value={rule.color||''} onChange={e=>setRule({...rule,color:e.target.value||null})}><option value="">Automatic (engineer color)</option>{teamColors.map(c=><option key={c} value={c}>{c}</option>)}</select></Field>
      <Field label="Note"><textarea maxLength={400} value={rule.note||''} onChange={e=>setRule({...rule,note:e.target.value})}/></Field>
      <div className="compare-card"><strong>{items.length} occurrences · {hours.toLocaleString()} pattern hours</strong><small>Individual exceptions are preserved and may change the final total.</small>{items.map(item=><span key={item.date}>{dateLabel(item.start,rule.timezone)} → {dateLabel(item.end,rule.timezone)}</span>)}</div>
      {exceptions.length>0&&<div className="inline-note">{exceptions.length} individually changed/cancelled nights will be preserved. {removed.length>0&&removed.length+' fall outside the selected pattern.'}</div>}
      {warning&&<div className="confirm-box" role="alert">{warning}</div>}<Status error={warning?'':action.error}/>
      <div className="dialog-footer"><Button variant="secondary" onClick={onClose}>Close</Button>{warning&&<Button type="submit" data-confirm="true" disabled={action.busy}>Confirm and save group</Button>}<Button type="submit" disabled={action.busy||!items.length||Boolean(warning)}>Save group</Button></div>
    </form>:<div className="form-stack">
      <div className="compare-card"><strong>{people.find(p=>p.id===rule.engineerId)?.name||occurrences.find(item=>item.engineerId===rule.engineerId)?.engineerName||'Duty group'} · {rule.weekdays.map(d=>days[d-1]).join(', ')}</strong><span>{rule.startTime}–{rule.endTime}{rule.endDayOffset?' next day':''}</span><span>{group.totalHours.toLocaleString()} scheduled hours · {exceptions.length} exceptions</span></div>
      <div className="group-occurrences">{occurrences.map(item=><div className="group-occurrence" key={item.id}><div><strong>{item.engineerName}{item.cancelled?' · Cancelled':item.isException?' · Individually changed':''}</strong><small>{dateLabel(item.start,rule.timezone)} → {dateLabel(item.end,rule.timezone)}</small></div>{!item.cancelled&&<Button variant="secondary" size="small" onClick={()=>onOccurrence(item)}>{writable?'Edit night':session.user.role==='engineer'&&item.engineerId===session.user.id?'View / request change':'View night'}</Button>}</div>)}</div>
      <Status error={action.error}/>{confirmCancel&&<div className="confirm-box"><p>Cancel every remaining assignment in this group?</p><Button variant="danger" disabled={action.busy} onClick={()=>action.run(()=>api('/duty-groups/'+group.id+'?version='+group.version,{method:'DELETE'}))}>Confirm group cancellation</Button></div>}
      <div className="dialog-footer">{writable&&<><Button variant="ghost" onClick={()=>setConfirmCancel(true)}>Cancel group</Button><Button onClick={()=>setEditing(true)}>Edit group</Button></>}<Button variant="secondary" onClick={onClose}>Close</Button></div>
    </div>}
  </Modal>
}
