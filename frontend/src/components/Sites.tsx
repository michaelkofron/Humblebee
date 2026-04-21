import { useEffect, useRef, useState } from 'react'
import type { Site } from '../types'

export default function Sites({ onSitesMutated }: { onSitesMutated: () => void }) {
  const [sites, setSites] = useState<Site[]>([])
  const [name, setName] = useState('')
  const [domain, setDomain] = useState('')
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState('')
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null)
  const [copied, setCopied] = useState<string | null>(null)
  const [expandedSite, setExpandedSite] = useState<string | null>(null)
  const [eventInput, setEventInput] = useState('')
  const scrollToRef = useRef<string | null>(null)

  const fetchSites = () => {
    fetch('/api/sites')
      .then(r => r.json())
      .then(setSites)
      .catch(() => {})
  }

  useEffect(() => { fetchSites() }, [])

  // Scroll to newly created site once it appears in the list.
  useEffect(() => {
    const id = scrollToRef.current
    if (!id) return
    const el = document.querySelector(`[data-site-id="${id}"]`)
    if (!el) return
    scrollToRef.current = null
    el.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [sites])

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
        setExpandedSite(site.site_id)
        scrollToRef.current = site.site_id
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
        if (expandedSite === siteId) setExpandedSite(null)
        fetchSites()
        onSitesMutated()
      })
      .catch(() => {})
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
                onKeyDown={e => e.key === 'Enter' && handleCreate()}
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
                onKeyDown={e => e.key === 'Enter' && handleCreate()}
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

      {/* Sites list */}
      {sites.length === 0 ? (
        <div className="card">
          <div className="card-body" style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 40 }}>
            No sites yet. Create one above to get started.
          </div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {sites.map(s => {
            const isOpen = expandedSite === s.site_id
            return (
              <div className="card" key={s.site_id} data-site-id={s.site_id} style={{ overflow: 'hidden' }}>
                {/* Header — always visible, click to expand */}
                <div
                  style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 16px', cursor: 'pointer', userSelect: 'none' }}
                  onClick={() => { setExpandedSite(isOpen ? null : s.site_id); setEventInput('') }}
                >
                  <div style={{
                    width: 20, height: 20, display: 'flex', alignItems: 'center', justifyContent: 'center',
                    borderRadius: 4, flexShrink: 0, fontSize: 10,
                    background: isOpen ? 'var(--primary-light)' : '#f1f5f9',
                    color: isOpen ? 'var(--primary)' : 'var(--text-muted)',
                  }}>
                    {isOpen ? '▼' : '▶'}
                  </div>
                  <div style={{ flex: 1 }}>
                    <span style={{ fontWeight: 600 }}>{s.site_name}</span>
                    <span className="text-mono" style={{ marginLeft: 10, color: 'var(--text-muted)', fontSize: 12 }}>{s.domain}</span>
                  </div>
                  <div style={{ display: 'flex', gap: 6 }} onClick={e => e.stopPropagation()}>
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

                {/* Expanded body */}
                {isOpen && (
                  <div style={{ borderTop: '1px solid var(--border)' }}>
                    {/* Script snippet */}
                    <div className="card-body" style={{ borderBottom: '1px solid var(--border)' }}>
                      <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 6 }}>Install snippet</div>
                      <pre style={{
                        background: 'var(--surface-raised)', border: '1px solid var(--border)',
                        borderRadius: 'var(--radius-sm)', padding: 10, fontSize: 11,
                        fontFamily: "'SF Mono', 'Fira Code', monospace", overflowX: 'auto',
                        userSelect: 'all', whiteSpace: 'pre-wrap', wordBreak: 'break-all', margin: 0,
                      }}>
                        {snippet(s.site_uuid)}
                      </pre>
                      <button className="btn" style={{ marginTop: 8, fontSize: 12, padding: '4px 10px' }}
                        onClick={() => copySnippet(s.site_uuid)}>
                        {copied === s.site_uuid ? 'Copied!' : 'Copy'}
                      </button>
                    </div>

                    {/* Allowed actions */}
                    <div className="card-body">
                      <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 6 }}>Allowed actions</div>
                      <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 8 }}>
                        Only actions listed here will be accepted. Page views are always tracked.
                        Use <code style={{ background: 'var(--surface-raised)', padding: '1px 4px', borderRadius: 3 }}>data-buzz-on-click</code>, <code style={{ background: 'var(--surface-raised)', padding: '1px 4px', borderRadius: 3 }}>data-buzz-on-view</code>, or <code style={{ background: 'var(--surface-raised)', padding: '1px 4px', borderRadius: 3 }}>humblebee.buzz("action")</code>.
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
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </>
  )
}
