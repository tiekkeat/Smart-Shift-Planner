import { useState } from 'react'
import { DateTime } from 'luxon'
import { api, dateLabel, rangeQuery } from './lib.js'
import { ShiftDialog } from './shift-dialog.jsx'
import { Button, Empty, Field, Loading, Modal, Status, useResource } from './ui.jsx'

export function NewChangeRequest({ session, people, onClose, onSaved }) {
  const { user, timezone } = session
  const [fromDate, setFromDate] = useState(() => DateTime.now().setZone(timezone).toISODate())
  const [selectedId, setSelectedId] = useState('')
  const [requestShift, setRequestShift] = useState(null)
  const start = DateTime.fromISO(fromDate, { zone: timezone }).startOf('day')
  const search = start.isValid ? rangeQuery(start.toUTC().toISO(), start.plus({ days: 60 }).toUTC().toISO()) : ''
  const resource = useResource(async signal => {
    if (!search) return { shifts: [], templates: [] }
    const [shifts, requests, templates] = await Promise.all([
      api('/shifts' + search, { signal }),
      api('/changes', { signal }),
      api('/shift-templates', { signal }).catch(() => []),
    ])
    const pending = new Set(requests.filter(item => item.status === 'pending').flatMap(item => [item.original.id, item.swap?.id].filter(Boolean)))
    return {
      shifts: shifts.filter(shift => shift.engineerId === user.id && !shift.cancelled && Date.parse(shift.end) > Date.now() && !pending.has(shift.id))
        .toSorted((a, b) => Date.parse(a.start) - Date.parse(b.start) || a.id.localeCompare(b.id)),
      templates,
    }
  }, user.id + search)
  const choices = resource.data?.shifts || []
  const selected = choices.find(shift => shift.id === selectedId) || choices[0]

  if (requestShift) return <ShiftDialog session={session} people={people} templates={resource.data?.templates || []} dialog={{ mode: 'request', shift: requestShift }} onClose={onClose} onSaved={onSaved} onChooseShift={() => { setRequestShift(null); resource.refresh() }} />

  return <Modal title="Choose your assigned duty" description={'Current and upcoming duties assigned to ' + user.name + '. Times are in ' + timezone + '.'} onClose={onClose}>
    <form className="form-stack" onSubmit={event => { event.preventDefault(); if (selected && !resource.loading && !resource.error) setRequestShift(selected) }}>
      <Field label="Find duties from"><input type="date" name="fromDate" required value={fromDate} onChange={event => { setFromDate(event.target.value); setSelectedId('') }} /></Field>
      <p className="settings-help">Searches 60 days from this date. Your nearest eligible duty is selected automatically. Ended, cancelled, and duties with your pending requests are excluded.</p>
      {resource.loading ? <Loading /> : resource.error ? <><Status error={resource.error} /><Button variant="secondary" onClick={resource.refresh}>Retry</Button></> : choices.length ? <>
        <div className="field"><label htmlFor="request-assigned-shift">Assigned shift</label><select id="request-assigned-shift" name="shiftId" required value={selected.id} onChange={event => setSelectedId(event.target.value)}>
          {choices.map(shift => <option key={shift.id} value={shift.id}>{dateLabel(shift.start, timezone)} → {dateLabel(shift.end, timezone)}{shift.groupId ? shift.isException ? ' · Changed night' : ' · Repeated duty' : ''}</option>)}
        </select></div>
        <div className="compare-card"><strong>{selected.engineerName}</strong><span>From: {dateLabel(selected.start, timezone)}</span><span>To: {dateLabel(selected.end, timezone)}</span>{selected.groupId && <small>This request affects this night only.</small>}</div>
      </> : <Empty title="No eligible assigned duties" description="Try a later date to find your duties. If a request is already pending, review it on this page." />}
      <div className="dialog-footer"><Button variant="secondary" onClick={onClose}>Close</Button><Button type="submit" disabled={resource.loading || Boolean(resource.error) || !selected}>Continue to request</Button></div>
    </form>
  </Modal>
}
