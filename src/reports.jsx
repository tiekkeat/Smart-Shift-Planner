import { useState } from 'react'
import { DateTime } from 'luxon'
import { BarChart3, ChevronLeft, ChevronRight, ClipboardList, Clock3 } from 'lucide-react'
import { api, dateLabel, rangeQuery, teamColors } from './lib.js'
import { Avatar, Button, Empty, Field, Loading, Modal, Status, useAction, useResource } from './ui.jsx'

const hourNumber = new Intl.NumberFormat('en-MY', { maximumFractionDigits: 2 })
const hours = ms => hourNumber.format(ms / 3600000)
const typeKey = type => type.templateId || 'unclassified'
const statuses = { matched: 'Exact match', ambiguous: 'Choose manually', unmatched: 'No exact match', pending: 'Pending request' }

function ClassificationDialog({ search, timezone, onClose, onSaved }) {
  const resource = useResource(signal => api('/report/classification-preview' + search, { signal }), search)
  const [selected, setSelected] = useState([])
  const action = useAction(onSaved)
  const units = resource.data?.units || []
  const matched = units.filter(unit => unit.status === 'matched')
  const chosen = units.filter(unit => selected.includes(unit.key))
  const count = chosen.reduce((sum, unit) => sum + unit.duties.length, 0)
  function refresh() { setSelected([]); resource.refresh() }
  return <Modal title="Classify existing duties" description="Review time matches before adding shift types." onClose={() => { if (!action.busy) onClose() }}>
    <form className="form-stack" onSubmit={event => {
      event.preventDefault()
      action.run(() => api('/report/classification', { method: 'POST', body: { from: resource.data.from, to: resource.data.to, fingerprint: resource.data.fingerprint, keys: selected } }))
    }}>
      <p className="settings-help">Only types change. Times and engineers stay the same. Groups include all normal nights, even outside this period.</p>
      {resource.loading ? <Loading /> : resource.error ? <><Status error={resource.error} /><Button variant="secondary" onClick={refresh}>Retry</Button></> : <>
        <div className="request-selection-tools"><strong>{matched.length} exact {matched.length === 1 ? 'match' : 'matches'}</strong><Button variant="ghost" size="small" disabled={action.busy} onClick={() => setSelected(matched.slice(0, 1000).map(unit => unit.key))}>Select exact matches</Button><Button variant="ghost" size="small" disabled={action.busy} onClick={() => setSelected([])}>Clear</Button></div>
        {!units.length && <Empty title="No unclassified duties" description="Try another reporting period." />}
        <div className="classification-list">{units.map(unit => <section className="classification-unit" key={unit.key}>
          <label className="classification-choice"><input type="checkbox" disabled={action.busy || unit.status !== 'matched' || (!selected.includes(unit.key) && selected.length >= 1000)} checked={selected.includes(unit.key)} onChange={event => setSelected(previous => event.target.checked ? [...previous, unit.key] : previous.filter(key => key !== unit.key))} /><span><strong>{unit.grouped ? 'Repeated group · ' + unit.duties.length + ' duties' : unit.duties[0].engineerName}</strong><small>{unit.status === 'matched' ? unit.matches[0].name : statuses[unit.status]}</small></span></label>
          {unit.grouped ? <details><summary>View all affected dates</summary>{unit.duties.map(duty => <p key={duty.id}>{duty.engineerName} · {dateLabel(duty.start, timezone)} → {dateLabel(duty.end, timezone)}{duty.cancelled ? ' · Cancelled' : ''}</p>)}</details> : <p>{dateLabel(unit.duties[0].start, timezone)} → {dateLabel(unit.duties[0].end, timezone)}</p>}
          {unit.reason && <p className="settings-help">{unit.reason}{unit.status === 'ambiguous' ? ' (' + unit.matches.map(item => item.name).join(', ') + ')' : ''}</p>}
        </section>)}</div>
      </>}
      <Status error={action.error} />
      {action.error && <Button variant="secondary" disabled={action.busy} onClick={refresh}>Refresh preview</Button>}
      <div className="dialog-footer"><Button variant="secondary" disabled={action.busy} onClick={onClose}>Cancel</Button><Button type="submit" disabled={action.busy || resource.loading || Boolean(resource.error) || !chosen.length}>{action.busy ? 'Classifying…' : 'Classify ' + count + (count === 1 ? ' duty' : ' duties')}</Button></div>
    </form>
  </Modal>
}

export function ReportsPage({ session }) {
  const [mode, setMode] = useState('month')
  const [cursor, setCursor] = useState(() => DateTime.now().setZone(session.timezone))
  const [filter, setFilter] = useState('all')
  const [filterName, setFilterName] = useState('')
  const [classifying, setClassifying] = useState(false)
  const [success, setSuccess] = useState('')
  const start = cursor.startOf(mode)
  const end = start.plus(mode === 'month' ? { months: 1 } : { weeks: 1 })
  const search = rangeQuery(start.toUTC().toISO(), end.toUTC().toISO())
  const resource = useResource(signal => api('/report' + search, { signal }), search)
  const templates = useResource(signal => api('/shift-templates', { signal }))
  const available = new Map((templates.data || []).map(template => [template.id, { templateId: template.id, name: template.name }]))
  for (const row of resource.data || []) for (const type of row.types) available.set(typeKey(type), type)
  available.set('unclassified', { templateId: null, name: 'Unclassified' })
  if (filter !== 'all' && !available.has(filter)) available.set(filter, { templateId: filter === 'unclassified' ? null : filter, name: filterName })
  const types = [...available.values()].sort((a, b) => a.name.localeCompare(b.name))
  const rows = (resource.data || []).map(row => {
    if (filter === 'all') return row
    const type = row.types.find(type => typeKey(type) === filter)
    return { ...row, shiftCount: type?.shiftCount || 0, durationMs: type?.durationMs || 0 }
  }).filter(row => row.durationMs > 0)
  const total = rows.reduce((sum, row) => sum + row.durationMs, 0)
  const max = Math.max(1, ...rows.map(row => row.durationMs))
  const label = mode === 'month' ? start.toFormat('LLLL yyyy') : start.toFormat('dd LLL') + ' – ' + end.minus({ days: 1 }).toFormat('dd LLL yyyy')
  return <>
    <div className="page-heading"><div><h1>Duty hours</h1><p>Duty counts and scheduled hours by engineer and shift type.</p></div>{session.user.role === 'admin' && <Button variant="secondary" onClick={() => { setSuccess(''); setClassifying(true) }}>Classify existing duties</Button>}</div>
    <Status success={success} />
    <div className="report-stats">
      <div className="panel report-stat"><Clock3 size={20} /><span>Scheduled duty hours</span><strong>{resource.data ? hours(total) + ' h' : '—'}</strong></div>
      <div className="panel report-stat"><ClipboardList size={20} /><span>Duties starting in period</span><strong>{resource.data ? rows.reduce((sum, row) => sum + row.shiftCount, 0) : '—'}</strong></div>
    </div>
    <section className="panel">
      <div className="panel-toolbar report-toolbar">
        <div className="calendar-date"><Button variant="secondary" size="icon" aria-label="Previous reporting period" onClick={() => { setCursor(cursor.minus(mode === 'month' ? { months: 1 } : { weeks: 1 })); setSuccess('') }}><ChevronLeft size={17} /></Button><Button variant="secondary" size="icon" aria-label="Next reporting period" onClick={() => { setCursor(cursor.plus(mode === 'month' ? { months: 1 } : { weeks: 1 })); setSuccess('') }}><ChevronRight size={17} /></Button><h2>{label}</h2></div>
        <div className="segmented" role="group" aria-label="Reporting period">{['week', 'month'].map(item => <button key={item} type="button" className="capitalize" aria-pressed={mode === item} onClick={() => setMode(item)}>{item}</button>)}</div>
        <Field label="Shift type"><select aria-label="Report shift type" value={filter} onChange={event => { setFilter(event.target.value); setFilterName(event.target.selectedOptions[0].text) }}><option value="all">All types</option>{types.map(type => <option key={typeKey(type)} value={typeKey(type)}>{type.name}{type.archived ? ' (archived)' : ''}</option>)}</select></Field>
      </div>
      <p className="report-help">Each duty counts on its start date. Hours are split at period boundaries. Times in {session.timezone}.</p>
      {resource.loading ? <Loading /> : <Status error={resource.error} />}
      <Status error={templates.error} />
      {resource.error && <Button variant="secondary" onClick={resource.refresh}>Retry report</Button>}
      {resource.data && (rows.length ? <div className="table-wrap"><table className={'type-report-table ' + (filter !== 'all' ? 'is-filtered' : '')}><thead><tr><th scope="col">Engineer</th><th scope="col">Duties</th><th scope="col">Scheduled hours</th>{filter === 'all' && types.map(type => <th scope="col" key={typeKey(type)}>{type.name}{type.archived && <small>Archived</small>}</th>)}</tr></thead><tbody>{rows.map((row, index) => <tr key={row.engineerId}>
        <td><div className="person-cell"><Avatar name={row.name} color={teamColors[index % teamColors.length]} /><strong>{row.name}</strong></div></td><td>{row.shiftCount}</td><td><div className="hours-cell"><div className="bar" aria-hidden="true"><span style={{ width: 100 * row.durationMs / max + '%' }} /></div><strong>{hours(row.durationMs)} h</strong></div></td>
        {filter === 'all' && types.map(type => { const value = row.types.find(item => typeKey(item) === typeKey(type)); return <td key={typeKey(type)}><div className="type-report-value"><strong>{value?.shiftCount || 0} {(value?.shiftCount || 0) === 1 ? 'duty' : 'duties'}</strong><small>{hours(value?.durationMs || 0)} h</small></div></td> })}
      </tr>)}</tbody></table></div> : <Empty title="No duty for this period and type" icon={BarChart3} />)}
    </section>
    {classifying && <ClassificationDialog search={search} timezone={session.timezone} onClose={() => setClassifying(false)} onSaved={result => { setClassifying(false); resource.refresh(); setSuccess(result.classified + ' duties classified.') }} />}
  </>
}
