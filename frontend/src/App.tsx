import { useEffect, useState } from 'react'
import type { Site, View } from './types'
import Overview from './components/Overview'
import Colonies from './components/Colonies'

export default function App() {
  const [sites, setSites] = useState<Site[]>([])
  const [selectedSite, setSelectedSite] = useState<string>('')
  const [view, setView] = useState<View>('overview')

  useEffect(() => {
    fetch('/api/sites')
      .then(r => r.json())
      .then(setSites)
      .catch(() => {})
  }, [])

  const tabs: { key: View; label: string }[] = [
    { key: 'overview', label: 'Overview' },
    { key: 'colonies', label: 'Colonies' },
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

      <div className="main">
        {view === 'overview' && <Overview siteId={selectedSite} />}
        {view === 'colonies' && <Colonies siteId={selectedSite} />}
      </div>
    </>
  )
}
