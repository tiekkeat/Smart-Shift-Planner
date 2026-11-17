import { ShiftDialog } from './shift-dialog.jsx'
import { monthGroupSegments } from './calendar-events.js'
import { GroupDialog, groupRule } from './duty-groups.jsx'
import { useCallback, useEffect, useRef, useState } from 'react'
import FullCalendar from '@fullcalendar/react'
import dayGridPlugin from '@fullcalendar/daygrid'
import timeGridPlugin from '@fullcalendar/timegrid'
import interactionPlugin from '@fullcalendar/interaction'
import luxonPlugin from '@fullcalendar/luxon3'
import { DateTime } from 'luxon'
import { ArrowUpRight, CalendarDays, ChevronLeft, ChevronRight, Clock3, GripVertical, Plus, Radio, X } from 'lucide-react'
import { api, dateLabel, local, rangeQuery, shiftTime, teamColors, timeLabel } from './lib.js'
import { Button, Modal, Status } from './ui.jsx'

const plugins = [dayGridPlugin, timeGridPlugin, interactionPlugin, luxonPlugin]
const views = [['dayGridMonth', 'Month'], ['timeGridWeek', 'Week'], ['timeGridDay', 'Day']]

function shiftDraft(zone, selected) {
  const start = selected ? local(selected, zone) : DateTime.now().setZone(zone).startOf('day').set({ hour: 18 })
  return { start: start.toISO(), end: start.plus({ hours: 7 }).toISO() }
}

export function CalendarPage({ session, people, onChange, notifyUser, teams = [], holidayPlacement = 'top' }) {
  const calendar = useRef(null)
  const latestFetch = useRef(0)
  const dragOrigin = useRef(null)
  const suppressDrop = useRef(null)
  const orderPending = useRef(false)
  const { user, timezone } = session
  const writable = ['admin','manager'].includes(user.role)
  const [view, setView] = useState({ type: 'dayGridMonth', title: '' })
  const [dialog, setDialog] = useState(null)
  const [groupDialog, setGroupDialog] = useState(null)
  const [groupError, setGroupError] = useState('')
  const [templates, setTemplates] = useState([])
  const [templateError, setTemplateError] = useState('')
  const [holidays, setHolidays] = useState([])
  const [holidayError, setHolidayError] = useState('')
  const [holidayDialog, setHolidayDialog] = useState(null)
  const [teamFiltersOpen,setTeamFiltersOpen]=useState(()=>{try{return localStorage.getItem('team-filters:'+user.id)!=='false'}catch{return true}})
  useEffect(()=>{try{localStorage.setItem('team-filters:'+user.id,String(teamFiltersOpen))}catch{}},[teamFiltersOpen,user.id])
  const [teamFilter,setTeamFilter]=useState([])
  useEffect(()=>setTeamFilter(previous=>previous.filter(id=>id==='unassigned'||teams.some(team=>team.id===id))),[teams])
  const matchesTeam=shift=>!teamFilter.length||teamFilter.some(id=>id==='unassigned'?!shift.teamIds?.length:shift.teamIds?.includes(id))
  const [filter, setFilter] = useState('')
  const [shifts, setShifts] = useState([])
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [now, setNow] = useState(Date.now())
  const [coverage, setCoverage] = useState(null)
  const [refresh, setRefresh] = useState(0)
  const colors = useRef({})
  colors.current = Object.fromEntries(people.map((person, index) => [person.id, person.color || teamColors[index % teamColors.length]]))

  useEffect(() => {
    const controller = new AbortController()
    api('/shift-templates', { signal: controller.signal }).then((items) => { setTemplates(items); setTemplateError('') }).catch((error) => { if (error.name !== 'AbortError') setTemplateError('Shift templates are unavailable: ' + error.message) })
    return () => controller.abort()
  }, [])

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 15_000)
    return () => clearInterval(timer)
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    const current = DateTime.fromMillis(now).toUTC()
    api('/shifts' + rangeQuery(current.minus({ days: 1 }).toISO(), current.plus({ days: 30 }).toISO()), { signal: controller.signal })
      .then(setCoverage).catch((error) => { if (error.name !== 'AbortError') setCoverage(null) })
    return () => controller.abort()
  }, [refresh, Math.floor(now / 60_000)])

  const holidaysOutside = holidayPlacement === 'outside' || (view.type !== 'dayGridMonth' && holidayPlacement === 'bottom')

  const getEvents = useCallback(async (info) => {
    const requestId = ++latestFetch.current
    setError('')
    try {
      const search = rangeQuery(info.startStr, info.endStr)
      const [data, holidayData, groupData] = await Promise.all([
        api('/shifts' + search),
        api('/holidays' + search).catch((error) => ({events:[],errors:['Holiday calendars are unavailable: ' + error.message]})),
        api('/duty-groups' + search).then(groups => ({groups,error:''})).catch(error => ({groups:[],error:'Duty groups are unavailable: '+error.message})),
      ])
      const holidayEvents = holidayData.events || []
      if (requestId === latestFetch.current) { setGroupError(groupData.error); setShifts(data); setHolidays(holidayEvents); setHolidayError((holidayData.errors || []).join(' ')) }
      const segments = monthGroupSegments(groupData.groups, timezone, occurrence => matchesTeam(occurrence) && (!filter || occurrence.engineerId === filter))
      const summarizedIds = new Set(segments.flatMap(segment => segment.occurrences.map(item => item.id)))
      const rosterEvents = data.filter((shift) => matchesTeam(shift) && (!filter || shift.engineerId === filter) && (view.type !== 'dayGridMonth' || !summarizedIds.has(shift.id))).map((shift) => ({
        id: shift.id, title: shift.engineerName,
        allDay: view.type === 'dayGridMonth',
        start: view.type === 'dayGridMonth' ? local(shift.start, timezone).toISODate() : shift.start,
        end: view.type === 'dayGridMonth'
          ? local(shift.end, timezone).startOf('day').plus({ days: local(shift.end, timezone).toMillis() === local(shift.end, timezone).startOf('day').toMillis() ? 0 : 1 }).toISODate()
          : shift.end,
        classNames: ['shift-event', 'color-' + (shift.color || colors.current[shift.engineerId] || 'blue')],
        extendedProps: { shift, orderGroup: 0, calendarRank: shift.displayOrder ?? Date.parse(shift.start) },
      }))
      const groupedEvents = (view.type === 'dayGridMonth' ? segments : []).map(segment => ({
        id: 'group:' + segment.group.id + ':' + segment.occurrences[0].id,
        title: [...new Set(segment.occurrences.map(item => item.engineerName))].join(', '),
        start: local(segment.start, timezone).toISODate(),
        end: local(segment.end, timezone).startOf('day').plus({days:local(segment.end, timezone).toMillis() === local(segment.end, timezone).startOf('day').toMillis() ? 0 : 1}).toISODate(),
        allDay: true, editable: writable, startEditable: writable, durationEditable: writable,
        classNames: ['group-event','color-' + (segment.group.rule.color || colors.current[segment.group.rule.engineerId] || 'blue')],
        extendedProps: {group: segment.group, segment, orderGroup:0,calendarRank:segment.group.displayOrder},
      }))
      return [...rosterEvents, ...groupedEvents, ...holidayEvents.flatMap((holiday) => [
        { id: 'holiday-bg:' + holiday.id, title: holiday.title, start: holiday.start, end: holiday.end, allDay: true, display: 'background', backgroundColor: holiday.color, editable: false, extendedProps: { holiday } },
        ...(!holidaysOutside ? [{ id: 'holiday:' + holiday.id, title: holiday.title, start: holiday.start, end: holiday.end, allDay: true, editable: false, startEditable: false, durationEditable: false, backgroundColor: holiday.color, classNames: ['holiday-event'], extendedProps: { holiday, orderGroup: holidayPlacement === 'bottom' ? 1 : -1, calendarRank: 0 } }] : []),
      ])]

    } catch (error) {
      if (requestId === latestFetch.current) setError(error.message)
      throw error
    }
  }, [filter, view.type, timezone, people, holidayPlacement, holidaysOutside, teamFilter])

  function toggleTeam(teamId) {
    const next=teamFilter.includes(teamId)?teamFilter.filter(id=>id!==teamId):[...teamFilter,teamId]
    setTeamFilter(next)
    const person=people.find(item=>item.id===filter)
    if(filter&&next.length&&!next.some(id=>id==='unassigned'?!person?.teamIds?.length:person?.teamIds?.includes(id)))setFilter('')
  }

  function reload() {
    calendar.current?.getApi().refetchEvents()
    setRefresh((value) => value + 1)
    onChange()
  }

  function newShift(start, end, selectedDates) {
    const draft = shiftDraft(timezone, start)
    setDialog({ mode: 'new', selectedDates, shift: { ...draft, ...(end && { end }) } })
  }

  function moveShift(info) {
    if (suppressDrop.current === info.event.id) { suppressDrop.current=null; info.revert(); return }
    if (info.event.extendedProps.group) {
      const group=info.event.extendedProps.group
      const delta=info.delta || {}
      const moveDays=delta.days || 0
      const firstDelta=info.delta || info.startDelta || {}
      const lastDelta=info.delta || info.endDelta || {}
      const rule={...group.rule,
        firstDate:local(!info.delta && info.startDelta?.days ? info.event.extendedProps.segment.firstDate : group.rule.firstDate,timezone).plus(firstDelta).toISODate(),
        lastDate:local(!info.delta && info.endDelta?.days ? info.event.extendedProps.segment.lastDate : group.rule.lastDate,timezone).plus(lastDelta).toISODate(),
        weekdays:info.delta?group.rule.weekdays.map(day=>((day-1+moveDays)%7+7)%7+1).sort():group.rule.weekdays,
      }
      setGroupDialog({group,rule,moveDays,revert:info.revert})
      return
    }
    if (suppressDrop.current === info.event.id) {
      suppressDrop.current = null
      info.revert()
      return
    }
    const shift = info.event.extendedProps.shift
    const start = local(shift.start, timezone).plus(info.delta || info.startDelta || {}).toUTC().toISO()
    const end = local(shift.end, timezone).plus(info.delta || info.endDelta || {}).toUTC().toISO()
    setDialog({ mode: 'edit', shift: { ...shift, start, end }, revert: info.revert })
  }

  function pointer(event) {
    const value = event.changedTouches?.[0] || event.touches?.[0] || event
    return { x: value.clientX, y: value.clientY }
  }

  function dateAtPoint(point) {
    const cell = [...document.querySelectorAll('.calendar-body .fc-daygrid-day[data-date]')].find((element) => {
      const box = element.getBoundingClientRect()
      return point.x >= box.left && point.x < box.right && point.y >= box.top && point.y < box.bottom
    })
    return cell?.dataset.date
  }

  function startShiftDrag(info) {
    suppressDrop.current = null
    const point = pointer(info.jsEvent)
    dragOrigin.current = { ...point, date: dateAtPoint(point) }
  }

  async function stopShiftDrag(info) {
    const origin = dragOrigin.current
    dragOrigin.current = null
    if (!writable || orderPending.current || view.type !== 'dayGridMonth' || !origin?.date) return
    const point = pointer(info.jsEvent)
    if (dateAtPoint(point) !== origin.date || Math.abs(point.y - origin.y) < 6) return
    const sourceId = info.event.extendedProps.group ? 'group:' + info.event.extendedProps.group.id : info.event.id
    const candidates = [...document.querySelectorAll('.calendar-body .shift-event[data-shift-id], .calendar-body .group-event[data-shift-id]')].filter((element) => {
      if (element.dataset.shiftId === sourceId || element.classList.contains('fc-event-mirror')) return false
      const box = element.getBoundingClientRect()
      return box.width && point.x >= box.left && point.x < box.right && dateAtPoint({ x: point.x, y: box.top + box.height / 2 }) === origin.date
    }).map((element) => ({ id: element.dataset.shiftId, box: element.getBoundingClientRect() }))
    candidates.sort((a, b) => Math.abs(point.y - (a.box.top + a.box.height / 2)) - Math.abs(point.y - (b.box.top + b.box.height / 2)))
    const target = candidates[0]
    if (!target) return
    suppressDrop.current = info.event.id
    orderPending.current = true
    setError('')
    try {
      const placement=point.y >= target.box.top + target.box.height / 2 ? 'after' : 'before'
      if(sourceId.startsWith('group:')||target.id.startsWith('group:')) {
        await api('/calendar-order',{method:'POST',body:{sourceId:sourceId.replace(/^group:/,''),sourceKind:sourceId.startsWith('group:')?'group':'shift',targetId:target.id.replace(/^group:/,''),targetKind:target.id.startsWith('group:')?'group':'shift',placement}})
      } else await api('/shifts/' + info.event.id + '/reorder', { method: 'POST', body: { targetId: target.id, placement } })
      calendar.current?.getApi().refetchEvents()
      notifyUser('Shift display order saved.')
    } catch (error) {
      setError(error.message)
      calendar.current?.getApi().refetchEvents()
      notifyUser(error.message, true)
    } finally { orderPending.current = false }
  }

  function closeDialog() {
    dialog?.revert?.()
    setDialog(null)
    calendar.current?.getApi().unselect()
  }

  const current = coverage?.filter(matchesTeam).filter((shift) => (!filter || shift.engineerId===filter) && Date.parse(shift.start) <= now && Date.parse(shift.end) > now).sort((a, b) => Date.parse(b.start) - Date.parse(a.start) || a.id.localeCompare(b.id))[0]
  const next = coverage?.filter(matchesTeam).find((shift) => (!filter || shift.engineerId===filter) && Date.parse(shift.start) > now)
  const shown = shifts.filter(matchesTeam).filter((shift) => !filter || shift.engineerId === filter)
  const legend = [...new Map(shown.map((shift) => {
    const color = shift.color || colors.current[shift.engineerId] || 'blue'
    return [shift.engineerId + ':' + color, { id: shift.engineerId + ':' + color, name: shift.engineerName, color }]
  })).values()]
  const zoneName = DateTime.fromMillis(now).setZone(timezone).toFormat("'UTC'ZZ")

  return <>
    <div className="page-heading">
      <div><h1>Duty calendar</h1><p>Schedule engineer coverage and manage handoffs.</p></div>
      {writable && <Button onClick={() => newShift()}><Plus size={17} /> New shift</Button>}
    </div>
    <div className="coverage-grid">
      <section className="coverage-card active-coverage">
        <span className="coverage-heading"><Radio size={16} /> On call now{teamFilter.length||filter?' · Filtered':''}</span>
        <h2>{current?.engineerName || (coverage ? (teamFilter.length||filter?'No matching active shift':'No active shift') : 'Coverage unavailable')}</h2>
        <p>{current ? <><Clock3 size={14} /> Until {dateLabel(current.end, timezone)}</> : coverage && 'No engineer is scheduled right now.'}</p>
        {current && <Button variant="ghost" size="icon" className="coverage-link" aria-label="View active shift" onClick={() => setDialog({ mode: writable ? 'edit' : 'read', shift: current })}><ArrowUpRight size={18} /></Button>}
      </section>
      <section className="coverage-card next-coverage">
        <span className="coverage-heading"><CalendarDays size={16} /> Next handoff{teamFilter.length||filter?' · Filtered':''}</span>
        <h2>{next?.engineerName || (coverage ? (teamFilter.length||filter?'No matching shift in the next 30 days':'No shift in the next 30 days') : 'Coverage unavailable')}</h2>
        <p>{next && <><Clock3 size={14} /> {dateLabel(next.start, timezone)}</>}</p>
        {next && <Button variant="ghost" size="icon" className="coverage-link" aria-label="View next shift" onClick={() => setDialog({ mode: writable ? 'edit' : 'read', shift: next })}><ArrowUpRight size={18} /></Button>}
      </section>
    </div>
    <section className="panel calendar-panel" aria-label="Duty schedule">
      <details className="team-filter-controls" open={teamFiltersOpen} onToggle={event=>setTeamFiltersOpen(event.currentTarget.open)}><summary>Teams: {teamFilter.length?teamFilter.map(id=>teams.find(t=>t.id===id)?.name||'Unassigned').join(', '):'All teams'}{(teamFilter.length>0||filter)&&<Button size="small" variant="ghost" aria-label="Clear team and engineer filters" onClick={event=>{event.preventDefault();event.stopPropagation();setTeamFilter([]);setFilter('')}}>Clear</Button>}</summary><div className="heading-actions"><Button size="small" variant={teamFilter.length?'secondary':'primary'} onClick={()=>setTeamFilter([])}>All teams</Button>{[...teams,{id:'unassigned',name:'Unassigned',color:'blue'}].map(team=><button type="button" key={team.id} className={'engineer-color color-'+team.color} aria-pressed={teamFilter.includes(team.id)} onClick={()=>toggleTeam(team.id)}>{team.name}</button>)}<Button size="small" variant="ghost" onClick={()=>{setTeamFilter([]);setFilter('')}}>Clear filters</Button></div></details>
      <div className="calendar-toolbar">
        <div className="calendar-date">
          <div className="calendar-arrows">
            <Button variant="secondary" size="icon" aria-label="Previous period" onClick={() => calendar.current?.getApi().prev()}><ChevronLeft size={17} /></Button>
            <Button variant="secondary" size="icon" aria-label="Next period" onClick={() => calendar.current?.getApi().next()}><ChevronRight size={17} /></Button>
          </div>
          <h2>{view.title}</h2>
          <Button variant="secondary" size="small" onClick={() => calendar.current?.getApi().today()}>Today</Button>
        </div>
        <div className="calendar-controls">
          {user.role === 'engineer' && <Button size="small" variant={filter === user.id ? 'primary' : 'secondary'} aria-pressed={filter === user.id} onClick={() => {
            if (filter === user.id) setFilter('')
            else { setTeamFilter([]); setFilter(user.id) }
          }}>My shifts</Button>}
          <label className="sr-only" htmlFor="engineer-filter">Filter by engineer</label>
          <select id="engineer-filter" value={filter} onChange={(event) => setFilter(event.target.value)}>
            <option value="">All engineers</option>
            {people.filter((person) => person.role === 'engineer' && matchesTeam(person)).map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}
          </select>
          <div className="segmented" role="group" aria-label="Calendar view">
            {views.map(([id, label]) => <button type="button" key={id} aria-pressed={view.type === id} onClick={() => calendar.current?.getApi().changeView(id)}>{label}</button>)}
          </div>
        </div>
      </div>
      <div className="calendar-meta">
        <span><Clock3 size={14} /> {timezone} · {zoneName}</span>
        <span aria-live="polite">{loading ? 'Loading shifts…' : shown.length + (shown.length === 1 ? ' shift in view' : ' shifts in view')}</span>
      </div>
      {writable && view.type === 'dayGridMonth' && <p className="calendar-order-hint">Drag shifts up or down within a date to reorder. Drag across dates to reschedule.</p>}
      <Status error={error || holidayError || templateError || groupError} />
      <div className="calendar-body">
        <FullCalendar ref={calendar} plugins={plugins} timeZone={timezone} initialView="dayGridMonth"
          headerToolbar={false} firstDay={1} height="auto" fixedWeekCount={false} allDaySlot={holidayPlacement === 'top'} allDayText="Holidays"
          dayMaxEvents={false} eventOrder="orderGroup,calendarRank,start,title" eventOrderStrict eventInteractive nowIndicator stickyHeaderDates={false} eventDisplay="block" nextDayThreshold="00:00:00"
          slotMinTime="00:00:00" slotMaxTime="24:00:00" slotDuration="01:00:00"
          scrollTime="17:00:00" eventOverlap={true} eventResizableFromStart eventDurationEditable={writable} eventStartEditable={writable} longPressDelay={350} dragScroll selectMirror editable={writable} selectable={writable}
          selectMinDistance={4} selectLongPressDelay={350} unselectAuto={false}
          dateClick={(selection) => {
            if (!writable) return
            const selected = selection.allDay ? local(selection.dateStr, timezone).set({ hour: 18 }).toISO() : selection.dateStr
            newShift(selected, undefined, selection.allDay ? selection.dateStr : undefined)
          }}
          dayCellClassNames={({ date }) => holidays.some((item) => { const day = local(date.toISOString(), timezone).toISODate(); return item.start <= day && item.end > day }) ? ['holiday-day'] : []}
          dayHeaderClassNames={({ date }) => holidays.some((item) => { const day = local(date.toISOString(), timezone).toISODate(); return item.start <= day && item.end > day }) ? ['holiday-day'] : []}
          selectAllow={(selection) => selection.end > selection.start}
          select={(selection) => newShift(
            selection.startStr,
            selection.endStr,
            selection.allDay ? local(selection.startStr, timezone).toFormat('dd LLL yyyy') + ' – ' + local(selection.endStr, timezone).minus({ days: 1 }).toFormat('dd LLL yyyy') : undefined,
          )}
          events={getEvents} loading={setLoading}
          datesSet={({ view }) => setView({ type: view.type, title: view.title })}
          eventClick={({ event }) => event.extendedProps.group ? setGroupDialog({group:event.extendedProps.group}) : event.extendedProps.holiday ? setHolidayDialog(event.extendedProps.holiday) : event.extendedProps.shift && setDialog({ mode: writable ? 'edit' : 'read', shift: event.extendedProps.shift })}
          eventDragStart={startShiftDrag} eventDragStop={stopShiftDrag}
          eventDrop={moveShift} eventResize={moveShift}
          eventContent={({ event, view, isStart }) => {
            if (event.extendedProps.group) {
              const group=event.extendedProps.group
              return <div className="event-content"><strong>{event.title} · Repeated duty</strong><small>{group.rule.weekdays.map(day=>['Mon','Tue','Wed','Thu','Fri','Sat','Sun'][day-1]).join(', ')} · {group.rule.startTime}–{group.rule.endTime}{group.rule.endDayOffset?' next day':''}</small>{(teamFilter.length>0||filter)&&<small>{event.extendedProps.segment.occurrences.length} matching nights</small>}</div>
            }
            if (event.extendedProps.holiday) return <div className="event-content holiday-content"><small>Public holiday</small><strong>{event.title}</strong></div>
            const shift = event.extendedProps.shift
            if (!shift) return <div className="event-content">Selected period</div>
            return <div className="event-content">
              {writable && view.type === 'dayGridMonth' && <span className="shift-order-grip" aria-hidden="true"><GripVertical size={13} /></span>}
              <strong>{shift.engineerName}</strong>
              {shift.groupId && <small>{shift.isException ? 'Repeated duty · changed night' : 'Repeated duty'}</small>}
              <small>{!isStart ? 'Until ' + timeLabel(shift.end, timezone) : shiftTime(shift.start, shift.end, timezone)}</small>
            </div>
          }}
          eventDidMount={({ el, event }) => {
            if(event.extendedProps.group) { el.dataset.shiftId='group:' + event.extendedProps.group.id; el.title=event.title + ' · Coverage only during listed duty intervals'; return }
            const shift = event.extendedProps.shift
            if (!shift) { if (event.extendedProps.holiday) el.title = event.title + ' · ' + event.extendedProps.holiday.feed; return }
            el.dataset.shiftId = shift.id
            el.title = shift.engineerName + ' · ' + dateLabel(shift.start, timezone) + ' – ' + dateLabel(shift.end, timezone)
          }}
        />
      </div>
      <div className="calendar-legend">
        {holidays.length > 0 && <span className="holiday-legend"><i className="holiday-swatch" style={{ backgroundColor: holidays[0].color }} />Public holiday</span>}
        {legend.map((person) => <span key={person.id}><i className={'legend-dot color-' + person.color} />{person.name}</span>)}
        {filter && <Button variant="ghost" size="small" onClick={() => setFilter('')}><X size={14} /> Clear filter</Button>}
      </div>
    </section>
    {holidaysOutside && holidays.length > 0 && <section className="panel holiday-summary" aria-label="Public holidays outside calendar"><h2>Public holidays</h2><p className="settings-help">Holiday dates in the current calendar period.</p><div className="holiday-summary-list">
      {[...holidays].sort((a, b) => a.start.localeCompare(b.start) || a.title.localeCompare(b.title)).map((holiday) => <button type="button" key={holiday.id} className="holiday-summary-item" onClick={() => setHolidayDialog(holiday)}><span className="holiday-swatch" style={{ backgroundColor: holiday.color }} /><span><strong>{holiday.title}</strong><small>{local(holiday.start, timezone).toFormat('dd LLL yyyy')} · {holiday.feed}</small></span></button>)}
    </div></section>}
    {holidayDialog && <Modal title={holidayDialog.title} description={holidayDialog.feed + ' · ' + holidayDialog.start} onClose={() => setHolidayDialog(null)}><div className="dialog-footer"><Button onClick={() => setHolidayDialog(null)}>Close</Button></div></Modal>}
    {groupDialog && <GroupDialog dialog={groupDialog} session={session} people={people} templates={templates} onClose={() => {groupDialog.revert?.();setGroupDialog(null)}} onSaved={() => {setGroupDialog(null);calendar.current?.getApi().unselect();reload();notifyUser('Duty group saved.')}} onOccurrence={shift => {groupDialog.revert?.();setGroupDialog(null);calendar.current?.getApi().refetchEvents();setDialog({mode:writable?'edit':'read',shift})}} />}
    {dialog && <ShiftDialog onViewGroup={async groupId => {
      try { const group=await api('/duty-groups/'+groupId); dialog.revert?.(); setDialog(null); calendar.current?.getApi().refetchEvents(); setGroupDialog({group}) }
      catch(error) { notifyUser(error.message,true) }
    }} onGroup={shift => {setGroupDialog({initialRule:groupRule(shift,timezone),...(shift.id&&{sourceShift:shift})});dialog.revert?.();setDialog(null);calendar.current?.getApi().refetchEvents()}} templates={templates} session={session} people={people} dialog={dialog} onClose={closeDialog} onSaved={() => {
      setDialog(null)
      calendar.current?.getApi().unselect()
      reload()
      notifyUser('Roster action saved.')
    }} />}
  </>
}
