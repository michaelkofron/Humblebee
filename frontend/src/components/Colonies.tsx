import { useCallback, useEffect, useRef, useState } from 'react'
import type { Journey, JourneyEvent, UuidRow, Hive, HiveCondition, HiveConditionType, HiveSequence } from '../types'

const PAGE_SIZE = 100

const CONDITION_TYPES: { value: HiveConditionType; label: string }[] = [
  { value: 'event_name', label: 'Event name' },
  { value: 'page_path_equals', label: 'Page path equals' },
  { value: 'page_path_contains', label: 'Page path contains' },
]

const SEQUENCE_OPTIONS: { value: HiveSequence; label: string }[] = [
  { value: 'anytime', label: 'any time later' },
  { value: 'immediately', label: 'immediately followed by' },
]

function placeholderFor(type: HiveConditionType) {
  if (type === 'event_name') return 'e.g. signup'
  if (type === 'page_path_equals') return 'e.g. /pricing'
  return 'e.g. /blog'
}

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

export default function Colonies({ siteId }: { siteId: string }) {
  // UUID search + list
  const [uuids, setUuids] = useState<UuidRow[]>([])
  const [totalUuids, setTotalUuids] = useState(0)
  const [uuidSearch, setUuidSearch] = useState('')
  const [loadingMore, setLoadingMore] = useState(false)
  const [journey, setJourney] = useState<Journey | null>(null)
  const [journeyLoading, setJourneyLoading] = useState(false)
  const [journeyError, setJourneyError] = useState('')
  const listRef = useRef<HTMLDivElement>(null)

  // Condition filter
  const [conditions, setConditions] = useState<HiveCondition[]>([])
  const [filterActive, setFilterActive] = useState(false)
  const [filterLoading, setFilterLoading] = useState(false)

  // Saved colonies
  const [colonies, setColonies] = useState<Hive[]>([])
  const [colonyCounts, setColonyCounts] = useState<Record<string, number>>({})
  const [countLoading, setCountLoading] = useState<Record<string, boolean>>({})

  // Save modal
  const [showSaveModal, setShowSaveModal] = useState(false)
  const [colonyName, setColonyName] = useState('')
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState('')

  // ── Fetch UUIDs (default mode) ──────────────────────────────────────────
  const fetchUuids = useCallback((offset: number, append: boolean) => {
    if (filterActive) return
    if (append) setLoadingMore(true)
    const p = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String(offset) })
    if (siteId) p.set('site_id', siteId)
    if (uuidSearch) p.set('q', uuidSearch)
    fetch(`/api/uuids?${p}`)
      .then(r => r.json())
      .then((data: { total: number; items: UuidRow[] }) => {
        setTotalUuids(data.total)
        setUuids(prev => append ? [...prev, ...data.items] : data.items)
      })
      .catch(() => {})
      .finally(() => setLoadingMore(false))
  }, [siteId, uuidSearch, filterActive])

  useEffect(() => {
    if (filterActive) return
    fetchUuids(0, false)
  }, [siteId, uuidSearch, filterActive])

  // ── Fetch filtered UUIDs ────────────────────────────────────────────────
  const fetchFiltered = useCallback((offset: number, append: boolean) => {
    if (append) setLoadingMore(true)
    else setFilterLoading(true)
    fetch('/api/journey/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ conditions, site_id: siteId || null, limit: PAGE_SIZE, offset }),
    })
      .then(r => r.json())
      .then((data: { total: number; items: UuidRow[] }) => {
        setTotalUuids(data.total)
        setUuids(prev => append ? [...prev, ...data.items] : data.items)
      })
      .catch(() => { if (!append) setUuids([]) })
      .finally(() => { setFilterLoading(false); setLoadingMore(false) })
  }, [conditions, siteId])

  const applyFilter = useCallback(() => {
    if (conditions.some(c => !c.value.trim())) return
    setFilterActive(true)
    setJourney(null)
    fetchFiltered(0, false)
  }, [conditions, fetchFiltered])

  // ── Infinite scroll ─────────────────────────────────────────────────────
  const handleScroll = useCallback(() => {
    const el = listRef.current
    if (!el || loadingMore) return
    if (uuids.length >= totalUuids) return
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 40) {
      if (filterActive) {
        fetchFiltered(uuids.length, true)
      } else {
        fetchUuids(uuids.length, true)
      }
    }
  }, [loadingMore, uuids.length, totalUuids, filterActive, fetchFiltered, fetchUuids])

  // Load saved colonies
  const loadColonies = () => {
    const p = new URLSearchParams()
    if (siteId) p.set('site_id', siteId)
    fetch(`/api/hives?${p}`).then(r => r.json()).then(setColonies).catch(() => {})
  }
  useEffect(loadColonies, [siteId])

  // Journey lookup
  const loadJourney = (uuid: string) => {
    setJourneyLoading(true)
    setJourneyError('')
    const p = new URLSearchParams()
    if (siteId) p.set('site_id', siteId)
    fetch(`/api/journey/${uuid}?${p}`)
      .then(r => r.json())
      .then(j => { setJourney(j); setJourneyLoading(false) })
      .catch(() => { setJourneyError('Failed to load journey'); setJourneyLoading(false) })
  }

  // Condition actions
  const addCondition = () => {
    setConditions(prev => [...prev, { type: 'event_name', value: '', sequence: 'anytime' }])
  }

  const updateCondition = (i: number, patch: Partial<HiveCondition>) => {
    setConditions(prev => prev.map((c, j) => j === i ? { ...c, ...patch } : c))
  }

  const removeCondition = (i: number) => {
    const next = conditions.filter((_, j) => j !== i)
    setConditions(next)
    if (next.length === 0) clearFilter()
  }

  const clearFilter = () => {
    setConditions([])
    setFilterActive(false)
  }

  // Debounced auto-apply: wait 600ms after the user stops typing
  const debounceRef = useRef<ReturnType<typeof setTimeout>>()
  useEffect(() => {
    clearTimeout(debounceRef.current)
    if (conditions.length > 0 && conditions.every(c => c.value.trim())) {
      debounceRef.current = setTimeout(() => applyFilter(), 600)
    }
    return () => clearTimeout(debounceRef.current)
  }, [conditions, siteId])

  // Colony actions
  const countColony = (id: string) => {
    setCountLoading(prev => ({ ...prev, [id]: true }))
    fetch(`/api/hives/${id}/count`)
      .then(r => r.json())
      .then(d => setColonyCounts(prev => ({ ...prev, [id]: d.count })))
      .catch(() => {})
      .finally(() => setCountLoading(prev => ({ ...prev, [id]: false })))
  }

  const deleteColony = (id: string) => {
    if (!confirm('Delete this colony?')) return
    fetch(`/api/hives/${id}`, { method: 'DELETE' })
      .then(() => setColonies(c => c.filter(x => x.id !== id)))
      .catch(() => {})
  }

  const openSaveModal = () => {
    setColonyName('')
    setSaveError('')
    setShowSaveModal(true)
  }

  const saveColony = () => {
    if (!colonyName.trim()) { setSaveError('Name is required'); return }
    if (conditions.some(c => !c.value.trim())) { setSaveError('All conditions need a value'); return }
    setSaving(true)
    setSaveError('')
    fetch('/api/hives', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: colonyName.trim(), conditions, site_id: siteId || null }),
    })
      .then(r => { if (!r.ok) throw new Error(); return r.json() })
      .then(h => { setColonies(prev => [h, ...prev]); setShowSaveModal(false) })
      .catch(() => setSaveError('Failed to save'))
      .finally(() => setSaving(false))
  }

  // Load a colony's conditions into the filter
  const loadColonyFilter = (colony: Hive) => {
    setConditions(colony.conditions)
    setFilterActive(true)
    setJourney(null)
  }

  const sessions = journey ? groupBySession(journey.events) : []

  return (
    <>
      {/* Search + UUID list */}
      <div className="card" style={{ marginBottom: 16, overflow: 'hidden' }}>
        <div style={{ padding: '12px 20px', borderBottom: '1px solid var(--border)', display: 'flex', gap: 8, alignItems: 'center' }}>
          <input
            className="input"
            placeholder="Search UUIDs..."
            value={uuidSearch}
            onChange={e => setUuidSearch(e.target.value)}
            style={{ flex: 1, fontFamily: 'monospace', fontSize: 12 }}
          />
          <span style={{ fontSize: 12, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
            {totalUuids.toLocaleString()} visitor{totalUuids !== 1 ? 's' : ''}
          </span>
        </div>
        {filterActive && (
          <div style={{ padding: '6px 20px', background: 'var(--primary-light)', fontSize: 12, color: 'var(--primary-dark)', fontWeight: 600 }}>
            {filterLoading ? 'Searching...' : `${totalUuids.toLocaleString()} matching visitor${totalUuids !== 1 ? 's' : ''}`}
          </div>
        )}
        <div ref={listRef} onScroll={handleScroll} style={{ maxHeight: 400, overflowY: 'auto' }}>
          {uuids.map(u => (
            <div
              key={u.uuid + u.site_id}
              className={`uuid-list-item${journey?.uuid === u.uuid ? ' active' : ''}`}
              onClick={() => loadJourney(u.uuid)}
              style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
            >
              <div>
                <div className="text-mono" style={{ fontSize: 12 }}>{u.uuid}</div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
                  {u.site_name} · {formatTs(u.last_seen)}
                </div>
              </div>
            </div>
          ))}
          {loadingMore && (
            <div style={{ padding: 12, textAlign: 'center' }}>
              <span className="spinner" style={{ width: 16, height: 16 }} />
            </div>
          )}
          {uuids.length === 0 && !filterLoading && (
            <div style={{ padding: 20, textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
              {filterActive ? 'No matches' : 'No visitors'}
            </div>
          )}
        </div>
      </div>

      {/* Filter conditions */}
      <div className="card" style={{ marginBottom: 16, overflow: 'hidden' }}>
        <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span>Filter conditions</span>
          <div style={{ display: 'flex', gap: 6 }}>
            {filterActive && conditions.length > 0 && (
              <button className="btn btn-primary" onClick={openSaveModal} style={{ padding: '4px 12px', fontSize: 12 }}>
                Save as Colony
              </button>
            )}
            {conditions.length === 0 && (
              <button className="btn btn-ghost" onClick={addCondition} style={{ padding: '4px 10px', fontSize: 12 }}>
                + Add
              </button>
            )}
          </div>
        </div>
        {conditions.length > 0 && (
          <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {conditions.map((c, i) => (
              <div key={i}>
                {i > 0 && (
                  <select
                    className="select"
                    value={c.sequence}
                    onChange={e => updateCondition(i, { sequence: e.target.value as HiveSequence })}
                    style={{ fontSize: 12, width: '100%', marginBottom: 6 }}
                  >
                    {SEQUENCE_OPTIONS.map(o => (
                      <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                  </select>
                )}
                <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  <select
                    className="select"
                    value={c.type}
                    onChange={e => updateCondition(i, { type: e.target.value as HiveConditionType })}
                    style={{ fontSize: 12 }}
                  >
                    {CONDITION_TYPES.map(t => (
                      <option key={t.value} value={t.value}>{t.label}</option>
                    ))}
                  </select>
                  <input
                    className="input"
                    placeholder={placeholderFor(c.type)}
                    value={c.value}
                    onChange={e => updateCondition(i, { value: e.target.value })}
                    onKeyDown={e => e.key === 'Enter' && applyFilter()}
                    style={{ flex: 1, fontSize: 12, minWidth: 0 }}
                  />
                  <button className="btn btn-ghost" onClick={() => removeCondition(i)} style={{ padding: '4px 8px', fontSize: 12 }}>✕</button>
                </div>
              </div>
            ))}
            <div style={{ display: 'flex', gap: 6, justifyContent: 'space-between' }}>
              <button className="btn btn-ghost" onClick={addCondition} style={{ padding: '4px 10px', fontSize: 12 }}>+ Add</button>
              <div style={{ display: 'flex', gap: 6 }}>
                {filterActive && (
                  <button className="btn btn-ghost" onClick={clearFilter} style={{ padding: '4px 10px', fontSize: 12 }}>Clear</button>
                )}
                <button
                  className="btn btn-primary"
                  onClick={applyFilter}
                  disabled={filterLoading || conditions.some(c => !c.value.trim())}
                  style={{ padding: '4px 12px', fontSize: 12 }}
                >
                  {filterLoading ? <span className="spinner" style={{ width: 14, height: 14 }} /> : 'Search'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Journey modal */}
      {(journey || journeyLoading) && (
        <div className="modal-overlay" onClick={e => { if (e.target === e.currentTarget && !journeyLoading) setJourney(null) }}>
          <div className="modal" style={{ maxWidth: 700 }}>
            {journeyLoading ? (
              <div style={{ textAlign: 'center', padding: 40 }}>
                <span className="spinner" />
              </div>
            ) : journeyError ? (
              <>
                <div style={{ color: 'var(--error)', fontSize: 13, marginBottom: 12 }}>{journeyError}</div>
                <button className="btn" onClick={() => { setJourney(null); setJourneyError('') }}>Close</button>
              </>
            ) : journey && journey.events.length > 0 ? (
              <>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                  <div>
                    <span className="text-mono" style={{ fontSize: 13 }}>{journey.uuid}</span>
                    <span style={{ color: 'var(--text-muted)', marginLeft: 10, fontSize: 13 }}>{journey.events.length} events</span>
                  </div>
                  <button className="btn btn-ghost" onClick={() => setJourney(null)} style={{ padding: '4px 10px' }}>✕</button>
                </div>
                <div style={{ maxHeight: '70vh', overflowY: 'auto' }}>
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
              </>
            ) : (
              <>
                <div style={{ textAlign: 'center', padding: 20, color: 'var(--text-muted)' }}>No events found</div>
                <button className="btn" onClick={() => setJourney(null)}>Close</button>
              </>
            )}
          </div>
        </div>
      )}

      {/* Saved colonies */}
      <div style={{ marginTop: 32 }}>
        <h3 style={{ fontSize: 16, fontWeight: 700, marginBottom: 12 }}>Saved Colonies</h3>
        {colonies.length === 0 && (
          <div style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)', fontSize: 13 }}>
            No colonies yet — use the filter above and save one
          </div>
        )}
        {colonies.map(h => (
          <div key={h.id} className="card" style={{ marginBottom: 12 }}>
            <div className="card-header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span>{h.name}</span>
                <span className="badge-amber">{h.conditions.length} condition{h.conditions.length !== 1 ? 's' : ''}</span>
                {colonyCounts[h.id] !== undefined && (
                  <span style={{ fontSize: 13, color: 'var(--text-secondary)', fontWeight: 400 }}>
                    {colonyCounts[h.id].toLocaleString()} visitor{colonyCounts[h.id] !== 1 ? 's' : ''}
                  </span>
                )}
              </div>
              <div style={{ display: 'flex', gap: 4 }}>
                <button className="btn" onClick={() => loadColonyFilter(h)} style={{ fontSize: 12, padding: '4px 10px' }}>
                  Load
                </button>
                <button className="btn" onClick={() => countColony(h.id)} disabled={countLoading[h.id]} style={{ fontSize: 12, padding: '4px 10px' }}>
                  {countLoading[h.id] ? <span className="spinner" style={{ width: 14, height: 14 }} /> : 'Count'}
                </button>
                <button className="btn btn-danger" onClick={() => deleteColony(h.id)} style={{ fontSize: 12, padding: '4px 10px' }}>Delete</button>
              </div>
            </div>
            <div className="card-body" style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {h.conditions.map((c, i) => (
                <div key={i} style={{
                  background: 'var(--surface-raised)',
                  border: '1px solid var(--border-subtle)',
                  borderRadius: 'var(--radius-sm)',
                  padding: '6px 10px',
                  fontSize: 12,
                }}>
                  {i > 0 && (
                    <span style={{ fontSize: 10, textTransform: 'uppercase', color: 'var(--text-muted)', marginRight: 4 }}>
                      {c.sequence === 'immediately' ? 'then' : 'later'}
                    </span>
                  )}
                  <span style={{ color: 'var(--text-secondary)' }}>
                    {CONDITION_TYPES.find(t => t.value === c.type)?.label}
                  </span>{' '}
                  <span className="text-mono" style={{ fontWeight: 600 }}>"{c.value}"</span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* Save modal */}
      {showSaveModal && (
        <div className="modal-overlay" onClick={e => e.target === e.currentTarget && setShowSaveModal(false)}>
          <div className="modal">
            <h2>Save as Colony</h2>
            <div style={{ marginBottom: 16 }}>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 4 }}>Name</label>
              <input
                className="input"
                style={{ width: '100%' }}
                placeholder="e.g. Blog readers who signed up"
                value={colonyName}
                onChange={e => setColonyName(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && saveColony()}
                autoFocus
              />
            </div>
            <div style={{ marginBottom: 16 }}>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 8 }}>Conditions</label>
              {conditions.map((c, i) => (
                <div key={i} style={{
                  background: 'var(--surface-raised)',
                  border: '1px solid var(--border-subtle)',
                  borderRadius: 'var(--radius-sm)',
                  padding: '8px 12px',
                  marginBottom: 6,
                  fontSize: 12,
                }}>
                  {i > 0 && (
                    <div style={{ fontSize: 10, textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: 2 }}>
                      {c.sequence === 'immediately' ? 'immediately followed by' : 'any time later'}
                    </div>
                  )}
                  <span style={{ color: 'var(--text-secondary)' }}>
                    {CONDITION_TYPES.find(t => t.value === c.type)?.label}
                  </span>{' '}
                  <span className="text-mono" style={{ fontWeight: 600 }}>"{c.value}"</span>
                </div>
              ))}
            </div>
            {saveError && (
              <div style={{ color: 'var(--error)', fontSize: 13, marginBottom: 12 }}>{saveError}</div>
            )}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button className="btn" onClick={() => setShowSaveModal(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={saveColony} disabled={saving}>
                {saving ? 'Saving...' : 'Save Colony'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
