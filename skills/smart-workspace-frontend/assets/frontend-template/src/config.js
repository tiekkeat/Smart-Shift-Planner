import { LayoutDashboard, Layers3, Settings, UsersRound } from 'lucide-react'

// Set appId once per new application; it namespaces browser preferences.
export const defaultBranding = {
  appId: 'smart-workspace-demo',
  appName: 'Smart Workspace',
  headerName: 'Workspace',
  subtitle: 'Your operations, together',
  logo: '',
  favicon: '',
}

export const navigation = [
  { id: 'overview', title: 'Overview', icon: LayoutDashboard },
  { id: 'directory', title: 'Directory', icon: UsersRound },
  { id: 'settings', title: 'App settings', icon: Settings },
  { id: 'components', title: 'UI examples', icon: Layers3 },
]

export const exampleItems = [
  { id: 1, name: 'Alex Morgan', email: 'alex@example.com', team: 'Operations', active: true, color: 'blue' },
  { id: 2, name: 'Sam Taylor', email: 'sam@example.com', team: 'Product', active: true, color: 'purple' },
  { id: 3, name: 'Jordan Lee', email: 'jordan@example.com', team: 'Support', active: false, color: 'green' },
]
