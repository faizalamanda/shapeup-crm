"use client"

import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import {
  DateRangeKey,
  ComparisonMode,
  DEFAULT_TIMEZONE,
  getBusinessTimezone,
  getLocalDateRangeLimits,
  getDateRangeLabel,
  resolveComparisonRange,
  getComparisonModeLabel,
  formatLocalDateString,
  shiftLocalCalendarDate,
  formatCalendarYMD,
} from '@/lib/localzone'
import { FullScreenModal } from './FullScreenModal'

export interface TemporalFilterValue {
  startDate: string // YYYY-MM-DD
  endDate: string // YYYY-MM-DD
  preset: DateRangeKey
  comparisonMode: ComparisonMode
  comparisonStartDate: string // YYYY-MM-DD
  comparisonEndDate: string // YYYY-MM-DD
  comparisonLabel?: string
}

export interface TemporalDateFilterProps {
  value?: TemporalFilterValue
  defaultValue?: Partial<TemporalFilterValue>
  onChange?: (val: TemporalFilterValue) => void
  timezone?: string
  allowAllTime?: boolean
  showComparison?: boolean
  className?: string
  align?: 'left' | 'right'
  primaryLabel?: string
  comparisonLabel?: string
}

const PRESET_GROUPS: { label: string; presets: { key: DateRangeKey; label: string }[] }[] = [
  {
    label: 'Cepat & Harian',
    presets: [
      { key: 'today', label: 'Hari Ini' },
      { key: 'yesterday', label: 'Kemarin' },
      { key: 'last-7', label: '7 Hari Terakhir' },
      { key: 'last-30', label: '30 Hari Terakhir' },
    ],
  },
  {
    label: 'Bulan',
    presets: [
      { key: 'this-month', label: 'Bulan Ini' },
      { key: 'last-month', label: 'Bulan Lalu' },
    ],
  },
  {
    label: 'Kuartal & Tahun',
    presets: [
      { key: 'this-quarter', label: 'Kuartal Ini' },
      { key: 'last-quarter', label: 'Kuartal Lalu' },
      { key: 'this-year', label: 'Tahun Ini' },
      { key: 'last-year', label: 'Tahun Lalu' },
    ],
  },
]

function formatDateDisplay(ymd: string): string {
  if (!ymd) return '-'
  const parts = ymd.split('-')
  if (parts.length < 3) return ymd
  return `${parts[2]}/${parts[1]}/${parts[0]}`
}

function getDaysInMonth(year: number, monthIndex0: number): number {
  return new Date(Date.UTC(year, monthIndex0 + 1, 0)).getUTCDate()
}

function getFirstDayOfWeek(year: number, monthIndex0: number): number {
  // 0 = Sunday, 1 = Monday, ..., 6 = Saturday
  const d = new Date(Date.UTC(year, monthIndex0, 1)).getUTCDay()
  // Convert so Monday = 0, Sunday = 6
  return (d + 6) % 7
}

const MONTH_NAMES_ID = [
  'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
  'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember',
]

const DAY_NAMES_SHORT = ['Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab', 'Min']

export function TemporalDateFilter({
  value,
  defaultValue,
  onChange,
  timezone = DEFAULT_TIMEZONE,
  allowAllTime = false,
  showComparison = true,
  className = '',
  align = 'left',
  primaryLabel = 'Periode Waktu',
  comparisonLabel = 'Perbandingan Waktu',
}: TemporalDateFilterProps) {
  const tz = getBusinessTimezone(timezone)

  // Initialize defaults
  const initialValue = useMemo<TemporalFilterValue>(() => {
    const preset = defaultValue?.preset || 'this-month'
    const limits = getLocalDateRangeLimits(preset, tz)
    const startDate = defaultValue?.startDate || limits.start
    const endDate = defaultValue?.endDate || limits.end
    const compMode = defaultValue?.comparisonMode || 'previous_period'
    const comp = resolveComparisonRange(
      compMode,
      startDate,
      endDate,
      defaultValue?.comparisonStartDate,
      defaultValue?.comparisonEndDate
    )

    return {
      startDate,
      endDate,
      preset,
      comparisonMode: compMode,
      comparisonStartDate: comp.start,
      comparisonEndDate: comp.end,
      comparisonLabel: comp.label,
    }
  }, [defaultValue, tz])

  // Internal state for controlled/uncontrolled
  const [internalValue, setInternalValue] = useState<TemporalFilterValue>(value || initialValue)

  // Sync if controlled prop changes
  useEffect(() => {
    if (value) {
      setInternalValue(value)
    }
  }, [value])

  const activeValue = value || internalValue

  // UI Popover States
  const [isPrimaryOpen, setIsPrimaryOpen] = useState(false)
  const [isComparisonOpen, setIsComparisonOpen] = useState(false)
  const [isMobileModalOpen, setIsMobileModalOpen] = useState(false)
  const [mobileTab, setMobileTab] = useState<'primary' | 'comparison'>('primary')

  // Temporary staging state when picker modal is open
  const [tempStart, setTempStart] = useState(activeValue.startDate)
  const [tempEnd, setTempEnd] = useState(activeValue.endDate)
  const [tempPreset, setTempPreset] = useState<DateRangeKey>(activeValue.preset)
  const [hoverDate, setHoverDate] = useState<string | null>(null)

  // Temporary comparison state
  const [tempCompMode, setTempCompMode] = useState<ComparisonMode>(activeValue.comparisonMode)
  const [tempCompStart, setTempCompStart] = useState(activeValue.comparisonStartDate)
  const [tempCompEnd, setTempCompEnd] = useState(activeValue.comparisonEndDate)

  // Calendar view month & year (displays 2 consecutive months)
  const [viewYear, setViewYear] = useState(() => {
    const p = (activeValue.endDate || activeValue.startDate || formatLocalDateString(new Date(), tz)).split('-')
    return parseInt(p[0] || '2026', 10)
  })
  const [viewMonth, setViewMonth] = useState(() => {
    const p = (activeValue.endDate || activeValue.startDate || formatLocalDateString(new Date(), tz)).split('-')
    return Math.max(0, parseInt(p[1] || '1', 10) - 2) // default to show current & previous month
  })

  // Refs for click outside
  const primaryContainerRef = useRef<HTMLDivElement>(null)
  const comparisonContainerRef = useRef<HTMLDivElement>(null)

  // Reset staging states whenever popover opens
  const openPrimaryPicker = () => {
    setTempStart(activeValue.startDate)
    setTempEnd(activeValue.endDate)
    setTempPreset(activeValue.preset)
    setHoverDate(null)
    setIsPrimaryOpen(true)
    setIsComparisonOpen(false)
  }

  const openComparisonPicker = () => {
    setTempCompMode(activeValue.comparisonMode)
    setTempCompStart(activeValue.comparisonStartDate)
    setTempCompEnd(activeValue.comparisonEndDate)
    setIsComparisonOpen(true)
    setIsPrimaryOpen(false)
  }

  // Handle outside clicks to close desktop popovers
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (primaryContainerRef.current && !primaryContainerRef.current.contains(e.target as Node)) {
        setIsPrimaryOpen(false)
      }
      if (comparisonContainerRef.current && !comparisonContainerRef.current.contains(e.target as Node)) {
        setIsComparisonOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  // Commit changes to parent / state
  const commitChanges = useCallback(
    (newVal: TemporalFilterValue) => {
      if (!value) {
        setInternalValue(newVal)
      }
      onChange?.(newVal)
    },
    [value, onChange]
  )

  // Apply Primary Range selection
  const handleApplyPrimary = () => {
    const comp = resolveComparisonRange(
      activeValue.comparisonMode,
      tempStart,
      tempEnd,
      activeValue.comparisonStartDate,
      activeValue.comparisonEndDate
    )

    const updated: TemporalFilterValue = {
      ...activeValue,
      startDate: tempStart,
      endDate: tempEnd,
      preset: tempPreset,
      comparisonStartDate: comp.start,
      comparisonEndDate: comp.end,
      comparisonLabel: comp.label,
    }

    commitChanges(updated)
    setIsPrimaryOpen(false)
    setIsMobileModalOpen(false)
  }

  // Preset Selection Click
  const handleSelectPreset = (key: DateRangeKey) => {
    setTempPreset(key)
    if (key === 'all') {
      setTempStart('')
      setTempEnd('')
      return
    }
    const limits = getLocalDateRangeLimits(key, tz)
    setTempStart(limits.start)
    setTempEnd(limits.end)
  }

  // Calendar Day Click Handler
  const handleDayClick = (ymd: string) => {
    setTempPreset('custom')
    if (!tempStart || (tempStart && tempEnd)) {
      // First click: start new range
      setTempStart(ymd)
      setTempEnd('')
    } else {
      // Second click: finish range
      if (ymd < tempStart) {
        setTempEnd(tempStart)
        setTempStart(ymd)
      } else {
        setTempEnd(ymd)
      }
    }
  }

  // Comparison Mode Change
  const handleComparisonModeSelect = (mode: ComparisonMode) => {
    setTempCompMode(mode)
    if (mode === 'none') {
      const updated: TemporalFilterValue = {
        ...activeValue,
        comparisonMode: 'none',
        comparisonStartDate: '',
        comparisonEndDate: '',
        comparisonLabel: 'Tanpa Perbandingan',
      }
      commitChanges(updated)
      setIsComparisonOpen(false)
      return
    }

    const comp = resolveComparisonRange(mode, activeValue.startDate, activeValue.endDate)
    const updated: TemporalFilterValue = {
      ...activeValue,
      comparisonMode: mode,
      comparisonStartDate: comp.start,
      comparisonEndDate: comp.end,
      comparisonLabel: comp.label,
    }
    commitChanges(updated)
    if (mode !== 'custom') {
      setIsComparisonOpen(false)
    }
  }

  // Apply Custom Comparison
  const handleApplyCustomComparison = () => {
    const comp = resolveComparisonRange(
      'custom',
      activeValue.startDate,
      activeValue.endDate,
      tempCompStart,
      tempCompEnd
    )
    const updated: TemporalFilterValue = {
      ...activeValue,
      comparisonMode: 'custom',
      comparisonStartDate: tempCompStart,
      comparisonEndDate: tempCompEnd,
      comparisonLabel: comp.label,
    }
    commitChanges(updated)
    setIsComparisonOpen(false)
  }

  // Navigate calendar months
  const handlePrevMonth = () => {
    if (viewMonth === 0) {
      setViewYear(y => y - 1)
      setViewMonth(11)
    } else {
      setViewMonth(m => m - 1)
    }
  }

  const handleNextMonth = () => {
    if (viewMonth === 11) {
      setViewYear(y => y + 1)
      setViewMonth(0)
    } else {
      setViewMonth(m => m + 1)
    }
  }

  // Render Month Grid
  const renderMonthCalendar = (year: number, monthIndex0: number) => {
    const daysInMonth = getDaysInMonth(year, monthIndex0)
    const firstDayIndex = getFirstDayOfWeek(year, monthIndex0)
    const todayYMD = formatLocalDateString(new Date(), tz)

    const days: (number | null)[] = []
    for (let i = 0; i < firstDayIndex; i++) days.push(null)
    for (let d = 1; d <= daysInMonth; d++) days.push(d)

    return (
      <div className="w-[230px] select-none">
        <div className="text-center text-xs font-bold text-slate-800 py-1 mb-1">
          {MONTH_NAMES_ID[monthIndex0]} {year}
        </div>
        <div className="grid grid-cols-7 gap-y-1 text-center text-[11px] font-semibold text-slate-400 mb-1">
          {DAY_NAMES_SHORT.map((dn, idx) => (
            <div key={idx}>{dn}</div>
          ))}
        </div>
        <div className="grid grid-cols-7 gap-y-1 text-center text-xs">
          {days.map((dayNum, idx) => {
            if (dayNum === null) {
              return <div key={`empty-${idx}`} className="h-7 w-7" />
            }
            const ymd = formatCalendarYMD(year, monthIndex0, dayNum)
            const isStart = tempStart === ymd
            const isEnd = tempEnd === ymd
            const isToday = todayYMD === ymd

            let inRange = false
            if (tempStart && tempEnd) {
              inRange = ymd >= tempStart && ymd <= tempEnd
            } else if (tempStart && !tempEnd && hoverDate) {
              const [rangeMin, rangeMax] = tempStart < hoverDate ? [tempStart, hoverDate] : [hoverDate, tempStart]
              inRange = ymd >= rangeMin && ymd <= rangeMax
            }

            return (
              <button
                key={ymd}
                type="button"
                onClick={() => handleDayClick(ymd)}
                onMouseEnter={() => !tempEnd && setHoverDate(ymd)}
                className={`h-7 w-7 mx-auto rounded-md flex items-center justify-center font-medium transition text-xs
                  ${isStart || isEnd ? 'bg-emerald-600 text-white font-bold shadow-sm' : ''}
                  ${inRange && !isStart && !isEnd ? 'bg-emerald-50 text-emerald-800 rounded-none' : ''}
                  ${!isStart && !isEnd && !inRange ? 'text-slate-700 hover:bg-slate-100' : ''}
                  ${isToday && !isStart && !isEnd ? 'border border-emerald-400' : ''}
                `}
              >
                {dayNum}
              </button>
            )
          })}
        </div>
      </div>
    )
  }

  // Calculate days duration for primary preview
  const primaryDurationDays = useMemo(() => {
    if (!tempStart || !tempEnd) return 0
    const [sy, sm, sd] = tempStart.split('-').map(Number)
    const [ey, em, ed] = tempEnd.split('-').map(Number)
    const sUtc = Date.UTC(sy, sm - 1, sd)
    const eUtc = Date.UTC(ey, em - 1, ed)
    return Math.max(1, Math.round(Math.abs(eUtc - sUtc) / 86400000) + 1)
  }, [tempStart, tempEnd])

  return (
    <div className={`relative flex flex-wrap items-end gap-3 text-xs ${className}`}>
      {/* ========================================================================= */}
      {/* DESKTOP BAR (Hidden on Mobile)                                            */}
      {/* ========================================================================= */}
      <div className="hidden sm:flex flex-wrap items-end gap-3">
        {/* GROUP 1: Primary Date Range Button */}
        <div ref={primaryContainerRef} className="relative">
          <label className="block text-[11px] font-semibold text-slate-500 mb-1">
            {primaryLabel}
          </label>
          <button
            type="button"
            onClick={openPrimaryPicker}
            className={`inline-flex items-center gap-2 rounded-xl border px-3.5 py-2 text-xs font-semibold shadow-sm transition active:scale-[0.98] ${
              isPrimaryOpen
                ? 'border-emerald-500 bg-emerald-50/50 text-emerald-900 ring-2 ring-emerald-100'
                : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50'
            }`}
          >
            <svg className="w-4 h-4 text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
            <span>
              {activeValue.preset === 'all'
                ? 'Semua Waktu'
                : `${formatDateDisplay(activeValue.startDate)} – ${formatDateDisplay(activeValue.endDate)}`}
            </span>
            <svg className="w-3.5 h-3.5 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7" />
            </svg>
          </button>

          {/* DESKTOP POPOVER: Dual Month & Presets */}
          {isPrimaryOpen && (
            <div
              className={`absolute top-full mt-2 z-50 bg-white rounded-2xl border border-slate-200 shadow-2xl p-4 w-[680px] max-w-[95vw] ${
                align === 'right' ? 'right-0' : 'left-0'
              }`}
            >
              <div className="flex gap-4">
                {/* Left Column: Preset Shortcuts */}
                <div className="w-[180px] border-r border-slate-100 pr-3 space-y-3">
                  <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400 px-2">
                    Preset Periode
                  </div>
                  <div className="space-y-1 max-h-[340px] overflow-y-auto pr-1">
                    {PRESET_GROUPS.map(group => (
                      <div key={group.label} className="pt-1">
                        <div className="text-[10px] font-semibold text-slate-400 px-2 py-0.5">
                          {group.label}
                        </div>
                        {group.presets.map(p => {
                          const isSelected = tempPreset === p.key
                          return (
                            <button
                              key={p.key}
                              type="button"
                              onClick={() => handleSelectPreset(p.key)}
                              className={`w-full text-left px-2.5 py-1.5 rounded-lg text-xs font-medium transition ${
                                isSelected
                                  ? 'bg-emerald-50 text-emerald-800 font-bold'
                                  : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
                              }`}
                            >
                              {p.label}
                            </button>
                          )
                        })}
                      </div>
                    ))}
                    {allowAllTime && (
                      <button
                        type="button"
                        onClick={() => handleSelectPreset('all')}
                        className={`w-full text-left px-2.5 py-1.5 rounded-lg text-xs font-medium transition ${
                          tempPreset === 'all'
                            ? 'bg-emerald-50 text-emerald-800 font-bold'
                            : 'text-slate-600 hover:bg-slate-50'
                        }`}
                      >
                        Semua Waktu
                      </button>
                    )}
                  </div>
                </div>

                {/* Right Area: Calendar Navigation & Month Grids */}
                <div className="flex-1">
                  {/* Date Input Previews & Month Nav */}
                  <div className="flex items-center justify-between pb-3 border-b border-slate-100 mb-3">
                    <div className="flex items-center gap-2">
                      <input
                        type="date"
                        value={tempStart}
                        onChange={e => {
                          setTempPreset('custom')
                          setTempStart(e.target.value)
                        }}
                        className="rounded-lg border border-slate-200 px-2 py-1 text-xs text-slate-700 font-medium"
                      />
                      <span className="text-slate-400">–</span>
                      <input
                        type="date"
                        value={tempEnd}
                        onChange={e => {
                          setTempPreset('custom')
                          setTempEnd(e.target.value)
                        }}
                        className="rounded-lg border border-slate-200 px-2 py-1 text-xs text-slate-700 font-medium"
                      />
                    </div>

                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={handlePrevMonth}
                        className="p-1 rounded-lg hover:bg-slate-100 text-slate-600"
                        title="Bulan Sebelumnya"
                      >
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 19l-7-7 7-7" />
                        </svg>
                      </button>
                      <button
                        type="button"
                        onClick={handleNextMonth}
                        className="p-1 rounded-lg hover:bg-slate-100 text-slate-600"
                        title="Bulan Berikutnya"
                      >
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5l7 7-7 7" />
                        </svg>
                      </button>
                    </div>
                  </div>

                  {/* Dual Calendar Views */}
                  <div className="flex gap-6 justify-center">
                    {renderMonthCalendar(viewYear, viewMonth)}
                    {renderMonthCalendar(
                      viewMonth === 11 ? viewYear + 1 : viewYear,
                      viewMonth === 11 ? 0 : viewMonth + 1
                    )}
                  </div>
                </div>
              </div>

              {/* Popover Footer */}
              <div className="flex items-center justify-between pt-3 mt-3 border-t border-slate-100">
                <div className="text-xs text-slate-500 font-medium">
                  {tempStart && tempEnd ? (
                    <>
                      Terpilih: <strong className="text-slate-800">{formatDateDisplay(tempStart)} – {formatDateDisplay(tempEnd)}</strong> ({primaryDurationDays} hari)
                    </>
                  ) : (
                    'Pilih tanggal mulai dan tanggal akhir'
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setIsPrimaryOpen(false)}
                    className="px-3 py-1.5 rounded-lg border border-slate-200 text-xs font-semibold text-slate-600 hover:bg-slate-50 transition"
                  >
                    Batal
                  </button>
                  <button
                    type="button"
                    disabled={!tempStart || !tempEnd}
                    onClick={handleApplyPrimary}
                    className="px-4 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-xs font-bold text-white shadow-sm transition disabled:opacity-50"
                  >
                    Terapkan
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* GROUP 2: Time Comparison (Lifetimely-Style) */}
        {showComparison && (
          <div ref={comparisonContainerRef} className="relative flex items-end gap-2">
            <div>
              <label className="block text-[11px] font-semibold text-slate-500 mb-1">
                {comparisonLabel}
              </label>

              {/* Comparison Mode Dropdown */}
              <div className="relative">
                <button
                  type="button"
                  onClick={openComparisonPicker}
                  className={`inline-flex items-center gap-2 rounded-xl border px-3.5 py-2 text-xs font-semibold shadow-sm transition active:scale-[0.98] ${
                    isComparisonOpen
                      ? 'border-indigo-500 bg-indigo-50/50 text-indigo-900 ring-2 ring-indigo-100'
                      : activeValue.comparisonMode !== 'none'
                      ? 'border-slate-200 bg-white text-slate-800 hover:border-slate-300 hover:bg-slate-50'
                      : 'border-slate-200 bg-slate-50 text-slate-400 hover:bg-slate-100'
                  }`}
                >
                  <svg className="w-4 h-4 text-indigo-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
                  </svg>
                  <span>{getComparisonModeLabel(activeValue.comparisonMode)}</span>
                  <svg className="w-3.5 h-3.5 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7" />
                  </svg>
                </button>

                {/* Comparison Mode Popover */}
                {isComparisonOpen && (
                  <div className="absolute top-full mt-2 left-0 z-50 bg-white rounded-2xl border border-slate-200 shadow-xl p-3 w-[260px]">
                    <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400 px-2 mb-2">
                      Opsi Perbandingan
                    </div>
                    <div className="space-y-1">
                      {(['none', 'previous_period', 'previous_year', 'custom'] as ComparisonMode[]).map(mode => (
                        <button
                          key={mode}
                          type="button"
                          onClick={() => handleComparisonModeSelect(mode)}
                          className={`w-full text-left px-3 py-2 rounded-lg text-xs font-medium flex items-center justify-between transition ${
                            tempCompMode === mode
                              ? 'bg-indigo-50 text-indigo-900 font-bold'
                              : 'text-slate-600 hover:bg-slate-50'
                          }`}
                        >
                          <span>{getComparisonModeLabel(mode)}</span>
                          {tempCompMode === mode && (
                            <svg className="w-4 h-4 text-indigo-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M5 13l4 4L19 7" />
                            </svg>
                          )}
                        </button>
                      ))}
                    </div>

                    {/* Custom Range Picker Drawer inside Popover */}
                    {tempCompMode === 'custom' && (
                      <div className="pt-3 mt-2 border-t border-slate-100 space-y-2">
                        <div className="text-[11px] font-semibold text-slate-700">Rentang Kustom Pembanding</div>
                        <div className="space-y-1.5">
                          <input
                            type="date"
                            value={tempCompStart}
                            onChange={e => setTempCompStart(e.target.value)}
                            className="w-full rounded-lg border border-slate-200 px-2 py-1 text-xs"
                          />
                          <input
                            type="date"
                            value={tempCompEnd}
                            onChange={e => setTempCompEnd(e.target.value)}
                            className="w-full rounded-lg border border-slate-200 px-2 py-1 text-xs"
                          />
                        </div>
                        <button
                          type="button"
                          onClick={handleApplyCustomComparison}
                          className="w-full mt-1 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs shadow-sm transition"
                        >
                          Terapkan Kustom
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* Comparison Date Display Box (Lifetimely Exact Date Match) */}
            {activeValue.comparisonMode !== 'none' && activeValue.comparisonStartDate && (
              <div
                className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-slate-50/80 px-3 py-2 text-xs font-semibold text-slate-600"
                title={`Membandingkan dengan: ${activeValue.comparisonLabel || 'Periode Sebelumnya'}`}
              >
                <svg className="w-3.5 h-3.5 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                </svg>
                <span>
                  {formatDateDisplay(activeValue.comparisonStartDate)} – {formatDateDisplay(activeValue.comparisonEndDate)}
                </span>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ========================================================================= */}
      {/* MOBILE TRIGGER BAR (< 640px)                                              */}
      {/* ========================================================================= */}
      <div className="flex sm:hidden w-full">
        <button
          type="button"
          onClick={() => {
            setTempStart(activeValue.startDate)
            setTempEnd(activeValue.endDate)
            setTempPreset(activeValue.preset)
            setTempCompMode(activeValue.comparisonMode)
            setTempCompStart(activeValue.comparisonStartDate)
            setTempCompEnd(activeValue.comparisonEndDate)
            setIsMobileModalOpen(true)
          }}
          className="w-full flex items-center justify-between rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 shadow-sm active:bg-slate-50 transition"
        >
          <div className="flex items-center gap-2 truncate">
            <svg className="w-4 h-4 text-emerald-600 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
            <div className="text-left truncate">
              <div className="text-xs font-bold text-slate-800 truncate">
                {activeValue.preset === 'all'
                  ? 'Semua Periode'
                  : `${formatDateDisplay(activeValue.startDate)} – ${formatDateDisplay(activeValue.endDate)}`}
              </div>
              {showComparison && activeValue.comparisonMode !== 'none' && (
                <div className="text-[10px] text-slate-500 truncate">
                  vs {formatDateDisplay(activeValue.comparisonStartDate)} – {formatDateDisplay(activeValue.comparisonEndDate)} ({getComparisonModeLabel(activeValue.comparisonMode)})
                </div>
              )}
            </div>
          </div>
          <svg className="w-4 h-4 text-slate-400 flex-shrink-0 ml-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7" />
          </svg>
        </button>
      </div>

      {/* ========================================================================= */}
      {/* MOBILE FULLSCREEN MODAL (mobile-modal-ux standard)                        */}
      {/* ========================================================================= */}
      {isMobileModalOpen && (
        <FullScreenModal
          isOpen={isMobileModalOpen}
          onClose={() => setIsMobileModalOpen(false)}
          title="Pilih Rentang Waktu & Pembanding"
          description="Atur periode tanggal analitik untuk menyaring data transaksi."
          footer={
            <div className="flex items-center justify-between w-full gap-2">
              <button
                type="button"
                onClick={() => setIsMobileModalOpen(false)}
                className="flex-1 py-2.5 rounded-xl border border-slate-300 font-semibold text-slate-700 text-xs active:bg-slate-100"
              >
                Batal
              </button>
              <button
                type="button"
                onClick={() => {
                  const comp = resolveComparisonRange(
                    tempCompMode,
                    tempStart,
                    tempEnd,
                    tempCompStart,
                    tempCompEnd
                  )
                  const updated: TemporalFilterValue = {
                    startDate: tempStart,
                    endDate: tempEnd,
                    preset: tempPreset,
                    comparisonMode: tempCompMode,
                    comparisonStartDate: comp.start,
                    comparisonEndDate: comp.end,
                    comparisonLabel: comp.label,
                  }
                  commitChanges(updated)
                  setIsMobileModalOpen(false)
                }}
                className="flex-1 py-2.5 rounded-xl bg-emerald-600 font-bold text-white text-xs shadow-md active:bg-emerald-700"
              >
                Terapkan Filter
              </button>
            </div>
          }
        >
          <div className="space-y-4 py-2">
            {/* Tabs */}
            <div className="flex border-b border-slate-200">
              <button
                type="button"
                onClick={() => setMobileTab('primary')}
                className={`flex-1 py-2 text-xs font-bold border-b-2 transition ${
                  mobileTab === 'primary'
                    ? 'border-emerald-600 text-emerald-800'
                    : 'border-transparent text-slate-500'
                }`}
              >
                Periode Utama
              </button>
              {showComparison && (
                <button
                  type="button"
                  onClick={() => setMobileTab('comparison')}
                  className={`flex-1 py-2 text-xs font-bold border-b-2 transition ${
                    mobileTab === 'comparison'
                      ? 'border-indigo-600 text-indigo-800'
                      : 'border-transparent text-slate-500'
                  }`}
                >
                  Perbandingan
                </button>
              )}
            </div>

            {/* TAB 1: Periode Utama */}
            {mobileTab === 'primary' && (
              <div className="space-y-4">
                {/* Presets Chips */}
                <div>
                  <div className="text-[11px] font-semibold text-slate-500 mb-2">Preset Populer</div>
                  <div className="grid grid-cols-2 gap-2">
                    {PRESET_GROUPS.flatMap(g => g.presets).map(p => {
                      const active = tempPreset === p.key
                      return (
                        <button
                          key={p.key}
                          type="button"
                          onClick={() => handleSelectPreset(p.key)}
                          className={`py-2 px-3 rounded-xl text-xs font-medium border text-left transition ${
                            active
                              ? 'border-emerald-500 bg-emerald-50 text-emerald-900 font-bold'
                              : 'border-slate-200 text-slate-700 bg-white'
                          }`}
                        >
                          {p.label}
                        </button>
                      )
                    })}
                  </div>
                </div>

                {/* Custom Inputs */}
                <div className="pt-2 border-t border-slate-100">
                  <div className="text-[11px] font-semibold text-slate-500 mb-2">Atur Tanggal Spesifik</div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="text-[10px] text-slate-500 block mb-1">Mulai</label>
                      <input
                        type="date"
                        value={tempStart}
                        onChange={e => {
                          setTempPreset('custom')
                          setTempStart(e.target.value)
                        }}
                        className="w-full rounded-xl border border-slate-200 px-3 py-2 text-xs text-slate-800"
                      />
                    </div>
                    <div>
                      <label className="text-[10px] text-slate-500 block mb-1">Selesai</label>
                      <input
                        type="date"
                        value={tempEnd}
                        onChange={e => {
                          setTempPreset('custom')
                          setTempEnd(e.target.value)
                        }}
                        className="w-full rounded-xl border border-slate-200 px-3 py-2 text-xs text-slate-800"
                      />
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* TAB 2: Perbandingan */}
            {mobileTab === 'comparison' && showComparison && (
              <div className="space-y-3">
                <div className="text-[11px] font-semibold text-slate-500">Pilih Mode Pembanding</div>
                <div className="space-y-2">
                  {(['none', 'previous_period', 'previous_year', 'custom'] as ComparisonMode[]).map(mode => (
                    <button
                      key={mode}
                      type="button"
                      onClick={() => setTempCompMode(mode)}
                      className={`w-full py-2.5 px-3.5 rounded-xl text-xs font-semibold border flex items-center justify-between transition ${
                        tempCompMode === mode
                          ? 'border-indigo-600 bg-indigo-50 text-indigo-900'
                          : 'border-slate-200 text-slate-700 bg-white'
                      }`}
                    >
                      <span>{getComparisonModeLabel(mode)}</span>
                      {tempCompMode === mode && (
                        <svg className="w-4 h-4 text-indigo-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M5 13l4 4L19 7" />
                        </svg>
                      )}
                    </button>
                  ))}
                </div>

                {tempCompMode === 'custom' && (
                  <div className="pt-3 border-t border-slate-100 space-y-2">
                    <div className="text-[11px] font-semibold text-slate-700">Tanggal Kustom Pembanding</div>
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="text-[10px] text-slate-500 block mb-1">Mulai</label>
                        <input
                          type="date"
                          value={tempCompStart}
                          onChange={e => setTempCompStart(e.target.value)}
                          className="w-full rounded-xl border border-slate-200 px-3 py-2 text-xs"
                        />
                      </div>
                      <div>
                        <label className="text-[10px] text-slate-500 block mb-1">Selesai</label>
                        <input
                          type="date"
                          value={tempCompEnd}
                          onChange={e => setTempCompEnd(e.target.value)}
                          className="w-full rounded-xl border border-slate-200 px-3 py-2 text-xs"
                        />
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </FullScreenModal>
      )}
    </div>
  )
}

