import { useCallback, useEffect, useRef, useState } from 'react'
import type { OverviewStats } from '../types'

const PAGE_SIZE = 50

export default function Overview({ siteId, siteName, startDate, endDate }: {
  siteId: string
  siteName: string | null
  startDate: string
  endDate: string
}) {
  const [stats, setStats] = useState<OverviewStats | null>(null)

  const [pages, setPages] = useState<{ page_path: string; views: number }[]>([])
  const [totalPages, setTotalPages] = useState(0)
  const [pagesLoadingMore, setPagesLoadingMore] = useState(false)
  const pagesRef = useRef<HTMLDivElement>(null)

  const [events, setEvents] = useState<{ event_name: string; count: number }[]>([])
  const [totalEvents, setTotalEvents] = useState(0)
  const [eventsLoadingMore, setEventsLoadingMore] = useState(false)
  const eventsRef = useRef<HTMLDivElement>(null)

  const title = siteName ? `Overview — ${siteName}` : 'Overview — All Sites'

  function buildParams(extra?: Record<string, string>) {
    const p = new URLSearchParams()
    if (siteId) p.set('site_id', siteId)
    if (startDate) p.set('start', startDate)
    if (endDate) p.set('end', endDate)
    if (extra) Object.entries(extra).forEach(([k, v]) => p.set(k, v))
    return p
  }

  const fetchStats = useCallback(() => {
    fetch(`/api/stats?${buildParams()}`)
      .then(r => r.json())
      .then(setStats)
      .catch(() => {})
  }, [siteId, startDate, endDate])

  const fetchPages = useCallback((offset: number, append: boolean) => {
    if (append) setPagesLoadingMore(true)
    fetch(`/api/pages?${buildParams({ limit: String(PAGE_SIZE), offset: String(offset) })}`)
      .then(r => r.json())
      .then((data: { total: number; items: { page_path: string; views: number }[] }) => {
        setTotalPages(data.total)
        setPages(prev => append ? [...prev, ...data.items] : data.items)
      })
      .catch(() => {})
      .finally(() => setPagesLoadingMore(false))
  }, [siteId, startDate, endDate])

  const fetchEvents = useCallback((offset: number, append: boolean) => {
    if (append) setEventsLoadingMore(true)
    fetch(`/api/events?${buildParams({ limit: String(PAGE_SIZE), offset: String(offset) })}`)
      .then(r => r.json())
      .then((data: { total: number; items: { event_name: string; count: number }[] }) => {
        setTotalEvents(data.total)
        setEvents(prev => append ? [...prev, ...data.items] : data.items)
      })
      .catch(() => {})
      .finally(() => setEventsLoadingMore(false))
  }, [siteId, startDate, endDate])

  useEffect(() => {
    fetchStats()
    fetchPages(0, false)
    fetchEvents(0, false)
  }, [siteId, startDate, endDate])

  const handlePagesScroll = useCallback(() => {
    const el = pagesRef.current
    if (!el || pagesLoadingMore || pages.length >= totalPages) return
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 40) fetchPages(pages.length, true)
  }, [pagesLoadingMore, pages.length, totalPages, fetchPages])

  const handleEventsScroll = useCallback(() => {
    const el = eventsRef.current
    if (!el || eventsLoadingMore || events.length >= totalEvents) return
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 40) fetchEvents(events.length, true)
  }, [eventsLoadingMore, events.length, totalEvents, fetchEvents])

  return (
    <>
      <div style={{ marginBottom: 20 }}>
        <h2 style={{ fontSize: 20, fontWeight: 700 }}>{title}</h2>
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
        <div className="card" style={{ display: 'flex', flexDirection: 'column', maxHeight: 480 }}>
          <div className="card-header">Top Pages</div>
          <div ref={pagesRef} onScroll={handlePagesScroll} style={{ flex: 1, overflowY: 'auto' }}>
            <table className="table">
              <thead>
                <tr><th>Page</th><th className="text-right">Views</th></tr>
              </thead>
              <tbody>
                {pages.map(p => (
                  <tr key={p.page_path}>
                    <td className="text-mono">{p.page_path}</td>
                    <td className="text-right">{p.views.toLocaleString()}</td>
                  </tr>
                ))}
                {pages.length === 0 && (
                  <tr><td colSpan={2} style={{ color: 'var(--text-muted)', textAlign: 'center' }}>No data</td></tr>
                )}
              </tbody>
            </table>
            {pagesLoadingMore && (
              <div style={{ padding: 12, textAlign: 'center' }}>
                <span className="spinner" style={{ width: 16, height: 16 }} />
              </div>
            )}
          </div>
        </div>

        <div className="card" style={{ display: 'flex', flexDirection: 'column', maxHeight: 480 }}>
          <div className="card-header">Top Actions</div>
          <div ref={eventsRef} onScroll={handleEventsScroll} style={{ flex: 1, overflowY: 'auto' }}>
            <table className="table">
              <thead>
                <tr><th>Event</th><th className="text-right">Count</th></tr>
              </thead>
              <tbody>
                {events.map(e => (
                  <tr key={e.event_name}>
                    <td><span className="badge-amber">{e.event_name}</span></td>
                    <td className="text-right">{e.count.toLocaleString()}</td>
                  </tr>
                ))}
                {events.length === 0 && (
                  <tr><td colSpan={2} style={{ color: 'var(--text-muted)', textAlign: 'center' }}>No data</td></tr>
                )}
              </tbody>
            </table>
            {eventsLoadingMore && (
              <div style={{ padding: 12, textAlign: 'center' }}>
                <span className="spinner" style={{ width: 16, height: 16 }} />
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  )
}
