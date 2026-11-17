import {ArrowLeft,Check,Plus,Pencil,Trash2,UsersRound} from 'lucide-react'
import {useState} from 'react'
import {api,teamColors} from './lib.js'
import {Button,Field,Modal,Status,useAction} from './ui.jsx'
export function TeamPicker({teams,value,onChange}){return <fieldset className="scope-list"><legend>Teams</legend>{teams.map(t=><label className="checkbox" key={t.id}><input type="checkbox" checked={value.includes(t.id)} onChange={e=>onChange(e.target.checked?[...value,t.id]:value.filter(id=>id!==t.id))}/><span className={'engineer-color color-'+t.color}>{t.name}</span></label>)}{!teams.length&&<small>No teams configured.</small>}</fieldset>}
const colorName = value => value[0].toUpperCase() + value.slice(1)

function TeamForm({team,onCancel,onSaved,onBusy}) {
  const [draft,setDraft]=useState(team||{name:'',color:'blue'})
  const action=useAction(onSaved)
  return <form className="form-stack team-editor" onSubmit={async event=>{event.preventDefault();onBusy(true);try{await action.run(()=>api('/teams'+(team?'/'+team.id:''),{method:team?'PUT':'POST',body:draft}))}finally{onBusy(false)}}}>
    <Field label="Team name"><input autoFocus required maxLength={80} placeholder="e.g. Cloud team" value={draft.name} onChange={event=>setDraft({...draft,name:event.target.value})}/></Field>
    <fieldset className="team-palette"><legend>Label color</legend><div className="team-palette-options">{teamColors.map(color=><label key={color} className={'team-color-option color-'+color} title={colorName(color)}>
      <input type="radio" name="team-color" value={color} aria-label={colorName(color)} checked={draft.color===color} onChange={()=>setDraft({...draft,color})}/>
      <span className="team-color-circle">{draft.color===color&&<Check size={17}/>}</span><span>{colorName(color)}</span>
    </label>)}</div></fieldset>
    <div className="team-label-preview"><small>Label preview</small><span className={'engineer-color color-'+draft.color}>{draft.name.trim()||'Team name'}</span></div>
    <p className="settings-help">This color identifies the team. Engineer and shift colors stay the same.</p>
    <Status error={action.error}/>
    <div className="dialog-footer"><Button variant="secondary" disabled={action.busy} onClick={onCancel}>Cancel</Button><Button type="submit" disabled={action.busy}>{action.busy?'Saving…':team?'Save changes':'Create team'}</Button></div>
  </form>
}

function TeamDelete({team,count,onCancel,onDeleted,onBusy}) {
  const action=useAction(onDeleted)
  return <div className="form-stack">
    <div className="team-delete-card"><span className={'engineer-color color-'+team.color}>{team.name}</span><span>{count} {count===1?'member':'members'}</span></div>
    <div className="team-delete-explanation"><p>This removes the team label and its memberships.</p><p>Members with no other team will appear under <strong>Unassigned</strong>.</p><p>User accounts, duty assignments, and duty history are kept.</p></div>
    <Status error={action.error}/><div className="dialog-footer"><Button variant="secondary" disabled={action.busy} onClick={onCancel}>Cancel</Button><Button variant="danger" disabled={action.busy} onClick={async()=>{onBusy(true);try{await action.run(()=>api('/teams/'+team.id,{method:'DELETE'}))}finally{onBusy(false)}}}><Trash2 size={15}/>{action.busy?'Deleting…':'Delete team'}</Button></div>
  </div>
}

export function TeamManager({teams,people=[],onClose,onSaved}) {
  const [screen,setScreen]=useState(null)
  const [success,setSuccess]=useState('')
  const [busy,setBusy]=useState(false)
  const count=team=>people.filter(person=>person.teamIds?.includes(team.id)).length
  const done=message=>{onSaved();setScreen(null);setSuccess(message)}
  const title=screen?.mode==='delete'?'Delete team?':screen?.mode==='edit'?'Edit team':screen?.mode==='new'?'Create team':'Manage teams'
  const description=screen?.mode==='delete'?'Review the impact before removing this team.':screen?'Give your team a clear name and an easy-to-recognize label.':'Organize people into teams. A person can belong to more than one team.'
  return <Modal title={title} description={description} onClose={()=>{if(!busy)onClose()}}>
    {screen?<><Button className="team-back" variant="ghost" size="small" disabled={busy} onClick={()=>setScreen(null)}><ArrowLeft size={15}/>All teams</Button>
      {screen.mode==='delete'?<TeamDelete onBusy={setBusy} key={screen.team.id} team={screen.team} count={count(screen.team)} onCancel={()=>setScreen(null)} onDeleted={()=>done('Team deleted. Members and duties were kept.')}/>:<TeamForm onBusy={setBusy} key={screen.team?.id||'new'} team={screen.team} onCancel={()=>setScreen(null)} onSaved={()=>done(screen.mode==='edit'?'Team updated.':'Team created.')}/>}</>:
      <div className="form-stack"><div className="team-manager-toolbar"><span>{teams.length} {teams.length===1?'team':'teams'}</span><Button size="small" onClick={()=>{setSuccess('');setScreen({mode:'new'})}}><Plus size={15}/>Add team</Button></div>
        <Status success={success}/>
        {teams.length?<div className="team-manager-list">{teams.map(team=><div className="team-manager-row" key={team.id}><span className={'team-manager-icon color-'+team.color}><UsersRound size={19}/></span><div className="team-manager-name"><strong>{team.name}</strong><small>{count(team)} {count(team)===1?'member':'members'}</small></div><div className="team-manager-actions"><Button variant="ghost" size="icon" aria-label={'Edit '+team.name} title="Edit team" onClick={()=>{setSuccess('');setScreen({mode:'edit',team})}}><Pencil size={16}/></Button><Button variant="ghost" size="icon" className="team-delete-action" aria-label={'Delete '+team.name} title="Delete team" onClick={()=>{setSuccess('');setScreen({mode:'delete',team})}}><Trash2 size={16}/></Button></div></div>)}</div>:<div className="team-manager-empty"><UsersRound size={28}/><strong>No teams yet</strong><p>Create your first team, then assign members from their accounts.</p></div>}
        <div className="dialog-footer"><Button variant="secondary" onClick={onClose}>Done</Button></div>
      </div>}
  </Modal>
}
