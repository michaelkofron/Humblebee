import { useEffect, useState } from 'react'
import type { Hive, HiveCondition, HiveConditionType, HiveSequence } from '../types'

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

export default function Hives({ siteId }: { siteId: string }) {
  const [hives, setHives] = useState<Hive[]>([])
  const [hiveCounts, setHiveCounts] = useState<Record<string, number>>({})
  const [countLoading, setCountLoading] = useState<Record<string, boolean>>({})
  const [showModal, setShowModal] = useState(false)
  const [hiveName, setHiveName] = useState('')
  const [conditions, setConditions] = useState<HiveCondition[]>([
    { type: 'event_name', value: '', sequence: 'anytime' },
  ])
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState('')

  const loadHives = () => {
    fetch('/api/hives').then(r => r.json()).then(setHives).catch(() => {})
  }
  useEffect(loadHives, [])

  const countHive = (id: string) => {
    setCountLoading(prev => ({ ...prev, [id]: true }))
    const p = new URLSearchParams()
    if (siteId) p.set('site_id', siteId)
    fetch(`/api/hives/${id}/count?${p}`)
      .then(r => r.json())
      .then(d => setHiveCounts(prev => ({ ...prev, [id]: d.count })))
      .catch(() => {})
      .finally(() => setCountLoading(prev => ({ ...prev, [id]: false })))
  }

  const deleteHive = (id: string) => {
    if (!confirm('Delete this hive?')) return
    fetch(`/api/hives/${id}`, { method: 'DELETE' })
      .then(() => { setHives(h => h.filter(x => x.id !== id)) })
      .catch(() => {})
  }

  const openModal = () => {
    setHiveName('')
    setConditions([{ type: 'event_name', value: '', sequence: 'anytime' }])
    setSaveError('')
    setShowModal(true)
  }

  const saveHive = () => {
    if (!hiveName.trim()) { setSaveError('Name is required'); return }
    if (conditions.some(c => !c.value.trim())) { setSaveError('All conditions need a value'); return }
    setSaving(true)
    setSaveError('')
    fetch('/api/hives', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: hiveName.trim(), conditions }),
    })
      .then(r => { if (!r.ok) throw new Error(); return r.json() })
      .then(h => { setHives(prev => [h, ...prev]); setShowModal(false) })
      .catch(() => setSaveError('Failed to save'))
      .finally(() => setSaving(false))
  }

  const updateCondition = (i: number, patch: Partial<HiveCondition>) => {
    setConditions(prev => prev.map((c, j) => j === i ? { ...c, ...patch } : c))
  }

  const addCondition = () => {
    setConditions(prev => [...prev, { type: 'event_name', value: '', sequence: 'anytime' }])
  }

  const removeCondition = (i: number) => {
    setConditions(prev => prev.filter((_, j) => j !== i))
  }

  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
        <h2 style={{ fontSize: 20, fontWeight: 700 }}>Hives</h2>
        <button className="btn btn-primary" onClick={openModal}>+ New Hive</button>
      </div>

      {hives.length === 0 && (
        <div style={{ textAlign: 'center', padding: 60, color: 'var(--text-muted)' }}>
          🍯 No hives yet — create one to segment your visitors
        </div>
      )}

      {hives.map(h => (
        <div key={h.id} className="card" style={{ marginBottom: 16 }}>
          <div className="card-header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span>{h.name}</span>
              <span className="badge-amber">{h.conditions.length} condition{h.conditions.length !== 1 ? 's' : ''}</span>
              {hiveCounts[h.id] !== undefined && (
                <span style={{ fontSize: 13, color: 'var(--text-secondary)', fontWeight: 400 }}>
                  {hiveCounts[h.id].toLocaleString()} visitor{hiveCounts[h.id] !== 1 ? 's' : ''}
                </span>
              )}
            </div>
            <div style={{ display: 'flex', gap: 4 }}>
              <button className="btn" onClick={() => countHive(h.id)} disabled={countLoading[h.id]}>
                {countLoading[h.id] ? <span className="spinner" /> : 'Count'}
              </button>
              <button className="btn btn-danger" onClick={() => deleteHive(h.id)}>Delete</button>
            </div>
          </div>
          <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {h.conditions.map((c, i) => (
              <div key={i} style={{
                background: 'var(--surface-raised)',
                border: '1px solid var(--border-subtle)',
                borderRadius: 'var(--radius-sm)',
                padding: '8px 12px',
              }}>
                {i > 0 && (
                  <div style={{ fontSize: 11, textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: 2 }}>
                    {c.sequence === 'immediately' ? 'immediately followed by' : 'any time later'}
                  </div>
                )}
                <div style={{ fontSize: 12 }}>
                  <span style={{ color: 'var(--text-secondary)' }}>
                    {CONDITION_TYPES.find(t => t.value === c.type)?.label}
                  </span>{' '}
                  <span className="text-mono" style={{ fontWeight: 600 }}>"{c.value}"</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}

      {/* Modal */}
      {showModal && (
        <div className="modal-overlay" onClick={e => e.target === e.currentTarget && setShowModal(false)}>
          <div className="modal">
            <h2>New Hive</h2>

            <div style={{ marginBottom: 16 }}>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 4 }}>Name</label>
              <input
                className="input"
                style={{ width: '100%' }}
                placeholder="e.g. Blog → Signup"
                value={hiveName}
                onChange={e => setHiveName(e.target.value)}
              />
            </div>

            <label style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 8 }}>Conditions</label>
            {conditions.map((c, i) => (
              <div key={i} style={{ marginBottom: 10, display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                {i > 0 && (
                  <select
                    className="select"
                    value={c.sequence}
                    onChange={e => updateCondition(i, { sequence: e.target.value as HiveSequence })}
                    style={{ fontSize: 12, width: 180 }}
                  >
                    {SEQUENCE_OPTIONS.map(o => (
                      <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                  </select>
                )}
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
                  style={{ flex: 1, fontSize: 12, minWidth: 120 }}
                />
                {conditions.length > 1 && (
                  <button className="btn btn-ghost" onClick={() => removeCondition(i)} style={{ padding: '4px 8px' }}>✕</button>
                )}
              </div>
            ))}

            <button className="btn btn-ghost" onClick={addCondition} style={{ marginBottom: 16 }}>
              + Add condition
            </button>

            {saveError && (
              <div style={{ color: 'var(--error)', fontSize: 13, marginBottom: 12 }}>{saveError}</div>
            )}

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button className="btn" onClick={() => setShowModal(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={saveHive} disabled={saving}>
                {saving ? 'Saving…' : 'Save Hive'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
