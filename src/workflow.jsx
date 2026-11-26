import { NewChangeRequest } from './change-request.jsx'
import { useState } from 'react'
import { ArrowRight, Bell, Check, ClipboardList, Inbox, Plus } from 'lucide-react'
import { api, dateLabel } from './lib.js'
import { Avatar, Button, Empty, Field, Loading, Modal, Status, useAction, useResource } from './ui.jsx'

const statuses = { pending: 'warning', approved: 'positive', rejected: 'negative', withdrawn: 'neutral', reverted: 'neutral' }
function ReviewDialog({ item, timezone, role, onClose, onSaved }) {
  const action = useAction(onSaved)
  const admin = role === 'admin'
  const canDecide = admin && item.status === 'pending'
  const canWithdraw = role === 'engineer' && item.status === 'pending'
  const [note, setNote] = useState('')
  const [overlap, setOverlap] = useState('')
  const [restore, setRestore] = useState(null)
  const [restoreLoading, setRestoreLoading] = useState(false)
  const [restoreError, setRestoreError] = useState('')
  const [confirmLaterChanges, setConfirmLaterChanges] = useState(false)
  async function loadRestore() {
    setRestoreLoading(true); setRestoreError(''); setOverlap('')
    try { setRestore(await api('/changes/' + item.id + '/revert-preview')); setConfirmLaterChanges(false) }
    catch (error) { setRestoreError(error.message) }
    finally { setRestoreLoading(false) }
  }
  function revert(allowOverlap = false) {
    action.run(async () => {
      try { return await api('/changes/' + item.id + '/revert', { method: 'POST', body: { versions: restore.shifts.map(entry => ({ id: entry.current.id, version: entry.current.version })), confirmLaterChanges, allowOverlap, note } }) }
      catch (error) { if (error.status === 409 && error.message.startsWith('This time overlaps existing duty')) setOverlap(error.message); throw error }
    })
  }
  function review(decision, allowOverlap = false) {
    action.run(async () => {
      try { return await api('/changes/' + item.id + '/review', { method: 'POST', body: { decision, note, allowOverlap } }) }
      catch (error) { if (error.status === 409 && error.message.startsWith('This time overlaps existing duty')) setOverlap(error.message); throw error }
    })
  }
  return <Modal title="Duty change request" description={'Submitted by ' + item.requester + ' on ' + dateLabel(item.createdAt, timezone)} onClose={onClose}>
    <div className="form-stack">
      <span className={'badge self-start badge-' + statuses[item.status]}>{item.status}</span>
      <div className="form-grid compare-grid">
        {[['Original assignment', item.original], ['Proposed assignment', item.proposed]].map(([label, shift]) => <div className="compare-card" key={label}>
          <small>{label}</small><small>{shift.templateName || 'Unclassified'}</small><strong>{shift.engineerName}</strong><span>{dateLabel(shift.start, timezone)}</span><span>to {dateLabel(shift.end, timezone)}</span>
        </div>)}
      </div>
      {item.swap && <div className="compare-card"><strong>Shift swap · both assignments change</strong><span>{item.original.engineerName} takes {item.swap.engineerName}'s duty: {dateLabel(item.swap.start, timezone)} → {dateLabel(item.swap.end, timezone)}</span><span>{item.swap.engineerName} takes the original duty: {dateLabel(item.original.start, timezone)} → {dateLabel(item.original.end, timezone)}</span></div>}
      <div className="request-reason"><strong>Reason</strong><p>{item.reason}</p></div>
      {item.reviewNote && <div className="request-reason"><strong>Decision note</strong><p>{item.reviewNote}</p></div>}
      {item.revertedAt && <div className="request-reason"><strong>Reverted on {dateLabel(item.revertedAt, timezone)}</strong>{item.revertNote && <p>{item.revertNote}</p>}</div>}
      {restore && <section className="form-stack" aria-label="Restore original assignments">
        <h3>Restore original {item.swap ? 'assignments' : 'assignment'}</h3>
        <p>This restores the original duty dates and engineers. {item.swap ? 'Both sides of the swap are restored together.' : 'The current assignment is replaced.'}</p>
        {restore.shifts.map(entry => <div className="compare-card" key={entry.current.id}>
          <strong>{entry.original.engineerName}</strong>
          <span>Current: {entry.current.engineerName} · {dateLabel(entry.current.start, timezone)} → {dateLabel(entry.current.end, timezone)}{entry.current.cancelled ? ' · Cancelled' : ''}</span>
          <span>Restore: {dateLabel(entry.original.start, timezone)} → {dateLabel(entry.original.end, timezone)}</span>
        </div>)}
        {restore.shifts.some(entry => entry.laterChanged) && <div className="confirm-box"><p>An assignment was edited or cancelled after approval. Restoring it will replace those later changes.</p><div className="checkbox-row"><input id="confirm-later-changes" type="checkbox" checked={confirmLaterChanges} onChange={event => setConfirmLaterChanges(event.target.checked)} /><label htmlFor="confirm-later-changes">I confirm replacing the later edits or cancellation shown above.</label></div></div>}
        <Field label="Restore note"><textarea value={note} maxLength={400} rows={2} onChange={event => setNote(event.target.value)} /></Field>
        <div className="heading-actions"><Button variant="secondary" onClick={() => { setRestore(null); setOverlap(''); setRestoreError('') }}>Keep current assignments</Button><Button variant="danger" disabled={action.busy || (restore.shifts.some(entry => entry.laterChanged) && !confirmLaterChanges)} onClick={() => revert()}>Confirm restore original {item.swap ? 'assignments' : 'assignment'}</Button></div>
      </section>}
      <Status error={restoreError} />
      {canDecide && <Field label="Decision note"><textarea value={note} maxLength={400} rows={3} onChange={(event) => setNote(event.target.value)} /></Field>}
      {overlap && <div className="confirm-box" role="alert"><p>{overlap}</p><Button disabled={action.busy} onClick={() => restore ? revert(true) : review('approved', true)}>{restore ? 'Confirm overlap and restore' : 'Confirm overlap and approve'}</Button></div>}
      <Status error={overlap ? '' : action.error} />
      <div className="dialog-footer">
        <Button variant="secondary" onClick={onClose}>Close</Button>
        {admin && item.status === 'approved' && !restore && <Button variant="danger" disabled={restoreLoading || action.busy} onClick={loadRestore}>{restoreLoading ? 'Loading restore preview…' : 'Revert approved change'}</Button>}
        {canDecide && <><Button variant="danger" onClick={() => review('rejected')} disabled={action.busy}>Reject</Button>
          <Button onClick={() => review('approved')} disabled={action.busy}><Check size={16} /> Approve</Button></>}
        {canWithdraw && <Button variant="danger" disabled={action.busy} onClick={() => action.run(() =>
          api('/changes/' + item.id + '/withdraw', { method: 'POST' }))}>Withdraw request</Button>}
      </div>
    </div>
  </Modal>
}

export function ChangesPage({ session, people, onChange, notifyUser }) {
  const resource = useResource((signal) => api('/changes', { signal }))
  const [requesting, setRequesting] = useState(false)
  const [selected, setSelected] = useState(null)
  const [filter, setFilter] = useState('all')
  const shown = (resource.data || []).filter((item) => filter === 'all' || item.status === filter)
  return <>
    <div className="page-heading"><div><h1>Change requests</h1><p>Track proposed updates to duty assignments.</p></div>{session.user.role === 'engineer' && <Button onClick={() => setRequesting(true)}><Plus size={16} /> Request change</Button>}</div>
    <section className="panel">
      <div className="panel-toolbar"><h2>{session.user.role === 'engineer' ? 'My requests' : 'Schedule requests'}</h2>
        <select aria-label="Request status" value={filter} onChange={(event) => setFilter(event.target.value)}>
          <option value="all">All statuses</option>
          {Object.keys(statuses).map((status) => <option key={status} value={status}>{status[0].toUpperCase() + status.slice(1)}</option>)}
        </select>
      </div>
      {resource.loading ? <Loading /> : <Status error={resource.error} />}
      {resource.data && (shown.length ? <div className="table-wrap"><table>
        <thead><tr><th>Requested by</th><th>Original start</th><th>Proposed start</th><th>Status</th><th><span className="sr-only">Actions</span></th></tr></thead>
        <tbody>{shown.map((item) => <tr key={item.id}>
          <td><div className="person-cell"><Avatar name={item.requester} /><strong>{item.requester}</strong>{item.swap && <span className="badge badge-neutral">Swap</span>}</div></td>
          <td>{dateLabel(item.original.start, session.timezone)}</td><td>{dateLabel(item.proposed.start, session.timezone)}</td>
          <td><span className={'badge badge-' + statuses[item.status]}>{item.status}</span></td>
          <td><Button size="small" variant="secondary" onClick={() => setSelected(item)}>View <ArrowRight size={14} /></Button></td>
        </tr>)}</tbody></table></div>
        : <Empty icon={ClipboardList} title="No change requests" description={session.user.role === 'engineer' ? 'Choose Request change to find your assigned duty.' : 'Matching requests will appear here.'} />)}
    </section>
    {requesting && <NewChangeRequest session={session} people={people} onClose={() => setRequesting(false)} onSaved={result => { setRequesting(false); resource.refresh(); onChange(); const count = result.requests.length; notifyUser(count === 1 ? 'Change request submitted.' : count + ' change requests submitted.') }} />}
    {selected && <ReviewDialog item={selected} timezone={session.timezone} role={session.user.role} onClose={() => setSelected(null)}
      onSaved={() => { setSelected(null); resource.refresh(); onChange(); notifyUser('Request updated.') }} />}
  </>
}

export { ReportsPage } from './reports.jsx'

export function NotificationsPage({ notifications, timezone, refresh, error }) {
  const action = useAction(refresh)
  function mark(notificationId) {
    action.run(() => api('/notifications/read', { method: 'POST', body: notificationId ? { notificationId } : {} }))
  }
  const unread = notifications.filter((item) => item.unread).length
  return <>
    <div className="page-heading"><div><h1>Notifications</h1><p>Stay up to date with your duty schedule and change requests.</p></div>
      {unread > 0 && <Button variant="secondary" onClick={() => mark()} disabled={action.busy}><Check size={16} /> Mark all as read</Button>}
    </div>
    <Status error={action.error || error} />
    <section className="panel notification-list">
      {notifications.length ? notifications.map((item) => <article key={item.id} className={item.unread ? 'unread' : ''}>
        <span className="notification-icon"><Bell size={18} /></span>
        <div><strong>{item.title}</strong><p>{item.body}</p><small>{dateLabel(item.createdAt, timezone)}</small></div>
        {item.unread && <Button size="icon" variant="ghost" aria-label="Mark as read" disabled={action.busy} onClick={() => mark(item.id)}><Check size={16} /></Button>}
      </article>) : <Empty icon={Inbox} title="You're all caught up" description="New assignments and schedule updates will appear here." />}
    </section>
  </>
}
