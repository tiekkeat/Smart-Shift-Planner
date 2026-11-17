import { useEffect, useState } from 'react'
import { Moon } from 'lucide-react'
import { api, applyShiftTemplate, dateField, dateLabel, fromField, local, rangeQuery, teamColors } from './lib.js'
import { Avatar, Button, Field, Modal, Status, useAction } from './ui.jsx'

export function ShiftDialog({ session, people, dialog, onClose, onSaved, templates = [], onGroup, onViewGroup, onChooseShift }) {
  const { user, timezone } = session
  const { shift, mode } = dialog
  const create = mode === 'new'
  const edit = mode === 'edit'
  const read = mode === 'read' || mode === 'request'
  const [overlap, setOverlap] = useState('')
  const [propose, setPropose] = useState(mode === 'request')
  const [swapping, setSwapping] = useState(false)
  const [swapShift, setSwapShift] = useState(null)
  const [swapChoices, setSwapChoices] = useState([])
  const [swapError, setSwapError] = useState('')
  const [swapLoading, setSwapLoading] = useState(false)
  const proposing = propose
  const [confirmCancel, setConfirmCancel] = useState(false)
  const [color, setColor] = useState(shift.color || '')
  const [start, setStart] = useState(dateField(shift.start, timezone))
  const [engineerId, setEngineerId] = useState(shift.engineerId || '')
  const [end, setEnd] = useState(dateField(shift.end, timezone))
  const action = useAction(onSaved)
  const canPropose = user.role === 'engineer' && read && shift.engineerId === user.id && Date.parse(shift.end) > Date.now()
  const showRead = read && !proposing
  const title = proposing ? 'Request a duty change' : create ? 'New duty shift' : edit ? 'Edit duty shift' : 'Duty details'
  const description = proposing ? 'An admin reviews your proposed change before it takes effect.' : 'Times are shown in ' + timezone + '.'
  const assignable = people.filter((person) => person.role === 'engineer' && (person.active || person.id === shift.engineerId))

  useEffect(() => {
    if (!proposing || !swapping) return
    const from = local(start, timezone), to = local(end, timezone)
    if (!from.isValid || !to.isValid || to <= from) { setSwapChoices([]); return }
    const controller = new AbortController()
    setSwapLoading(true); setSwapError('')
    api('/shifts' + rangeQuery(from.toUTC().toISO(), to.toUTC().toISO()), { signal: controller.signal })
      .then(items => { if (!controller.signal.aborted) setSwapChoices(items.filter(item => item.id !== shift.id && item.engineerId !== user.id && !item.cancelled && Date.parse(item.end) > Date.now() && people.some(person => person.id === item.engineerId && person.active && person.role === 'engineer'))) })
      .catch(error => { if (!controller.signal.aborted) { setSwapError(error.message); setSwapChoices([]) } })
      .finally(() => { if (!controller.signal.aborted) setSwapLoading(false) })
    return () => controller.abort()
  }, [proposing, swapping, start, end, timezone, shift.id, user.id, people])

  function submit(event) {
    event.preventDefault()
    const values = new FormData(event.currentTarget)
    const allowOverlap = event.nativeEvent.submitter?.dataset.overlap === 'true'
    action.run(async () => {
      try {
      const fields = { allowOverlap, engineerId: swapping ? user.id : values.get('engineerId'), start: fromField(start, timezone), end: fromField(end, timezone) }
      if (proposing && swapping && !swapShift) throw new Error('Choose an existing shift to swap.')
      if (proposing) return await api('/changes', { method: 'POST', body: { ...fields, shiftId: shift.id, version: shift.version, reason: values.get('reason'), ...(swapping && { swapShiftId: swapShift.id, swapVersion: swapShift.version }) } })
      return await api(create ? '/shifts' : '/shifts/' + shift.id, {
        method: create ? 'POST' : 'PUT',
        body: { ...fields, color: color || null, note: values.get('note'), ...(!create && { version: shift.version }) },
      })
      } catch (error) {
        if (error.status === 409 && error.message.startsWith('This time overlaps existing duty')) setOverlap(error.message)
        throw error
      }
    })
  }

  return <Modal title={title} description={description} onClose={onClose}>
    {shift.groupId && <div className="group-night-context"><span>This is one occurrence in a repeated duty group. Changes here affect this night only.</span>{onViewGroup && <Button variant="secondary" size="small" onClick={() => onViewGroup(shift.groupId)}>View duty group</Button>}</div>}
    {proposing && <div className="compare-card"><small>Original assignment</small>{onChooseShift && <Button variant="secondary" size="small" onClick={onChooseShift}>Choose another duty</Button>}<strong>{shift.engineerName}</strong><span>{dateLabel(shift.start, timezone)} → {dateLabel(shift.end, timezone)}</span></div>}
    {showRead ? <>
      <div className="detail-person"><Avatar name={shift.engineerName} /><strong>{shift.engineerName}</strong></div>
      <dl className="shift-details"><dt>Starts</dt><dd>{dateLabel(shift.start, timezone)}</dd><dt>Ends</dt><dd>{dateLabel(shift.end, timezone)}</dd>
        {shift.note && <><dt>Note</dt><dd>{shift.note}</dd></>}</dl>
      <div className="dialog-footer"><Button variant="secondary" onClick={onClose}>Close</Button>
        {canPropose && <Button onClick={() => setPropose(true)}>Request change</Button>}</div>
    </> : <form onSubmit={submit} onChange={() => setOverlap('')} className="form-stack">
      {(create || edit) && !shift.groupId && <Button variant="secondary" onClick={(event) => { const form=event.currentTarget.form; const fields=[...form.querySelectorAll('input[type=datetime-local]')]; if(fields.some(field=>!field.reportValidity())) return; onGroup({ ...shift, engineerId, note:new FormData(form).get('note')||'', start:fromField(start,timezone), end:fromField(end,timezone) }) }}>{create ? 'Create repeated duty group' : 'Convert to repeated duty group'}</Button>}
      {!swapping && templates.length > 0 && <Field label="Shift time template" hint="Applies times to the start date above. Review the resulting end date before saving."><select defaultValue="" onChange={(event) => {
        const template = templates.find((item) => item.id === event.target.value)
        if (!template) return
        const values = applyShiftTemplate(template, start || shift.start, timezone)
        setStart(values.start); setEnd(values.end)
      }}><option value="">Choose a template (optional)</option>{templates.map((item) => <option key={item.id} value={item.id}>{item.name} · {item.startTime}–{item.endTime}{item.endDayOffset ? ' (+' + item.endDayOffset + ' day)' : ''}</option>)}</select></Field>}
      <Field label="Engineer"><select disabled={swapping} name="engineerId" value={engineerId} onChange={(event) => setEngineerId(event.target.value)} required>
        <option value="" disabled>Select an engineer</option>
        {assignable.map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}
      </select></Field>
      {proposing && <>
        <div className="checkbox-row"><input id="swap-duty" name="swapDuty" type="checkbox" checked={swapping} onChange={event => { setSwapping(event.target.checked); setSwapShift(null); if (event.target.checked) setEngineerId(user.id) }} /><label htmlFor="swap-duty">Swap with another engineer's existing shift (optional)</label></div>
        {swapping && <>
          <p className="inline-note">Set the desired dates below, then select the duty to exchange. Both assignments require admin approval.</p>
          <Field label="Shift to swap" hint="Only active duties overlapping the selected period are listed."><select name="swapShiftId" required value={swapShift?.id || ''} onChange={event => {
            const target = swapChoices.find(item => item.id === event.target.value)
            setSwapShift(target || null)
            if (target) { setStart(dateField(target.start, timezone)); setEnd(dateField(target.end, timezone)) }
          }}><option value="">{swapLoading ? 'Loading shifts…' : 'Choose an existing shift'}</option>{swapChoices.map(item => <option key={item.id} value={item.id}>{item.engineerName} · {dateLabel(item.start, timezone)} → {dateLabel(item.end, timezone)}</option>)}</select></Field>
          {!swapLoading && !swapChoices.length && !swapError && <p className="inline-note">No other engineer's shifts found. Try a different date range.</p>}
          <Status error={swapError} />
          {swapShift && <div className="compare-card"><strong>After approval</strong><span>{shift.engineerName}: {dateLabel(swapShift.start, timezone)} → {dateLabel(swapShift.end, timezone)}</span><span>{swapShift.engineerName}: {dateLabel(shift.start, timezone)} → {dateLabel(shift.end, timezone)}</span></div>}
        </>}
      </>}
      <div className="compare-card" aria-live="polite"><strong>Selected duty period</strong>
        <span>From: {start && local(start, timezone).isValid ? local(start, timezone).toFormat('ccc, dd LLL yyyy, h:mm a') : 'Choose a start'}</span>
        <span>To: {end && local(end, timezone).isValid ? local(end, timezone).toFormat('ccc, dd LLL yyyy, h:mm a') : 'Choose an end'}</span>
        {dialog.selectedDates && start === dateField(shift.start, timezone) && end === dateField(shift.end, timezone) && <small>Selected dates: {dialog.selectedDates}. The end time is the exclusive boundary after the last selected day.</small>}
      </div>
      <div className="form-grid">
        <Field label="Start"><input type="datetime-local" required value={start} onChange={(event) => { setStart(event.target.value); setSwapShift(null) }} /></Field>
        <Field label="End"><input type="datetime-local" required value={end} onChange={(event) => { setEnd(event.target.value); setSwapShift(null) }} /></Field>
      </div>
      {end.slice(0, 10) > start.slice(0, 10) && <div className="inline-note"><Moon size={15} /> This shift ends on a later date.</div>}
      {!proposing && <Field label="Shift color"><select value={color} onChange={(event) => setColor(event.target.value)}>
        <option value="">Automatic (engineer color)</option>
        {teamColors.map((item) => <option key={item} value={item}>{item[0].toUpperCase() + item.slice(1)}</option>)}
      </select><span className={'color-preview color-' + (color || people.find((person) => person.id === engineerId)?.color || teamColors[Math.max(0, people.findIndex((person) => person.id === engineerId)) % teamColors.length])}>Duty shift preview</span></Field>}
      {proposing ? <Field label="Reason"><textarea name="reason" required rows={3} maxLength={500} /></Field>
        : <Field label="Note"><textarea name="note" rows={3} maxLength={400} defaultValue={shift.note || ''} /></Field>}
      {overlap && <div className="confirm-box" role="alert"><strong>Overlapping duty</strong><p>{overlap} Review the dates above, then confirm to save both assignments.</p></div>}
      <Status error={overlap ? '' : action.error} />
      {confirmCancel && <div className="confirm-box"><p>Cancel this assignment? The assigned engineer will be notified.</p>
        <Button variant="danger" disabled={action.busy} onClick={() => action.run(() => api('/shifts/' + shift.id + '?version=' + shift.version, { method: 'DELETE' }))}>Confirm cancellation</Button>
      </div>}
      <div className="dialog-footer">
        {edit && !confirmCancel && <Button className="mr-auto" variant="ghost" onClick={() => setConfirmCancel(true)}>Cancel shift</Button>}
        <Button variant="secondary" onClick={onClose}>Close</Button>
        {overlap && <Button type="submit" data-overlap="true" disabled={action.busy}>Confirm overlap and save</Button>}
        <Button type="submit" disabled={action.busy || !assignable.length || confirmCancel || Boolean(overlap)}>{proposing ? 'Submit request' : 'Save shift'}</Button>
      </div>
    </form>}
  </Modal>
}
