import { useEffect, useState } from 'react'
import type { Site } from '../types'

export default function Sites({ onSitesMutated }: { onSitesMutated: () => void }) {
  const [sites, setSites] = useState<Site[]>([])
  const [name, setName] = useState('')
  const [domain, setDomain] = useState('')
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState('')
  const [snippetSite, setSnippetSite] = useState<string | null>(null)
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null)
  const [copied, setCopied] = useState<string | null>(null)
  const [editingEvents, setEditingEvents] = useState<string | null>(null)
  const [eventDraft, setEventDraft] = useState('')
  const [eventInput, setEventInput] = useState('')

  const fetchSites = () => {
    fetch('/api/sites')
      .then(r => r.json())
      .then(setSites)
      .catch(() => {})
  }

  useEffect(() => { fetchSites() }, [])

  const handleCreate = () => {
    if (!name.trim() || !domain.trim()) { setError('Name and domain are required'); return }
    setCreating(true)
    setError('')
    fetch('/api/sites', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: name.trim(), domain: domain.trim() }),
    })
      .then(r => { if (!r.ok) throw new Error(); return r.json() })
      .then((site: Site) => {
        setName('')
        setDomain('')
        setSnippetSite(site.site_uuid)
        fetchSites()
        onSitesMutated()
      })
      .catch(() => setError('Failed to create site'))
      .finally(() => setCreating(false))
  }

  const handleDelete = (siteId: string) => {
    fetch(`/api/sites/${siteId}`, { method: 'DELETE' })
      .then(() => {
        setDeleteConfirm(null)
        if (snippetSite) {
          const deleted = sites.find(s => s.site_id === siteId)
          if (deleted && deleted.site_uuid === snippetSite) setSnippetSite(null)
        }
        fetchSites()
        onSitesMutated()
      })
      .catch(() => {})
  }

  const startEditingEvents = (site: Site) => {
    setEditingEvents(site.site_id)
    setEventDraft(site.allowed_actions.join(', '))
    setEventInput('')
  }

  const addEvent = (siteId: string) => {
    const val = eventInput.trim().replace(/[^a-zA-Z0-9_]/g, '')
    if (!val) return
    const site = sites.find(s => s.site_id === siteId)
    if (!site) return
    if (site.allowed_actions.includes(val)) { setEventInput(''); return }
    const updated = [...site.allowed_actions, val]
    fetch(`/api/sites/${siteId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ allowed_actions: updated }),
    })
      .then(r => { if (!r.ok) throw new Error(); return r.json() })
      .then(() => { setEventInput(''); fetchSites() })
      .catch(() => {})
  }

  const removeEvent = (siteId: string, eventName: string) => {
    const site = sites.find(s => s.site_id === siteId)
    if (!site) return
    const updated = site.allowed_actions.filter(e => e !== eventName)
    fetch(`/api/sites/${siteId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ allowed_actions: updated }),
    })
      .then(r => { if (!r.ok) throw new Error(); return r.json() })
      .then(() => fetchSites())
      .catch(() => {})
  }

  const snippet = (siteUuid: string) =>
    `<script src="${window.location.origin}/hb.js" data-site="${siteUuid}"></script>`

  const copySnippet = (siteUuid: string) => {
    navigator.clipboard.writeText(snippet(siteUuid)).then(() => {
      setCopied(siteUuid)
      setTimeout(() => setCopied(null), 2000)
    })
  }

  return (
    <>
      <h1 style={{ fontSize: 20, fontWeight: 700, marginBottom: 20 }}>Sites</h1>

      {/* Create form */}
      <div className="card" style={{ marginBottom: 20 }}>
        <div className="card-header">Add a new site</div>
        <div className="card-body">
          <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap' }}>
            <div style={{ flex: 1, minWidth: 180 }}>
              <label style={{ fontSize: 12, color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>Site name</label>
              <input
                className="input"
                placeholder="My Blog"
                value={name}
                onChange={e => setName(e.target.value)}
                style={{ width: '100%' }}
              />
            </div>
            <div style={{ flex: 1, minWidth: 180 }}>
              <label style={{ fontSize: 12, color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>Domain</label>
              <input
                className="input"
                placeholder="myblog.com"
                value={domain}
                onChange={e => setDomain(e.target.value)}
                style={{ width: '100%' }}
              />
            </div>
            <button className="btn btn-primary" onClick={handleCreate} disabled={creating}>
              {creating ? 'Creating...' : 'Create'}
            </button>
          </div>
          {error && <div style={{ color: 'var(--error)', fontSize: 12, marginTop: 8 }}>{error}</div>}
        </div>
      </div>

      {/* Snippet display after creation */}
      {snippetSite && (
        <div className="card" style={{ marginBottom: 20, borderColor: 'var(--primary)' }}>
          <div className="card-header" style={{ background: 'var(--primary-light)' }}>
            Install snippet
          </div>
          <div className="card-body">
            <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 10 }}>
              Paste this in the {'<head>'} of your site:
            </p>
            <pre style={{
              background: 'var(--surface-raised)', border: '1px solid var(--border)',
              borderRadius: 'var(--radius-sm)', padding: 12, fontSize: 12,
              fontFamily: "'SF Mono', 'Fira Code', monospace", overflowX: 'auto',
              userSelect: 'all', whiteSpace: 'pre-wrap', wordBreak: 'break-all',
            }}>
              {snippet(snippetSite)}
            </pre>
            <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
              <button className="btn" onClick={() => copySnippet(snippetSite)}>
                {copied === snippetSite ? 'Copied!' : 'Copy'}
              </button>
              <button className="btn btn-ghost" onClick={() => setSnippetSite(null)}>Dismiss</button>
            </div>
          </div>
        </div>
      )}

      {/* Sites list */}
      {sites.length === 0 ? (
        <div className="card">
          <div className="card-body" style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 40 }}>
            No sites yet. Create one above to get started.
          </div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {sites.map(s => (
            <div className="card" key={s.site_id}>
              <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <span style={{ fontWeight: 600 }}>{s.site_name}</span>
                  <span className="text-mono" style={{ marginLeft: 10, color: 'var(--text-muted)', fontSize: 12 }}>{s.domain}</span>
                </div>
                <div style={{ display: 'flex', gap: 6 }}>
                  <button className="btn" style={{ fontSize: 12, padding: '4px 10px' }}
                    onClick={() => setSnippetSite(snippetSite === s.site_uuid ? null : s.site_uuid)}>
                    {snippetSite === s.site_uuid ? 'Hide snippet' : 'Snippet'}
                  </button>
                  <button className="btn" style={{ fontSize: 12, padding: '4px 10px' }}
                    onClick={() => editingEvents === s.site_id ? setEditingEvents(null) : startEditingEvents(s)}>
                    {editingEvents === s.site_id ? 'Done' : 'Allowed actions'}
                  </button>
                  {deleteConfirm === s.site_id ? (
                    <>
                      <button className="btn btn-danger" style={{ fontSize: 12, padding: '4px 10px' }}
                        onClick={() => handleDelete(s.site_id)}>Confirm</button>
                      <button className="btn btn-ghost" style={{ fontSize: 12, padding: '4px 10px' }}
                        onClick={() => setDeleteConfirm(null)}>Cancel</button>
                    </>
                  ) : (
                    <button className="btn btn-danger" style={{ fontSize: 12, padding: '4px 10px' }}
                      onClick={() => setDeleteConfirm(s.site_id)}>Delete</button>
                  )}
                </div>
              </div>

              {/* Allowed actions editor */}
              {editingEvents === s.site_id && (
                <div className="card-body" style={{ borderTop: '1px solid var(--border)' }}>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 8 }}>
                    Only actions listed here will be accepted. Page views are always tracked.
                    Use these in your HTML with <code style={{ background: 'var(--surface-raised)', padding: '1px 4px', borderRadius: 3 }}>data-buzz-on-click</code> or <code style={{ background: 'var(--surface-raised)', padding: '1px 4px', borderRadius: 3 }}>data-buzz-on-view</code>, or in JS with <code style={{ background: 'var(--surface-raised)', padding: '1px 4px', borderRadius: 3 }}>humblebee.buzz("action")</code>.
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 10 }}>
                    {s.allowed_actions.length === 0 && (
                      <span style={{ fontSize: 12, color: 'var(--text-muted)', fontStyle: 'italic' }}>No actions defined yet</span>
                    )}
                    {s.allowed_actions.map(ev => (
                      <span key={ev} style={{
                        display: 'inline-flex', alignItems: 'center', gap: 4,
                        padding: '3px 10px', borderRadius: 999, fontSize: 12, fontWeight: 500,
                        background: 'var(--primary-light)', color: 'var(--primary-dark)',
                      }}>
                        {ev}
                        <button onClick={() => removeEvent(s.site_id, ev)} style={{
                          background: 'none', border: 'none', cursor: 'pointer', padding: 0,
                          color: 'var(--primary-dark)', fontSize: 14, lineHeight: 1,
                        }}>&times;</button>
                      </span>
                    ))}
                  </div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <input
                      className="input"
                      placeholder="action_name"
                      value={eventInput}
                      onChange={e => setEventInput(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter') addEvent(s.site_id) }}
                      style={{ flex: 1 }}
                    />
                    <button className="btn btn-primary" onClick={() => addEvent(s.site_id)}>Add</button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </>
  )
}
