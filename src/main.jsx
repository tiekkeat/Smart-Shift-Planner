import { StrictMode, createContext, useContext, useCallback, useEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { ArrowRight, ArrowUpRight, BarChart3, Bell, CalendarDays, ChevronRight, ClipboardList, Clock3, Eye, EyeOff, KeyRound, LoaderCircle, LogOut, Menu, PanelLeftClose, PanelLeftOpen, Settings, UsersRound } from 'lucide-react'
import { api } from './lib.js'
import { Avatar, Button, Field, Loading, Status, useAction } from './ui.jsx'
import { CalendarPage } from './calendar.jsx'
import { PeoplePage } from './people.jsx'
import { ChangesPage, NotificationsPage, ReportsPage } from './workflow.jsx'
import { IntegrationsPage } from './integrations.jsx'
import { SettingsPage, defaultBranding } from './settings.jsx'
import './style.css'
const BrandingContext = createContext(defaultBranding)

const pages = [
  { id: 'calendar', title: 'Duty calendar', icon: CalendarDays },
  { id: 'changes', title: 'Change requests', icon: ClipboardList, roles: ['admin','manager','engineer'] },
  { id: 'reports', title: 'Duty hours', icon: BarChart3, roles: ['admin','manager','engineer'] },
  { id: 'notifications', title: 'Notifications', icon: Bell, roles: ['admin','manager','engineer'] },
  { id: 'people', title: 'Team directory', icon: UsersRound, roles: ['admin', 'manager'] },
  { id: 'settings', title: 'App settings', icon: Settings, roles: ['admin'] },
  { id: 'integrations', title: 'Integrations', icon: KeyRound, roles: ['admin'] },
]

function Brand() {
  const branding = useContext(BrandingContext)
  return <div className="brand"><span className="brand-mark"><>{branding.logo ? <img src={branding.logo} alt="" /> : <CalendarDays size={21} strokeWidth={2.2} />}</></span>
    <div><strong>{branding.appName}</strong><small>{branding.subtitle}</small></div></div>
}

function Login({ onSignIn }) {
  const [showPassword, setShowPassword] = useState(false)
  const action = useAction(onSignIn)
  function submit(event) {
    event.preventDefault()
    const input = new FormData(event.currentTarget)
    action.run(() => api('/login', { method: 'POST', body: { email: input.get('email'), password: input.get('password') } }))
  }
  return <div className="login-stage">
    <div className="login-backdrop" aria-hidden="true"><span /><span /><span /></div>
    <main className="login-card">
      <Brand />
      <div className="login-heading"><h1 id="sign-in-title">Welcome back</h1><p>Sign in to your engineer duty roster.</p></div>
      <form className="form-stack login-form" aria-labelledby="sign-in-title" onSubmit={submit}>
        <div className="field"><label htmlFor="login-email">Work email</label><input id="login-email" name="email" type="email" placeholder="you@company.com" autoComplete="username" spellCheck={false} enterKeyHint="next" required maxLength={254} /></div>
        <div className="field"><label htmlFor="login-password">Password</label><div className="login-password-input">
          <input id="login-password" name="password" type={showPassword ? 'text' : 'password'} autoComplete="current-password" enterKeyHint="go" required maxLength={128} />
          <button type="button" className="login-password-toggle" aria-label="Show password" aria-pressed={showPassword} aria-controls="login-password" title={showPassword ? 'Hide password' : 'Show password'} onClick={() => setShowPassword(value => !value)}>{showPassword ? <EyeOff size={18} aria-hidden="true" /> : <Eye size={18} aria-hidden="true" />}</button>
        </div></div>
        <Status error={action.error} />
        <Button type="submit" className="login-submit" disabled={action.busy} aria-busy={action.busy}><span>{action.busy ? 'Signing in…' : 'Sign in'}</span><span className="login-submit-icon" aria-hidden="true">{action.busy ? <LoaderCircle size={19} className="animate-spin motion-reduce:animate-none" /> : <ArrowRight size={19} />}</span></Button>
        <span className="sr-only" role="status">{action.busy ? 'Signing in. Please wait.' : ''}</span>
      </form>
      <p className="login-help">Need access? Contact your roster administrator.</p>
    </main>
  </div>
}

const locationPage = () => window.location.hash.replace(/^#/, '') || 'calendar'

function Workspace({ session, onSignOut, onBrandingSaved }) {
  const branding = useContext(BrandingContext)
  const [route, setRoute] = useState(locationPage)
  const [mobileNav, setMobileNav] = useState(false)
  const [isMobile, setIsMobile] = useState(() => window.matchMedia('(max-width: 680px)').matches)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    try { return localStorage.getItem('sidebar-collapsed') === 'true' } catch { return false }
  })
  const sidebarToggle = useRef(null)
  const sidebarVisible = isMobile ? mobileNav : !sidebarCollapsed
  const sidebarAccessible = !isMobile || mobileNav

  useEffect(() => {
    const media = window.matchMedia('(max-width: 680px)')
    const change = () => { setIsMobile(media.matches); setMobileNav(false) }
    media.addEventListener('change', change)
    return () => media.removeEventListener('change', change)
  }, [])

  useEffect(() => {
    try { localStorage.setItem('sidebar-collapsed', String(sidebarCollapsed)) } catch { /* Keep the preference in memory if storage is unavailable. */ }
    const frame = requestAnimationFrame(() => window.dispatchEvent(new Event('resize')))
    return () => cancelAnimationFrame(frame)
  }, [sidebarCollapsed, isMobile])

  useEffect(() => {
    if (!isMobile || !mobileNav) return
    const close = (event) => { if (event.key === 'Escape') { setMobileNav(false); requestAnimationFrame(() => sidebarToggle.current?.focus()) } }
    window.addEventListener('keydown', close)
    return () => window.removeEventListener('keydown', close)
  }, [isMobile, mobileNav])
  const [people, setPeople] = useState([])
  const [teams,setTeams]=useState([])
  const [teamsError,setTeamsError]=useState('')
  const [notifications, setNotifications] = useState([])
  const [peopleError, setPeopleError] = useState('')
  const [feedError, setFeedError] = useState('')
  const [toast, setToast] = useState(null)
  const { user, timezone } = session
  const readable = pages.filter((page) => !page.roles || page.roles.includes(user.role))
  const page = readable.find((item) => item.id === route) || readable[0]
  const unread = notifications.filter((item) => item.unread).length

  useEffect(() => {
    function routeChange() { setRoute(locationPage()); setMobileNav(false) }
    window.addEventListener('hashchange', routeChange)
    return () => window.removeEventListener('hashchange', routeChange)
  }, [])

  useEffect(() => {
    if (!toast) return
    const timeout = setTimeout(() => setToast(null), 4000)
    return () => clearTimeout(timeout)
  }, [toast])

  const refreshTeams=useCallback(signal=>api('/teams',{signal}).then(rows=>{setTeams(rows);setTeamsError('')}).catch(error=>{if(error.name!=='AbortError')setTeamsError('Team groups are unavailable: '+error.message)}),[])

  const refreshPeople = useCallback((signal) => api('/people', { signal }).then((rows) => {
    setPeople(rows); setPeopleError('')
  }).catch((error) => { if (error.name !== 'AbortError') setPeopleError(error.message) }), [])

  const refreshFeed = useCallback((signal) => api('/notifications', { signal }).then((rows) => {
    setNotifications(rows); setFeedError('')
  }).catch((error) => { if (error.name !== 'AbortError') setFeedError(error.message) }), [])

  useEffect(() => {
    const controller = new AbortController()
    refreshTeams(controller.signal)
    refreshPeople(controller.signal)
    refreshFeed(controller.signal)
    const timer = setInterval(() => refreshFeed(controller.signal), 20_000)
    return () => { clearInterval(timer); controller.abort() }
  }, [refreshFeed, refreshPeople, refreshTeams])

  function toggleSidebar() {
    if (isMobile) {
      setMobileNav(false)
      requestAnimationFrame(() => sidebarToggle.current?.focus())
    } else setSidebarCollapsed(!sidebarCollapsed)
  }

  function notifyUser(message, failed = false) { setToast({ message, failed }) }
  const logout = useAction(onSignOut)

  return <div className={'shell' + (sidebarCollapsed ? ' sidebar-collapsed' : '')}>
    {isMobile && mobileNav && <button className="mobile-scrim" aria-label="Close navigation" onClick={() => { setMobileNav(false); requestAnimationFrame(() => sidebarToggle.current?.focus()) }} />}
    <aside id="sidebar" inert={!sidebarAccessible} aria-hidden={!sidebarAccessible} className={'sidebar ' + (mobileNav ? 'sidebar-open' : '')}>
      <Brand />
      <nav aria-label="Main navigation">
        {readable.map(({ id, icon: Icon, title }) => <a key={id} aria-label={id === 'notifications' && unread > 0 ? title + ', ' + unread + ' unread' : title} title={title} href={'#' + id} onClick={() => setMobileNav(false)} aria-current={page.id === id ? 'page' : undefined}>
          <Icon size={19} strokeWidth={1.9} /><span>{title}</span>{id === 'notifications' && unread > 0 && <span className="nav-badge">{unread}</span>}
        </a>)}
      </nav>
      <div className="sidebar-account">
        <div className="account-profile"><Avatar name={user.name} /><div><strong>{user.name}</strong><small className="capitalize">{user.role}</small></div></div>
        <div className="sidebar-actions">
          <Button variant="ghost" size="icon" aria-label="Sign out" title="Sign out" onClick={() => logout.run(() => api('/logout', { method: 'POST' }))} disabled={logout.busy}><LogOut size={17} /></Button>
          <button type="button" className="btn btn-ghost btn-icon sidebar-collapse-control" aria-label={isMobile ? 'Hide sidebar' : sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'} title={isMobile ? 'Hide sidebar' : sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'} aria-controls="sidebar" aria-expanded={sidebarVisible} onClick={toggleSidebar}>{!isMobile && sidebarCollapsed ? <PanelLeftOpen size={18} /> : <PanelLeftClose size={18} />}</button>
        </div>
      </div>
    </aside>
    <div className="workspace">
      <header className="topbar">
        <div className="breadcrumb">{isMobile && !mobileNav && <button ref={sidebarToggle} type="button" className="btn btn-ghost btn-icon sidebar-toggle" aria-label="Show sidebar" title="Show sidebar" aria-controls="sidebar" aria-expanded={false}
          onClick={() => setMobileNav(true)}><Menu size={20} /></button>}
          <span>{branding.headerName}</span><ChevronRight size={14} /><strong>{page.title}</strong></div>
        <div className="topbar-right"><span><Clock3 size={15} />{timezone}</span>
          {user.role !== 'viewer' && <Button asChild variant="secondary" size="icon" className="top-notifications"><a href="#notifications" aria-label={unread ? 'Notifications, ' + unread + ' unread' : 'Notifications'}><Bell size={17} />{unread > 0 && <i />}</a></Button>}
        </div>
      </header>
      <main className="workspace-content">
        <Status error={teamsError || logout.error || (page.id === 'calendar' ? peopleError : '')} />
        {page.id === 'calendar' && <CalendarPage teams={teams} holidayPlacement={branding.holidayPlacement || 'top'} session={session} people={people} onChange={() => refreshFeed()} notifyUser={notifyUser} />}
        {page.id === 'people' && <PeoplePage teams={teams} onTeamsChange={()=>{refreshTeams();refreshPeople()}} session={session} people={people} onChange={() => refreshPeople()} notifyUser={notifyUser} error={peopleError} />}
        {page.id === 'changes' && <ChangesPage people={people} session={session} onChange={() => refreshFeed()} notifyUser={notifyUser} />}
        {page.id === 'reports' && <ReportsPage session={session} />}
        {page.id === 'notifications' && <NotificationsPage notifications={notifications} timezone={timezone} refresh={() => refreshFeed()} error={feedError} />}
        {page.id === 'settings' && <SettingsPage timezone={timezone} branding={branding} onSaved={onBrandingSaved} notifyUser={notifyUser} />}
        {page.id === 'integrations' && <IntegrationsPage timezone={timezone} notifyUser={notifyUser} />}
      </main>
    </div>
    {toast && <div className="toast"><Status error={toast.failed ? toast.message : ''} success={!toast.failed ? toast.message : ''} /></div>}
  </div>
}

function App() {
  const [branding, setBranding] = useState(defaultBranding)
  useEffect(() => {
    const controller = new AbortController()
    api('/branding', { signal: controller.signal }).then((value) => { if (!controller.signal.aborted) setBranding(value) }).catch(() => {})
    return () => controller.abort()
  }, [])
  useEffect(() => {
    document.title = branding.appName
    document.querySelector('meta[name="apple-mobile-web-app-title"]')?.setAttribute('content', branding.appName)
    let icon = document.querySelector('link[rel="icon"]')
    if (branding.favicon) {
      if (!icon) { icon = document.createElement('link'); icon.rel = 'icon'; document.head.appendChild(icon) }
      icon.type = 'image/png'; icon.href = branding.favicon
    } else { icon?.remove() }
  }, [branding])
  const [session, setSession] = useState(null)
  const [loading, setLoading] = useState(true)
  useEffect(() => {
    const controller = new AbortController()
    api('/me', { signal: controller.signal }).then((result) => {
      if (!controller.signal.aborted) setSession(result)
    }).catch(() => {}).finally(() => {
      if (!controller.signal.aborted) setLoading(false)
    })
    const endSession = () => setSession(null)
    window.addEventListener('session-ended', endSession)
    return () => { controller.abort(); window.removeEventListener('session-ended', endSession) }
  }, [])
  if (loading) return <Loading />
  return <BrandingContext.Provider value={branding}>{session ? <Workspace session={session} onBrandingSaved={setBranding} onSignOut={() => setSession(null)} /> : <Login onSignIn={setSession} />}</BrandingContext.Provider>
}

createRoot(document.getElementById('root')).render(<StrictMode><App /></StrictMode>)
