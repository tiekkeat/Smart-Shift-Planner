import { useState } from 'react'
import { Moon } from 'lucide-react'
import { api, applyShiftTemplate, dateField, dateLabel, fromField, local, teamColors } from './lib.js'
import { ShiftTypeField } from './shift-type.jsx'
import { NewChangeRequest } from './change-request.jsx'
import { Avatar, Button, Field, Modal, Status, useAction } from './ui.jsx'

export function ShiftDialog(props) {
  const [requesting, setRequesting] = useState(props.dialog.mode === 'request')
  if (requesting) return <NewChangeRequest session={props.session} people={props.people} initialShift={props.dialog.shift} onClose={props.onClose} onSaved={props.onSaved} />
  return <DutyShiftDialog {...props} onRequest={() => setRequesting(true)} />
}

function DutyShiftDialog({ session, people, dialog, onClose, onSaved, templates = [], onGroup, onViewGroup, onRequest }) {
  const { user, timezone } = session
  const { shift, mode } = dialog
  const create = mode === 'new'
  const edit = mode === 'edit'
  const read = mode === 'read'
  const [overlap, setOverlap] = useState('')
  const [confirmCancel, setConfirmCancel] = useState(false)
  const [templateId, setTemplateId] = useState(shift.templateId || null)
  const [color, setColor] = useState(shift.color || '')
  const [start, setStart] = useState(dateField(shift.start, timezone))
  const [engineerId, setEngineerId] = useState(shift.engineerId || '')
  const [end, setEnd] = useState(dateField(shift.end, timezone))
  const action = useAction(onSaved)
  const canPropose = user.role === 'engineer' && read && shift.engineerId === user.id && Date.parse(shift.end) > Date.now()
  const title = create ? 'New duty shift' : edit ? 'Edit duty shift' : 'Duty details'
  const description = 'Times are shown in ' + timezone + '.'
  const assignable = people.filter((person) => person.role === 'engineer' && (person.active || person.id === shift.engineerId))

  function submit(event) {
    event.preventDefault()
    const values = new FormData(event.currentTarget)
    const allowOverlap = event.nativeEvent.submitter?.dataset.overlap === 'true'
    action.run(async () => {
      try {
      const fields = { allowOverlap, engineerId: values.get('engineerId'), start: fromField(start, timezone), end: fromField(end, timezone) }
      return await api(create ? '/shifts' : '/shifts/' + shift.id, {
        method: create ? 'POST' : 'PUT',
        body: { ...fields, templateId, color: color || null, note: values.get('note'), ...(!create && { version: shift.version }) },
      })
      } catch (error) {
        if (error.status === 409 && error.message.startsWith('This time overlaps existing duty')) setOverlap(error.message)
        throw error
      }
    })
  }

  return <Modal title={title} description={description} onClose={onClose}>
    {shift.groupId && <div className="group-night-context"><span>This is one occurrence in a repeated duty group. Changes here affect this night only.</span>{onViewGroup && <Button variant="secondary" size="small" onClick={() => onViewGroup(shift.groupId)}>View duty group</Button>}</div>}
    {read ? <>
      <div className="detail-person"><Avatar name={shift.engineerName} /><strong>{shift.engineerName}</strong></div>
      <dl className="shift-details"><dt>Starts</dt><dd>{dateLabel(shift.start, timezone)}</dd><dt>Ends</dt><dd>{dateLabel(shift.end, timezone)}</dd>
        <dt>Shift type</dt><dd>{shift.templateName || 'Unclassified'}</dd>
        {shift.note && <><dt>Note</dt><dd>{shift.note}</dd></>}</dl>
      <div className="dialog-footer"><Button variant="secondary" onClick={onClose}>Close</Button>
        {canPropose && <Button onClick={() => onRequest()}>Request change</Button>}</div>
    </> : <form onSubmit={submit} onChange={() => setOverlap('')} className="form-stack">
      {(create || edit) && !shift.groupId && <Button variant="secondary" onClick={(event) => { const form=event.currentTarget.form; const fields=[...form.querySelectorAll('input[type=datetime-local]')]; if(fields.some(field=>!field.reportValidity())) return; onGroup({ ...shift, engineerId, templateId, note:new FormData(form).get('note')||'', start:fromField(start,timezone), end:fromField(end,timezone) }) }}>{create ? 'Create repeated duty group' : 'Convert to repeated duty group'}</Button>}
      <ShiftTypeField templates={templates} templateId={templateId} currentName={shift.templateName} onChange={template => {
        setTemplateId(template?.id || null)
        if (template) { const values = applyShiftTemplate(template, start || shift.start, timezone); setStart(values.start); setEnd(values.end) }
      }} />
      <Field label="Engineer"><select name="engineerId" value={engineerId} onChange={(event) => setEngineerId(event.target.value)} required>
        <option value="" disabled>Select an engineer</option>
        {assignable.map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}
      </select></Field>
      <div className="compare-card" aria-live="polite"><strong>Selected duty period</strong>
        <span>From: {start && local(start, timezone).isValid ? local(start, timezone).toFormat('ccc, dd LLL yyyy, h:mm a') : 'Choose a start'}</span>
        <span>To: {end && local(end, timezone).isValid ? local(end, timezone).toFormat('ccc, dd LLL yyyy, h:mm a') : 'Choose an end'}</span>
        {dialog.selectedDates && start === dateField(shift.start, timezone) && end === dateField(shift.end, timezone) && <small>Selected dates: {dialog.selectedDates}. The end time is the exclusive boundary after the last selected day.</small>}
      </div>
      <div className="form-grid">
        <Field label="Start"><input type="datetime-local" required value={start} onChange={(event) => setStart(event.target.value)} /></Field>
        <Field label="End"><input type="datetime-local" required value={end} onChange={(event) => setEnd(event.target.value)} /></Field>
      </div>
      {end.slice(0, 10) > start.slice(0, 10) && <div className="inline-note"><Moon size={15} /> This shift ends on a later date.</div>}
      <Field label="Shift color"><select value={color} onChange={(event) => setColor(event.target.value)}>
        <option value="">Automatic (engineer color)</option>
        {teamColors.map((item) => <option key={item} value={item}>{item[0].toUpperCase() + item.slice(1)}</option>)}
      </select><span className={'color-preview color-' + (color || people.find((person) => person.id === engineerId)?.color || teamColors[Math.max(0, people.findIndex((person) => person.id === engineerId)) % teamColors.length])}>Duty shift preview</span></Field>
      <Field label="Note"><textarea name="note" rows={3} maxLength={400} defaultValue={shift.note || ''} /></Field>
      {overlap && <div className="confirm-box" role="alert"><strong>Overlapping duty</strong><p>{overlap} Review the dates above, then confirm to save both assignments.</p></div>}
      <Status error={overlap ? '' : action.error} />
      {confirmCancel && <div className="confirm-box"><p>Cancel this assignment? The assigned engineer will be notified.</p>
        <Button variant="danger" disabled={action.busy} onClick={() => action.run(() => api('/shifts/' + shift.id + '?version=' + shift.version, { method: 'DELETE' }))}>Confirm cancellation</Button>
      </div>}
      <div className="dialog-footer">
        {edit && !confirmCancel && <Button className="mr-auto" variant="ghost" onClick={() => setConfirmCancel(true)}>Cancel shift</Button>}
        <Button variant="secondary" onClick={onClose}>Close</Button>
        {overlap && <Button type="submit" data-overlap="true" disabled={action.busy}>Confirm overlap and save</Button>}
        <Button type="submit" disabled={action.busy || !assignable.length || confirmCancel || Boolean(overlap)}>Save shift</Button>
      </div>
    </form>}
  </Modal>
}
