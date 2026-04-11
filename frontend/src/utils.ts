/** Return YYYY-MM-DD for a Date in the browser's local timezone. */
export function localDateStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** Return YYYY-MM-DD for N days ago in the browser's local timezone. */
export function daysAgoStr(n: number): string {
  const d = new Date()
  d.setDate(d.getDate() - n)
  return localDateStr(d)
}

/** Preset date ranges. Functions are evaluated at call-time so they always return fresh dates. */
export const DATE_PRESETS = [
  { label: 'Past 24 hours', start: () => daysAgoStr(0),  end: () => daysAgoStr(0) },
  { label: 'Last 3 days',   start: () => daysAgoStr(3),  end: () => daysAgoStr(1) },
  { label: 'Last 7 days',   start: () => daysAgoStr(7),  end: () => daysAgoStr(1) },
  { label: 'Last 28 days',  start: () => daysAgoStr(28), end: () => daysAgoStr(1) },
  { label: 'Last 90 days',  start: () => daysAgoStr(90), end: () => daysAgoStr(1) },
  { label: 'This month',    start: () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01` }, end: () => daysAgoStr(1) },
  { label: 'Last month',    start: () => { const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - 1); return localDateStr(d) }, end: () => { const d = new Date(); d.setDate(0); return localDateStr(d) } },
  { label: 'Year to date',  start: () => `${new Date().getFullYear()}-01-01`, end: () => daysAgoStr(1) },
]

/**
 * Format a UTC timestamp string (e.g. "2024-01-15 10:30:00") in the
 * browser's local timezone. The backend stores timestamps as UTC but
 * without a Z suffix, so we normalise before parsing.
 */
export function formatTs(ts: string): string {
  return new Date(ts.replace(' ', 'T') + 'Z').toLocaleString()
}
