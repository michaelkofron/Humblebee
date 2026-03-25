import { useEffect, useState } from 'react'
import type { Journey, JourneyEvent, UuidRow } from '../types'

function formatTs(ts: string) {
  return new Date(ts).toLocaleString()
}

function groupBySession(events: JourneyEvent[]) {
  const groups: { session_id: string; events: JourneyEvent[] }[] = []
  let current: typeof groups[number] | null = null
  for (const e of events) {
    if (!current || current.session_id !== e.session_id) {
      current = { session_id: e.session_id, events: [] }
      groups.push(current)
    }
    current.events.push(e)
  }
  return groups
}

export default function JourneyExplorer({ siteId }: { siteId: string }) {
  const [uuids, setUuids] = useState<UuidRow[]>([])
  const [uuidSearch, setUuidSearch] = useState('')
  const [query, setQuery] = useState('')
  const [journey, setJourney] = useState<Journey | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    const p = new URLSearchParams({ limit: '30' })
    if (siteId) p.set('site_id', siteId)
    if (uuidSearch) p.set('q', uuidSearch)
    fetch(`/api/uuids?${p}`)
      .then(r => r.json())
      .then(setUuids)
      .catch(() => {})
  }, [siteId, uuidSearch])

  const loadJourney = (uuid: string) => {
    setQuery(uuid)
    setLoading(true)
    setError('')
    const p = new URLSearchParams()
    if (siteId) p.set('site_id', siteId)
    fetch(`/api/journey/${uuid}?${p}`)
      .then(r => r.json())
      .then(j => { setJourney(j); setLoading(false) })
      .catch(() => { setError('Failed to load journey'); setLoading(false) })
  }

  const handleLookup = () => {
    if (query.trim()) loadJourney(query.trim())
  }

  const sessions = journey ? groupBySession(journey.events) : []

  return (
    <div className="journey-grid">
      {/* Sidebar */}
      <div className="card" style={{ overflow: 'hidden' }}>
        <div style={{ padding: '12px 14px', borderBottom: '1px solid var(--border)' }}>
          <input
            className="input"
            placeholder="Search UUIDs…"
            value={uuidSearch}
            onChange={e => setUuidSearch(e.target.value)}
            style={{ width: '100%', fontFamily: 'monospace', fontSize: 11 }}
          />
        </div>
        <div style={{ maxHeight: 520, overflowY: 'auto' }}>
          {uuids.map(u => (
            <div
              key={u.uuid + u.site_id}
              className={`uuid-list-item${journey?.uuid === u.uuid ? ' active' : ''}`}
              onClick={() => loadJourney(u.uuid)}
            >
              <div className="text-mono" style={{ fontSize: 11 }}>{u.uuid}</div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
                {u.site_name} · {formatTs(u.last_seen)}
              </div>
            </div>
          ))}
          {uuids.length === 0 && (
            <div style={{ padding: 20, textAlign: 'center', color: 'var(--text-muted)' }}>No visitors</div>
          )}
        </div>
      </div>

      {/* Main */}
      <div>
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="card-body" style={{ display: 'flex', gap: 8 }}>
            <input
              className="input"
              placeholder="Enter a UUID…"
              value={query}
              onChange={e => setQuery(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleLookup()}
              style={{ flex: 1, fontFamily: 'monospace', fontSize: 12 }}
            />
            <button className="btn btn-primary" onClick={handleLookup} disabled={loading}>
              {loading ? <span className="spinner" /> : 'Look up'}
            </button>
          </div>
          {error && <div style={{ padding: '0 20px 12px', color: 'var(--error)', fontSize: 13 }}>{error}</div>}
        </div>

        {journey && journey.events.length > 0 ? (
          <div className="card">
            <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span className="text-mono" style={{ fontSize: 12 }}>{journey.uuid}</span>
              <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>{journey.events.length} events</span>
            </div>
            <div className="card-body">
              {sessions.map((s, si) => (
                <div key={s.session_id}>
                  <div className="session-divider">Session {si + 1} · {formatTs(s.events[0].timestamp)}</div>
                  {s.events.map(ev => (
                    <div className="event-row" key={ev.event_id}>
                      <div
                        className="event-dot"
                        style={{ background: ev.event_name === 'page_view' ? 'var(--border)' : 'var(--primary)' }}
                      />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          {ev.event_name !== 'page_view' && (
                            <span className="badge-amber">{ev.event_name}</span>
                          )}
                          {ev.page_path && (
                            <span className="text-mono" style={{ color: 'var(--text-secondary)' }}>
                              {ev.page_path}
                            </span>
                          )}
                        </div>
                        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
                          {formatTs(ev.timestamp)}
                          {ev.site_name && <> · {ev.site_name}</>}
                          {ev.properties && (
                            <span style={{ marginLeft: 8, fontFamily: 'monospace', fontSize: 10, color: 'var(--text-muted)' }}>
                              {JSON.stringify(ev.properties)}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </div>
        ) : !loading && (
          <div style={{ textAlign: 'center', padding: 60, color: 'var(--text-muted)' }}>
            🔍 Select a visitor or enter a UUID to view their journey
          </div>
        )}
      </div>
    </div>
  )
}
