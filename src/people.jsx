import {TeamPicker,TeamManager} from './teams.jsx'
import { useState,useEffect } from 'react'
import { Pencil, Plus, Search, Trash2, UsersRound } from 'lucide-react'
import { api, teamColors } from './lib.js'
import { Avatar, Button, Empty, Field, Modal, Status, useAction } from './ui.jsx'

function PersonDialog({ person, admin, userId, onClose, onSaved, teams }) {
  const action = useAction(onSaved)
  const [role, setRole] = useState(person?.role || 'engineer')
  const [teamIds,setTeamIds]=useState(person?.teamIds||[])
  const self = person?.id === userId

  function submit(event) {
    event.preventDefault()
    const input = new FormData(event.currentTarget)
    const body = {
      name: input.get('name'), email: input.get('email'), phone: input.get('phone'),
      dingtalkId: input.get('dingtalkId'), role, active: self || input.has('active'),
      teamIds, password: input.get('password'), ...(admin && { color: input.get('color') || null }),
    }
    action.run(() => api(person ? '/people/' + person.id : '/people', { method: person ? 'PUT' : 'POST', body }))
  }

  return <Modal title={person ? 'Edit account' : 'Add team member'} description="Manage account access and engineer contact details." onClose={onClose}>
    <form className="form-stack" onSubmit={submit}>
      <Field label="Full name" name="name" required maxLength={120} defaultValue={person?.name} />
      <Field label="Email" name="email" type="email" required maxLength={254} defaultValue={person?.email} />
      <div className="form-grid">
        <Field label="Phone" name="phone" type="tel" defaultValue={person?.phone || ''} required={role === 'engineer' && (person?.active ?? true)} placeholder="+60123456789" />
        <Field label="DingTalk ID" name="dingtalkId" maxLength={120} defaultValue={person?.dingtalkId || ''} />
      </div>
      {admin && <Field label="Role"><select value={role} onChange={(event) => setRole(event.target.value)} disabled={self}>
        <option value="engineer">Engineer</option><option value="viewer">Viewer (read-only timetable)</option><option value="manager">Manager</option><option value="admin">Admin</option>
      </select></Field>}
      {admin && role === 'engineer' && <Field label="Engineer color" hint="Used automatically by shifts unless a shift has its own color."><select name="color" defaultValue={person?.color || ''}>
        <option value="">Automatic</option>{teamColors.map((color) => <option value={color} key={color}>{color}</option>)}
      </select></Field>}
      <TeamPicker teams={teams} value={teamIds} onChange={setTeamIds}/>
      <Field label={person ? 'New password' : 'Initial password'} name="password" type="password" minLength={12}
        maxLength={128} required={!person} autoComplete="new-password"
        hint={person ? 'Leave blank to keep the current password.' : 'Use at least 12 characters.'} />
      <label className="checkbox"><input type="checkbox" name="active" defaultChecked={person?.active ?? true} disabled={self} /> Active account</label>
      <Status error={action.error} />
      <div className="dialog-footer"><Button variant="secondary" onClick={onClose}>Cancel</Button><Button type="submit" disabled={action.busy}>Save account</Button></div>
    </form>
  </Modal>
}

export function PeoplePage({ session, people, onChange, notifyUser, error, teams, onTeamsChange }) {
  const [collapsed,setCollapsed]=useState(()=>{try{return JSON.parse(localStorage.getItem('team-sections:'+session.user.id)||'{}')}catch{return {}}})
  useEffect(()=>{try{localStorage.setItem('team-sections:'+session.user.id,JSON.stringify(collapsed))}catch{}},[collapsed,session.user.id])
  const [manageTeams,setManageTeams]=useState(false)
  const [editor, setEditor] = useState(null)
  const [search, setSearch] = useState('')
  const [deleting,setDeleting]=useState(null)
  const deletion=useAction(()=>{setDeleting(null);onChange();notifyUser('Account deleted.')})
  const shown = people.filter((person) => [person.name, person.email, person.role,...teams.filter(t=>person.teamIds?.includes(t.id)).map(t=>t.name)].some((value) => value.toLowerCase().includes(search.toLowerCase().trim())))
  return <>
    <div className="page-heading">
      <div><h1>Team directory</h1><p>Manage engineer contacts and account access.</p></div>
      <div className="heading-actions directory-actions">{session.user.role==='admin'&&<Button variant="secondary" onClick={()=>setManageTeams(true)}>Manage teams</Button>}
      <Button onClick={() => setEditor({})}><Plus size={17} /> Add team member</Button></div>
    </div>
    <Status error={error} />
    <div className="panel-toolbar"><h2>Team members · {people.length}</h2><label className="search-box"><Search size={16}/><input aria-label="Search team members" placeholder="Search team members or teams" value={search} onChange={event=>setSearch(event.target.value)}/></label></div>
    {[...teams,{id:'unassigned',name:'Unassigned'}].map(team=>{const members=shown.filter(p=>team.id==='unassigned'?!p.teamIds?.length:p.teamIds?.includes(team.id));return <details key={team.id} open={search.trim()?members.length>0:!collapsed[team.id]} onToggle={event=>{if(search.trim())return;const closed=!event.currentTarget.open;setCollapsed(previous=>Boolean(previous[team.id])===closed?previous:{...previous,[team.id]:closed})}} className="team-directory-section"><summary><span className={'engineer-color color-'+(team.color||'blue')}>{team.name}</span> · {members.length}</summary>    <section className="panel">
      {members.length ? <div className="table-wrap"><table>
        <thead><tr><th>Name</th><th>Role</th><th>Color</th><th>Phone</th><th>DingTalk ID</th><th>Status</th><th><span className="sr-only">Actions</span></th></tr></thead>
        <tbody>{members.map((person, index) => <tr key={person.id}>
          <td><div className="person-cell"><Avatar name={person.name} color={person.color || teamColors[people.findIndex(item=>item.id===person.id) % teamColors.length]} /><div><strong>{person.name}</strong><small>{person.email}</small></div></div></td>
          <td className="capitalize">{person.role}</td><td><span className={'engineer-color color-' + (person.color || teamColors[people.findIndex(item=>item.id===person.id) % teamColors.length])}>{person.color || 'Automatic'}</span></td><td>{person.phone || '—'}</td><td>{person.dingtalkId || '—'}</td>
          <td><span className={'badge badge-' + (person.active ? 'positive' : 'neutral')}>{person.active ? 'Active' : 'Inactive'}</span></td>
          <td><div className="heading-actions"><Button size="icon" variant="ghost" aria-label={'Edit ' + person.name} onClick={() => setEditor({ person })}><Pencil size={16} /></Button>{session.user.role==='admin' && person.id!==session.user.id && <Button size="icon" variant="ghost" aria-label={'Delete '+person.name} onClick={()=>setDeleting(person)}><Trash2 size={16}/></Button>}</div></td>
        </tr>)}</tbody>
      </table></div> : <Empty icon={UsersRound} title={search ? 'No matching team members' : 'No team members yet'} description={search ? 'Try a different name or email.' : 'Add an engineer before creating a shift.'} />}
    </section>
</details>})}
    {deleting && <Modal title={'Delete '+deleting.name+'?'} description="This removes the account from Team directory and disables sign-in. Past duty and audit history retain the user's name. The email address can be used for a new account." onClose={()=>setDeleting(null)}><Status error={deletion.error}/><div className="dialog-footer"><Button variant="secondary" onClick={()=>setDeleting(null)}>Cancel</Button><Button variant="danger" disabled={deletion.busy} onClick={()=>deletion.run(()=>api('/people/'+deleting.id,{method:'DELETE'}))}>Delete account</Button></div></Modal>}
    {manageTeams&&<TeamManager people={people} teams={teams} onClose={()=>setManageTeams(false)} onSaved={onTeamsChange}/>}
    {editor && <PersonDialog teams={teams} person={editor.person} admin={session.user.role === 'admin'} userId={session.user.id}
      onClose={() => setEditor(null)} onSaved={() => { setEditor(null); onChange(); notifyUser('Account saved.') }} />}
  </>
}
