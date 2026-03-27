import { useCallback, useEffect, useRef, useState } from 'react'
import type { Journey, JourneyEvent, UuidRow, Hive, ConditionRow, ConditionStep, HiveConditionField, HiveConditionMatch, HiveSequence, StepOperator } from '../types'

const PAGE_SIZE = 100

const CONDITION_FIELDS: { value: HiveConditionField; label: string; placeholder: string }[] = [
  { value: 'event_name',    label: 'Action',        placeholder: 'e.g. signup' },
  { value: 'page_path',     label: 'Page path',     placeholder: 'e.g. /pricing' },
  { value: 'entry_page',    label: 'Entry page',    placeholder: 'e.g. /blog/getting-started' },
  { value: 'page_referrer', label: 'Page referrer', placeholder: 'e.g. google.com' },
]

// Cross-field companions (self-compatibility is handled separately by match type below).
const FIELD_COMPANIONS: Record<HiveConditionField, HiveConditionField[]> = {
  entry_page:    ['page_referrer'],
  event_name:    [],
  page_path:     ['page_referrer'],
  page_referrer: ['entry_page', 'page_path'],
}

/** Effective companions for a row: cross-field companions + self if non-exact match. */
function rowCompanions(row: ConditionRow): Set<HiveConditionField> {
  const isExact = row.match === 'is' || row.match === 'is_not'
  const s = new Set<HiveConditionField>(FIELD_COMPANIONS[row.field])
  if (!isExact) s.add(row.field)  // contains / does_not_contain → same field can repeat
  return s
}

/**
 * If sibling rows in the step (AND only) use the same field with non-exact match,
 * this row must also be non-exact — can't mix "contains" and "is" for the same field in AND.
 * OR steps have no restriction: each condition is evaluated independently.
 */
function allowedMatchesForRow(step: ConditionStep, rowIdx: number): HiveConditionMatch[] {
  if (step.operator === 'or') return ['is', 'is_not', 'contains', 'does_not_contain']
  const field = step.conditions[rowIdx].field
  const siblings = step.conditions.filter((_, i) => i !== rowIdx && _.field === field)
  const siblingNonExact = siblings.some(r => r.match === 'contains' || r.match === 'does_not_contain')
  return siblingNonExact ? ['contains', 'does_not_contain'] : ['is', 'is_not', 'contains', 'does_not_contain']
}

/** Returns the fields that are compatible for a given row position, given the other rows in the step. */
function allowedFieldsForStep(step: ConditionStep, si: number, excludeIdx?: number): HiveConditionField[] {
  const all: HiveConditionField[] = ['event_name', 'page_path', 'entry_page', 'page_referrer']
  const base = si === 0 ? all : all.filter(f => f !== 'entry_page')
  // OR steps: conditions are evaluated independently, so any field combination is valid.
  if (step.operator === 'or') return base
  // AND steps: all conditions must match the same event — apply intersection rules.
  const others = step.conditions.filter((_, i) => i !== excludeIdx)
  if (others.length === 0) return base
  let allowed = new Set<HiveConditionField>(base)
  for (const row of others) {
    const companions = rowCompanions(row)
    allowed = new Set([...allowed].filter(f => companions.has(f)))
  }
  return [...allowed]
}

const MATCH_OPTIONS: { value: HiveConditionMatch; label: string }[] = [
  { value: 'is',               label: 'is' },
  { value: 'is_not',           label: 'is not' },
  { value: 'contains',         label: 'contains' },
  { value: 'does_not_contain', label: 'does not contain' },
]

const SEQUENCE_OPTIONS: { value: HiveSequence; label: string }[] = [
  { value: 'immediately',  label: 'immediately after' },
  { value: 'next_session', label: 'in the next session' },
  { value: 'anytime',      label: 'any time later' },
]

function placeholderFor(field: HiveConditionField) {
  return CONDITION_FIELDS.find(f => f.value === field)?.placeholder ?? ''
}

function formatTs(ts: string) {
  return new Date(ts).toLocaleString()
}

function stepsSummary(steps: ConditionStep[]): string {
  return steps.map((step, si) => {
    const rows = step.conditions.map(c => {
      const field = CONDITION_FIELDS.find(f => f.value === c.field)?.label ?? c.field
      const match = MATCH_OPTIONS.find(m => m.value === c.match)?.label ?? c.match
      return `${field} ${match} "${c.value}"`
    }).join(` ${step.operator.toUpperCase()} `)
    if (si === 0) return rows
    const seq = SEQUENCE_OPTIONS.find(s => s.value === step.sequence)?.label ?? step.sequence
    return `${seq}: ${rows}`
  }).join(' · ')
}

function uuidSubline(u: { site_name: string; last_seen: string; session_count: number; page_count: number; first_custom_event: string | null; custom_event_count: number }) {
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

const newRow = (): ConditionRow => ({ field: 'event_name', match: 'is', value: '' })
const newStep = (sequence: HiveSequence = 'anytime'): ConditionStep => ({
  sequence,
  operator: 'and',
  conditions: [newRow()],
})

export default function Colonies({ siteId, siteName, startDate, endDate, onColonyMutated }: {
  siteId: string; siteName: string | null; startDate: string; endDate: string; onColonyMutated?: () => void
}) {
  // UUID search + list
  const [uuids, setUuids] = useState<UuidRow[]>([])
  const [totalUuids, setTotalUuids] = useState(0)
  const [uuidSearch, setUuidSearch] = useState('')
  const [loadingMore, setLoadingMore] = useState(false)
  const [uuidsLoading, setUuidsLoading] = useState(true)
  const [journey, setJourney] = useState<Journey | null>(null)
  const [journeyLoading, setJourneyLoading] = useState(false)
  const [journeyError, setJourneyError] = useState('')
  const listRef = useRef<HTMLDivElement>(null)

  // Steps filter
  const [steps, setSteps] = useState<ConditionStep[]>([])
  const [filterActive, setFilterActive] = useState(false)
  const [filterLoading, setFilterLoading] = useState(false)

  // Saved colonies
  const [colonies, setColonies] = useState<Hive[]>([])
  const [colonyCounts, setColonyCounts] = useState<Record<string, number>>({})
  const [countLoading, setCountLoading] = useState<Record<string, boolean>>({})
  const [expandedColony, setExpandedColony] = useState<string | null>(null)
  const [colonyUuids, setColonyUuids] = useState<Record<string, UuidRow[]>>({})
  const [colonyUuidLoading, setColonyUuidLoading] = useState<Record<string, boolean>>({})
  const [colonyLoadingMore, setColonyLoadingMore] = useState(false)
  const colonyListRef = useRef<HTMLDivElement>(null)

  // Save modal
  const [showSaveModal, setShowSaveModal] = useState(false)
  const [colonyName, setColonyName] = useState('')
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState('')

  // ── Fetch UUIDs (default mode) ──────────────────────────────────────────
  const fetchUuids = useCallback((offset: number, append: boolean) => {
    if (filterActive) return
    if (append) setLoadingMore(true)
    else setUuidsLoading(true)
    const p = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String(offset) })
    if (siteId) p.set('site_id', siteId)
    if (uuidSearch) p.set('q', uuidSearch)
    if (startDate) p.set('start', startDate)
    if (endDate) p.set('end', endDate)
    fetch(`/api/uuids?${p}`)
      .then(r => r.json())
      .then((data: { total: number; items: UuidRow[] }) => {
        setTotalUuids(data.total)
        setUuids(prev => append ? [...prev, ...data.items] : data.items)
      })
      .catch(() => {})
      .finally(() => { setLoadingMore(false); setUuidsLoading(false) })
  }, [siteId, uuidSearch, filterActive, startDate, endDate])

  useEffect(() => {
    if (filterActive) return
    fetchUuids(0, false)
  }, [siteId, uuidSearch, filterActive, startDate, endDate])

  // ── Fetch filtered UUIDs ────────────────────────────────────────────────
  const fetchFiltered = useCallback((offset: number, append: boolean) => {
    if (append) setLoadingMore(true)
    else setFilterLoading(true)
    fetch('/api/journey/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ steps, site_id: siteId || null, limit: PAGE_SIZE, offset, start: startDate || null, end: endDate || null }),
    })
      .then(r => r.json())
      .then((data: { total: number; items: UuidRow[] }) => {
        setTotalUuids(data.total)
        setUuids(prev => append ? [...prev, ...data.items] : data.items)
      })
      .catch(() => { if (!append) setUuids([]) })
      .finally(() => { setFilterLoading(false); setLoadingMore(false) })
  }, [steps, siteId, startDate, endDate])

  const stepsValid = steps.length > 0 && steps.every(s => s.conditions.every(c => c.value.trim()))

  const applyFilter = useCallback(() => {
    if (!stepsValid) return
    setFilterActive(true)
    setJourney(null)
    fetchFiltered(0, false)
  }, [stepsValid, fetchFiltered])

  // ── Infinite scroll ─────────────────────────────────────────────────────
  const handleScroll = useCallback(() => {
    const el = listRef.current
    if (!el || loadingMore) return
    if (uuids.length >= totalUuids) return
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 40) {
      if (filterActive) fetchFiltered(uuids.length, true)
      else fetchUuids(uuids.length, true)
    }
  }, [loadingMore, uuids.length, totalUuids, filterActive, fetchFiltered, fetchUuids])

  // Count all colonies with current date range
  const countAll = useCallback((ids: string[], sd: string, ed: string) => {
    ids.forEach(id => {
      setCountLoading(prev => ({ ...prev, [id]: true }))
      const p = new URLSearchParams()
      if (sd) p.set('start', sd)
      if (ed) p.set('end', ed)
      fetch(`/api/hives/${id}/count?${p}`)
        .then(r => r.json())
        .then(d => setColonyCounts(prev => ({ ...prev, [id]: d.count })))
        .catch(() => {})
        .finally(() => setCountLoading(prev => ({ ...prev, [id]: false })))
    })
  }, [])

  // Load saved colonies and immediately count them
  const loadColonies = useCallback(() => {
    const p = new URLSearchParams()
    if (siteId) p.set('site_id', siteId)
    fetch(`/api/hives?${p}`)
      .then(r => r.json())
      .then((hives: Hive[]) => {
        setColonies(hives)
        countAll(hives.map(h => h.id), startDate, endDate)
      })
      .catch(() => {})
  }, [siteId, startDate, endDate, countAll])

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

  // Step / condition management
  const clearFilter = () => { setSteps([]); setFilterActive(false) }

  const addStep = () => setSteps(prev => [...prev, newStep()])

  const removeStep = (si: number) => {
    const next = steps.filter((_, i) => i !== si)
    setSteps(next)
    if (next.length === 0) setFilterActive(false)
  }

  const addRowToStep = (si: number, operator: StepOperator) => {
    setSteps(prev => prev.map((s, i) => {
      if (i !== si) return s
      const withOp = { ...s, operator }
      const allowed = allowedFieldsForStep(withOp, si)
      const field = allowed[0] ?? 'event_name'
      const hasNonExact = operator === 'and' && s.conditions.some(r => r.field === field && (r.match === 'contains' || r.match === 'does_not_contain'))
      const match: HiveConditionMatch = hasNonExact ? 'contains' : 'is'
      return { ...withOp, conditions: [...s.conditions, { field, match, value: '' }] }
    }))
  }

  const removeRowFromStep = (si: number, ci: number) => {
    setSteps(prev => {
      if (prev[si].conditions.length === 1) {
        const next = prev.filter((_, i) => i !== si)
        if (next.length === 0) setFilterActive(false)
        return next
      }
      return prev.map((s, i) => i === si
        ? { ...s, conditions: s.conditions.filter((_, j) => j !== ci) }
        : s
      )
    })
  }

  const updateRow = (si: number, ci: number, patch: Partial<ConditionRow>) => {
    setSteps(prev => prev.map((s, i) => i === si
      ? { ...s, conditions: s.conditions.map((c, j) => j === ci ? { ...c, ...patch } : c) }
      : s
    ))
  }

  const updateStepSequence = (si: number, sequence: HiveSequence) => {
    setSteps(prev => prev.map((s, i) => i === si ? { ...s, sequence } : s))
  }

  // Colony UUID fetch + accordion
  const fetchColonyUuids = useCallback((colony: Hive, offset: number, append: boolean) => {
    if (append) setColonyLoadingMore(true)
    else setColonyUuidLoading(prev => ({ ...prev, [colony.id]: true }))
    fetch('/api/journey/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        steps: colony.steps,
        site_id: colony.site_id || siteId || null,
        limit: PAGE_SIZE,
        offset,
        start: startDate || null,
        end: endDate || null,
      }),
    })
      .then(r => r.json())
      .then((data: { total: number; items: UuidRow[] }) => {
        setColonyUuids(prev => ({ ...prev, [colony.id]: append ? [...(prev[colony.id] ?? []), ...data.items] : data.items }))
        setColonyCounts(prev => ({ ...prev, [colony.id]: data.total }))
      })
      .catch(() => {})
      .finally(() => {
        setColonyUuidLoading(prev => ({ ...prev, [colony.id]: false }))
        setColonyLoadingMore(false)
      })
  }, [siteId, startDate, endDate])

  const isLive = endDate === new Date().toISOString().slice(0, 10)

  const toggleColony = (colony: Hive) => {
    if (expandedColony === colony.id) {
      setExpandedColony(null)
    } else {
      setExpandedColony(colony.id)
      if (!colonyUuids[colony.id] || isLive) fetchColonyUuids(colony, 0, false)
    }
  }

  const handleColonyScroll = useCallback(() => {
    const el = colonyListRef.current
    if (!el || colonyLoadingMore || !expandedColony) return
    const colony = colonies.find(h => h.id === expandedColony)
    if (!colony) return
    const list = colonyUuids[colony.id] ?? []
    const total = colonyCounts[colony.id] ?? 0
    if (list.length >= total) return
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 40) {
      fetchColonyUuids(colony, list.length, true)
    }
  }, [colonyLoadingMore, expandedColony, colonies, colonyUuids, colonyCounts, fetchColonyUuids])

  // Re-run filter + recount + refresh colony UUIDs when dates change
  const prevDates = useRef({ startDate, endDate })
  useEffect(() => {
    const prev = prevDates.current
    prevDates.current = { startDate, endDate }
    if (prev.startDate === startDate && prev.endDate === endDate) return
    setColonyUuids({})
    if (filterActive) fetchFiltered(0, false)
    if (colonies.length > 0) countAll(colonies.map(h => h.id), startDate, endDate)
    if (expandedColony) {
      const colony = colonies.find(h => h.id === expandedColony)
      if (colony) fetchColonyUuids(colony, 0, false)
    }
  }, [startDate, endDate, filterActive, colonies, countAll, expandedColony, fetchColonyUuids])

  const countColony = (id: string) => countAll([id], startDate, endDate)

  const deleteColony = async (id: string) => {
    const r = await fetch(`/api/hives/${id}/pollination-count`).then(r => r.json()).catch(() => ({ count: 0, names: [] }))
    const message = r.count > 0
      ? `This colony is used in ${r.count} pollination${r.count !== 1 ? 's' : ''} (${r.names.join(', ')}). Deleting it will also delete those pollinations.\n\nContinue?`
      : 'Delete this colony?'
    if (!confirm(message)) return
    await fetch(`/api/hives/${id}`, { method: 'DELETE' }).catch(() => {})
    setColonies(c => c.filter(x => x.id !== id))
    onColonyMutated?.()
  }

  const saveColony = () => {
    if (!colonyName.trim()) { setSaveError('Name is required'); return }
    if (!stepsValid) { setSaveError('All conditions need a value'); return }
    setSaving(true)
    setSaveError('')
    fetch('/api/hives', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: colonyName.trim(), steps, site_id: siteId || null }),
    })
      .then(r => { if (!r.ok) throw new Error(); return r.json() })
      .then(h => {
        setColonies(prev => [h, ...prev])
        setShowSaveModal(false)
        countAll([h.id], startDate, endDate)
        clearFilter()
        setExpandedColony(h.id)
        fetchColonyUuids(h, 0, false)
        onColonyMutated?.()
      })
      .catch(() => setSaveError('Failed to save'))
      .finally(() => setSaving(false))
  }

  const sessions = journey ? groupBySession(journey.events) : []
  const title = siteName ? `Colonies — ${siteName}` : 'Colonies — All Sites'

  return (
    <>
      <div style={{ marginBottom: 20 }}>
        <h2 style={{ fontSize: 20, fontWeight: 700 }}>{title}</h2>
        <p style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 6, maxWidth: 560 }}>
          Colonies are saved groups of visitors who match a sequence of conditions — like "came from Google, then signed up." Build one using the filter below, then save it to track and compare over time.
        </p>
      </div>

      {/* Search + UUID list */}
      <div className="card" style={{ marginBottom: 16, overflow: 'hidden' }}>
        <div style={{ padding: '12px 20px', borderBottom: '1px solid var(--border)', display: 'flex', gap: 8, alignItems: 'center' }}>
          <input
            className="input"
            placeholder="Search bee_ids..."
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
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>{uuidSubline(u)}</div>
              </div>
            </div>
          ))}
          {loadingMore && (
            <div style={{ padding: 12, textAlign: 'center' }}>
              <span className="spinner" style={{ width: 16, height: 16 }} />
            </div>
          )}
          {uuids.length === 0 && (uuidsLoading || filterLoading) && (
            <div style={{ padding: 20, textAlign: 'center' }}>
              <span className="spinner" style={{ width: 16, height: 16 }} />
            </div>
          )}
          {uuids.length === 0 && !uuidsLoading && !filterLoading && (
            <div style={{ padding: 20, textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
              {filterActive ? 'No matches' : 'No visitors'}
            </div>
          )}
        </div>
      </div>

      {/* Colony creator */}
      <div className="card" style={{ marginBottom: 16, overflow: 'hidden' }}>
        <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span>Colony creator</span>
          <div style={{ display: 'flex', gap: 6 }}>
            {filterActive && steps.length > 0 && (
              <button className="btn btn-primary" onClick={() => { setColonyName(''); setSaveError(''); setShowSaveModal(true) }} style={{ padding: '4px 12px', fontSize: 12 }}>
                Save as Colony
              </button>
            )}
            {steps.length === 0 && (
              <button className="btn btn-ghost" onClick={() => setSteps([newStep()])} style={{ padding: '4px 10px', fontSize: 12 }}>
                New Colony +
              </button>
            )}
          </div>
        </div>

        {steps.length > 0 && (
          <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {steps.map((step, si) => (
              <div key={si}>
                {/* Sequence selector between steps */}
                {si > 0 && (
                  <select
                    className="select"
                    value={step.sequence}
                    onChange={e => updateStepSequence(si, e.target.value as HiveSequence)}
                    style={{ fontSize: 12, width: '100%', marginBottom: 8 }}
                  >
                    {SEQUENCE_OPTIONS.map(o => (
                      <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                  </select>
                )}

                {/* Step group */}
                <div style={{
                  border: '1px solid var(--border)',
                  borderRadius: 'var(--radius-sm)',
                  padding: 10,
                  background: 'var(--surface-raised)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 0,
                }}>
                  {step.conditions.map((row, ci) => (
                    <div key={ci}>
                      {/* AND / OR label between rows */}
                      {ci > 0 && (
                        <div style={{
                          fontSize: 10, fontWeight: 700, textTransform: 'uppercase',
                          color: step.operator === 'and' ? 'var(--primary)' : 'var(--text-muted)',
                          padding: '4px 0',
                          letterSpacing: '0.06em',
                        }}>
                          {step.operator}
                        </div>
                      )}
                      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                        <select
                          className="select"
                          value={row.field}
                          onChange={e => updateRow(si, ci, { field: e.target.value as HiveConditionField })}
                          style={{ fontSize: 12 }}
                        >
                          {CONDITION_FIELDS.map(f => {
                            const allowed = allowedFieldsForStep(step, si, ci)
                            return (
                              <option key={f.value} value={f.value} disabled={!allowed.includes(f.value)}>
                                {f.label}
                              </option>
                            )
                          })}
                        </select>
                        <select
                          className="select"
                          value={row.match}
                          onChange={e => updateRow(si, ci, { match: e.target.value as HiveConditionMatch })}
                          style={{ fontSize: 12 }}
                        >
                          {MATCH_OPTIONS.map(m => {
                            const allowedMatches = allowedMatchesForRow(step, ci)
                            return (
                              <option key={m.value} value={m.value} disabled={!allowedMatches.includes(m.value)}>
                                {m.label}
                              </option>
                            )
                          })}
                        </select>
                        <input
                          className="input"
                          placeholder={placeholderFor(row.field)}
                          value={row.value}
                          onChange={e => updateRow(si, ci, { value: e.target.value })}
                          onKeyDown={e => e.key === 'Enter' && applyFilter()}
                          style={{ flex: 1, fontSize: 12, minWidth: 0 }}
                        />
                        <button className="btn btn-ghost" onClick={() => removeRowFromStep(si, ci)} style={{ padding: '4px 8px', fontSize: 12 }}>✕</button>
                      </div>
                    </div>
                  ))}

                  {/* + AND / + OR */}
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 8 }}>
                    <div style={{ display: 'flex', gap: 4 }}>
                      {allowedFieldsForStep({ ...step, operator: 'and' }, si).length > 0 && (
                        <button className="btn btn-ghost" onClick={() => addRowToStep(si, 'and')} style={{ fontSize: 11, padding: '3px 8px' }}>+ AND</button>
                      )}
                      {allowedFieldsForStep({ ...step, operator: 'or' }, si).length > 0 && (
                        <button className="btn btn-ghost" onClick={() => addRowToStep(si, 'or')} style={{ fontSize: 11, padding: '3px 8px' }}>+ OR</button>
                      )}
                    </div>
                    {steps.length > 1 && (
                      <button className="btn btn-ghost" onClick={() => removeStep(si)} style={{ fontSize: 11, padding: '3px 8px', color: 'var(--error)' }}>
                        Remove step
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ))}

            {/* Bottom row */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <button className="btn btn-ghost" onClick={addStep} style={{ fontSize: 12, padding: '4px 10px' }}>+ Add step</button>
              <div style={{ display: 'flex', gap: 6 }}>
                {filterActive && (
                  <button className="btn btn-ghost" onClick={clearFilter} style={{ padding: '4px 10px', fontSize: 12 }}>Clear</button>
                )}
                <button
                  className="btn btn-primary"
                  onClick={applyFilter}
                  disabled={filterLoading || !stepsValid}
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

      {/* Saved colonies */}
      <div style={{ marginTop: 32 }}>
        <h3 style={{ fontSize: 16, fontWeight: 700, marginBottom: 12 }}>🍯 Saved Colonies</h3>
        {colonies.length === 0 && (
          <div style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)', fontSize: 13 }}>
            🍯 No colonies saved yet — build a filter above and save it as a colony
          </div>
        )}
        {colonies.map(h => {
          const isOpen = expandedColony === h.id
          const uuidList = colonyUuids[h.id] ?? []
          const uuidLoading = colonyUuidLoading[h.id] ?? false
          const count = colonyCounts[h.id]
          return (
            <div key={h.id} className="card" style={{ marginBottom: 12, overflow: 'hidden' }}>
              <div
                style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 16px', cursor: 'pointer', userSelect: 'none' }}
                onClick={() => toggleColony(h)}
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
                    <span style={{ fontWeight: 600, fontSize: 13 }}>{h.name}</span>
                    {count !== undefined && (
                      <span style={{ fontSize: 12, color: 'var(--text-muted)', fontWeight: 400 }}>
                        {countLoading[h.id]
                          ? <span className="spinner" style={{ width: 12, height: 12, display: 'inline-block' }} />
                          : `${count.toLocaleString()} visitor${count !== 1 ? 's' : ''}`}
                      </span>
                    )}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {stepsSummary(h.steps)}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 4, flexShrink: 0 }} onClick={e => e.stopPropagation()}>
                  <button className="btn btn-danger" onClick={() => deleteColony(h.id)} style={{ fontSize: 12, padding: '4px 10px' }}>Delete</button>
                </div>
              </div>

              {isOpen && (
                <div style={{ borderTop: '1px solid var(--border)' }}>
                  {uuidLoading ? (
                    <div style={{ padding: 20, textAlign: 'center' }}>
                      <span className="spinner" style={{ width: 16, height: 16 }} />
                    </div>
                  ) : uuidList.length === 0 ? (
                    <div style={{ padding: 20, textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>No matches</div>
                  ) : (
                    <div ref={colonyListRef} onScroll={handleColonyScroll} style={{ maxHeight: 360, overflowY: 'auto' }}>
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
                      {colonyLoadingMore && (
                        <div style={{ padding: 12, textAlign: 'center' }}>
                          <span className="spinner" style={{ width: 16, height: 16 }} />
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          )
        })}
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
              <label style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 8 }}>Steps</label>
              {steps.map((step, si) => (
                <div key={si} style={{ marginBottom: 8 }}>
                  {si > 0 && (
                    <div style={{ fontSize: 10, textTransform: 'uppercase', color: 'var(--text-muted)', margin: '4px 0' }}>
                      {SEQUENCE_OPTIONS.find(s => s.value === step.sequence)?.label}
                    </div>
                  )}
                  <div style={{ border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-sm)', padding: '8px 12px', background: 'var(--surface-raised)', fontSize: 12 }}>
                    {step.conditions.map((c, ci) => (
                      <div key={ci}>
                        {ci > 0 && (
                          <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', color: 'var(--primary)', padding: '2px 0' }}>
                            {step.operator}
                          </div>
                        )}
                        <span style={{ color: 'var(--text-secondary)' }}>
                          {CONDITION_FIELDS.find(f => f.value === c.field)?.label} {MATCH_OPTIONS.find(m => m.value === c.match)?.label}
                        </span>{' '}
                        <span className="text-mono" style={{ fontWeight: 600 }}>"{c.value}"</span>
                      </div>
                    ))}
                  </div>
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
