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

export type ComparisonMode = 'none' | 'previous_period' | 'previous_year' | 'custom'

/**
 * Checks whether a given year is a leap year (tahun kabisat).
 */
export function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0
}

/**
 * Pure UTC-calendar formatter: converts (year, 0-indexed month, day) into YYYY-MM-DD
 * without passing through local browser/server timezone or secondary Intl formatting.
 */
export function formatCalendarYMD(year: number, monthIndex0: number, day: number): string {
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
 * Given a local calendar range [startLocal, endLocal] (YYYY-MM-DD),
 * calculates the corresponding same period in the previous year (Year-over-Year / YoY).
 * Handles leap years safely (Feb 29 -> Feb 28 on non-leap years).
 */
export function getPreviousYearDateRangeLimits(
  startLocal: string,
  endLocal: string
): { start: string; end: string; daysCount: number } {
  const [sy, sm, sd] = (startLocal || '').split('-').map(Number)
  const [ey, em, ed] = (endLocal || '').split('-').map(Number)
  if (!sy || !sm || !sd || !ey || !em || !ed) {
    return { start: startLocal, end: endLocal, daysCount: 1 }
  }

  const prevStartYear = sy - 1
  const prevEndYear = ey - 1

  const safeStartDay = sm === 2 && sd === 29 && !isLeapYear(prevStartYear) ? 28 : sd
  const safeEndDay = em === 2 && ed === 29 && !isLeapYear(prevEndYear) ? 28 : ed

  const prevStart = formatCalendarYMD(prevStartYear, sm - 1, safeStartDay)
  const prevEnd = formatCalendarYMD(prevEndYear, em - 1, safeEndDay)

  const [psy, psm, psd] = prevStart.split('-').map(Number)
  const [pey, pem, ped] = prevEnd.split('-').map(Number)
  const startUtcMs = Date.UTC(psy, psm - 1, psd)
  const endUtcMs = Date.UTC(pey, pem - 1, ped)
  const spanDays = Math.max(1, Math.round(Math.abs(endUtcMs - startUtcMs) / 86400000) + 1)

  return { start: prevStart, end: prevEnd, daysCount: spanDays }
}

/**
 * Universal resolver for comparison bounds based on comparison mode.
 */
export function resolveComparisonRange(
  mode: ComparisonMode,
  startLocal: string,
  endLocal: string,
  customCompStart?: string,
  customCompEnd?: string
): { start: string; end: string; daysCount: number; label: string } {
  if (mode === 'none' || !startLocal || !endLocal) {
    return { start: '', end: '', daysCount: 0, label: 'Tanpa Perbandingan' }
  }

  if (mode === 'previous_year') {
    const limits = getPreviousYearDateRangeLimits(startLocal, endLocal)
    return { ...limits, label: 'Tahun Lalu (YoY)' }
  }

  if (mode === 'custom' && customCompStart && customCompEnd) {
    const [csy, csm, csd] = customCompStart.split('-').map(Number)
    const [cey, cem, ced] = customCompEnd.split('-').map(Number)
    const startUtcMs = Date.UTC(csy, csm - 1, csd)
    const endUtcMs = Date.UTC(cey, cem - 1, ced)
    const spanDays = Math.max(1, Math.round(Math.abs(endUtcMs - startUtcMs) / 86400000) + 1)
    return { start: customCompStart, end: customCompEnd, daysCount: spanDays, label: 'Kustom' }
  }

  // Default: previous_period
  const limits = getPreviousDateRangeLimits(startLocal, endLocal)
  return { ...limits, label: 'Periode Sebelumnya' }
}

/**
 * Localized label for Comparison Mode.
 */
export function getComparisonModeLabel(mode: ComparisonMode): string {
  switch (mode) {
    case 'previous_period':
      return 'Periode Sebelumnya'
    case 'previous_year':
      return 'Tahun Lalu (YoY)'
    case 'custom':
      return 'Kustom'
    case 'none':
    default:
      return 'Tanpa Perbandingan'
  }
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
  customEnd?: string,
  comparisonMode: ComparisonMode = 'previous_period',
  customCompStart?: string,
  customCompEnd?: string
): PeriodComparisonBounds {
  const tz = getBusinessTimezone(timezone)
  const range =
    preset === 'custom' && customStart && customEnd
      ? { start: customStart, end: customEnd }
      : getLocalDateRangeLimits(preset, tz)

  const compRange = resolveComparisonRange(
    comparisonMode,
    range.start,
    range.end,
    customCompStart,
    customCompEnd
  )
  const currBounds = localDateToUtcBounds(range.start, range.end, tz)
  const prevBounds =
    compRange.start && compRange.end
      ? localDateToUtcBounds(compRange.start, compRange.end, tz)
      : { startOfDayISO: '', endOfDayISO: '' }

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
      startLocal: compRange.start,
      endLocal: compRange.end,
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

/**
 * Resolves a raw date value from Excel, CSV, or text into a valid UTC ISO string,
 * taking into account whether the raw data represents local business time or UTC.
 * 
 * - If isLocalZone is true: wall-clock date/time from the file is interpreted in business timezone,
 *   then accurately converted to UTC ISO (preventing unwanted +7 / +8 / +9 hour shifts).
 * - If isLocalZone is false: date/time is treated as already in UTC format.
 */
export function parseAndResolveOrderDate(
  rawVal: any,
  isLocalZone: boolean = true,
  timezone: string = DEFAULT_TIMEZONE
): string | null {
  if (rawVal === undefined || rawVal === null || rawVal === '') return null

  const tz = getBusinessTimezone(timezone)

  // Case 1: JavaScript Date object (e.g. from SheetJS cellDates: true)
  if (rawVal instanceof Date) {
    if (isNaN(rawVal.getTime())) return null

    const y = rawVal.getFullYear()
    const m = rawVal.getMonth() + 1
    const d = rawVal.getDate()
    const h = rawVal.getHours()
    const min = rawVal.getMinutes()
    const s = rawVal.getSeconds()

    if (!isLocalZone) {
      return new Date(Date.UTC(y, m - 1, d, h, min, s)).toISOString()
    }

    const dateStr = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
    const timeStr = `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}:${String(s).padStart(2, '0')}.000`
    return getUtcTimestampInTimezone(dateStr, timeStr, tz)
  }

  // Case 2: Numeric Excel serial date (e.g. 46310.60416)
  if (typeof rawVal === 'number' && !isNaN(rawVal)) {
    try {
      const ms = Math.round((rawVal - 25569) * 86400 * 1000)
      const d = new Date(ms)
      if (!isNaN(d.getTime())) {
        if (!isLocalZone) return d.toISOString()
        const y = d.getUTCFullYear()
        const m = d.getUTCMonth() + 1
        const dd = d.getUTCDate()
        const h = d.getUTCHours()
        const min = d.getUTCMinutes()
        const s = d.getUTCSeconds()
        const dateStr = `${y}-${String(m).padStart(2, '0')}-${String(dd).padStart(2, '0')}`
        const timeStr = `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}:${String(s).padStart(2, '0')}.000`
        return getUtcTimestampInTimezone(dateStr, timeStr, tz)
      }
    } catch {
      // Fallback to string handling
    }
  }

  // Case 3: String date representation
  const str = String(rawVal).trim()
  if (!str) return null

  // If string contains explicit timezone offset preceded by time (e.g. 2026-10-15T14:30:00+07:00 or 14:30:00Z)
  const hasExplicitTz = /(?:T|\s)\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?\s*(Z|[+-]\d{2}(?::?\d{2})?)$/i.test(str)
  if (hasExplicitTz) {
    const d = new Date(str)
    if (!isNaN(d.getTime())) return d.toISOString()
  }

  // Split into datePart and timePart
  const [datePart, timePart] = str.split(/[ T]/)
  let hours = 12
  let minutes = 0
  let seconds = 0

  if (timePart) {
    const tPieces = timePart.split(':')
    hours = parseInt(tPieces[0], 10) || 0
    minutes = parseInt(tPieces[1], 10) || 0
    seconds = parseInt(tPieces[2], 10) || 0
  }

  let year = new Date().getFullYear()
  let month = 1
  let day = 1

  const dPieces = (datePart || '').split(/[-/.]/)
  if (dPieces.length === 3) {
    if (dPieces[0].length === 4) {
      // YYYY-MM-DD or YYYY/MM/DD
      year = parseInt(dPieces[0], 10)
      month = parseInt(dPieces[1], 10)
      day = parseInt(dPieces[2], 10)
    } else if (dPieces[2].length === 4) {
      // DD-MM-YYYY or DD/MM/YYYY
      day = parseInt(dPieces[0], 10)
      month = parseInt(dPieces[1], 10)
      year = parseInt(dPieces[2], 10)
    } else if (dPieces[2].length === 2) {
      // DD-MM-YY or DD/MM/YY
      day = parseInt(dPieces[0], 10)
      month = parseInt(dPieces[1], 10)
      year = 2000 + parseInt(dPieces[2], 10)
    }
  } else {
    // Fallback parsing via standard Date
    const fallback = new Date(str)
    if (!isNaN(fallback.getTime())) {
      if (!isLocalZone) return fallback.toISOString()
      year = fallback.getFullYear()
      month = fallback.getMonth() + 1
      day = fallback.getDate()
      hours = fallback.getHours()
      minutes = fallback.getMinutes()
      seconds = fallback.getSeconds()
    } else {
      return null
    }
  }

  const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
  const timeStr = `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.000`

  if (isLocalZone) {
    return getUtcTimestampInTimezone(dateStr, timeStr, tz)
  } else {
    return new Date(Date.UTC(year, month - 1, day, hours, minutes, seconds)).toISOString()
  }
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
