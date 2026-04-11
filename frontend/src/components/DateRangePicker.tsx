import { useEffect, useRef, useState } from 'react'
import { DATE_PRESETS } from '../utils'

function formatDisplay(date: string) {
  const [y, m, d] = date.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

interface Props {
  startDate: string
  endDate: string
  onChange: (start: string, end: string, preset: string | null) => void
  initialActivePreset?: string | null
}

export default function DateRangePicker({ startDate, endDate, onChange, initialActivePreset = 'Last 28 days' }: Props) {
  const [open, setOpen] = useState(false)
  const [activePreset, setActivePreset] = useState<string | null>(initialActivePreset)
  const [draft, setDraft] = useState({ start: startDate, end: endDate })
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const applyPreset = (preset: typeof DATE_PRESETS[number]) => {
    const s = preset.start(), e = preset.end()
    setActivePreset(preset.label)
    setDraft({ start: s, end: e })
    onChange(s, e, preset.label)
    setOpen(false)
  }

  const applyCustom = () => {
    if (!draft.start || !draft.end || draft.start > draft.end) return
    setActivePreset(null)
    onChange(draft.start, draft.end, null)
    setOpen(false)
  }

  const displayLabel = activePreset ?? `${formatDisplay(startDate)} – ${formatDisplay(endDate)}`

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button
        onClick={() => { setDraft({ start: startDate, end: endDate }); setOpen(o => !o) }}
        style={{
          display: 'flex', alignItems: 'center', gap: 6,
          padding: '6px 12px',
          background: 'var(--surface)',
          border: `1px solid ${open ? 'var(--border-focus)' : 'var(--border)'}`,
          borderRadius: 'var(--radius-sm)',
          fontSize: 13, fontWeight: 500, color: 'var(--text)',
          cursor: 'pointer', whiteSpace: 'nowrap',
        }}
      >
        <span>📅</span>
        {displayLabel}
        <span style={{ color: 'var(--text-muted)', fontSize: 10 }}>▾</span>
      </button>

      {open && (
        <div style={{
          position: 'absolute', top: 'calc(100% + 6px)', right: 0, zIndex: 300,
          background: 'var(--surface)', border: '1px solid var(--border)',
          borderRadius: 'var(--radius)', boxShadow: 'var(--shadow-md)',
          display: 'flex', minWidth: 360,
        }}>
          {/* Presets */}
          <div style={{ display: 'flex', flexDirection: 'column', borderRight: '1px solid var(--border)', padding: '8px 0', minWidth: 140 }}>
            {DATE_PRESETS.map(p => (
              <button
                key={p.label}
                onClick={() => applyPreset(p)}
                style={{
                  background: activePreset === p.label ? 'var(--primary-light)' : 'none',
                  color: activePreset === p.label ? 'var(--primary-dark)' : 'var(--text)',
                  border: 'none', textAlign: 'left', padding: '8px 16px',
                  fontSize: 13, fontWeight: activePreset === p.label ? 600 : 400,
                  cursor: 'pointer',
                }}
              >
                {p.label}
              </button>
            ))}
          </div>

          {/* Custom range */}
          <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 10, flex: 1 }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              Custom range
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <label style={{ fontSize: 11, color: 'var(--text-secondary)', fontWeight: 500 }}>From</label>
                <input type="date" value={draft.start} onChange={e => { setDraft(d => ({ ...d, start: e.target.value })); setActivePreset(null) }}
                  style={{ fontSize: 13, padding: '6px 8px', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', background: 'var(--surface)', color: 'var(--text)', outline: 'none' }} />
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <label style={{ fontSize: 11, color: 'var(--text-secondary)', fontWeight: 500 }}>To</label>
                <input type="date" value={draft.end} onChange={e => { setDraft(d => ({ ...d, end: e.target.value })); setActivePreset(null) }}
                  style={{ fontSize: 13, padding: '6px 8px', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', background: 'var(--surface)', color: 'var(--text)', outline: 'none' }} />
              </div>
            </div>
            <button
              onClick={applyCustom}
              disabled={!draft.start || !draft.end || draft.start > draft.end}
              style={{ background: 'var(--primary)', color: '#fff', border: 'none', borderRadius: 'var(--radius-sm)', padding: '7px 14px', fontSize: 12, fontWeight: 600, cursor: 'pointer', opacity: (!draft.start || !draft.end || draft.start > draft.end) ? 0.4 : 1 }}
            >
              Apply
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
