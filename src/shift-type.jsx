import { Field } from './ui.jsx'

export function ShiftTypeField({ templates, templateId, currentName, onChange }) {
  const missing = templateId && !templates.some(template => template.id === templateId)
  return <Field label="Shift type" hint="Choosing a type fills its times. You can adjust them."><select aria-label="Shift type" value={templateId || ''} onChange={event => onChange(templates.find(template => template.id === event.target.value) || null)}>
    <option value="">Unclassified</option>
    {missing && <option value={templateId} disabled>{currentName || 'Saved type'} (archived)</option>}
    {templates.map(template => <option key={template.id} value={template.id}>{template.name}</option>)}
  </select></Field>
}
