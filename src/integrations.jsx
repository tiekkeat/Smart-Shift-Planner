import { useState } from 'react'
import { ArrowUpRight, Cable, Copy, KeyRound, Plus, Webhook } from 'lucide-react'
import { api, dateLabel } from './lib.js'
import { Button, Empty, Field, Loading, Modal, Status, useAction, useResource } from './ui.jsx'

const scopeOptions = [
  ['on_call:read', 'Current duty lookup'],
  ['shifts:read', 'Published schedule'],
  ['engineers:read', 'Engineer profiles'],
  ['contact:phone', 'Phone numbers'],
  ['contact:email', 'Email addresses'],
  ['contact:dingtalk', 'DingTalk IDs'],
]

function IntegrationEditor({ kind, onClose, onCreated }) {
  const action = useAction(onCreated)
  const token = kind === 'token'
  function submit(event) {
    event.preventDefault()
    const input = new FormData(event.currentTarget)
    const body = token ? { name: input.get('name'), scopes: input.getAll('scopes'), expiresInDays: Number(input.get('days')) }
      : { name: input.get('name'), url: input.get('url') }
    action.run(() => api(token ? '/tokens' : '/webhooks', { method: 'POST', body }))
  }
  return <Modal onClose={onClose} title={token ? 'Create API token' : 'Add webhook'}
    description={token ? 'Choose which roster data this integration can read.' : 'Send signed schedule events to an approved HTTPS endpoint.'}>
    <form className="form-stack" onSubmit={submit}>
      <Field name="name" label="Integration name" required maxLength={120} placeholder="n8n on-call routing" />
      {token ? <>
        <fieldset className="scope-list"><legend>Permissions</legend>
          {scopeOptions.map(([value, label]) => <label className="checkbox" key={value}><input name="scopes" type="checkbox"
            value={value} defaultChecked={value === 'on_call:read'} /> {label}</label>)}
        </fieldset>
        <Field label="Expires in days" name="days" type="number" min={1} max={365} defaultValue={90} required />
      </> : <Field name="url" label="Webhook URL" required type="url" maxLength={2048} placeholder="https://automation.example.com/webhook/duty" />}
      <Status error={action.error} />
      <div className="dialog-footer"><Button variant="secondary" onClick={onClose}>Cancel</Button><Button type="submit" disabled={action.busy}>Create {kind}</Button></div>
    </form>
  </Modal>
}

function CredentialDialog({ value, title, onClose }) {
  const [copied, setCopied] = useState(false)
  const [copyError, setCopyError] = useState('')
  async function copy() {
    setCopyError('')
    // execCommand runs synchronously during the click, including on HTTP LAN URLs.
    const input = document.querySelector('#credential-value')
    input?.focus(); input?.select(); input?.setSelectionRange(0, value.length)
    try { if (document.execCommand('copy')) { setCopied(true); return } } catch { /* Try the modern clipboard next. */ }
    try {
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable')
      await navigator.clipboard.writeText(value); setCopied(true)
    } catch { setCopied(false); setCopyError('Your browser blocked clipboard access. The credential is selected; press Ctrl+C or ⌘C to copy.') }
  }
  return <Modal title={title} description="Copy this credential now. It is shown only once." onClose={onClose}>
    <div className="form-stack">
      <div className="credential-row"><input id="credential-value" aria-label="Credential" readOnly value={value} /><Button variant="secondary" onClick={copy}><Copy size={15} />{copied ? 'Copied' : 'Copy'}</Button></div>
      <Status error={copyError} success={copied ? 'Copied to clipboard.' : ''} />
      <div className="dialog-footer"><Button onClick={onClose}>Done</Button></div>
    </div>
  </Modal>
}

export function IntegrationsPage({ timezone, notifyUser }) {
  const [tab, setTab] = useState('tokens')
  const [editor, setEditor] = useState('')
  const [credential, setCredential] = useState(null)
  const [confirm, setConfirm] = useState(null)
  const resource = useResource((signal) => api('/' + tab, { signal }), tab)
  const action = useAction(() => { setConfirm(null); resource.refresh(); notifyUser('Integration updated.') })

  return <>
    <div className="page-heading"><div><h1>Integrations</h1><p>Connect automations to the shared duty roster.</p></div>
      <div className="heading-actions"><Button asChild variant="secondary"><a href="/api/v1/openapi.json" target="_blank" rel="noreferrer">OpenAPI <ArrowUpRight size={15} /></a></Button>
        <Button onClick={() => setEditor(tab === 'tokens' ? 'token' : 'webhook')}><Plus size={17} />{tab === 'tokens' ? 'New token' : 'Add webhook'}</Button>
      </div>
    </div>
    <section className="panel">
      <div className="panel-toolbar">
        <div className="segmented" role="group" aria-label="Integration section">
          {[['tokens', 'API tokens', KeyRound], ['webhooks', 'Webhooks', Webhook], ['deliveries', 'Delivery history', Cable]].map(([value, label, Icon]) =>
            <button type="button" key={value} aria-pressed={tab === value} onClick={() => setTab(value)}><Icon size={15} />{label}</button>)}
        </div>
        {tab === 'deliveries' && <Button size="small" variant="secondary" onClick={resource.refresh}>Refresh</Button>}
      </div>
      {resource.loading ? <Loading /> : <Status error={resource.error} />}
      {resource.data?.length > 0 && <div className="table-wrap"><table>
        {tab === 'tokens' ? <>
          <thead><tr><th>Name and permissions</th><th>Expires</th><th>Last used</th><th>Status</th><th><span className="sr-only">Actions</span></th></tr></thead>
          <tbody>{resource.data.map((item) => {
            const status = item.revokedAt ? 'Revoked' : Date.parse(item.expiresAt) <= Date.now() ? 'Expired' : 'Active'
            return <tr key={item.id}><td><strong>{item.name}</strong><div className="scope-tags">{item.scopes.map((scope) => <code key={scope}>{scope}</code>)}</div></td>
              <td>{dateLabel(item.expiresAt, timezone)}</td><td>{item.lastUsedAt ? dateLabel(item.lastUsedAt, timezone) : '—'}</td>
              <td><span className={'badge badge-' + (status === 'Active' ? 'positive' : 'neutral')}>{status}</span></td>
              <td>{!item.revokedAt && <Button variant="ghost" size="small" onClick={() => setConfirm({ item, tab, verb: 'Revoke' })}>Revoke</Button>}{item.revokedAt && <Button variant="danger" size="small" onClick={() => setConfirm({ item, tab, verb: 'Delete' })}>Delete</Button>}</td>
            </tr>
          })}</tbody>
        </> : tab === 'webhooks' ? <>
          <thead><tr><th>Name</th><th>Destination</th><th>Status</th><th><span className="sr-only">Actions</span></th></tr></thead>
          <tbody>{resource.data.map((item) => <tr key={item.id}><td><strong>{item.name}</strong></td><td className="break-all">{item.url}</td>
            <td><span className={'badge badge-' + (item.active ? 'positive' : 'neutral')}>{item.active ? 'Active' : 'Disabled'}</span></td>
            <td>{item.active && <Button variant="ghost" size="small" onClick={() => setConfirm({ item, tab, verb: 'Disable' })}>Disable</Button>}</td></tr>)}</tbody>
        </> : <>
          <thead><tr><th>Event</th><th>Destination</th><th>Status</th><th>Attempts</th><th>Created</th></tr></thead>
          <tbody>{resource.data.map((item) => <tr key={item.id}><td><strong>{item.event}</strong>{item.lastError && <small className="block">{item.lastError}</small>}</td>
            <td>{item.name}</td><td><span className={'badge badge-' + ({ sent: 'positive', failed: 'negative', queued: 'warning' }[item.state] || 'neutral')}>{item.state}</span></td>
            <td>{item.attempts}</td><td>{dateLabel(item.createdAt, timezone)}</td></tr>)}</tbody>
        </>}
      </table></div>}
      {resource.data?.length === 0 && <Empty icon={Cable} title={tab === 'tokens' ? 'No API tokens' : tab === 'webhooks' ? 'No webhooks configured' : 'No webhook deliveries'} />}
    </section>
    {editor && <IntegrationEditor kind={editor} onClose={() => setEditor('')} onCreated={(result) => {
      setCredential({ value: result.token || result.secret, title: result.token ? 'API token created' : 'Webhook signing secret' })
      setEditor(''); resource.refresh()
    }} />}
    {credential && <CredentialDialog {...credential} onClose={() => setCredential(null)} />}
    {confirm && <Modal title={confirm.verb + ' ' + confirm.item.name + '?'} description={confirm.verb === 'Delete' ? 'Permanently remove this revoked token from the list. Its audit history is retained.' : confirm.tab === 'tokens' ?
      'Requests using this token will be rejected.' : 'New schedule events will no longer be sent to this destination.'} onClose={() => setConfirm(null)}>
      <Status error={action.error} /><div className="dialog-footer"><Button variant="secondary" onClick={() => setConfirm(null)}>Cancel</Button>
        <Button variant="danger" disabled={action.busy} onClick={() => action.run(() => api('/' + confirm.tab + '/' + confirm.item.id + (confirm.verb === 'Delete' ? '/permanent' : ''), { method: 'DELETE' }))}>{confirm.verb}</Button></div>
    </Modal>}
  </>
}
