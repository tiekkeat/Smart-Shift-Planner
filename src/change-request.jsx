import { ShiftTypeField } from './shift-type.jsx'
import { useEffect, useRef, useState } from 'react'
import { DateTime } from 'luxon'
import { ArrowLeft, ArrowRight, Check, Repeat2, UserRound, CalendarDays } from 'lucide-react'
import { api, applyShiftTemplate, dateLabel, rangeQuery } from './lib.js'
import { buildProposal, changeKinds, MAX_REQUEST_DUTIES, requestDraft } from './change-request-model.js'
import { Button, Empty, Field, Loading, Modal, Status, useResource } from './ui.jsx'

function DutyPeriod({ start, end, timezone }) {
  const first = DateTime.fromISO(start, { zone: timezone })
  const last = DateTime.fromISO(end, { zone: timezone })
  return <div className="request-period"><strong>{first.toFormat('ccc, d LLL yyyy')}</strong><span>{first.toFormat('h:mm a')} → {first.hasSame(last, 'day') ? last.toFormat('h:mm a') : last.toFormat('ccc, d LLL · h:mm a')}</span></div>
}

function SwapPicker({ shift, draft, onChange, people, timezone, userId, unavailable }) {
  const from = DateTime.fromISO(draft.searchDate, { zone: timezone }).startOf('day')
  const search = from.isValid ? rangeQuery(from.toUTC().toISO(), from.plus({ days: 60 }).toUTC().toISO()) : ''
  const resource = useResource(signal => search ? api('/shifts' + search, { signal }) : Promise.resolve([]), search)
  const choices = (resource.data || []).filter(item => item.engineerId !== userId && !item.cancelled && Date.parse(item.end) > Date.now() && !unavailable.has(item.id) && people.some(person => person.id === item.engineerId && person.role === 'engineer' && person.active))
    .toSorted((a, b) => Date.parse(a.start) - Date.parse(b.start))
  return <>
    <Field label="Find swap duties from"><input type="date" required value={draft.searchDate} onChange={event => onChange({ searchDate: event.target.value, swap: null })} /></Field>
    {resource.loading ? <Loading /> : resource.error ? <><Status error={resource.error} /><Button variant="secondary" onClick={resource.refresh}>Retry</Button></> : <Field label="Duty to take"><select aria-label="Duty to take" required value={draft.swap?.id || ''} onChange={event => onChange({ swap: choices.find(item => item.id === event.target.value) || null })}><option value="">Choose a duty</option>{choices.map(item => <option key={item.id} value={item.id}>{item.engineerName} · {dateLabel(item.start, timezone)} → {dateLabel(item.end, timezone)}</option>)}</select></Field>}
    {!resource.loading && !resource.error && !choices.length && <Empty title="No swap duties found" description="Try another start date." />}
    {draft.swap && <div className="request-swap-result"><div><small>You take</small><strong>{draft.swap.engineerName}'s duty</strong><DutyPeriod {...draft.swap} timezone={timezone} /></div><Repeat2 size={20} aria-hidden="true" /><div><small>{draft.swap.engineerName} takes</small><strong>Your duty</strong><DutyPeriod {...shift} timezone={timezone} /></div></div>}
  </>
}

export function NewChangeRequest({ session, people, onClose, onSaved, initialShift }) {
  const { user, timezone } = session
  const [fromDate, setFromDate] = useState(() => DateTime.fromISO(initialShift?.start || DateTime.now().toISO(), { zone: timezone }).toISODate())
  const [selectedIds, setSelectedIds] = useState(initialShift ? [initialShift.id] : null)
  const [step, setStep] = useState(0)
  const [kind, setKind] = useState('replace')
  const [drafts, setDrafts] = useState({})
  const [replacementId, setReplacementId] = useState('')
  const [individual, setIndividual] = useState(false)
  const [index, setIndex] = useState(0)
  const [reason, setReason] = useState('')
  const [error, setError] = useState(null)
  const [confirmed, setConfirmed] = useState({})
  const [busy, setBusy] = useState(false)
  const submitting = useRef(false)
  const heading = useRef(null)
  const start = DateTime.fromISO(fromDate, { zone: timezone }).startOf('day')
  const search = start.isValid ? rangeQuery(start.toUTC().toISO(), start.plus({ days: 60 }).toUTC().toISO()) : ''
  const resource = useResource(async signal => {
    if (!search) return { shifts: [], templates: [], pending: [] }
    const [shifts, requests, templates] = await Promise.all([
      api('/shifts' + search, { signal }), api('/changes', { signal }), api('/shift-templates', { signal }).catch(() => []),
    ])
    const pending = requests.filter(item => item.status === 'pending').flatMap(item => [item.original.id, item.swap?.id].filter(Boolean))
    return {
      shifts: shifts.filter(shift => shift.engineerId === user.id && !shift.cancelled && Date.parse(shift.end) > Date.now() && !pending.includes(shift.id))
        .toSorted((a, b) => Date.parse(a.start) - Date.parse(b.start) || a.id.localeCompare(b.id)),
      templates, pending,
    }
  }, user.id + search)
  const choices = resource.data?.shifts || []
  const ids = selectedIds ?? choices.slice(0, 1).map(shift => shift.id)
  const selected = choices.filter(shift => ids.includes(shift.id))
  const active = selected[index]
  const draftFor = shift => drafts[shift.id] || requestDraft(shift, timezone)
  const activeDraft = active && draftFor(active)
  const engineers = people.filter(person => person.role === 'engineer' && person.active && person.id !== user.id)
  const options = { kind, replacementId, individual, timezone, userId: user.id, reason: reason.trim() }
  const proposalFor = shift => buildProposal(shift, draftFor(shift), options)
  const complete = shift => { try { proposalFor(shift); return true } catch { return false } }
  const stepNames = ['Duties', 'Change', 'Details', 'Review']
  useEffect(() => { heading.current?.focus() }, [step, index])
  function clearError() { setError(null); setConfirmed({}) }
  function updateDraft(shift, values) { setDrafts(previous => ({ ...previous, [shift.id]: { ...draftFor(shift), ...values } })); clearError() }
  function go(next) { clearError(); setStep(next) }
  function validate(shift) {
    try { proposalFor(shift); setError(null); return true }
    catch (failure) { setError({ message: failure.message, shiftId: shift.id }); return false }
  }
  async function submit(allowOverlapFor) {
    if (submitting.current) return
    if (!selected.length) { go(0); return }
    const invalid = selected.find(shift => !complete(shift))
    if (invalid) { setIndex(selected.indexOf(invalid)); setStep(2); validate(invalid); return }
    if (!reason.trim()) { setError({ message: 'Add a short reason.' }); return }
    const allowed = { ...confirmed, ...(allowOverlapFor && { [allowOverlapFor]: true }) }
    submitting.current = true; setBusy(true); setError(null)
    try {
      const result = await api('/changes/batch', { method: 'POST', body: { proposals: selected.map(shift => ({ ...proposalFor(shift), allowOverlap: Boolean(allowed[shift.id]) })) } })
      onSaved(result)
    } catch (failure) {
      setConfirmed(allowed)
      setError({ message: failure.message, shiftId: failure.shiftId, overlap: failure.status === 409 && failure.message.startsWith('This time overlaps existing duty') })
    } finally { submitting.current = false; setBusy(false) }
  }
  function next(event) {
    event.preventDefault()
    if (step === 0 && selected.length) go(1)
    else if (step === 1) { setIndex(0); go(2) }
    else if (step === 2 && active && validate(active)) {
      if (index < selected.length - 1 && (kind !== 'replace' || individual)) { setIndex(index + 1); setError(null) }
      else {
        const invalid = selected.find(shift => !complete(shift))
        if (invalid) { setIndex(selected.indexOf(invalid)); validate(invalid) }
        else go(3)
      }
    } else if (step === 3) submit()
  }
  const errorShift = selected.find(shift => shift.id === error?.shiftId)
  return <Modal title="Request a duty change" description={'Times in ' + timezone + ' · Admin approval required.'} onClose={() => { if (!busy) onClose() }}>
    <form className="request-wizard" onSubmit={next}>
      <ol className="request-steps" aria-label="Request progress">{stepNames.map((name, number) => <li key={name} aria-current={number === step ? 'step' : undefined} className={number < step ? 'is-complete' : ''}><span>{number < step ? <Check size={14} /> : number + 1}</span>{name}</li>)}</ol>
      <div className="request-body"><fieldset disabled={busy} className="request-fields">
        <h3 ref={heading} tabIndex={-1} className="request-step-title">{['Which duties?', 'What would you like to change?', selected.length > 1 ? 'Set your changes' : 'Set your change', 'Ready to send?'][step]}</h3>
        {step === 0 && <>
          <Field label="Find duties from"><input type="date" required value={fromDate} onChange={event => { setFromDate(event.target.value); setSelectedIds([]); setDrafts({}); clearError() }} /></Field>
          <p className="settings-help">Your available duties for the next 60 days.</p>
          {resource.loading ? <Loading /> : resource.error ? <><Status error={resource.error} /><Button variant="secondary" onClick={resource.refresh}>Retry</Button></> : choices.length ? <>
            <div className="request-selection-tools"><strong aria-live="polite">{selected.length} selected</strong><Button size="small" variant="ghost" onClick={() => { setSelectedIds(choices.slice(0, MAX_REQUEST_DUTIES).map(shift => shift.id)); clearError() }}>Select all{choices.length > MAX_REQUEST_DUTIES ? ' (first 63)' : ''}</Button><Button size="small" variant="ghost" onClick={() => { setSelectedIds([]); clearError() }}>Clear</Button></div>
            <div className="request-duty-list">{choices.map(shift => <label key={shift.id} className={'request-duty-option ' + (ids.includes(shift.id) ? 'is-selected' : '')}><input type="checkbox" checked={ids.includes(shift.id)} disabled={!ids.includes(shift.id) && selected.length >= MAX_REQUEST_DUTIES} onChange={event => { setSelectedIds(event.target.checked ? [...ids, shift.id] : ids.filter(id => id !== shift.id)); clearError() }} /><DutyPeriod {...shift} timezone={timezone} />{shift.groupId && <span className="badge badge-neutral">{shift.isException ? 'Changed night' : 'Repeated duty'}</span>}</label>)}</div>
            {selected.length >= MAX_REQUEST_DUTIES && <p className="settings-help">Up to 63 duties per submission.</p>}
          </> : <Empty title="No available duties" description="Try another date, or check your pending requests." />}
        </>}
        {step === 1 && <div className="request-kind-list">{changeKinds.map((item, number) => {
          const Icon = [UserRound, CalendarDays, Repeat2][number]
          return <label key={item.id} className={'request-kind-option ' + (kind === item.id ? 'is-selected' : '')}><input type="radio" name="changeKind" checked={kind === item.id} onChange={() => { setKind(item.id); clearError() }} /><Icon size={22} aria-hidden="true" /><span><strong>{item.title}</strong><small>{item.hint}</small></span></label>
        })}</div>}
        {step === 2 && active && <>
          {kind === 'replace' && <>
            <Field label={individual ? 'Default replacement' : 'Replacement engineer'}><select aria-label={individual ? 'Default replacement' : 'Replacement engineer'} required={!individual} value={replacementId} onChange={event => { setReplacementId(event.target.value); clearError() }}><option value="">Choose an engineer</option>{engineers.map(person => <option key={person.id} value={person.id}>{person.name}</option>)}</select></Field>
            {selected.length > 1 && <label className="checkbox-row"><input type="checkbox" checked={individual} onChange={event => { setIndividual(event.target.checked); setIndex(0); clearError() }} /><span>Set individually</span></label>}
          </>}
          {selected.length > 1 && <div className="request-duty-nav"><strong>Duty {index + 1} of {selected.length}</strong><div>{selected.map((shift, number) => <button key={shift.id} type="button" className={number === index ? 'is-active' : ''} aria-label={'Edit duty ' + (number + 1) + (complete(shift) ? ', complete' : '')} aria-current={number === index ? 'true' : undefined} onClick={() => { setIndex(number); setError(null) }}>{number + 1}{complete(shift) && <Check size={11} />}</button>)}</div></div>}
          <div className="request-original"><small>Your duty</small><DutyPeriod {...active} timezone={timezone} /></div>
          {kind === 'replace' && individual && <Field label="Replacement for this duty"><select aria-label="Replacement for this duty" required value={activeDraft.engineerId || replacementId} onChange={event => updateDraft(active, { engineerId: event.target.value })}><option value="">Choose an engineer</option>{engineers.map(person => <option key={person.id} value={person.id}>{person.name}</option>)}</select></Field>}
          {kind === 'replace' && <label className="checkbox-row"><input type="checkbox" checked={activeDraft.editTimes} onChange={event => updateDraft(active, { editTimes: event.target.checked, ...(!event.target.checked && { start: requestDraft(active, timezone).start, end: requestDraft(active, timezone).end }) })} /><span>Also change this duty's times</span></label>}
          {(kind === 'dates' || (kind === 'replace' && activeDraft.editTimes)) && <>
            <ShiftTypeField templates={resource.data?.templates || []} templateId={activeDraft.templateId} currentName={activeDraft.templateName} onChange={template => updateDraft(active, { templateId: template?.id || null, templateName: template?.name, ...(template && applyShiftTemplate(template, activeDraft.start, timezone)) })} />
            <div className="form-grid"><Field label="New start"><input type="datetime-local" required value={activeDraft.start} onChange={event => updateDraft(active, { start: event.target.value })} /></Field><Field label="New end"><input type="datetime-local" required value={activeDraft.end} onChange={event => updateDraft(active, { end: event.target.value })} /></Field></div>
          </>}
          {kind === 'swap' && <SwapPicker key={active.id} shift={active} draft={activeDraft} onChange={values => updateDraft(active, values)} people={people} timezone={timezone} userId={user.id} unavailable={new Set([...(resource.data?.pending || []), ...selected.map(shift => shift.id), ...selected.filter(shift => shift.id !== active.id).map(shift => draftFor(shift).swap?.id).filter(Boolean)])} />}
          {active.groupId && <p className="settings-help">Only this night changes.</p>}
        </>}
        {step === 3 && <>
          <p className="settings-help">{selected.length} {selected.length === 1 ? 'request' : 'requests'} · Reviewed separately by an admin.</p>
          <div className="request-review-list">{selected.map((shift, number) => {
            let proposed
            try { proposed = proposalFor(shift) } catch { return null }
            const draft = draftFor(shift)
            return <section className={'request-review-card ' + (error?.shiftId === shift.id ? 'has-error' : '')} key={shift.id}><div className="request-review-heading"><strong>Duty {number + 1}</strong><Button variant="ghost" size="small" onClick={() => { setIndex(number); go(2) }}>Edit</Button></div><div className="request-before-after"><div><small>Before · You</small><small>{shift.templateName || 'Unclassified'}</small><DutyPeriod {...shift} timezone={timezone} /></div><ArrowRight size={18} aria-hidden="true" /><div><small>After · {kind === 'swap' || kind === 'dates' ? 'You' : people.find(person => person.id === proposed.engineerId)?.name}</small><small>{kind === 'swap' ? draft.swap.templateName || 'Unclassified' : proposed.templateId ? resource.data?.templates.find(item => item.id === proposed.templateId)?.name || (proposed.templateId === shift.templateId ? shift.templateName : draft.templateName) || 'Saved type' : 'Unclassified'}</small><DutyPeriod {...proposed} timezone={timezone} /></div></div>{kind === 'swap' && <div className="request-swap-cover"><strong>{draft.swap.engineerName} covers your original duty</strong><DutyPeriod {...shift} timezone={timezone} /></div>}</section>
          })}</div>
          <Field label="Reason"><textarea aria-label="Reason" required maxLength={500} rows={2} value={reason} placeholder="Why do you need this change?" onChange={event => { setReason(event.target.value); clearError() }} /></Field>
        </>}
        {error && <div className="request-error" role="alert">{errorShift && <strong>Duty {selected.indexOf(errorShift) + 1} · {DateTime.fromISO(errorShift.start, { zone: timezone }).toFormat('d LLL')}</strong>}<p>{error.message}</p>{error.overlap && <Button variant="secondary" disabled={busy} onClick={() => submit(error.shiftId)}>Confirm this overlap and submit</Button>}{errorShift && step === 3 && !error.overlap && <><Button size="small" variant="secondary" onClick={() => { setIndex(selected.indexOf(errorShift)); go(2) }}>Review this duty</Button><Button size="small" variant="secondary" onClick={() => { setIndex(0); if (error.shiftId && drafts[error.shiftId]?.swap) setDrafts(previous => ({ ...previous, [error.shiftId]: { ...previous[error.shiftId], swap: null } })); go(0); resource.refresh() }}>Refresh duties</Button></>}</div>}
      </fieldset></div>
      <div className="dialog-footer request-footer"><Button variant="secondary" disabled={busy} onClick={() => { if (step === 0) onClose(); else if (step === 2 && index > 0) { setIndex(index - 1); setError(null) } else go(step - 1) }}>{step === 0 ? 'Cancel' : <><ArrowLeft size={15} /> Back</>}</Button><Button type="submit" disabled={busy || (step === 0 && (resource.loading || Boolean(resource.error) || !selected.length))}>{busy ? 'Sending…' : step === 3 ? 'Submit ' + selected.length + (selected.length === 1 ? ' request' : ' requests') : step === 2 && index < selected.length - 1 && (kind !== 'replace' || individual) ? 'Next duty' : step === 2 ? 'Review' : 'Continue'}{!busy && step < 3 && <ArrowRight size={15} />}</Button></div>
    </form>
  </Modal>
}
