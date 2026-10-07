import { formatDistanceToNow as fdfn } from 'date-fns'

/**
 * Format a date as a human-readable relative string (e.g. "2m ago", "1h ago", "3d ago").
 * Returns "Never" if date is null/undefined.
 */
export function formatDistanceToNow(date: Date | string | null | undefined): string {
  if (!date) return 'Never'
  const d = typeof date === 'string' ? new Date(date) : date
  if (isNaN(d.getTime())) return 'Never'
  return fdfn(d, { addSuffix: true })
}
