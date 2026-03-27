import { useCallback, useEffect, useRef, useState } from 'react'
import type { Hive, Journey, JourneyEvent, Pollination, PollinationCount, UuidRow } from '../types'

const PAGE_SIZE = 100

function formatTs(ts: string) {
  return new Date(ts).toLocaleString()
}

function uuidSubline(u: UuidRow) {
  const events = u.first_custom_event
    ? u.custom_event_count > 1
      ? `${u.first_custom_event} +${u.custom_event_count - 1} more`
      : u.first_custom_event
    : null
  return [
    u.site_name,
    `Active ${formatTs(u.last_seen)}`,
    `${u.page_count} page${u.page_count !== 1 ? 's' : ''}`,
    `${u.session_count} session${u.session_count !== 1 ? 's' : ''}`,
    events,
  ].filter(Boolean).join(' · ')
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

function VennDiagram({ a, b, overlap, nameA, nameB, uid }: {
  a: number; b: number; overlap: number; nameA: string; nameB: string; uid: string
}) {
  const VW = 500, VH = 250, CY = 115
  const MAX_R = 88, MIN_R = 40
  const maxCount = Math.max(a, b, 1)
  const ra = MIN_R + (MAX_R - MIN_R) * Math.sqrt(a / maxCount)
  const rb = MIN_R + (MAX_R - MIN_R) * Math.sqrt(b / maxCount)
  const overlapRatio = (a > 0 && b > 0) ? Math.min(overlap / Math.min(a, b), 1) : 0
  const dist = Math.max((ra + rb) * (1 - overlapRatio * 0.75), Math.abs(ra - rb) + 2)
  const cxa = VW / 2 - dist / 2
  const cxb = VW / 2 + dist / 2
  const clipId = `venn-clip-${uid}`
  const labelY = CY + MAX_R + 22
  const truncate = (s: string, n: number) => s.length > n ? s.slice(0, n - 1) + '…' : s

  return (
    <svg viewBox={`0 0 ${VW} ${VH}`} width="100%" style={{ display: 'block' }} preserveAspectRatio="xMidYMid meet">
      <defs>
        <clipPath id={clipId}>
          <circle cx={cxa} cy={CY} r={ra} />
        </clipPath>
      </defs>
      {/* Circle A */}
      <circle cx={cxa} cy={CY} r={ra} fill="var(--primary)" fillOpacity={0.15} stroke="var(--primary)" strokeWidth={1.5} />
      {/* Circle B */}
      <circle cx={cxb} cy={CY} r={rb} fill="var(--primary-dark)" fillOpacity={0.12} stroke="var(--primary-dark)" strokeWidth={1.5} />
      {/* Intersection — golden yellow, circle B clipped to circle A */}
      {overlapRatio > 0 && (
        <circle cx={cxb} cy={CY} r={rb} fill="#f59e0b" fillOpacity={0.55} stroke="none" clipPath={`url(#${clipId})`} />
      )}
      {/* Colony name labels */}
      <text x={cxa} y={labelY} textAnchor="middle" fontSize={13} fontWeight={600} fill="var(--text-secondary)">
        {truncate(nameA, 20)}
      </text>
      <text x={cxb} y={labelY} textAnchor="middle" fontSize={13} fontWeight={600} fill="var(--text-secondary)">
        {truncate(nameB, 20)}
      </text>
    </svg>
  )
}

export default function Pollinate({ siteId, siteName, startDate, endDate, coloniesVersion }: {
  siteId: string; siteName: string | null; startDate: string; endDate: string; coloniesVersion?: number
}) {
  const [pollinations, setPollinations] = useState<Pollination[]>([])
  const [counts, setCounts] = useState<Record<string, PollinationCount>>({})
  const [countLoading, setCountLoading] = useState<Record<string, boolean>>({})
  const [colonies, setColonies] = useState<Hive[]>([])

  // Collapsible cards + overlap UUIDs
  const [expandedPol, setExpandedPol] = useState<string | null>(null)
  const [overlapUuids, setOverlapUuids] = useState<Record<string, UuidRow[]>>({})
  const [overlapUuidLoading, setOverlapUuidLoading] = useState<Record<string, boolean>>({})
  const [overlapLoadingMore, setOverlapLoadingMore] = useState(false)
  const overlapListRef = useRef<HTMLDivElement>(null)

  // Journey modal
  const [journey, setJourney] = useState<Journey | null>(null)
  const [journeyLoading, setJourneyLoading] = useState(false)
  const [journeyError, setJourneyError] = useState('')

  // Create form
  const [showCreate, setShowCreate] = useState(false)
  const [formName, setFormName] = useState('')
  const [formHiveA, setFormHiveA] = useState('')
  const [formHiveB, setFormHiveB] = useState('')
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState('')

  const title = siteName ? `Pollinations — ${siteName}` : 'Pollinations — All Sites'

  // ── Fetch colonies for dropdowns ──────────────────────────────────────────
  useEffect(() => {
    const p = new URLSearchParams()
    if (siteId) p.set('site_id', siteId)
    fetch(`/api/hives?${p}`)
      .then(r => r.json())
      .then((data: Hive[]) => {
        setColonies(data)
        setFormHiveA('')
        setFormHiveB('')
      })
      .catch(() => {})
  }, [siteId, coloniesVersion])

  // ── Fetch pollinations ────────────────────────────────────────────────────
  const fetchPollinations = useCallback(() => {
    const p = new URLSearchParams()
    if (siteId) p.set('site_id', siteId)
    fetch(`/api/pollinations?${p}`)
      .then(r => r.json())
      .then((data: Pollination[]) => setPollinations(data))
      .catch(() => {})
  }, [siteId])

  useEffect(() => { fetchPollinations() }, [fetchPollinations])

  // Re-fetch when a colony was created/deleted externally
  useEffect(() => {
    if (coloniesVersion === undefined || coloniesVersion === 0) return
    fetchPollinations()
  }, [coloniesVersion]) // eslint-disable-line react-hooks/exhaustive-deps

  // Close expanded card if its pollination was cascade-deleted
  useEffect(() => {
    if (expandedPol && !pollinations.find(p => p.id === expandedPol))
      setExpandedPol(null)
  }, [pollinations, expandedPol])

  // ── Count all pollinations ────────────────────────────────────────────────
  const countPollination = useCallback((id: string) => {
    setCountLoading(prev => ({ ...prev, [id]: true }))
    const p = new URLSearchParams()
    if (startDate) p.set('start', startDate)
    if (endDate) p.set('end', endDate)
    fetch(`/api/pollinations/${id}/count?${p}`)
      .then(r => r.json())
      .then((data: PollinationCount) => setCounts(prev => ({ ...prev, [id]: data })))
      .catch(() => {})
      .finally(() => setCountLoading(prev => ({ ...prev, [id]: false })))
  }, [startDate, endDate])

  // Dates changed — invalidate all cached data, re-fetch the open card if any
  useEffect(() => {
    setCounts({})
    setOverlapUuids({})
    if (!expandedPol) return
    countPollination(expandedPol)
    fetchOverlapUuids(expandedPol, 0, false)
  }, [startDate, endDate]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Overlap UUID fetch ────────────────────────────────────────────────────
  const fetchOverlapUuids = useCallback((id: string, offset: number, append: boolean) => {
    if (append) setOverlapLoadingMore(true)
    else setOverlapUuidLoading(prev => ({ ...prev, [id]: true }))
    const p = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String(offset) })
    if (startDate) p.set('start', startDate)
    if (endDate) p.set('end', endDate)
    fetch(`/api/pollinations/${id}/overlap-uuids?${p}`)
      .then(r => r.json())
      .then((data: { total: number; items: UuidRow[] }) => {
        setOverlapUuids(prev => ({ ...prev, [id]: append ? [...(prev[id] ?? []), ...data.items] : data.items }))
      })
      .catch(() => {})
      .finally(() => {
        setOverlapUuidLoading(prev => ({ ...prev, [id]: false }))
        setOverlapLoadingMore(false)
      })
  }, [startDate, endDate])

  const isLive = endDate === new Date().toISOString().slice(0, 10)

  const togglePol = (id: string) => {
    if (expandedPol === id) {
      setExpandedPol(null)
    } else {
      setExpandedPol(id)
      if (!counts[id] || isLive) countPollination(id)
      if (!overlapUuids[id] || isLive) fetchOverlapUuids(id, 0, false)
    }
  }

  // ── Infinite scroll for overlap UUIDs ────────────────────────────────────
  const handleOverlapScroll = useCallback(() => {
    const el = overlapListRef.current
    if (!el || overlapLoadingMore || !expandedPol) return
    const list = overlapUuids[expandedPol] ?? []
    const count = counts[expandedPol]
    const total = count?.overlap ?? 0
    if (list.length >= total) return
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 40) {
      fetchOverlapUuids(expandedPol, list.length, true)
    }
  }, [overlapLoadingMore, expandedPol, overlapUuids, counts, fetchOverlapUuids])

  // ── Journey ───────────────────────────────────────────────────────────────
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

  // ── Save ──────────────────────────────────────────────────────────────────
  const save = async () => {
    if (!formName.trim() || !formHiveA || !formHiveB) return
    setSaving(true)
    setSaveError('')
    try {
      const res = await fetch('/api/pollinations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: formName.trim(),
          site_id: siteId || null,
          hive_a_id: formHiveA,
          hive_b_id: formHiveB,
        }),
      })
      if (!res.ok) { setSaveError('Failed to save'); return }
      const newPol: Pollination = await res.json()
      setPollinations(prev => [newPol, ...prev])
      setFormName(''); setFormHiveA(''); setFormHiveB(''); setShowCreate(false)
      setExpandedPol(newPol.id)
      countPollination(newPol.id)
      fetchOverlapUuids(newPol.id, 0, false)
    } catch { setSaveError('Failed to save') }
    finally { setSaving(false) }
  }

  const deletePollination = async (id: string) => {
    await fetch(`/api/pollinations/${id}`, { method: 'DELETE' })
    setPollinations(prev => prev.filter(p => p.id !== id))
    setCounts(prev => { const n = { ...prev }; delete n[id]; return n })
    if (expandedPol === id) setExpandedPol(null)
  }

  const colonyName = (id: string) => colonies.find(c => c.id === id)?.name ?? id
  const canSave = formName.trim() && formHiveA && formHiveB && formHiveA !== formHiveB

  const sessions = journey ? groupBySession(journey.events) : []

  return (
    <div>
      {/* Header */}
      <div style={{ marginBottom: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <h2 style={{ fontSize: 20, fontWeight: 700 }}>{title}</h2>
          <button
            className="btn btn-primary"
            onClick={() => { setShowCreate(s => !s); setSaveError('') }}
            style={{ padding: '6px 14px', fontSize: 13 }}
          >
            Cross-pollinate +
          </button>
        </div>
        <p style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 6, maxWidth: 560 }}>
          Pollinations compare two colonies to reveal how much their audiences overlap. Pick any two saved colonies to see shared visitors, unique counts, and browse who's in both.
        </p>
      </div>

      {/* Creator */}
      {showCreate && (
        <div className="card" style={{ marginBottom: 20, padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ fontWeight: 600, fontSize: 14 }}>New cross-pollination</div>
          <input
            className="input"
            placeholder="Name this comparison"
            value={formName}
            onChange={e => setFormName(e.target.value)}
            style={{ fontSize: 13 }}
          />
          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            <select
              className="select"
              value={formHiveA}
              onChange={e => setFormHiveA(e.target.value)}
              style={{ flex: 1, fontSize: 13 }}
            >
              <option value="">Colony A…</option>
              {colonies.map(c => (
                <option key={c.id} value={c.id} disabled={c.id === formHiveB}>{c.name}</option>
              ))}
            </select>
            <span style={{ color: 'var(--text-muted)', fontWeight: 700, fontSize: 13 }}>vs</span>
            <select
              className="select"
              value={formHiveB}
              onChange={e => setFormHiveB(e.target.value)}
              style={{ flex: 1, fontSize: 13 }}
            >
              <option value="">Colony B…</option>
              {colonies.map(c => (
                <option key={c.id} value={c.id} disabled={c.id === formHiveA}>{c.name}</option>
              ))}
            </select>
          </div>
          {saveError && <div style={{ fontSize: 12, color: 'var(--error)' }}>{saveError}</div>}
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn btn-primary" onClick={save} disabled={saving || !canSave} style={{ fontSize: 13, padding: '6px 16px' }}>
              {saving ? 'Saving…' : 'Save'}
            </button>
            <button className="btn btn-ghost" onClick={() => setShowCreate(false)} style={{ fontSize: 13 }}>Cancel</button>
          </div>
        </div>
      )}

      {/* Saved pollinations header + empty state */}
      <div style={{ marginTop: 8 }}>
        <h3 style={{ fontSize: 16, fontWeight: 700, marginBottom: 12 }}>🌼 Saved Pollinations</h3>
        {pollinations.length === 0 && !showCreate && (
          <div style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)', fontSize: 13 }}>
            🌼 No pollinations saved yet — cross-pollinate two colonies to compare their audiences
          </div>
        )}
      </div>

      {/* Pollination cards */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {pollinations.map(pol => {
          const c = counts[pol.id]
          const loading = countLoading[pol.id]
          const nameA = colonyName(pol.hive_a_id)
          const nameB = colonyName(pol.hive_b_id)
          const isOpen = expandedPol === pol.id
          const uuidList = overlapUuids[pol.id] ?? []
          const uuidLoading = overlapUuidLoading[pol.id] ?? false
          const pctA = c && c.a_count > 0 ? Math.round((c.overlap / c.a_count) * 100) : null
          const pctB = c && c.b_count > 0 ? Math.round((c.overlap / c.b_count) * 100) : null

          return (
            <div key={pol.id} className="card" style={{ overflow: 'hidden' }}>
              {/* Collapsed header — always visible */}
              <div
                style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 16px', cursor: 'pointer', userSelect: 'none' }}
                onClick={() => togglePol(pol.id)}
              >
                <div style={{
                  width: 20, height: 20, display: 'flex', alignItems: 'center', justifyContent: 'center',
                  borderRadius: 4, flexShrink: 0, fontSize: 10,
                  background: isOpen ? 'var(--primary-light)' : '#f1f5f9',
                  color: isOpen ? 'var(--primary)' : 'var(--text-muted)',
                }}>
                  {uuidLoading ? '…' : isOpen ? '▼' : '▶'}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <span style={{ fontWeight: 600, fontSize: 13 }}>{pol.name}</span>
                    {c && (
                      <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                        {loading
                          ? <span className="spinner" style={{ width: 12, height: 12, display: 'inline-block' }} />
                          : `${c.overlap.toLocaleString()} in common`}
                      </span>
                    )}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
                    {nameA} vs {nameB} · saved {formatTs(pol.created_at)}
                  </div>
                </div>
                <div style={{ flexShrink: 0 }} onClick={e => e.stopPropagation()}>
                  <button
                    className="btn btn-danger"
                    onClick={() => deletePollination(pol.id)}
                    style={{ fontSize: 12, padding: '4px 10px' }}
                  >
                    Delete
                  </button>
                </div>
              </div>

              {/* Expanded content */}
              {isOpen && (
                <div style={{ borderTop: '1px solid var(--border)' }}>
                  {loading || !c ? (
                    <div style={{ padding: 32, textAlign: 'center' }}>
                      <span className="spinner" style={{ width: 20, height: 20 }} />
                    </div>
                  ) : (
                    <>
                      {/* Venn (left) + stats (right) */}
                      <div style={{ padding: '20px 16px 16px', display: 'flex', gap: 20, alignItems: 'center', flexWrap: 'wrap' }}>
                        {/* Responsive Venn */}
                        <div style={{ flex: '1 1 260px', minWidth: 0 }}>
                          <VennDiagram a={c.a_count} b={c.b_count} overlap={c.overlap} nameA={nameA} nameB={nameB} uid={pol.id} />
                        </div>

                        {/* Stats panel */}
                        <div style={{ flex: '1 1 200px', display: 'flex', flexDirection: 'column', gap: 8 }}>
                          {/* Colony A */}
                          <div style={{ padding: '10px 14px', background: 'var(--surface-raised)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)' }}>
                            <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>
                              {nameA}
                            </div>
                            <div style={{ fontSize: 22, fontWeight: 700, lineHeight: 1 }}>{c.a_count.toLocaleString()}</div>
                            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
                              {c.a_only.toLocaleString()} only here
                            </div>
                          </div>

                          {/* Overlap */}
                          <div style={{ padding: '10px 14px', background: '#fffbeb', borderRadius: 'var(--radius-sm)', border: '1px solid #fcd34d' }}>
                            <div style={{ fontSize: 10, fontWeight: 600, color: '#92400e', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>
                              Overlap
                            </div>
                            <div style={{ fontSize: 22, fontWeight: 700, lineHeight: 1, color: '#d97706' }}>{c.overlap.toLocaleString()}</div>
                            {(pctA !== null || pctB !== null) && (
                              <div style={{ fontSize: 11, color: '#92400e', marginTop: 4, display: 'flex', flexDirection: 'column', gap: 1 }}>
                                {pctA !== null && <span>{pctA}% of {nameA}</span>}
                                {pctB !== null && <span>{pctB}% of {nameB}</span>}
                              </div>
                            )}
                          </div>

                          {/* Colony B */}
                          <div style={{ padding: '10px 14px', background: 'var(--surface-raised)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)' }}>
                            <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>
                              {nameB}
                            </div>
                            <div style={{ fontSize: 22, fontWeight: 700, lineHeight: 1 }}>{c.b_count.toLocaleString()}</div>
                            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
                              {c.b_only.toLocaleString()} only here
                            </div>
                          </div>
                        </div>
                      </div>

                      {/* Overlap UUID list */}
                      {c.overlap > 0 && (
                        <div style={{ borderTop: '1px solid var(--border)' }}>
                          <div style={{ padding: '8px 16px', fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                            {c.overlap.toLocaleString()} overlapping visitor{c.overlap !== 1 ? 's' : ''}
                          </div>
                          {uuidLoading ? (
                            <div style={{ padding: 20, textAlign: 'center' }}>
                              <span className="spinner" style={{ width: 16, height: 16 }} />
                            </div>
                          ) : (
                            <div ref={overlapListRef} onScroll={handleOverlapScroll} style={{ maxHeight: 360, overflowY: 'auto' }}>
                              {uuidList.map(u => (
                                <div
                                  key={u.uuid + u.site_id}
                                  className={`uuid-list-item${journey?.uuid === u.uuid ? ' active' : ''}`}
                                  onClick={() => loadJourney(u.uuid)}
                                  style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
                                >
                                  <div>
                                    <div className="text-mono" style={{ fontSize: 12 }}>{u.uuid}</div>
                                    <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>{uuidSubline(u)}</div>
                                  </div>
                                </div>
                              ))}
                              {overlapLoadingMore && (
                                <div style={{ padding: 12, textAlign: 'center' }}>
                                  <span className="spinner" style={{ width: 16, height: 16 }} />
                                </div>
                              )}
                              {uuidList.length === 0 && !uuidLoading && (
                                <div style={{ padding: 20, textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>No visitors</div>
                              )}
                            </div>
                          )}
                        </div>
                      )}
                    </>
                  )}
                </div>
              )}
            </div>
          )
        })}
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
                    <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', marginRight: 4 }}>bee_id:</span>
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
                              {ev.event_name === 'page_view' ? (
                                <span className="text-mono" style={{ color: 'var(--text-secondary)' }}>
                                  {ev.page_path}
                                </span>
                              ) : (
                                <span className="badge-amber">{ev.event_name}</span>
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
    </div>
  )
}
