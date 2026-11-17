import { useState } from 'react'
import { api, dateLabel } from './lib.js'
import { Button, Empty, Field, Modal, Status, useAction, useResource } from './ui.jsx'
const presets = [
  ['Malaysia — national / country feed', 'https://www.officeholidays.com/ics/malaysia'],
  ['Malaysia — Kuala Lumpur', 'https://www.officeholidays.com/ics/malaysia/kuala-lumpur'],
  ['Malaysia — Selangor', 'https://www.officeholidays.com/ics/malaysia/selangor'],
]
function TemplateEditor({ template, onClose, onSaved }) {
  const [draft,setDraft]=useState(template || {name:'',startTime:'18:30',endTime:'01:00',endDayOffset:1})
  const action=useAction(onSaved)
  return <Modal title={template?'Edit shift template':'Create shift template'} description="Templates fill in times for a selected start date. You can adjust the dates before saving a shift." onClose={onClose}>
    <form className="form-stack" onSubmit={e=>{e.preventDefault();action.run(()=>api('/shift-templates'+(template?'/'+template.id:''),{method:template?'PUT':'POST',body:draft}))}}>
      <div className="heading-actions"><Button variant="secondary" size="small" onClick={()=>setDraft({name:'Night duty',startTime:'18:30',endTime:'01:00',endDayOffset:1})}>Night duty example</Button><Button variant="secondary" size="small" onClick={()=>setDraft({name:'Weekend duty',startTime:'09:00',endTime:'09:00',endDayOffset:1})}>Weekend duty example</Button></div>
      <Field label="Template name"><input required maxLength={80} value={draft.name} onChange={e=>setDraft({...draft,name:e.target.value})}/></Field>
      <div className="form-grid"><Field label="Starts at"><input type="time" required value={draft.startTime} onChange={e=>setDraft({...draft,startTime:e.target.value})}/></Field><Field label="Ends at"><input type="time" required value={draft.endTime} onChange={e=>setDraft({...draft,endTime:e.target.value})}/></Field></div>
      <Field label="End day"><select value={draft.endDayOffset} onChange={e=>setDraft({...draft,endDayOffset:Number(e.target.value)})}>{Array.from({length:8},(_,i)=><option key={i} value={i}>{i===0?'Same day':i===1?'Next day':i+' days later'}</option>)}</select></Field>
      <Status error={action.error}/><div className="dialog-footer"><Button variant="secondary" onClick={onClose}>Cancel</Button><Button type="submit" disabled={action.busy}>Save template</Button></div>
    </form>
  </Modal>
}
function FeedEditor({onClose,onSaved}) {
  const [draft,setDraft]=useState({name:'',url:'',color:'#fff0d4'})
  const action=useAction(onSaved)
  return <Modal title="Subscribe to holiday calendar" description="Choose a region or paste a public HTTPS iCalendar (.ics) feed. The subscribed calendar is shared with the team." onClose={onClose}>
    <form className="form-stack" onSubmit={e=>{e.preventDefault();action.run(()=>api('/holiday-feeds',{method:'POST',body:draft}))}}>
      <Field label="Region preset"><select defaultValue="" onChange={e=>{const preset=presets.find(p=>p[1]===e.target.value);setDraft({...draft,name:preset?.[0]||'',url:preset?.[1]||''})}}><option value="">Custom region / feed URL</option>{presets.map(([name,url])=><option key={url} value={url}>{name}</option>)}</select></Field>
      <Field label="Calendar name"><input required maxLength={120} value={draft.name} onChange={e=>setDraft({...draft,name:e.target.value})}/></Field>
      <Field label="iCalendar feed URL"><input required value={draft.url} maxLength={2048} placeholder="https://example.com/holidays.ics" onChange={e=>setDraft({...draft,url:e.target.value})}/></Field>
      <Field label="Holiday highlight color"><input type="color" value={draft.color} onChange={e=>setDraft({...draft,color:e.target.value})}/></Field>
      <p className="settings-help">Preset calendars are provided by <a href="https://www.officeholidays.com/subscribe/malaysia" target="_blank" rel="noreferrer">Office Holidays</a>. Country feeds may include regional holidays; choose a state feed when appropriate.</p>
      <Status error={action.error}/><div className="dialog-footer"><Button variant="secondary" onClick={onClose}>Cancel</Button><Button type="submit" disabled={action.busy}>{action.busy?'Subscribing…':'Subscribe'}</Button></div>
    </form>
  </Modal>
}
export function ScheduleSettings({notifyUser,timezone}) {
  const templates=useResource(signal=>api('/shift-templates',{signal}))
  const feeds=useResource(signal=>api('/holiday-feeds',{signal}))
  const [templateEditor,setTemplateEditor]=useState(null)
  const [feedEditor,setFeedEditor]=useState(false)
  const [confirm,setConfirm]=useState(null)
  const action=useAction(()=>{templates.refresh();feeds.refresh();setConfirm(null);notifyUser('Schedule settings updated.')})
  return <>
    <section className="panel schedule-settings"><div className="panel-toolbar"><div><h2>Shift time templates</h2><p className="settings-help">Reusable times for night, weekend, and other duties.</p></div><Button onClick={()=>setTemplateEditor({})}>Add template</Button></div>
      <Status error={templates.error}/>{templates.data?.length>0?<div className="table-wrap"><table><thead><tr><th>Name</th><th>Start</th><th>End</th><th>End day</th><th>Actions</th></tr></thead><tbody>{templates.data.map(t=><tr key={t.id}><td>{t.name}</td><td>{t.startTime}</td><td>{t.endTime}</td><td>{t.endDayOffset===0?'Same day':t.endDayOffset===1?'Next day':t.endDayOffset+' days later'}</td><td><div className="heading-actions"><Button variant="secondary" size="small" onClick={()=>setTemplateEditor({template:t})}>Edit</Button><Button variant="ghost" size="small" onClick={()=>setConfirm({title:'Delete '+t.name+'?',description:'Existing shifts keep their saved times.',path:'/shift-templates/'+t.id})}>Delete</Button></div></td></tr>)}</tbody></table></div>:!templates.loading&&<Empty title="No shift templates" description="Add a template to fill in duty times faster."/>}
    </section>
    <section className="panel schedule-settings"><div className="panel-toolbar"><div><h2>Public holiday calendars</h2><p className="settings-help">Feeds refresh daily. The last successful calendar stays visible if a refresh fails.</p></div><Button onClick={()=>setFeedEditor(true)}>Subscribe to calendar</Button></div>
      <Status error={feeds.error||action.error}/>{feeds.data?.length>0?<div className="table-wrap"><table><thead><tr><th>Calendar</th><th>Last refreshed</th><th>Actions</th></tr></thead><tbody>{feeds.data.map(f=><tr key={f.id}><td><span className="holiday-swatch" style={{backgroundColor:f.color}}/>{f.name}<small className="block break-all">{f.url}</small>{f.error&&<Status error={f.error}/>}</td><td>{f.refreshedAt?dateLabel(f.refreshedAt,timezone):'Not yet refreshed'}</td><td><div className="heading-actions"><Button variant="secondary" size="small" disabled={action.busy} onClick={()=>action.run(()=>api('/holiday-feeds/'+f.id+'/refresh',{method:'POST'}))}>Refresh</Button><Button variant="ghost" size="small" onClick={()=>setConfirm({title:'Unsubscribe from '+f.name+'?',description:'This removes its holiday highlights from the team calendar. Duty shifts stay unchanged.',path:'/holiday-feeds/'+f.id})}>Unsubscribe</Button></div></td></tr>)}</tbody></table></div>:!feeds.loading&&<Empty title="No holiday subscriptions" description="Subscribe to your region's public holiday feed to highlight those dates."/>}
    </section>
    {templateEditor&&<TemplateEditor {...templateEditor} onClose={()=>setTemplateEditor(null)} onSaved={()=>{setTemplateEditor(null);templates.refresh();notifyUser('Shift template saved.')}}/>}
    {feedEditor&&<FeedEditor onClose={()=>setFeedEditor(false)} onSaved={()=>{setFeedEditor(false);feeds.refresh();notifyUser('Holiday calendar subscribed.')}}/>}
    {confirm&&<Modal title={confirm.title} description={confirm.description} onClose={()=>setConfirm(null)}><Status error={action.error}/><div className="dialog-footer"><Button variant="secondary" onClick={()=>setConfirm(null)}>Cancel</Button><Button variant="danger" disabled={action.busy} onClick={()=>action.run(()=>api(confirm.path,{method:'DELETE'}))}>Confirm</Button></div></Modal>}
  </>
}
