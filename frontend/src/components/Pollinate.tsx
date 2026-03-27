import { useCallback, useEffect, useState } from 'react'
import type { Hive, Pollination, PollinationCount } from '../types'

function formatTs(ts: string) {
  return new Date(ts).toLocaleString()
}

function VennDiagram({ a, b, overlap, nameA, nameB }: {
  a: number; b: number; overlap: number; nameA: string; nameB: string
}) {
  const W = 220, H = 110, CY = H / 2
  const MAX_R = 44, MIN_R = 20
  const maxCount = Math.max(a, b, 1)
  const ra = MIN_R + (MAX_R - MIN_R) * Math.sqrt(a / maxCount)
  const rb = MIN_R + (MAX_R - MIN_R) * Math.sqrt(b / maxCount)
  const overlapRatio = (a > 0 && b > 0) ? Math.min(overlap / Math.min(a, b), 1) : 0
  const dist = Math.max((ra + rb) * (1 - overlapRatio * 0.75), Math.abs(ra - rb) + 2)
  const cxa = W / 2 - dist / 2
  const cxb = W / 2 + dist / 2

  return (
    <svg width={W} height={H} style={{ display: 'block', overflow: 'visible' }}>
      <circle cx={cxa} cy={CY} r={ra} fill="var(--primary)" fillOpacity={0.18} stroke="var(--primary)" strokeWidth={1.5} />
      <circle cx={cxb} cy={CY} r={rb} fill="var(--primary-dark)" fillOpacity={0.15} stroke="var(--primary-dark)" strokeWidth={1.5} />
      {/* A only count */}
      <text x={cxa - dist * 0.18} y={CY + 4} textAnchor="middle" fontSize={11} fontWeight={600} fill="var(--text-secondary)">
        {a > 0 ? (a - overlap).toLocaleString() : '–'}
      </text>
      {/* Overlap count */}
      {overlap > 0 && (
        <text x={W / 2} y={CY + 4} textAnchor="middle" fontSize={12} fontWeight={700} fill="var(--text)">
          {overlap.toLocaleString()}
        </text>
      )}
      {/* B only count */}
      <text x={cxb + dist * 0.18} y={CY + 4} textAnchor="middle" fontSize={11} fontWeight={600} fill="var(--text-secondary)">
        {b > 0 ? (b - overlap).toLocaleString() : '–'}
      </text>
      {/* Labels */}
      <text x={cxa - ra - 4} y={H - 6} textAnchor="end" fontSize={10} fill="var(--text-muted)" style={{ maxWidth: 60 }}>
        {nameA.length > 14 ? nameA.slice(0, 13) + '…' : nameA}
      </text>
      <text x={cxb + rb + 4} y={H - 6} textAnchor="start" fontSize={10} fill="var(--text-muted)">
        {nameB.length > 14 ? nameB.slice(0, 13) + '…' : nameB}
      </text>
    </svg>
  )
}

export default function Pollinate({ siteId, siteName, startDate, endDate }: {
  siteId: string; siteName: string | null; startDate: string; endDate: string
}) {
  const [pollinations, setPollinations] = useState<Pollination[]>([])
  const [counts, setCounts] = useState<Record<string, PollinationCount>>({})
  const [countLoading, setCountLoading] = useState<Record<string, boolean>>({})
  const [colonies, setColonies] = useState<Hive[]>([])

  const [showCreate, setShowCreate] = useState(false)
  const [formName, setFormName] = useState('')
  const [formHiveA, setFormHiveA] = useState('')
  const [formHiveB, setFormHiveB] = useState('')
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState('')

  const title = siteName ? `Pollinate — ${siteName}` : 'Pollinate — All Sites'

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
  }, [siteId])

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

  useEffect(() => {
    pollinations.forEach(p => countPollination(p.id))
  }, [pollinations, countPollination])

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
      setFormName(''); setFormHiveA(''); setFormHiveB(''); setShowCreate(false)
      fetchPollinations()
    } catch { setSaveError('Failed to save') }
    finally { setSaving(false) }
  }

  const deletePollination = async (id: string) => {
    await fetch(`/api/pollinations/${id}`, { method: 'DELETE' })
    setPollinations(prev => prev.filter(p => p.id !== id))
    setCounts(prev => { const n = { ...prev }; delete n[id]; return n })
  }

  const colonyName = (id: string) => colonies.find(c => c.id === id)?.name ?? id

  const canSave = formName.trim() && formHiveA && formHiveB && formHiveA !== formHiveB

  return (
    <div>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
        <h2 style={{ fontSize: 20, fontWeight: 700 }}>{title}</h2>
        <button
          className="btn btn-primary"
          onClick={() => { setShowCreate(s => !s); setSaveError('') }}
          style={{ padding: '6px 14px', fontSize: 13 }}
        >
          Cross-pollinate +
        </button>
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

      {/* Saved pollinations */}
      {pollinations.length === 0 && !showCreate && (
        <div style={{ color: 'var(--text-muted)', fontSize: 14, marginTop: 40, textAlign: 'center' }}>
          No cross-pollinations yet — pick two colonies to compare.
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {pollinations.map(pol => {
          const c = counts[pol.id]
          const loading = countLoading[pol.id]
          const nameA = colonyName(pol.hive_a_id)
          const nameB = colonyName(pol.hive_b_id)
          const pctA = c && c.a_count > 0 ? Math.round((c.overlap / c.a_count) * 100) : null
          const pctB = c && c.b_count > 0 ? Math.round((c.overlap / c.b_count) * 100) : null

          return (
            <div key={pol.id} className="card" style={{ padding: 16 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
                <div>
                  <div style={{ fontWeight: 700, fontSize: 15 }}>{pol.name}</div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
                    {nameA} vs {nameB} · saved {formatTs(pol.created_at)}
                  </div>
                </div>
                <button
                  className="btn btn-danger"
                  onClick={() => deletePollination(pol.id)}
                  style={{ fontSize: 12, padding: '4px 10px' }}
                >
                  Delete
                </button>
              </div>

              {loading || !c ? (
                <div style={{ color: 'var(--text-muted)', fontSize: 13, padding: '16px 0' }}>Counting…</div>
              ) : (
                <div style={{ display: 'flex', alignItems: 'center', gap: 24 }}>
                  <VennDiagram a={c.a_count} b={c.b_count} overlap={c.overlap} nameA={nameA} nameB={nameB} />
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    <div style={{ display: 'flex', gap: 16 }}>
                      <div>
                        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 2 }}>{nameA}</div>
                        <div style={{ fontSize: 20, fontWeight: 700 }}>{c.a_count.toLocaleString()}</div>
                      </div>
                      <div>
                        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 2 }}>{nameB}</div>
                        <div style={{ fontSize: 20, fontWeight: 700 }}>{c.b_count.toLocaleString()}</div>
                      </div>
                      <div>
                        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 2 }}>Overlap</div>
                        <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--primary)' }}>{c.overlap.toLocaleString()}</div>
                      </div>
                    </div>
                    {(pctA !== null || pctB !== null) && (
                      <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                        {pctA !== null && <span>{pctA}% of {nameA}</span>}
                        {pctA !== null && pctB !== null && <span style={{ margin: '0 6px', color: 'var(--border)' }}>·</span>}
                        {pctB !== null && <span>{pctB}% of {nameB}</span>}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
