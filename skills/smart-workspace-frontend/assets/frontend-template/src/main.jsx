import { StrictMode, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { defaultBranding, exampleItems, navigation } from './config.js'
import { WorkspaceShell } from './shell.jsx'
import { ComponentsPage, DirectoryPage, OverviewPage, SettingsPage } from './pages.jsx'
import { Status } from './ui.jsx'
import { readPreference, savePreference } from './storage.js'
import './style.css'

const brandingKey = defaultBranding.appId + ':branding'
const locationPage = () => window.location.hash.slice(1) || navigation[0].id

function App() {
  const [route, setRoute] = useState(locationPage)
  const [branding, setBranding] = useState(() => {
    const saved = readPreference(brandingKey, {})
    return { ...defaultBranding, ...Object.fromEntries(Object.entries(defaultBranding).filter(([key]) => key !== 'appId').map(([key, fallback]) => [key, typeof saved?.[key] === 'string' ? saved[key] : fallback])) }
  })
  const [items, setItems] = useState(exampleItems)
  const [toast, setToast] = useState('')
  const page = navigation.find(item => item.id === route) || navigation[0]
  useEffect(() => {
    const change = () => setRoute(locationPage())
    window.addEventListener('hashchange', change)
    return () => window.removeEventListener('hashchange', change)
  }, [])
  useEffect(() => {
    document.title = branding.appName
    document.querySelector('meta[name="apple-mobile-web-app-title"]')?.setAttribute('content', branding.appName)
    let icon = document.querySelector('link[rel="icon"]')
    if (branding.favicon) {
      if (!icon) { icon = document.createElement('link'); icon.rel = 'icon'; document.head.appendChild(icon) }
      icon.href = branding.favicon
    } else icon?.remove()
    savePreference(brandingKey, branding)
  }, [branding])
  useEffect(() => {
    if (!toast) return
    const timeout = setTimeout(() => setToast(''), 4000)
    return () => clearTimeout(timeout)
  }, [toast])

  function saveItem(item) {
    setItems(previous => item.id ? previous.map(value => value.id === item.id ? item : value) : [...previous, { ...item, id: Math.max(0, ...previous.map(value => value.id)) + 1, color: 'blue' }])
    setToast('Member saved.')
  }
  return <>
    <WorkspaceShell branding={branding} navigation={navigation} page={page} user={{ name: 'Demo User', role: 'Workspace member' }}>
      {page.id === 'overview' && <OverviewPage items={items} />}
      {page.id === 'directory' && <DirectoryPage items={items} onSave={saveItem} />}
      {page.id === 'settings' && <SettingsPage branding={branding} onSave={value => { setBranding(value); setToast('Workspace branding saved.') }} />}
      {page.id === 'components' && <ComponentsPage branding={branding} />}
    </WorkspaceShell>
    {toast && <div className="toast"><Status success={toast} /></div>}
  </>
}

createRoot(document.getElementById('root')).render(<StrictMode><App /></StrictMode>)
