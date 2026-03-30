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

/**
 * Format a UTC timestamp string (e.g. "2024-01-15 10:30:00") in the
 * browser's local timezone. The backend stores timestamps as UTC but
 * without a Z suffix, so we normalise before parsing.
 */
export function formatTs(ts: string): string {
  return new Date(ts.replace(' ', 'T') + 'Z').toLocaleString()
}
