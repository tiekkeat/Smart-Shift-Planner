import { useEffect, useState } from 'react'
import { Slot } from '@radix-ui/react-slot'
import * as Dialog from '@radix-ui/react-dialog'
import { AlertCircle, CalendarDays, CheckCircle2, LoaderCircle, X } from 'lucide-react'
import { initials } from './lib.js'

export function Button({ asChild, variant = 'primary', size = 'regular', className = '', type = 'button', ...props }) {
  const Component = asChild ? Slot : 'button'
  return <Component className={'btn btn-' + variant + ' btn-' + size + ' ' + className} {...(!asChild && { type })} {...props} />
}

export function Avatar({ name, color = 'blue', size = 'regular' }) {
  return <span className={'avatar avatar-' + size + ' color-' + color} aria-hidden="true">{initials(name)}</span>
}

export function Field({ name, label, children, hint, ...props }) {
  return <label className="field">
    <span>{label}</span>
    {children || <input name={name} {...props} />}
    {hint && <small>{hint}</small>}
  </label>
}

export function Empty({ title, description, icon: Icon = CalendarDays }) {
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
  return <div role="status" className="loading"><LoaderCircle size={20} className="animate-spin" /> Loading…</div>
}

export function Modal({ title, description, onClose, children }) {
  return <Dialog.Root open onOpenChange={(open) => { if (!open) onClose() }}>
    <Dialog.Portal>
      <Dialog.Overlay className="dialog-overlay" />
      <Dialog.Content className="dialog-content">
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

export function useResource(load, key = '') {
  const pending = { data: null, error: '', loading: true, key }
  const [state, setState] = useState(pending)
  const [revision, setRevision] = useState(0)
  useEffect(() => {
    const controller = new AbortController()
    setState(pending)
    load(controller.signal).then((data) => {
      if (!controller.signal.aborted) setState({ data, error: '', loading: false, key })
    }).catch((error) => {
      if (!controller.signal.aborted) setState({ data: null, error: error.message, loading: false, key })
    })
    return () => controller.abort()
  }, [key, revision])
  return { ...(state.key === key ? state : pending), refresh: () => setRevision((value) => value + 1) }
}

export function useAction(onDone) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  async function run(action) {
    if (busy) return
    setBusy(true)
    setError('')
    try {
      const result = await action()
      onDone?.(result)
    } catch (failure) {
      setError(failure.message)
    } finally {
      setBusy(false)
    }
  }
  return { busy, error, run }
}
