import { useEffect, useState } from 'react'
import type { OverviewStats } from '../types'

function daysAgoStr(n: number) {
  const d = new Date()
  d.setDate(d.getDate() - n)
  return d.toISOString().slice(0, 10)
}

export default function Overview({ siteId }: { siteId: string }) {
  const [stats, setStats] = useState<OverviewStats | null>(null)
  const [loading, setLoading] = useState(false)
  const [startDate, setStartDate] = useState(daysAgoStr(30))
  const [endDate, setEndDate] = useState(daysAgoStr(0))

  const load = () => {
    setLoading(true)
    const p = new URLSearchParams()
    if (siteId) p.set('site_id', siteId)
    if (startDate) p.set('start', startDate)
    if (endDate) p.set('end', endDate)
    fetch(`/api/stats?${p}`)
      .then(r => r.json())
      .then(setStats)
      .catch(() => {})
      .finally(() => setLoading(false))
  }

  useEffect(load, [siteId])

  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
        <h2 style={{ fontSize: 20, fontWeight: 700 }}>Overview</h2>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <input type="date" className="input" value={startDate} onChange={e => setStartDate(e.target.value)} />
          <span style={{ color: 'var(--text-muted)' }}>–</span>
          <input type="date" className="input" value={endDate} onChange={e => setEndDate(e.target.value)} />
          <button className="btn" onClick={load} disabled={loading}>
            {loading ? <span className="spinner" /> : 'Refresh'}
          </button>
        </div>
      </div>

      <div className="stat-grid">
        <div className="stat-tile">
          <div className="stat-value">{stats?.total_uuids?.toLocaleString() ?? '–'}</div>
          <div className="stat-label">Unique visitors</div>
        </div>
        <div className="stat-tile">
          <div className="stat-value">{stats?.total_sessions?.toLocaleString() ?? '–'}</div>
          <div className="stat-label">Sessions</div>
        </div>
        <div className="stat-tile">
          <div className="stat-value">{stats?.total_events?.toLocaleString() ?? '–'}</div>
          <div className="stat-label">Events</div>
        </div>
      </div>

      <div className="two-col">
        <div className="card">
          <div className="card-header">Top Pages</div>
          <table className="table">
            <thead>
              <tr><th>Page</th><th className="text-right">Views</th></tr>
            </thead>
            <tbody>
              {stats?.top_pages.map(p => (
                <tr key={p.page_path}>
                  <td className="text-mono">{p.page_path}</td>
                  <td className="text-right">{p.views.toLocaleString()}</td>
                </tr>
              ))}
              {stats && stats.top_pages.length === 0 && (
                <tr><td colSpan={2} style={{ color: 'var(--text-muted)', textAlign: 'center' }}>No data</td></tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="card">
          <div className="card-header">Top Events</div>
          <table className="table">
            <thead>
              <tr><th>Event</th><th className="text-right">Count</th></tr>
            </thead>
            <tbody>
              {stats?.top_events.map(e => (
                <tr key={e.event_name}>
                  <td><span className="badge-amber">{e.event_name}</span></td>
                  <td className="text-right">{e.count.toLocaleString()}</td>
                </tr>
              ))}
              {stats && stats.top_events.length === 0 && (
                <tr><td colSpan={2} style={{ color: 'var(--text-muted)', textAlign: 'center' }}>No data</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </>
  )
}
