/**
 * Global Localzone Module for ShapeUp CRM
 * Standardized timezone handling, date range generation, local-to-UTC conversion,
 * transaction date formatting, and consistency checking for accounting functions.
 */

export const DEFAULT_TIMEZONE = 'Asia/Jakarta'

export type DateRangeKey =
  | 'this-month'
  | 'thisMonth'
  | 'this-quarter'
  | 'this-year'
  | 'last-month'
  | 'lastMonth'
  | 'last-quarter'
  | 'last-year'
  | 'last-7'
  | 'last7'
  | 'last-30'
  | 'last30'
  | 'custom'
  | 'today'
  | 'yesterday'
  | 'all'

/**
 * Pure UTC-calendar formatter: converts (year, 0-indexed month, day) into YYYY-MM-DD
 * without passing through local browser/server timezone or secondary Intl formatting.
 */
function formatCalendarYMD(year: number, monthIndex0: number, day: number): string {
  const d = new Date(Date.UTC(year, monthIndex0, day))
  const y = d.getUTCFullYear()
  const m = String(d.getUTCMonth() + 1).padStart(2, '0')
  const dd = String(d.getUTCDate()).padStart(2, '0')
  return `${y}-${m}-${dd}`
}

/**
 * Shifts a YYYY-MM-DD calendar date by `deltaDays` purely in calendar space (immune to DST/browser timezone).
 */
export function shiftLocalCalendarDate(dateStr: string, deltaDays: number): string {
  const parts = (dateStr || '').split('-').map(Number)
  if (parts.length < 3 || !parts[0] || !parts[1] || !parts[2]) return dateStr
  return formatCalendarYMD(parts[0], parts[1] - 1, parts[2] + deltaDays)
}

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
  key: DateRangeKey | string,
  timezone: string = DEFAULT_TIMEZONE
): { start: string; end: string } {
  const tz = getBusinessTimezone(timezone)
  const now = new Date()
  const todayStr = formatLocalDateString(now, tz)
  const [yearStr, monthStr] = todayStr.split('-')
  const year = parseInt(yearStr, 10)
  const month = parseInt(monthStr, 10) - 1 // 0-indexed month

  switch (key) {
    case 'today':
      return { start: todayStr, end: todayStr }
    case 'yesterday': {
      const yStr = shiftLocalCalendarDate(todayStr, -1)
      return { start: yStr, end: yStr }
    }
    case 'last-7':
    case 'last7': {
      return { start: shiftLocalCalendarDate(todayStr, -6), end: todayStr }
    }
    case 'last-30':
    case 'last30': {
      return { start: shiftLocalCalendarDate(todayStr, -29), end: todayStr }
    }
    case 'this-month':
    case 'thisMonth': {
      return {
        start: formatCalendarYMD(year, month, 1),
        end: formatCalendarYMD(year, month + 1, 0),
      }
    }
    case 'this-quarter': {
      const q = Math.floor(month / 3)
      return {
        start: formatCalendarYMD(year, q * 3, 1),
        end: formatCalendarYMD(year, (q + 1) * 3, 0),
      }
    }
    case 'this-year': {
      return {
        start: `${year}-01-01`,
        end: `${year}-12-31`,
      }
    }
    case 'last-month':
    case 'lastMonth': {
      return {
        start: formatCalendarYMD(year, month - 1, 1),
        end: formatCalendarYMD(year, month, 0),
      }
    }
    case 'last-quarter': {
      const q = Math.floor(month / 3) - 1
      const targetYear = q < 0 ? year - 1 : year
      const targetQ = q < 0 ? 3 : q
      return {
        start: formatCalendarYMD(targetYear, targetQ * 3, 1),
        end: formatCalendarYMD(targetYear, (targetQ + 1) * 3, 0),
      }
    }
    case 'last-year': {
      return {
        start: `${year - 1}-01-01`,
        end: `${year - 1}-12-31`,
      }
    }
    case 'all': {
      return { start: '', end: '' }
    }
    case 'custom':
    default: {
      return {
        start: formatCalendarYMD(year, month, 1),
        end: formatCalendarYMD(year, month + 1, 0),
      }
    }
  }
}

/**
 * Given a local calendar range [startLocal, endLocal] (YYYY-MM-DD),
 * deterministically computes the immediately preceding period of the exact same length in days.
 */
export function getPreviousDateRangeLimits(
  startLocal: string,
  endLocal: string
): { start: string; end: string; daysCount: number } {
  const [sy, sm, sd] = (startLocal || '').split('-').map(Number)
  const [ey, em, ed] = (endLocal || '').split('-').map(Number)
  if (!sy || !sm || !sd || !ey || !em || !ed) {
    return { start: startLocal, end: endLocal, daysCount: 1 }
  }
  const startUtcMs = Date.UTC(sy, sm - 1, sd)
  const endUtcMs = Date.UTC(ey, em - 1, ed)
  const spanDays = Math.max(1, Math.round(Math.abs(endUtcMs - startUtcMs) / 86400000) + 1)

  const prevEnd = shiftLocalCalendarDate(startLocal, -1)
  const prevStart = shiftLocalCalendarDate(startLocal, -spanDays)
  return { start: prevStart, end: prevEnd, daysCount: spanDays }
}

/**
 * Returns localized Indonesian label for any preset date range key.
 */
export function getDateRangeLabel(key: DateRangeKey | string): string {
  switch (key) {
    case 'today':
      return 'Hari Ini'
    case 'yesterday':
      return 'Kemarin'
    case 'last-7':
    case 'last7':
      return '7 Hari Terakhir'
    case 'last-30':
    case 'last30':
      return '30 Hari Terakhir'
    case 'this-month':
    case 'thisMonth':
      return 'Bulan Ini'
    case 'last-month':
    case 'lastMonth':
      return 'Bulan Lalu'
    case 'this-quarter':
      return 'Kuartal Ini'
    case 'last-quarter':
      return 'Kuartal Lalu'
    case 'this-year':
      return 'Tahun Ini'
    case 'last-year':
      return 'Tahun Lalu'
    case 'all':
      return 'Semua Waktu'
    case 'custom':
    default:
      return 'Kustom Tanggal'
  }
}

/**
 * Returns localized Indonesian time-of-day greeting evaluated in the business timezone.
 */
export function getLocalizedGreeting(
  timezone?: string | null,
  date: Date = new Date()
): string {
  const tz = getBusinessTimezone(timezone)
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hour: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(date)
    const hourStr = parts.find(p => p.type === 'hour')?.value
    const hour = hourStr !== undefined ? parseInt(hourStr, 10) : date.getHours()

    if (hour >= 4 && hour < 11) return 'Selamat Pagi'
    if (hour >= 11 && hour < 15) return 'Selamat Siang'
    if (hour >= 15 && hour < 18) return 'Selamat Sore'
    return 'Selamat Malam'
  } catch {
    const hour = date.getHours()
    if (hour >= 4 && hour < 11) return 'Selamat Pagi'
    if (hour >= 11 && hour < 15) return 'Selamat Siang'
    if (hour >= 15 && hour < 18) return 'Selamat Sore'
    return 'Selamat Malam'
  }
}

/**
 * Extracts canonical timestamp string from an order record using fallback hierarchy:
 * order_date_utc -> order_date -> created_at
 */
export function resolveOrderTimestamp(
  order?: {
    order_date_utc?: string | null
    order_date?: string | null
    created_at?: string | null
    date?: string | null
  } | null
): string {
  if (!order) return ''
  return order.order_date_utc || order.order_date || order.date || order.created_at || ''
}

/**
 * Converts an order record (or raw ISO/Date) into a YYYY-MM-DD local calendar key in the business timezone.
 */
export function getOrderLocalDateKey(
  input?:
    | {
        order_date_utc?: string | null
        order_date?: string | null
        created_at?: string | null
        date?: string | null
      }
    | string
    | Date
    | null,
  timezone?: string | null
): string {
  if (!input) return ''
  const tz = getBusinessTimezone(timezone)
  let raw: string | Date = ''
  if (input instanceof Date || typeof input === 'string') {
    raw = input
  } else {
    raw = resolveOrderTimestamp(input)
  }
  if (!raw) return ''
  if (typeof raw === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(raw.trim())) {
    return raw.trim()
  }
  const d = typeof raw === 'string' ? new Date(raw) : raw
  if (isNaN(d.getTime())) return ''
  return formatLocalDateString(d, tz)
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

export type PeriodComparisonBounds = {
  timezone: string
  label: string
  current: {
    startLocal: string
    endLocal: string
    startOfDayISO: string
    endOfDayISO: string
  }
  previous: {
    startLocal: string
    endLocal: string
    startOfDayISO: string
    endOfDayISO: string
  }
}

/**
 * Universal helper to compute both Current Period and Previous Comparison Period
 * in local YYYY-MM-DD and exact UTC ISO bounds for any preset or custom date range.
 */
export function getPeriodComparisonBounds(
  preset: DateRangeKey | string,
  timezone?: string | null,
  customStart?: string,
  customEnd?: string
): PeriodComparisonBounds {
  const tz = getBusinessTimezone(timezone)
  const range =
    preset === 'custom' && customStart && customEnd
      ? { start: customStart, end: customEnd }
      : getLocalDateRangeLimits(preset, tz)

  const prevRange = getPreviousDateRangeLimits(range.start, range.end)
  const currBounds = localDateToUtcBounds(range.start, range.end, tz)
  const prevBounds = localDateToUtcBounds(prevRange.start, prevRange.end, tz)

  return {
    timezone: tz,
    label: getDateRangeLabel(preset),
    current: {
      startLocal: range.start,
      endLocal: range.end,
      startOfDayISO: currBounds.startOfDayISO || '',
      endOfDayISO: currBounds.endOfDayISO || '',
    },
    previous: {
      startLocal: prevRange.start,
      endLocal: prevRange.end,
      startOfDayISO: prevBounds.startOfDayISO || '',
      endOfDayISO: prevBounds.endOfDayISO || '',
    },
  }
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
