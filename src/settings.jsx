import { ScheduleSettings } from './schedule-settings.jsx'
import { useState } from 'react'
import { api } from './lib.js'
import { Button, Field, Status, useAction } from './ui.jsx'

export const defaultBranding = { appName: 'Smart Timetable', headerName: 'Support operations', subtitle: 'Engineer duty roster', logo: null, favicon: null, holidayPlacement: 'top' }
export function SettingsPage({ branding, onSaved, notifyUser, timezone }) {
  const [draft, setDraft] = useState(branding)
  const [uploadError, setUploadError] = useState('')
  const [reading, setReading] = useState(false)
  const action = useAction((settings) => { onSaved(settings); notifyUser('Branding settings saved.') })
  async function upload(key, file) {
    if (!file) return
    setUploadError(''); setReading(true)
    try {
      if (file.type !== 'image/png' || file.size > 256 * 1024) throw new Error('Choose a PNG file up to 256 KB.')
      const value = await new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = reject; reader.readAsDataURL(file) })
      const image = new Image(); image.src = value; await image.decode()
      if (image.width > 2048 || image.height > 2048) throw new Error('PNG dimensions must be at most 2048 × 2048 pixels.')
      setDraft((previous) => ({ ...previous, [key]: value }))
    } catch (error) { setUploadError(error.message || 'Could not read that PNG.') }
    finally { setReading(false) }
  }
  return <>
    <div className="page-heading"><div><h1>App settings</h1><p>Customize your workspace name, logo, and browser icon.</p></div></div>
    <section className="panel settings-panel"><form className="form-stack" onSubmit={(event) => { event.preventDefault(); action.run(() => api('/settings', { method: 'PUT', body: draft })) }}>
      <Field label="App name / browser title"><input required maxLength={60} value={draft.appName} onChange={(e) => setDraft({ ...draft, appName: e.target.value })} /></Field>
      <Field label="Header name"><input required maxLength={80} value={draft.headerName} onChange={(e) => setDraft({ ...draft, headerName: e.target.value })} /></Field>
      <Field label="App subtitle"><input maxLength={100} value={draft.subtitle} onChange={(e) => setDraft({ ...draft, subtitle: e.target.value })} /></Field>
      <div className="form-grid">{[['logo', 'Logo PNG'], ['favicon', 'Favicon PNG']].map(([key, label]) => <div className="branding-upload" key={key}>
        <Field label={label} hint="PNG · up to 256 KB · up to 2048 × 2048 pixels"><input type="file" accept="image/png" disabled={reading || action.busy} onChange={(e) => { upload(key, e.target.files[0]); e.target.value = '' }} /></Field>
        {draft[key] && <><img className="branding-preview" src={draft[key]} alt={label + ' preview'} /><Button variant="ghost" onClick={() => setDraft({ ...draft, [key]: null })}>Remove {key}</Button></>}
      </div>)}</div>
      <Field label="Public holiday placement" hint="Month view places holiday labels above or below shifts. Outside uses a separate holiday panel. Week and Day keep holidays separate from timed shifts."><select value={draft.holidayPlacement || 'top'} onChange={(event) => setDraft({ ...draft, holidayPlacement: event.target.value })}>
        <option value="top">Above shifts</option><option value="bottom">Below shifts</option><option value="outside">Separate panel outside calendar</option>
      </select></Field>
      <Status error={uploadError || action.error} />
      <div className="dialog-footer"><Button variant="secondary" disabled={action.busy || reading} onClick={() => setDraft({ ...defaultBranding })}>Reset to defaults</Button><Button type="submit" disabled={action.busy || reading}>Save settings</Button></div>
    </form></section>
    <ScheduleSettings notifyUser={notifyUser} timezone={timezone} />
  </>
}
