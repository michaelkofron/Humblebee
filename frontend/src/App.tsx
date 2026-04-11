import { useCallback, useEffect, useState } from 'react'
import type { Site, View } from './types'
import Overview from './components/Overview'
import Colonies from './components/Colonies'
import Pollinate from './components/Pollinate'
import Sites from './components/Sites'
import DateRangePicker from './components/DateRangePicker'
import { DATE_PRESETS, daysAgoStr, localDateStr } from './utils'

const STORAGE_KEY = 'hb_date_range'
const SITE_STORAGE_KEY = 'hb_selected_site'
const VALID_VIEWS: Record<string, View> = {
  '/': 'overview',
  '/overview': 'overview',
  '/colonies': 'colonies',
  '/pollinate': 'pollinate',
  '/sites': 'sites',
}

function loadDateRange(): { start: string; end: string; preset: string | null } {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const r = JSON.parse(raw)
      // If a named preset is stored, recompute its dates fresh so they don't go stale across sessions.
      if (r.preset) {
        const preset = DATE_PRESETS.find(p => p.label === r.preset)
        if (preset) return { start: preset.start(), end: preset.end(), preset: r.preset }
      }
      // Custom range: use the stored absolute dates as-is.
      if (typeof r.start === 'string' && typeof r.end === 'string')
        return { start: r.start, end: r.end, preset: null }
    }
  } catch {}
  return { start: daysAgoStr(28), end: daysAgoStr(1), preset: 'Last 28 days' }
}

function viewFromPath(): View {
  return VALID_VIEWS[window.location.pathname] || 'overview'
}

function loadSelectedSite(): string {
  try {
    return localStorage.getItem(SITE_STORAGE_KEY) || ''
  } catch { return '' }
}

function LoginScreen({ onSuccess }: { onSuccess: () => void }) {
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSubmitting(true)
    setError(null)
    try {
      const resp = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ password }),
      })
      if (resp.ok) { onSuccess(); return }
      const data = await resp.json().catch(() => ({}))
      setError(data.detail ?? 'Login failed')
    } catch {
      setError('Could not reach backend')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div style={{
      minHeight: '100vh', background: 'var(--bg)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }}>
      <form onSubmit={handleSubmit} style={{
        background: 'var(--surface)', border: '1px solid var(--border)',
        borderRadius: 'var(--radius)', padding: 32, width: 340,
        boxShadow: 'var(--shadow-md)', display: 'flex', flexDirection: 'column', gap: 16,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'center', fontSize: 18, fontWeight: 700 }}>
          🐝 Humblebee
        </div>
        <input
          type="password"
          className="input"
          value={password}
          onChange={e => setPassword(e.target.value)}
          placeholder="Password"
          autoFocus
          style={{ width: '100%' }}
        />
        {error && (
          <div style={{ color: 'var(--error)', fontSize: 12 }}>{error}</div>
        )}
        <button
          type="submit"
          className="btn btn-primary"
          disabled={submitting || !password}
          style={{ width: '100%' }}
        >
          {submitting ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </div>
  )
}

export default function App() {
  const [authChecked, setAuthChecked] = useState(false)
  const [needsLogin, setNeedsLogin] = useState(false)

  useEffect(() => {
    fetch('/api/auth-status').then(r => r.json()).then(data => {
      if (!data.auth_enabled) { setAuthChecked(true); return }
      fetch('/api/sites', { credentials: 'include' }).then(r => {
        if (r.status === 401) setNeedsLogin(true)
        setAuthChecked(true)
      })
    }).catch(() => setAuthChecked(true))
  }, [])

  if (!authChecked) return null
  if (needsLogin) return <LoginScreen onSuccess={() => setNeedsLogin(false)} />
  return <AppInner />
}

function AppInner() {
  const [sites, setSites] = useState<Site[]>([])
  const [selectedSite, setSelectedSite] = useState<string>(loadSelectedSite)
  const [view, setView] = useState<View>(viewFromPath)
  const [startDate, setStartDate] = useState(() => loadDateRange().start)
  const [endDate, setEndDate] = useState(() => loadDateRange().end)
  const [initialPreset] = useState<string | null>(() => loadDateRange().preset)
  const [coloniesVersion, setColoniesVersion] = useState(0)
  const onColonyMutated = useCallback(() => setColoniesVersion(v => v + 1), [])

  const fetchSites = useCallback((opts?: { redirectIfEmpty?: boolean }) => {
    fetch('/api/sites')
      .then(r => r.json())
      .then((data: Site[]) => {
        setSites(data)
        if (opts?.redirectIfEmpty && data.length === 0) {
          window.history.pushState(null, '', '/sites')
          setView('sites')
        }
      })
      .catch(() => {})
  }, [])

  useEffect(() => { fetchSites({ redirectIfEmpty: true }) }, [fetchSites])

  // Sync view to URL path
  const navigate = (v: View) => {
    const path = v === 'overview' ? '/' : '/' + v
    window.history.pushState(null, '', path)
    setView(v)
  }

  // Listen for back/forward
  useEffect(() => {
    const onPop = () => setView(viewFromPath())
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])

  // Persist selected site
  const handleSiteChange = (siteId: string) => {
    setSelectedSite(siteId)
    try { localStorage.setItem(SITE_STORAGE_KEY, siteId) } catch {}
  }

  const handleDateChange = (start: string, end: string, preset: string | null) => {
    setStartDate(start)
    setEndDate(end)
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ start, end, preset })) } catch {}
  }

  const today = localDateStr(new Date())
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
          onChange={e => handleSiteChange(e.target.value)}
          style={{ minWidth: 160 }}
        >
          <option value="">All sites</option>
          {sites.map(s => (
            <option key={s.site_id} value={s.site_id}>{s.site_name}</option>
          ))}
        </select>

        <button
          className={`topbar-tab sites-tab${view === 'sites' ? ' active' : ''}`}
          onClick={() => navigate('sites')}
          title="Manage sites"
        >
          edit sites
        </button>

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
              onClick={() => navigate(t.key)}
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
          <Colonies siteId={selectedSite} siteName={sites.find(s => s.site_id === selectedSite)?.site_name ?? null} startDate={startDate} endDate={endDate} onColonyMutated={onColonyMutated} />
        </div>
        <div style={{ display: view === 'pollinate' ? undefined : 'none' }}>
          <Pollinate siteId={selectedSite} siteName={sites.find(s => s.site_id === selectedSite)?.site_name ?? null} startDate={startDate} endDate={endDate} coloniesVersion={coloniesVersion} />
        </div>
        <div style={{ display: view === 'sites' ? undefined : 'none' }}>
          <Sites onSitesMutated={fetchSites} />
        </div>
      </div>
    </>
  )
}
