import { useEffect, useState } from 'react'
import type { Site, View } from './types'
import Overview from './components/Overview'
import Colonies from './components/Colonies'
import Pollinate from './components/Pollinate'
import DateRangePicker from './components/DateRangePicker'

function daysAgoStr(n: number) {
  const d = new Date()
  d.setDate(d.getDate() - n)
  return d.toISOString().slice(0, 10)
}

const STORAGE_KEY = 'hb_date_range'

function loadDateRange(): { start: string; end: string; preset: string | null } {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const r = JSON.parse(raw)
      if (typeof r.start === 'string' && typeof r.end === 'string')
        return { start: r.start, end: r.end, preset: r.preset ?? null }
    }
  } catch {}
  return { start: daysAgoStr(28), end: daysAgoStr(1), preset: 'Last 28 days' }
}

export default function App() {
  const [sites, setSites] = useState<Site[]>([])
  const [selectedSite, setSelectedSite] = useState<string>('')
  const [view, setView] = useState<View>('overview')
  const [startDate, setStartDate] = useState(() => loadDateRange().start)
  const [endDate, setEndDate] = useState(() => loadDateRange().end)
  const [initialPreset] = useState<string | null>(() => loadDateRange().preset)

  useEffect(() => {
    fetch('/api/sites')
      .then(r => r.json())
      .then(setSites)
      .catch(() => {})
  }, [])

  const handleDateChange = (start: string, end: string, preset: string | null) => {
    setStartDate(start)
    setEndDate(end)
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ start, end, preset })) } catch {}
  }

  const today = new Date().toISOString().slice(0, 10)
  const rangeIncludesToday = endDate === today
  const daySpan = Math.round((new Date(endDate).getTime() - new Date(startDate).getTime()) / 86400000)
  const showCacheBanner = rangeIncludesToday && daySpan > 30

  const tabs: { key: View; label: string }[] = [
    { key: 'overview', label: 'Overview' },
    { key: 'colonies', label: 'Colonies' },
    { key: 'pollinate', label: 'Pollinations' },
  ]

  return (
    <>
      <div className="topbar">
        <div className="topbar-logo">🐝 Humblebee</div>
        <div className="topbar-divider" />

        <select
          className="select"
          value={selectedSite}
          onChange={e => setSelectedSite(e.target.value)}
          style={{ minWidth: 160 }}
        >
          <option value="">All sites</option>
          {sites.map(s => (
            <option key={s.site_id} value={s.site_id}>{s.site_name}</option>
          ))}
        </select>

        <DateRangePicker
          startDate={startDate}
          endDate={endDate}
          initialActivePreset={initialPreset}
          onChange={handleDateChange}
        />

        <nav className="topbar-nav">
          {tabs.map(t => (
            <button
              key={t.key}
              className={`topbar-tab${view === t.key ? ' active' : ''}`}
              onClick={() => setView(t.key)}
            >
              {t.label}
            </button>
          ))}
        </nav>
      </div>

      {showCacheBanner && (
        <div style={{
          background: '#fffbeb', borderBottom: '1px solid #fcd34d',
          padding: '8px 24px', fontSize: 12, color: '#92400e',
          display: 'flex', alignItems: 'center', gap: 8,
        }}>
          <span>⚠️</span>
          <span>Date ranges over 30 days that include today bypass the cache and may be slow. For best performance, end on yesterday's date.</span>
        </div>
      )}

      <div className="main">
        <div style={{ display: view === 'overview' ? undefined : 'none' }}>
          <Overview siteId={selectedSite} siteName={sites.find(s => s.site_id === selectedSite)?.site_name ?? null} startDate={startDate} endDate={endDate} />
        </div>
        <div style={{ display: view === 'colonies' ? undefined : 'none' }}>
          <Colonies siteId={selectedSite} siteName={sites.find(s => s.site_id === selectedSite)?.site_name ?? null} startDate={startDate} endDate={endDate} />
        </div>
        <div style={{ display: view === 'pollinate' ? undefined : 'none' }}>
          <Pollinate siteId={selectedSite} siteName={sites.find(s => s.site_id === selectedSite)?.site_name ?? null} startDate={startDate} endDate={endDate} />
        </div>
      </div>
    </>
  )
}
