/**
 * Global Localzone Module for ShapeUp CRM
 * Standardized timezone handling, date range generation, local-to-UTC conversion,
 * transaction date formatting, and consistency checking for accounting functions.
 */

export const DEFAULT_TIMEZONE = 'Asia/Jakarta'

export type DateRangeKey =
  | 'this-month'
  | 'this-quarter'
  | 'this-year'
  | 'last-month'
  | 'last-quarter'
  | 'last-year'
  | 'custom'
  | 'today'
  | 'yesterday'

/**
 * Resolves business timezone, falling back to default global timezone (Asia/Jakarta).
 */
export function getBusinessTimezone(tz?: string | null): string {
  if (!tz || typeof tz !== 'string' || !tz.trim()) {
    return DEFAULT_TIMEZONE
  }
  const clean = tz.trim()
  try {
    // Validate IANA timezone
    Intl.DateTimeFormat(undefined, { timeZone: clean })
    return clean
  } catch (e) {
    console.warn(`Invalid timezone '${clean}' provided, falling back to '${DEFAULT_TIMEZONE}'`)
    return DEFAULT_TIMEZONE
  }
}

/**
 * Format a JavaScript Date into local YYYY-MM-DD string in specified timezone.
 */
export function formatLocalDateString(date: Date = new Date(), timezone: string = DEFAULT_TIMEZONE): string {
  const tz = getBusinessTimezone(timezone)
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
  return formatter.format(date) // Returns YYYY-MM-DD
}

/**
 * Calculate preset local YYYY-MM-DD date range limits in business timezone (not browser time).
 */
export function getLocalDateRangeLimits(
  key: DateRangeKey,
  timezone: string = DEFAULT_TIMEZONE
): { start: string; end: string } {
  const tz = getBusinessTimezone(timezone)
  const now = new Date()
  const todayStr = formatLocalDateString(now, tz)
  const [yearStr, monthStr] = todayStr.split('-')
  const year = parseInt(yearStr, 10)
  const month = parseInt(monthStr, 10) - 1 // 0-indexed month

  const toIsoStr = (d: Date) => formatLocalDateString(d, tz)

  switch (key) {
    case 'today':
      return { start: todayStr, end: todayStr }
    case 'yesterday': {
      const yesterday = new Date(now.getTime() - 86400000)
      const yStr = toIsoStr(yesterday)
      return { start: yStr, end: yStr }
    }
    case 'this-month': {
      const start = new Date(Date.UTC(year, month, 1))
      const end = new Date(Date.UTC(year, month + 1, 0))
      return { start: toIsoStr(start), end: toIsoStr(end) }
    }
    case 'this-quarter': {
      const q = Math.floor(month / 3)
      const start = new Date(Date.UTC(year, q * 3, 1))
      const end = new Date(Date.UTC(year, (q + 1) * 3, 0))
      return { start: toIsoStr(start), end: toIsoStr(end) }
    }
    case 'this-year': {
      const start = new Date(Date.UTC(year, 0, 1))
      const end = new Date(Date.UTC(year, 11, 31))
      return { start: toIsoStr(start), end: toIsoStr(end) }
    }
    case 'last-month': {
      const start = new Date(Date.UTC(year, month - 1, 1))
      const end = new Date(Date.UTC(year, month, 0))
      return { start: toIsoStr(start), end: toIsoStr(end) }
    }
    case 'last-quarter': {
      const q = Math.floor(month / 3) - 1
      const targetYear = q < 0 ? year - 1 : year
      const targetQ = q < 0 ? 3 : q
      const start = new Date(Date.UTC(targetYear, targetQ * 3, 1))
      const end = new Date(Date.UTC(targetYear, (targetQ + 1) * 3, 0))
      return { start: toIsoStr(start), end: toIsoStr(end) }
    }
    case 'last-year': {
      const start = new Date(Date.UTC(year - 1, 0, 1))
      const end = new Date(Date.UTC(year - 1, 11, 31))
      return { start: toIsoStr(start), end: toIsoStr(end) }
    }
    case 'custom':
    default: {
      const start = new Date(Date.UTC(year, month, 1))
      const end = new Date(Date.UTC(year, month + 1, 0))
      return { start: toIsoStr(start), end: toIsoStr(end) }
    }
  }
}

/**
 * Convert local calendar date (YYYY-MM-DD) and local time string (HH:mm:ss.sss)
 * in business timezone to UTC ISO string.
 */
export function getUtcTimestampInTimezone(
  dateStr: string,
  timeStr: string,
  timezone: string = DEFAULT_TIMEZONE
): string {
  const tz = getBusinessTimezone(timezone)
  const [year, month, day] = dateStr.split('-').map(Number)
  const timeParts = timeStr.split('.')[0].split(':').map(Number)
  const hours = timeParts[0] || 0
  const minutes = timeParts[1] || 0
  const seconds = timeParts[2] || 0
  const ms = Number(timeStr.split('.')[1] || 0)

  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  })

  const utcDate = new Date(Date.UTC(year, month - 1, day, hours, minutes, seconds, ms))
  const parts = formatter.formatToParts(utcDate)
  const partValues: Record<string, number> = {}
  parts.forEach(p => {
    if (p.type !== 'literal') {
      partValues[p.type] = Number(p.value)
    }
  })

  const fMonth = partValues.month
  const fDay = partValues.day
  const fYear = partValues.year
  const fHour = partValues.hour === 24 ? 0 : partValues.hour
  const fMin = partValues.minute
  const fSec = partValues.second

  const formattedUtc = new Date(Date.UTC(fYear, fMonth - 1, fDay, fHour, fMin, fSec, ms))
  const diffMs = utcDate.getTime() - formattedUtc.getTime()
  const targetDate = new Date(utcDate.getTime() + diffMs)

  return targetDate.toISOString()
}

/**
 * Helper to get exact startOfDay (00:00:00.000) and endOfDay (23:59:59.999) ISO strings for DB queries.
 */
export function localDateToUtcBounds(
  startDate?: string | null,
  endDate?: string | null,
  timezone: string = DEFAULT_TIMEZONE
): { startOfDayISO: string | null; endOfDayISO: string | null } {
  const tz = getBusinessTimezone(timezone)
  const startOfDayISO = startDate ? getUtcTimestampInTimezone(startDate, '00:00:00.000', tz) : null
  const endOfDayISO = endDate ? getUtcTimestampInTimezone(endDate, '23:59:59.999', tz) : null

  return { startOfDayISO, endOfDayISO }
}

/**
 * Formats a transaction date string for database storage.
 * Ensures the date component strictly matches the intended local date in business timezone.
 */
export function formatLocalTransactionDate(
  dateInput?: string | Date | null,
  timezone: string = DEFAULT_TIMEZONE,
  existingDate?: string
): string {
  const tz = getBusinessTimezone(timezone)
  if (!dateInput) return new Date().toISOString()

  if (typeof dateInput !== 'string') {
    return dateInput.toISOString()
  }

  const trimmed = dateInput.trim()
  if (!trimmed) return new Date().toISOString()

  // If full ISO timestamp with explicit non-midnight time, keep it
  if (trimmed.includes('T') && trimmed.length > 10) {
    const parsed = new Date(trimmed)
    if (!isNaN(parsed.getTime())) {
      if (parsed.getUTCHours() !== 0 || parsed.getUTCMinutes() !== 0 || parsed.getUTCSeconds() !== 0) {
        return parsed.toISOString()
      }
    }
  }

  // Extract YYYY-MM-DD
  const dateOnly = trimmed.split('T')[0]
  if (existingDate && existingDate.startsWith(dateOnly) && existingDate.includes('T')) {
    const existingParsed = new Date(existingDate)
    if (!isNaN(existingParsed.getTime()) && (existingParsed.getUTCHours() !== 0 || existingParsed.getUTCMinutes() !== 0)) {
      return existingDate
    }
  }

  // Get current local time of day in business timezone
  const now = new Date()
  const timeFormatter = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  })

  const parts = timeFormatter.formatToParts(now)
  const partValues: Record<string, string> = {}
  parts.forEach(p => {
    if (p.type !== 'literal') {
      partValues[p.type] = p.value.padStart(2, '0')
    }
  })

  const localTimeStr = `${partValues.hour || '12'}:${partValues.minute || '00'}:${partValues.second || '00'}.000`

  // Return ISO timestamp representing dateOnly + localTimeStr in timezone
  return getUtcTimestampInTimezone(dateOnly, localTimeStr, tz)
}

export type LocalzoneCheckReport = {
  timezone: string
  valid: boolean
  currentLocalTime: string
  currentUtcTime: string
  utcOffsetHours: number
  sampleRange: {
    key: DateRangeKey
    localStart: string
    localEnd: string
    utcStartISO: string
    utcEndISO: string
  }
}

/**
 * Diagnostic checker function to inspect localzone configuration and consistency.
 */
export function checkLocalzoneConsistency(
  timezoneInput?: string | null,
  sampleKey: DateRangeKey = 'this-month'
): LocalzoneCheckReport {
  const tz = getBusinessTimezone(timezoneInput)
  const now = new Date()

  // Calculate current UTC offset in hours
  const localStr = formatLocalDateString(now, tz)
  const nowUtc = now.toISOString()

  const range = getLocalDateRangeLimits(sampleKey, tz)
  const bounds = localDateToUtcBounds(range.start, range.end, tz)

  // Calculate offset hours
  const startUtc = new Date(bounds.startOfDayISO!)
  const localStartDate = new Date(`${range.start}T00:00:00Z`)
  const offsetMs = localStartDate.getTime() - startUtc.getTime()
  const offsetHours = offsetMs / (1000 * 60 * 60)

  return {
    timezone: tz,
    valid: true,
    currentLocalTime: `${localStr} (in ${tz})`,
    currentUtcTime: nowUtc,
    utcOffsetHours: offsetHours,
    sampleRange: {
      key: sampleKey,
      localStart: range.start,
      localEnd: range.end,
      utcStartISO: bounds.startOfDayISO || '',
      utcEndISO: bounds.endOfDayISO || '',
    },
  }
}
