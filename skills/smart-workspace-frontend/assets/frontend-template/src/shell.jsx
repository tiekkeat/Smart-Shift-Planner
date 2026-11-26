import { useEffect, useRef, useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { ChevronRight, LayoutGrid, LogOut, Menu, PanelLeftClose, PanelLeftOpen } from 'lucide-react'
import { Avatar, Button } from './ui.jsx'
import { readPreference, savePreference } from './storage.js'

export function Brand({ branding }) {
  return <div className="brand"><span className="brand-mark">{branding.logo ? <img src={branding.logo} alt="" /> : <LayoutGrid size={21} strokeWidth={2.2} />}</span>
    <div><strong>{branding.appName}</strong><small>{branding.subtitle}</small></div></div>
}

export function WorkspaceShell({ branding, navigation, page, user, onSignOut, children }) {
  const preferenceKey = branding.appId + ':sidebar-collapsed'
  const [collapsed, setCollapsed] = useState(() => readPreference(preferenceKey, false) === true)
  const [mobile, setMobile] = useState(() => window.matchMedia('(max-width: 680px)').matches)
  const [open, setOpen] = useState(false)
  const trigger = useRef(null)
  useEffect(() => {
    const media = window.matchMedia('(max-width: 680px)')
    const change = () => { setMobile(media.matches); setOpen(false) }
    media.addEventListener('change', change)
    return () => media.removeEventListener('change', change)
  }, [])
  useEffect(() => { savePreference(preferenceKey, collapsed) }, [preferenceKey, collapsed])

  function sidebar() {
    return <>
      <Brand branding={branding} />
      <nav aria-label="Main navigation">{navigation.map(({ id, title, icon: Icon }) =>
        <a key={id} href={'#' + id} title={title} aria-label={title} aria-current={page.id === id ? 'page' : undefined} onClick={() => setOpen(false)}>
          <Icon size={19} strokeWidth={1.9} aria-hidden="true" /><span>{title}</span>
        </a>)}</nav>
      <div className="sidebar-account">
        <div className="account-profile"><Avatar name={user.name} /><div><strong>{user.name}</strong><small>{user.role}</small></div></div>
        <div className="sidebar-actions">
          {onSignOut && <Button variant="ghost" size="icon" aria-label="Sign out" title="Sign out" onClick={onSignOut}><LogOut size={17} /></Button>}
          <Button variant="ghost" size="icon" aria-label={mobile ? 'Hide sidebar' : collapsed ? 'Expand sidebar' : 'Collapse sidebar'} title={mobile ? 'Hide sidebar' : collapsed ? 'Expand sidebar' : 'Collapse sidebar'} aria-controls="workspace-sidebar" aria-expanded={mobile ? open : !collapsed} onClick={() => mobile ? setOpen(false) : setCollapsed(value => !value)}>
            {!mobile && collapsed ? <PanelLeftOpen size={18} /> : <PanelLeftClose size={18} />}
          </Button>
        </div>
      </div>
    </>
  }

  return <Dialog.Root open={mobile && open} onOpenChange={setOpen}>
    <div className={'shell' + (collapsed ? ' sidebar-collapsed' : '')}>
      <a href="#workspace-main" className="skip-link" onClick={event => { event.preventDefault(); document.getElementById('workspace-main')?.focus() }}>Skip to content</a>
      {!mobile && <aside id="workspace-sidebar" className="sidebar">{sidebar()}</aside>}
      {mobile && <Dialog.Portal>
        <Dialog.Overlay className="mobile-scrim" />
        <Dialog.Content id="workspace-sidebar" className="sidebar" aria-describedby={undefined} onCloseAutoFocus={event => { event.preventDefault(); trigger.current?.focus() }}>
          <Dialog.Title className="sr-only">Navigation</Dialog.Title>
          {sidebar()}
        </Dialog.Content>
      </Dialog.Portal>}
      <div className="workspace">
        <header className="topbar">
          <div className="breadcrumb">
            {mobile && <Dialog.Trigger asChild><Button ref={trigger} variant="ghost" size="icon" aria-label="Show sidebar"><Menu size={20} /></Button></Dialog.Trigger>}
            <span>{branding.headerName}</span><ChevronRight size={14} aria-hidden="true" /><strong>{page.title}</strong>
          </div>
          <div className="topbar-right"><span>{branding.subtitle}</span></div>
        </header>
        <main id="workspace-main" className="workspace-content" tabIndex={-1}>{children}</main>
      </div>
    </div>
  </Dialog.Root>
}
