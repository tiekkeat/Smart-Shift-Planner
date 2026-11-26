# Optional calendar integration

Read this only for products that need calendar views. The base starter intentionally has no calendar dependencies. The source project uses FullCalendar 6.1.19 and Luxon 3.7.2; these are snapshot versions, not a claim about the latest releases.

## Dependencies and composition

Install matching FullCalendar versions so plugin APIs remain compatible:

```sh
npm install --save-exact @fullcalendar/core@6.1.19 @fullcalendar/react@6.1.19 @fullcalendar/daygrid@6.1.19 @fullcalendar/timegrid@6.1.19 @fullcalendar/interaction@6.1.19 @fullcalendar/luxon3@6.1.19 luxon@3.7.2
```

Use `@fullcalendar/react`, dayGrid, timeGrid, interaction, and luxon3 plugins. The source presents a custom toolbar inside a white panel and disables FullCalendar’s built-in header. Use existing `Button` and `.segmented` styles for navigation and Month/Week/Day selection; call the calendar ref’s `getApi().prev()`, `.next()`, `.today()`, and `.changeView(...)`. Update the displayed title with `datesSet`.

A minimal read-only calendar body:

```jsx
import FullCalendar from '@fullcalendar/react'
import dayGridPlugin from '@fullcalendar/daygrid'
import timeGridPlugin from '@fullcalendar/timegrid'
import interactionPlugin from '@fullcalendar/interaction'
import luxonPlugin from '@fullcalendar/luxon3'

export function CalendarBody({ timezone, events }) {
  return <div className="calendar-body">
    <FullCalendar
      plugins={[dayGridPlugin, timeGridPlugin, interactionPlugin, luxonPlugin]}
      timeZone={timezone}
      initialView="dayGridMonth"
      headerToolbar={false}
      firstDay={1}
      height="auto"
      fixedWeekCount={false}
      editable={false}
      selectable={false}
      nowIndicator
      events={events}
    />
  </div>
}
```

Choose the target product’s timezone explicitly. `Asia/Kuala_Lumpur` is the roster’s default, not a mandatory timezone for other applications. Calendar end boundaries are exclusive. Use actual occurrence intervals for repeated events; do not render gaps as continuous coverage. Add editing and persistence only when required by the target product, and review changes before saving where its workflow needs that behavior.

## Matching appearance

Append calendar-specific rules to the target app’s stylesheet when adding this module:

```css
.calendar-body { margin: 0 16px; overflow-x: auto; }
.calendar-body .fc {
  --fc-border-color: #e9eef6;
  --fc-page-bg-color: #fff;
  --fc-neutral-bg-color: #f7f9fd;
  --fc-today-bg-color: #f2f6ff;
  --fc-highlight-color: #dce8ff;
  --fc-now-indicator-color: #ef6659;
  font-size: 12px;
  min-width: 570px;
}
.fc .fc-col-header-cell { background: #f7f9fd; text-align: left; }
.fc .fc-col-header-cell-cushion { padding: 7px 8px; color: #52657f; font-weight: 700; }
.fc .fc-daygrid-day-top { flex-direction: row; }
.fc .fc-daygrid-day-frame { min-height: 80px; }
.fc .fc-daygrid-day-number {
  min-width: 22px; height: 22px; margin: 4px; display: grid;
  place-items: center; font-size: 11px; font-weight: 600; color: #465a78;
}
.fc .fc-day-today .fc-daygrid-day-number {
  color: white; background: var(--accent); border-radius: 6px;
}
.fc .fc-timegrid-slot { height: 2.45em; }
.fc .fc-timegrid-slot-label { font-size: 10.5px; color: var(--muted); }
.fc .calendar-event {
  border: 0; border-left: 3px solid var(--tone-line); border-radius: 5px;
  background: var(--tone-bg); margin-top: 2px;
}
.fc .calendar-event .fc-event-main { color: var(--tone-text); }
@media (max-width: 680px) { .calendar-body { margin: 0 7px; } }
```

Assign event class names such as `['calendar-event', 'color-blue']` to use the shared palette. Keep the calendar’s horizontal scrolling inside `.calendar-body` on phones. Add event detail rendering, timezone-aware labels, and legends as the application requires rather than copying roster-specific event shapes.

Verify Month/Week/Day, an overnight interval, timezone labels, the exclusive end date of all-day events, and mobile scrolling. If editing is added, test its save/cancel and failure behavior separately.
