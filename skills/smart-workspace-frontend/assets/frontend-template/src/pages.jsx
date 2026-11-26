import { useState } from 'react'
import { ArrowRight, CheckCircle2, LayoutGrid, Pencil, Plus, Search, UsersRound } from 'lucide-react'
import { Avatar, Badge, Button, Empty, Field, Loading, Modal, Panel, Status } from './ui.jsx'
import { Brand } from './shell.jsx'

function PageHeading({ title, description, children }) {
  return <div className="page-heading"><div><h1>{title}</h1><p>{description}</p></div>{children && <div className="heading-actions">{children}</div>}</div>
}

export function OverviewPage({ items }) {
  return <>
    <PageHeading title="Workspace overview" description="A shared view of your people and daily operations."><Button asChild><a href="#directory"><UsersRound size={16} />Open directory</a></Button></PageHeading>
    <div className="page-stack">
      <div className="summary-grid">
        <section className="summary-card summary-primary"><div className="summary-heading"><UsersRound size={16} />Active members</div><h2>{items.filter(item => item.active).length} people</h2><p>Ready to collaborate</p></section>
        <section className="summary-card summary-secondary"><div className="summary-heading"><LayoutGrid size={16} />Teams represented</div><h2>{new Set(items.map(item => item.team)).size} teams</h2><p>One connected workspace</p></section>
      </div>
      <Panel title="Your workspace"><div className="panel-body page-stack"><p>Find people, update workspace branding, and explore the shared interface components.</p><div className="component-row"><Button asChild variant="secondary"><a href="#settings">Customize branding</a></Button><Button asChild variant="ghost"><a href="#components">Explore UI examples<ArrowRight size={16} /></a></Button></div></div></Panel>
    </div>
  </>
}

function ItemDialog({ item, onClose, onSave }) {
  function submit(event) {
    event.preventDefault()
    const values = new FormData(event.currentTarget)
    onSave({ ...item, name: values.get('name').trim(), email: values.get('email').trim(), team: values.get('team').trim(), active: values.get('active') === 'on' })
  }
  return <Modal title={item ? 'Edit member' : 'Add member'} description="Update the example directory. Changes last until you reload this page." onClose={onClose}>
    <form className="form-stack" onSubmit={submit}>
      <Field name="name" label="Name" defaultValue={item?.name || ''} required maxLength={100} pattern=".*\S.*" />
      <Field name="email" label="Email" type="email" defaultValue={item?.email || ''} required maxLength={254} />
      <Field name="team" label="Team" defaultValue={item?.team || ''} required maxLength={100} pattern=".*\S.*" />
      <label className="checkbox"><input type="checkbox" name="active" defaultChecked={item?.active ?? true} />Active member</label>
      <div className="dialog-footer"><Button variant="secondary" onClick={onClose}>Cancel</Button><Button type="submit">Save member</Button></div>
    </form>
  </Modal>
}

export function DirectoryPage({ items, onSave }) {
  const [search, setSearch] = useState('')
  const [editor, setEditor] = useState(null)
  const query = search.trim().toLowerCase()
  const shown = items.filter(item => [item.name, item.email, item.team].some(value => value.toLowerCase().includes(query)))
  return <>
    <PageHeading title="Directory" description="Find and manage the people in your workspace."><Button onClick={() => setEditor({ item: null })}><Plus size={16} />Add member</Button></PageHeading>
    <Panel title={'Members · ' + items.length} actions={<label className="search-box"><Search size={16} aria-hidden="true" /><input aria-label="Search members" placeholder="Search name or team" value={search} onChange={event => setSearch(event.target.value)} /></label>}>
      {shown.length ? <div className="table-wrap"><table><thead><tr><th>Name</th><th>Team</th><th>Status</th><th><span className="sr-only">Actions</span></th></tr></thead><tbody>{shown.map(item => <tr key={item.id}>
        <td><div className="person-cell"><Avatar name={item.name} color={item.color || 'blue'} /><div><strong>{item.name}</strong><small>{item.email}</small></div></div></td><td>{item.team}</td>
        <td><Badge tone={item.active ? 'positive' : 'neutral'}>{item.active ? 'Active' : 'Inactive'}</Badge></td><td><Button size="icon" variant="ghost" aria-label={'Edit ' + item.name} onClick={() => setEditor({ item })}><Pencil size={16} /></Button></td>
      </tr>)}</tbody></table></div> : <Empty title="No members found" description="Try another name or team." icon={UsersRound} />}
    </Panel>
    {editor && <ItemDialog item={editor.item} onClose={() => setEditor(null)} onSave={item => { onSave(item); setEditor(null) }} />}
  </>
}

export function SettingsPage({ branding, onSave }) {
  const [draft, setDraft] = useState(branding)
  return <>
    <PageHeading title="App settings" description="Customize your workspace name, logo, and browser icon." />
    <section className="panel settings-panel"><form className="form-stack" onSubmit={event => { event.preventDefault(); onSave({ ...draft, appName: draft.appName.trim(), headerName: draft.headerName.trim(), subtitle: draft.subtitle.trim() }) }}>
      <Field label="Application name" name="appName" required maxLength={80} pattern=".*\S.*" value={draft.appName} onChange={event => setDraft({ ...draft, appName: event.target.value })} />
      <div className="form-grid"><Field label="Header name" name="headerName" required maxLength={80} pattern=".*\S.*" value={draft.headerName} onChange={event => setDraft({ ...draft, headerName: event.target.value })} /><Field label="Subtitle" name="subtitle" maxLength={120} value={draft.subtitle} onChange={event => setDraft({ ...draft, subtitle: event.target.value })} /></div>
      <Field label="Logo URL" name="logo" hint="Use a local asset path or an HTTPS image URL." value={draft.logo} onChange={event => setDraft({ ...draft, logo: event.target.value })} />
      <Field label="Favicon URL" name="favicon" hint="Use a local asset path or an HTTPS image URL." value={draft.favicon} onChange={event => setDraft({ ...draft, favicon: event.target.value })} />
      <div className="settings-preview"><Brand branding={draft} /></div>
      <p className="inline-note">Branding is saved in this browser. Directory edits last until reload.</p>
      <div className="dialog-footer"><Button type="submit">Save settings</Button></div>
    </form></section>
  </>
}

export function ComponentsPage({ branding }) {
  const [modal, setModal] = useState(false)
  const [notice, setNotice] = useState('')
  return <>
    <PageHeading title="UI examples" description="Shared components and states for your next application." />
    <div className="page-stack">
      <Panel title="Actions and feedback"><div className="panel-body component-section">
        <div className="component-row"><Button onClick={() => setModal(true)}>Open dialog</Button><Button variant="secondary" onClick={() => setNotice('Secondary action completed.')}>Secondary</Button><Button variant="ghost" onClick={() => setNotice('Ghost action completed.')}>Ghost</Button><Button variant="danger" onClick={() => setNotice('Danger button example selected; no data was deleted.')}>Danger example</Button><Button disabled>Disabled</Button></div>
        <div className="component-row"><Badge tone="positive">Active</Badge><Badge tone="neutral">Draft</Badge><Badge tone="warning">Pending</Badge><Badge tone="negative">Failed</Badge></div>
        <Status success={notice || 'Your changes have been saved.'} /><Status error="Example error: check the required fields." />
        <Loading /><Empty title="Nothing here yet" description="New items will appear here." icon={LayoutGrid} />
      </div></Panel>
      <Panel title="Sign-in appearance"><div className="login-stage login-example"><div className="login-backdrop" aria-hidden="true"><span /><span /><span /></div><div className="login-card">
        <Brand branding={branding} /><div className="login-heading"><h2>Welcome back</h2><p>Sign-in UI example. Authentication is not connected.</p></div>
        <form className="form-stack login-form" onSubmit={event => { event.preventDefault(); setNotice('Sign-in example only. Connect your application authentication to enable sign-in.') }}>
          <Field label="Work email" name="email" type="email" autoComplete="username" required placeholder="you@example.com" /><Field label="Password" name="password" type="password" autoComplete="current-password" required />
          <Button type="submit" className="login-submit">Preview sign-in<ArrowRight size={19} /></Button>
        </form><p className="login-help">Use synthetic credentials for this UI example.</p>
      </div></div></Panel>
    </div>
    {modal && <Modal title="Example dialog" description="Use this pattern for focused forms and confirmations." onClose={() => setModal(false)}><p className="inline-note"><CheckCircle2 size={16} />Keyboard focus stays inside this dialog.</p><div className="dialog-footer"><Button variant="secondary" onClick={() => setModal(false)}>Cancel</Button><Button onClick={() => { setNotice('Dialog confirmed.'); setModal(false) }}>Confirm</Button></div></Modal>}
  </>
}
