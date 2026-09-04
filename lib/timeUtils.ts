import { 
  DEFAULT_TIMEZONE, 
  formatLocalDateString, 
  getLocalDateRangeLimits, 
  formatLocalTransactionDate, 
  DateRangeKey 
} from './localzone'

export { DEFAULT_TIMEZONE }

/**
 * Format a Date object or ISO string into a local YYYY-MM-DD string without timezone shift.
 */
export function getLocalDateString(dateInput?: string | Date | null, timezone: string = DEFAULT_TIMEZONE): string {
  if (!dateInput) {
    return formatLocalDateString(new Date(), timezone)
  }
  const d = typeof dateInput === 'string' ? new Date(dateInput) : dateInput
  if (isNaN(d.getTime())) return ''
  return formatLocalDateString(d, timezone)
}

/**
 * Format transaction date for DB insertion/update using business timezone awareness.
 */
export function formatTransactionDate(
  dateInput?: string | Date | null,
  existingDate?: string,
  timezone: string = DEFAULT_TIMEZONE
): string {
  return formatLocalTransactionDate(dateInput, timezone, existingDate)
}

/**
 * Sort transactions array by date descending (newest timestamp at top).
 * Ties in date timestamp are broken deterministically by secondary order (array index in reverse).
 */
export function sortTransactionsNewestFirst<T extends { date: string }>(items: T[]): T[] {
  if (!Array.isArray(items) || items.length <= 1) return items ? [...items] : []

  // Create array with original index to break ties deterministically
  const indexed = items.map((item, index) => ({ item, index }))

  indexed.sort((a, b) => {
    const timeA = new Date(a.item.date).getTime()
    const timeB = new Date(b.item.date).getTime()

    if (!isNaN(timeA) && !isNaN(timeB) && timeA !== timeB) {
      return timeB - timeA // Newest date/timestamp first
    }
    // Tie-breaker: if exact same date timestamp, item inserted/fetched later comes first
    return b.index - a.index
  })

  return indexed.map(entry => entry.item)
}

/**
 * Format date for display in Indonesian locale with timezone awareness.
 * Modes:
 * - 'short': 20 Agt 2026
 * - 'medium': 20 Agustus 2026
 * - 'datetime': 20 Agt 2026, 10:28 WIB
 * - 'full': Kamis, 20 Agustus 2026 10:28 WIB
 * - 'time': 10:28 WIB
 */
export function formatDisplayDate(
  dateInput?: string | Date | null,
  mode: 'short' | 'medium' | 'datetime' | 'full' | 'time' = 'datetime',
  timezone: string = DEFAULT_TIMEZONE
): string {
  if (!dateInput) return '-'
  const d = typeof dateInput === 'string' ? new Date(dateInput) : dateInput
  if (isNaN(d.getTime())) return '-'

  try {
    switch (mode) {
      case 'short':
        return d.toLocaleDateString('id-ID', {
          timeZone: timezone,
          day: 'numeric',
          month: 'short',
          year: 'numeric',
        })
      case 'medium':
        return d.toLocaleDateString('id-ID', {
          timeZone: timezone,
          day: 'numeric',
          month: 'long',
          year: 'numeric',
        })
      case 'time':
        return d.toLocaleTimeString('id-ID', {
          timeZone: timezone,
          hour: '2-digit',
          minute: '2-digit',
        }) + ' ' + getTimezoneAbbr(timezone)
      case 'full':
        return d.toLocaleDateString('id-ID', {
          timeZone: timezone,
          weekday: 'long',
          day: 'numeric',
          month: 'long',
          year: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
        }) + ' ' + getTimezoneAbbr(timezone)
      case 'datetime':
      default:
        return d.toLocaleDateString('id-ID', {
          timeZone: timezone,
          day: 'numeric',
          month: 'short',
          year: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
        }) + ' ' + getTimezoneAbbr(timezone)
    }
  } catch (e) {
    return d.toISOString()
  }
}

/**
 * Helper to get timezone abbreviation (e.g. WIB, WITA, WIT, UTC).
 */
export function getTimezoneAbbr(timezone: string = DEFAULT_TIMEZONE): string {
  switch (timezone) {
    case 'Asia/Jakarta':
    case 'Asia/Pontianak':
      return 'WIB'
    case 'Asia/Makassar':
    case 'Asia/Denpasar':
    case 'Asia/Manado':
      return 'WITA'
    case 'Asia/Jayapura':
      return 'WIT'
    case 'UTC':
      return 'UTC'
    default:
      return ''
  }
}

/**
 * Get ISO start & end limits for common date range keys accounting for local timezone.
 */
export function getTimezoneDateRangeLimits(
  key: string,
  timezone: string = DEFAULT_TIMEZONE
): { start: string; end: string } {
  const now = new Date()
  const todayKey = getLocalDateString(now, timezone)
  const [yearStr, monthStr, dayStr] = todayKey.split('-')
  const year = parseInt(yearStr, 10)
  const month = parseInt(monthStr, 10) - 1

  let startStr = todayKey
  let endStr = todayKey

  switch (key) {
    case 'today':
      startStr = todayKey
      endStr = todayKey
      break
    case 'yesterday': {
      const yesterday = new Date(now.getTime() - 86400000)
      startStr = getLocalDateString(yesterday, timezone)
      endStr = startStr
      break
    }
    case 'this-month': {
      const firstDay = new Date(year, month, 1)
      const lastDay = new Date(year, month + 1, 0)
      startStr = getLocalDateString(firstDay, timezone)
      endStr = getLocalDateString(lastDay, timezone)
      break
    }
    case 'last-month': {
      const firstDay = new Date(year, month - 1, 1)
      const lastDay = new Date(year, month, 0)
      startStr = getLocalDateString(firstDay, timezone)
      endStr = getLocalDateString(lastDay, timezone)
      break
    }
    case 'this-year': {
      startStr = `${year}-01-01`
      endStr = `${year}-12-31`
      break
    }
    default:
      startStr = todayKey
      endStr = todayKey
      break
  }

  return { start: startStr, end: endStr }
}
