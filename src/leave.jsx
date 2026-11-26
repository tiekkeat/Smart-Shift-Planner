import { useState } from 'react'
import { DateTime } from 'luxon'
import { api, dateLabel } from './lib.js'
import { Button, Empty, Field, Loading, Modal, Status, useAction, useResource } from './ui.jsx'

const days = units => new Intl.NumberFormat('en-MY', { maximumFractionDigits: 1 }).format(Number(units || 0) / 2)
function newOperationId() {
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  bytes[6] = (bytes[6] & 15) | 64
  bytes[8] = (bytes[8] & 63) | 128
  const hex = Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}
const localToday = timezone => DateTime.now().setZone(timezone).toISODate()
const labels = { duty_credit: 'Duty earned', duty_reversal: 'Duty correction', manual: 'Manual adjustment', opening_usage: 'Previously taken', leave_taken: 'Leave approved', leave_refund: 'Leave cancelled' }

function AdjustmentDialog({ person, admin, onClose, onSaved }) {
  const [operationId] = useState(() => newOperationId())
  const action = useAction(onSaved)
  return <Modal title={'Adjust leave · ' + person.name} description="Credits and corrections are recorded in the engineer’s history." onClose={() => { if (!action.busy) onClose() }}>
    <form className="form-stack" onSubmit={event => { event.preventDefault(); const f = new FormData(event.currentTarget); action.run(() => api('/leave/adjustments', { method: 'POST', body: { engineerId: person.id, units: Number(f.get('days')) * 2, reason: f.get('reason'), operationId } })) }}>
      <p>Available: <strong>{days(person.available)} days</strong></p>
      <Field label={admin ? 'Days to add or deduct' : 'Days to add'} hint={admin ? 'Use a negative amount for a debit correction. Half days are supported.' : 'Half days are supported.'}><input aria-label={admin ? 'Days to add or deduct' : 'Days to add'} name="days" type="number" required min={admin ? -3650 : 0.5} max={3650} step="0.5" defaultValue="1" /></Field>
      <Field label="Reason"><textarea name="reason" required maxLength={500} rows={3} /></Field>
      <Status error={action.error} /><div className="dialog-footer"><Button variant="secondary" disabled={action.busy} onClick={onClose}>Cancel</Button><Button type="submit" disabled={action.busy}>Save adjustment</Button></div>
    </form>
  </Modal>
}

function History({ person, timezone }) {
  const resource = useResource(signal => api('/leave/history/' + person.id, { signal }), person.id)
  return <section className="panel schedule-settings"><div className="panel-toolbar"><h2>History · {person.name}</h2></div>
    <Status error={resource.error} />{resource.loading ? <Loading /> : resource.data?.length ? <div className="table-wrap"><table><thead><tr><th>Date</th><th>Activity</th><th>Days</th><th>Reason</th><th>Recorded by</th></tr></thead><tbody>{resource.data.map(entry => <tr key={entry.id}><td>{dateLabel(new Date(Number(entry.created_at)).toISOString(), timezone)}</td><td>{labels[entry.kind] || entry.kind}</td><td>{entry.units > 0 ? '+' : ''}{days(entry.units)}</td><td>{entry.reason}</td><td>{entry.actor_name || 'Automatic'}</td></tr>)}</tbody></table></div> : <Empty title="No leave transactions yet" />}
  </section>
}

export function CompensationPage({ session }) {
  const resource = useResource(signal => api('/leave/balances', { signal }))
  const [selected, setSelected] = useState(null)
  const [adjust, setAdjust] = useState(null)
  const [revision, setRevision] = useState(0)
  const staff = ['admin', 'manager'].includes(session.user.role)
  const people = resource.data?.people || []
  const person = people.find(p => p.id === selected) || people[0]
  return <>
    <div className="page-heading"><div><h1>Compensation leave</h1><p>Days earned, reserved, taken, and available. Unused leave does not expire.</p></div>{session.user.role === 'admin' && <Button asChild variant="secondary"><a href="#settings">Configure earning rules</a></Button>}</div>
    <Status error={resource.error} />
    {resource.data && !resource.data.enabled && <Status success="Automatic earning is not activated. An admin must configure template rates and review the historical setup in App settings. Manual credits and leave applications are available." />}
    {resource.loading ? <Loading /> : people.length ? <>
      {person && <div className="report-stats leave-stats">{[['Balance', person.balance], ['Reserved', person.reserved], ['Available', person.available], ['Projected', person.projected]].map(([label, value]) => <div className="panel report-stat" key={label}><span>{person.name} · {label}</span><strong>{days(value)} days</strong></div>)}</div>}
      <section className="panel"><div className="panel-toolbar"><h2>{staff ? 'Engineer balances' : 'My balance'}</h2><Button asChild variant="secondary"><a href="#leave">Leave applications</a></Button></div>
        <p className="report-help">Available = balance − pending reservations. Projected days become available after qualifying duties finish.</p>
        <div className="table-wrap"><table><thead><tr><th>Engineer</th><th>Balance</th><th>Reserved</th><th>Available</th><th>Projected</th><th>Actions</th></tr></thead><tbody>{people.map(p => <tr key={p.id}><td>{p.name}{(!p.active || p.deleted_at) && <small className="block">Inactive / historical</small>}</td><td>{days(p.balance)}</td><td>{days(p.reserved)}</td><td>{days(p.available)}</td><td>{days(p.projected)}</td><td><div className="heading-actions"><Button size="small" variant="secondary" onClick={() => setSelected(p.id)}>History</Button>{staff && Boolean(p.active) && !p.deleted_at && <Button size="small" onClick={() => setAdjust(p)}>Add / adjust</Button>}</div></td></tr>)}</tbody></table></div>
      </section>
      {person && <History key={person.id + ':' + revision} person={person} timezone={session.timezone} />}
    </> : <Empty title="No engineers" />}
    {adjust && <AdjustmentDialog person={adjust} admin={session.user.role === 'admin'} onClose={() => setAdjust(null)} onSaved={() => { setAdjust(null); resource.refresh(); setRevision(n => n + 1) }} />}
  </>
}

function SetupDialog({ timezone, onClose, onSaved }) {
  const people = useResource(signal => api('/leave/balances', { signal }))
  const [from, setFrom] = useState(localToday(timezone))
  const [used, setUsed] = useState({})
  const [preview, setPreview] = useState(null)
  const [confirmed, setConfirmed] = useState(false)
  const [error, setError] = useState('')
  const previewAction = useAction(p => { setPreview(p); setConfirmed(false); setError('') })
  const action = useAction(onSaved)
  const input = { from, openingDebits: Object.entries(used).filter(([, value]) => Number(value) > 0).map(([engineerId, value]) => ({ engineerId, units: Number(value) * 2 })) }
  const active = (people.data?.people || []).filter(p => p.active && !p.deleted_at)
  function invalidate() { setPreview(null); setConfirmed(false) }
  return <Modal title="Review historical credits and activate" description="Choose when earning starts and account for leave already taken. This setup runs once." onClose={() => { if (!action.busy && !previewAction.busy) onClose() }}>
    <div className="form-stack">
      <Field label="Earning start date"><input type="date" value={from} max={localToday(timezone)} required onChange={e => { setFrom(e.target.value); invalidate() }} /></Field>
      <p className="settings-help">Only completed duties on or after this date earn credit. Configure template rates effective from this date before continuing. Existing manual credits are retained.</p>
      <Status error={people.error} />{active.map(p => <Field key={p.id} label={p.name + ' · days already taken since start date'}><input aria-label={p.name + ' previously taken days'} type="number" min="0" max="3650" step="0.5" value={used[p.id] || ''} placeholder="0" onChange={e => { setUsed({ ...used, [p.id]: e.target.value }); invalidate() }} /></Field>)}
      <Button variant="secondary" disabled={previewAction.busy || action.busy || !from || people.loading || Boolean(people.error)} onClick={() => previewAction.run(() => api('/leave/setup-preview', { method: 'POST', body: input }))}>Preview historical credits</Button>
      <Status error={previewAction.error || action.error || error} />
      {preview && <>
        <div className="table-wrap"><table><thead><tr><th>Engineer</th><th>Earned</th><th>Previously taken</th><th>Resulting balance</th></tr></thead><tbody>{(people.data?.people || []).map(p => { const credit = preview.duties.filter(d => d.engineerId === p.id).reduce((sum, d) => sum + d.units, 0); return <tr key={p.id}><td>{p.name}</td><td>{days(credit)}</td><td>{Number(used[p.id] || 0)}</td><td>{days(p.balance + credit - Number(used[p.id] || 0) * 2)}</td></tr> })}</tbody></table></div>
        <p>{preview.duties.filter(d => !d.templateId).length} unclassified duties will earn no credit. Templates without an effective rate earn 0.</p>
        <details><summary>Review {preview.duties.length} completed duties</summary><div className="classification-list">{preview.duties.map(d => <p key={d.id}>{d.name} · {dateLabel(new Date(d.start).toISOString(), timezone)} · {d.templateName || 'Unclassified'} · {days(d.units)} days</p>)}</div></details>
        <label className="leave-checkbox"><input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} />I reviewed the rates, completed duties, and previously taken leave.</label>
      </>}
      <div className="dialog-footer"><Button variant="secondary" disabled={action.busy} onClick={onClose}>Cancel</Button><Button disabled={!preview || !confirmed || action.busy || previewAction.busy} onClick={() => action.run(() => api('/leave/activate', { method: 'POST', body: { ...input, fingerprint: preview.fingerprint } }))}>Activate automatic earning</Button></div>
    </div>
  </Modal>
}

export function LeaveSettings({ timezone }) {
  const resource = useResource(signal => api('/leave/settings', { signal }))
  const [setup, setSetup] = useState(false)
  const [success, setSuccess] = useState('')
  const action = useAction(() => { resource.refresh(); setSuccess('Earning rule saved.') })
  const enabled = Boolean(resource.data?.config)
  return <section className="panel schedule-settings"><div className="panel-toolbar"><div><h2>Compensation leave settings</h2><p className="settings-help">Set days earned for each completed duty template. Weekend duty can earn 1 day; Public holiday duty can earn 2 days.</p></div>{resource.data && !enabled && <Button onClick={() => setSetup(true)}>Set up automatic earning</Button>}</div>
    <div className="leave-settings-body"><Status error={resource.error || action.error} success={success} />{resource.loading ? <Loading /> : resource.data && <>
      <p>{enabled ? 'Automatic earning is active from ' + resource.data.config.starts_on + '. New rates must start on a future date.' : 'Automatic earning is disabled until historical credits are reviewed and confirmed.'} Unused leave does not expire. Unclassified duties earn no credit; review them in <a href="#reports">Duty hours</a>.</p>
      <form className="form-stack" onSubmit={event => { event.preventDefault(); const f = new FormData(event.currentTarget); action.run(() => api('/leave/rules', { method: 'POST', body: { templateId: f.get('template'), effectiveOn: f.get('effective'), units: Number(f.get('days')) * 2 } })) }}>
        <div className="form-grid"><Field label="Earning template"><select aria-label="Earning template" name="template" required defaultValue=""><option value="" disabled>Choose a shift template</option>{resource.data.templates.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}</select></Field><Field label="Days earned per completed duty"><input name="days" type="number" min="0" max="3650" step="0.5" required defaultValue="0" /></Field><Field label="Effective from"><input name="effective" type="date" required min={enabled ? DateTime.now().setZone(timezone).plus({ days: 1 }).toISODate() : undefined} defaultValue={enabled ? DateTime.now().setZone(timezone).plus({ days: 1 }).toISODate() : localToday(timezone)} /></Field></div>
        <div><Button type="submit" disabled={action.busy || !resource.data.templates.length}>Save earning rule</Button></div>
      </form>
      {resource.data.rules.length ? <div className="table-wrap"><table><thead><tr><th>Template</th><th>Effective from</th><th>Days per duty</th></tr></thead><tbody>{resource.data.rules.map(r => <tr key={r.id}><td>{r.template_name}{r.archived_at != null && ' (archived)'}</td><td>{r.effective_on}</td><td>{days(r.units)}</td></tr>)}</tbody></table></div> : <Empty title="No earning rules" description="Templates without a rule earn no compensation leave." />}
    </>}</div>
    {setup && <SetupDialog timezone={timezone} onClose={() => setSetup(false)} onSaved={() => { setSetup(false); resource.refresh(); setSuccess('Automatic earning activated. Historical credits are recorded.') }} />}
  </section>
}

function ApplyDialog({ timezone, onClose, onSaved }) {
  const [draft, setDraft] = useState({ from: localToday(timezone), to: localToday(timezone), halves: [] })
  const [reason, setReason] = useState('')
  const [preview, setPreview] = useState(null)
  const [operationId] = useState(() => newOperationId())
  const previewAction = useAction(setPreview)
  const action = useAction(onSaved)
  function change(value) { setDraft({ ...value, halves: value.halves.filter(h => h.date >= value.from && h.date <= value.to) }); setPreview(null) }
  const dates = []
  let cursor = DateTime.fromISO(draft.from)
  const end = DateTime.fromISO(draft.to)
  while (cursor.isValid && cursor <= end && dates.length < 63) { dates.push(cursor); cursor = cursor.plus({ days: 1 }) }
  return <Modal title="Apply for compensation leave" description="Choose full or half days. Submission reserves your available leave until a manager or admin reviews it." onClose={() => { if (!action.busy && !previewAction.busy) onClose() }}>
    <form className="form-stack" onSubmit={event => { event.preventDefault(); action.run(() => api('/leave/requests', { method: 'POST', body: { ...draft, reason, operationId, fingerprint: preview.fingerprint } })) }}>
      <div className="form-grid"><Field label="First leave date"><input type="date" required min={localToday(timezone)} value={draft.from} onChange={e => change({ ...draft, from: e.target.value })} /></Field><Field label="Last leave date"><input type="date" required min={draft.from} value={draft.to} onChange={e => change({ ...draft, to: e.target.value })} /></Field></div>
      <p className="settings-help">Weekends and subscribed public holidays are excluded. Morning is midnight–12:00; afternoon is 12:00–midnight, in {timezone}.</p>
      <div className="leave-date-list">{dates.filter(d => d.weekday < 6).map(d => { const date = d.toISODate(); return <Field key={date} label={d.toFormat('ccc, dd LLL yyyy')}><select value={draft.halves.find(h => h.date === date)?.part || 'full'} onChange={e => change({ ...draft, halves: [...draft.halves.filter(h => h.date !== date), ...(e.target.value === 'full' ? [] : [{ date, part: e.target.value }])] })}><option value="full">Full day</option><option value="am">Morning half day</option><option value="pm">Afternoon half day</option></select></Field> })}</div>
      <Field label="Reason"><textarea required maxLength={500} value={reason} onChange={e => setReason(e.target.value)} rows={3} /></Field>
      <Button variant="secondary" disabled={previewAction.busy || action.busy} onClick={() => previewAction.run(() => api('/leave/preview', { method: 'POST', body: draft }))}>Preview leave and balance</Button>
      {preview && <div className="leave-preview"><p><strong>{days(preview.units)} days requested</strong> · Available {days(preview.available)} · Remaining {days(preview.remaining)}</p>{preview.dates.map(d => <p key={d.date}>{d.date} · {d.excluded || (d.part === 'full' ? 'Full day' : d.part === 'am' ? 'Morning' : 'Afternoon')} · {days(d.units)} days</p>)}</div>}
      <Status error={previewAction.error || action.error} /><div className="dialog-footer"><Button variant="secondary" disabled={action.busy} onClick={onClose}>Cancel</Button><Button type="submit" disabled={!preview || preview.remaining < 0 || action.busy || previewAction.busy}>Submit application</Button></div>
    </form>
  </Modal>
}

function ReviewDialog({ item, session, onClose, onSaved }) {
  const [reason, setReason] = useState('')
  const action = useAction(onSaved)
  const staff = ['admin', 'manager'].includes(session.user.role)
  const start = Math.min(...item.snapshot.dates.filter(d => d.units).map(d => d.start))
  function transition(kind) { action.run(() => api('/leave/requests/' + item.id + '/action', { method: 'POST', body: { version: item.version, action: kind, reason } })) }
  return <Modal title={'Leave application · ' + item.engineer_name} description="Review the requested dates and decision history." onClose={() => { if (!action.busy) onClose() }}>
    <div className="form-stack"><p><strong className="capitalize">{item.status}</strong> · {days(item.units)} days · {item.selection.from} to {item.selection.to}</p><p>{item.reason}</p>
      <div className="leave-date-list">{item.snapshot.dates.map(d => <p key={d.date}>{d.date} · {d.excluded || d.part} · {days(d.units)} days</p>)}</div>
      {item.review_note && <p>Last decision: {item.review_note}</p>}
      <Field label="Decision / cancellation reason"><textarea maxLength={500} value={reason} onChange={e => setReason(e.target.value)} rows={3} /></Field>
      <Status error={action.error} />
      <div className="dialog-footer"><Button variant="secondary" disabled={action.busy} onClick={onClose}>Close</Button>
        {item.status === 'pending' && (staff ? <><Button variant="danger" disabled={action.busy} onClick={() => transition('reject')}>Reject leave</Button><Button disabled={action.busy} onClick={() => transition('approve')}>Approve leave</Button></> : <Button variant="danger" disabled={action.busy} onClick={() => transition('withdraw')}>Withdraw application</Button>)}
        {item.status === 'approved' && (session.user.role === 'admin' || (item.engineer_id === session.user.id && start > Date.now())) && <Button variant="danger" disabled={action.busy || !reason.trim()} onClick={() => transition('cancel')}>{start <= Date.now() ? 'Correct / cancel started leave' : 'Cancel approved leave'}</Button>}
      </div>
    </div>
  </Modal>
}

export function LeaveApplicationsPage({ session }) {
  const resource = useResource(signal => api('/leave/requests', { signal }))
  const [applying, setApplying] = useState(false)
  const [selected, setSelected] = useState(null)
  const [filter, setFilter] = useState('all')
  const [search, setSearch] = useState('')
  const [success, setSuccess] = useState('')
  const engineer = session.user.role === 'engineer'
  const rows = (resource.data || []).filter(r => (filter === 'all' || r.status === filter) && r.engineer_name.toLowerCase().includes(search.toLowerCase()))
  function saved() { setApplying(false); setSelected(null); resource.refresh(); setSuccess('Leave application updated.') }
  return <>
    <div className="page-heading"><div><h1>Leave applications</h1><p>{engineer ? 'Apply using your compensation balance and track decisions.' : 'Review engineer requests and approve compensation leave.'}</p></div>{engineer && <Button onClick={() => setApplying(true)}>Apply for leave</Button>}</div>
    <Status error={resource.error} success={success} />
    <section className="panel"><div className="panel-toolbar report-toolbar"><Button asChild variant="secondary"><a href="#compensation">View balances</a></Button>{!engineer && <Field label="Find engineer"><input type="search" value={search} onChange={e => setSearch(e.target.value)} /></Field>}<Field label="Application status"><select value={filter} onChange={e => setFilter(e.target.value)}>{['all', 'pending', 'approved', 'rejected', 'withdrawn', 'cancelled'].map(s => <option key={s} value={s}>{s === 'all' ? 'All statuses' : s}</option>)}</select></Field></div>
      {resource.loading ? <Loading /> : rows.length ? <div className="table-wrap"><table><thead><tr><th>Engineer</th><th>Dates</th><th>Days</th><th>Status</th><th>Actions</th></tr></thead><tbody>{rows.map(r => <tr key={r.id}><td>{r.engineer_name}</td><td>{r.selection.from} → {r.selection.to}</td><td>{days(r.units)}</td><td className="capitalize">{r.status}</td><td><Button variant="secondary" size="small" onClick={() => setSelected(r)}>View application</Button></td></tr>)}</tbody></table></div> : <Empty title="No leave applications" description="Applications and their decisions will appear here." />}
    </section>
    {applying && <ApplyDialog timezone={session.timezone} onClose={() => setApplying(false)} onSaved={saved} />}
    {selected && <ReviewDialog item={selected} session={session} onClose={() => setSelected(null)} onSaved={saved} />}
  </>
}
