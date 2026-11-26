import { useId, useRef } from 'react'
import { Slot } from '@radix-ui/react-slot'
import * as Dialog from '@radix-ui/react-dialog'
import { AlertCircle, LayoutGrid, CheckCircle2, LoaderCircle, X } from 'lucide-react'
const initials = (name = '') => name.trim().split(/\s+/).slice(0, 2).map(word => word[0]).join('').toUpperCase()

export function Button({ asChild, variant = 'primary', size = 'regular', className = '', type = 'button', ...props }) {
  const Component = asChild ? Slot : 'button'
  return <Component className={'btn btn-' + variant + ' btn-' + size + ' ' + className} {...(!asChild && { type })} {...props} />
}

export function Avatar({ name, color = 'blue', size = 'regular' }) {
  return <span className={'avatar avatar-' + size + ' color-' + color} aria-hidden="true">{initials(name)}</span>
}

export function Field({ id: providedId, name, label, children, hint, ...props }) {
  const generatedId = useId()
  const id = providedId || generatedId
  const hintId = hint ? id + '-hint' : undefined
  return <div className="field">
    <label htmlFor={id}>{label}</label>
    {children ? <Slot id={id} aria-describedby={hintId}>{children}</Slot> : <input {...props} id={id} name={name} aria-describedby={hintId} />}
    {hint && <small id={hintId}>{hint}</small>}
  </div>
}

export function Empty({ title, description, icon: Icon = LayoutGrid }) {
  return <div className="empty"><span className="empty-icon"><Icon size={21} /></span><strong>{title}</strong>
    {description && <p>{description}</p>}
  </div>
}

export function Status({ error, success }) {
  if (!error && !success) return null
  const Icon = error ? AlertCircle : CheckCircle2
  return <div role={error ? 'alert' : 'status'} className={'status-message ' + (error ? 'status-error' : 'status-success')}><Icon size={16} />{error || success}</div>
}

export function Loading() {
  return <div role="status" className="loading"><LoaderCircle size={20} className="animate-spin motion-reduce:animate-none" /> Loading…</div>
}

export function Modal({ title, description, onClose, children }) {
  const returnFocus = useRef(document.activeElement)
  return <Dialog.Root open onOpenChange={(open) => { if (!open) onClose() }}>
    <Dialog.Portal>
      <Dialog.Overlay className="dialog-overlay" />
      <Dialog.Content className="dialog-content" onCloseAutoFocus={event => { event.preventDefault(); if (returnFocus.current?.isConnected) returnFocus.current.focus() }}>
        <div className="dialog-heading">
          <Dialog.Title>{title}</Dialog.Title>
          <Dialog.Description>{description}</Dialog.Description>
          <Dialog.Close asChild><Button size="icon" variant="ghost" className="dialog-close" aria-label="Close"><X size={19} /></Button></Dialog.Close>
        </div>
        {children}
      </Dialog.Content>
    </Dialog.Portal>
  </Dialog.Root>
}

export function Panel({ title, actions, children, className = '' }) {
  return <section className={'panel ' + className}>
    {(title || actions) && <div className="panel-toolbar"><h2>{title}</h2>{actions}</div>}
    {children}
  </section>
}

export function Badge({ tone = 'neutral', children }) {
  return <span className={'badge badge-' + tone}>{children}</span>
}
