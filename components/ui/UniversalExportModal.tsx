"use client"

import React, { useState, useEffect, useRef } from 'react'
import * as XLSX from 'xlsx'
import { FullScreenModal } from '@/components/ui/FullScreenModal'
import {
  ExportFileFormat,
  ExportSheetConfig,
  canUseNativeFileShare,
  calculateAutoColumnWidths,
  downloadWorkbook,
  shareOrDownloadWorkbook,
} from '@/lib/fileExporter'

export interface ExportScopeOption {
  key: string
  label: string
  description: string
  badge?: string
}

export interface UniversalExportModalProps {
  isOpen: boolean
  onClose: () => void
  title?: string
  subtitle?: string
  /** Default base file name without extension (e.g. "Laporan_Inventory_Stok_2026-11-23") */
  defaultFileName: string
  /** Scope options (e.g. "Semua Data" vs "Halaman Aktif Saja"). If omitted or single item, scope selector can be simplified. */
  scopeOptions?: ExportScopeOption[]
  defaultScope?: string
  defaultFormat?: ExportFileFormat
  /**
   * Async generator function called when the user clicks Download or Share.
   * Should return an array of sheets (`ExportSheetConfig[]`) or a ready `XLSX.WorkBook`.
   */
  onBuildExportData: (params: {
    scope: string
    format: ExportFileFormat
    setProgress: (percent: number, text: string) => void
  }) => Promise<ExportSheetConfig[] | XLSX.WorkBook>
  /** Optional info footnote shown at the bottom of the modal */
  footnote?: string
}

export function UniversalExportModal({
  isOpen,
  onClose,
  title = 'Ekspor & Unduh Laporan',
  subtitle = 'Pilih cakupan data dan format berkas untuk diunduh ke perangkat atau dibagikan.',
  defaultFileName,
  scopeOptions = [],
  defaultScope,
  defaultFormat = 'xlsx',
  onBuildExportData,
  footnote,
}: UniversalExportModalProps) {
  const [scope, setScope] = useState<string>(defaultScope || scopeOptions[0]?.key || 'all')
  const [format, setFormat] = useState<ExportFileFormat>(defaultFormat)
  const [isExporting, setIsExporting] = useState(false)
  const [progressPercent, setProgressPercent] = useState(0)
  const [progressText, setProgressText] = useState('')
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [successMsg, setSuccessMsg] = useState<string | null>(null)
  const [supportsNativeShare, setSupportsNativeShare] = useState(false)

  // Rule 18: One-Time Transition Guard (prevIsOpenRef Invariant)
  const prevIsOpenRef = useRef(false)

  useEffect(() => {
    setSupportsNativeShare(canUseNativeFileShare())
  }, [])

  useEffect(() => {
    const isTransitionToOpen = isOpen && !prevIsOpenRef.current
    prevIsOpenRef.current = isOpen

    if (!isTransitionToOpen) return

    setScope(defaultScope || scopeOptions[0]?.key || 'all')
    setFormat(defaultFormat)
    setIsExporting(false)
    setProgressPercent(0)
    setProgressText('')
    setErrorMsg(null)
    setSuccessMsg(null)
  }, [isOpen, defaultScope, defaultFormat, scopeOptions])

  const setProgress = (percent: number, text: string) => {
    setProgressPercent(percent)
    setProgressText(text)
  }

  const executeExport = async (mode: 'download' | 'share') => {
    setIsExporting(true)
    setErrorMsg(null)
    setSuccessMsg(null)
    setProgress(10, 'Menyiapkan data laporan...')

    try {
      const result = await onBuildExportData({
        scope,
        format,
        setProgress,
      })

      setProgress(88, `Menyusun berkas ${format.toUpperCase()}...`)
      await new Promise(r => setTimeout(r, 40))

      let wb: XLSX.WorkBook
      if ('SheetNames' in result && 'Sheets' in result) {
        wb = result as XLSX.WorkBook
      } else {
        const sheets = result as ExportSheetConfig[]
        if (!sheets || sheets.length === 0 || sheets.every(s => !s.rows || s.rows.length === 0)) {
          throw new Error('Tidak ada data yang ditemukan untuk kriteria ekspor ini.')
        }
        wb = XLSX.utils.book_new()
        for (const sheet of sheets) {
          const safeRows = sheet.rows && sheet.rows.length > 0 ? sheet.rows : [{ Info: 'Tidak ada data' }]
          const ws = XLSX.utils.json_to_sheet(safeRows)
          ws['!cols'] = sheet.columnWidths || calculateAutoColumnWidths(safeRows)
          const cleanName = (sheet.sheetName || 'Laporan').replace(/[:\\/?*\[\]]/g, ' ').trim().slice(0, 31) || 'Laporan'
          XLSX.utils.book_append_sheet(wb, ws, cleanName)
          if (format === 'csv') break
        }
      }

      const fullFileName = `${defaultFileName}.${format}`

      if (mode === 'share') {
        setProgress(95, 'Membuka menu bagikan perangkat...')
        const { shared } = await shareOrDownloadWorkbook(wb, fullFileName, {
          bookType: format,
          title: fullFileName,
        })
        setProgress(100, shared ? 'Berkas berhasil dibagikan!' : 'Berkas siap diunduh!')
        setSuccessMsg(
          shared
            ? `Berkas ${fullFileName} berhasil diteruskan ke aplikasi tujuan.`
            : `Berkas ${fullFileName} berhasil diproses.`
        )
      } else {
        setProgress(95, 'Mengirim berkas ke pengelola unduhan...')
        downloadWorkbook(wb, fullFileName, {
          bookType: format,
        })
        setProgress(100, 'Ekspor selesai! Berkas sedang diunduh.')
        setSuccessMsg(`Berhasil mengekspor laporan ke dalam berkas ${fullFileName}.`)
      }

      setTimeout(() => {
        setIsExporting(false)
      }, 800)
    } catch (err: any) {
      console.error('[UniversalExportModal] Export error:', err)
      setErrorMsg(err.message || 'Terjadi kesalahan saat mengekspor data.')
      setIsExporting(false)
    }
  }

  return (
    <FullScreenModal
      isOpen={isOpen}
      onClose={() => {
        if (!isExporting) onClose()
      }}
      desktopSize="md"
      title={
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-emerald-50 text-emerald-600 flex items-center justify-center font-bold text-base border border-emerald-200 shrink-0">
            📥
          </div>
          <div>
            <h2 className="text-sm sm:text-base font-extrabold text-[#1C1C1A] leading-tight">
              {title}
            </h2>
            <p className="text-[11px] sm:text-xs text-[#6B6B63] font-normal mt-0.5">
              {subtitle}
            </p>
          </div>
        </div>
      }
      footer={
        <div className="flex flex-wrap items-center justify-between w-full gap-2.5">
          <button
            type="button"
            disabled={isExporting}
            onClick={onClose}
            className="px-4 py-2.5 rounded-xl border border-[#E2E2DC] text-[#4A4A45] hover:bg-[#F7F7F5] text-xs font-bold transition-all cursor-pointer disabled:opacity-50"
          >
            Tutup
          </button>

          <div className="flex items-center gap-2 flex-1 sm:flex-initial justify-end">
            {supportsNativeShare && (
              <button
                type="button"
                disabled={isExporting}
                onClick={() => executeExport('share')}
                className="flex items-center justify-center gap-1.5 px-3.5 py-2.5 rounded-xl bg-blue-50 hover:bg-blue-100 text-blue-700 border border-blue-200 text-xs font-bold transition-all cursor-pointer disabled:opacity-50"
                title="Bagikan langsung ke WhatsApp, Email, Telegram, atau Simpan ke File HP"
              >
                <span>📲</span>
                <span>Bagikan</span>
              </button>
            )}

            <button
              type="button"
              disabled={isExporting}
              onClick={() => executeExport('download')}
              className="flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold shadow-xs transition-all cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed flex-1 sm:flex-initial"
            >
              {isExporting ? (
                <>
                  <div className="w-3.5 h-3.5 rounded-full border-2 border-white border-t-transparent animate-spin" />
                  <span>Memproses...</span>
                </>
              ) : (
                <>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                    <polyline points="7 10 12 15 17 10" />
                    <line x1="12" y1="15" x2="12" y2="3" />
                  </svg>
                  <span>Unduh Berkas Sekarang</span>
                </>
              )}
            </button>
          </div>
        </div>
      }
    >
      <div className="p-4 sm:p-5 space-y-5">
        {/* Error Alert */}
        {errorMsg && (
          <div className="p-3.5 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-xs font-medium flex items-start gap-2.5">
            <span className="text-base leading-none">⚠️</span>
            <div>
              <div className="font-bold">Gagal Mengekspor Data</div>
              <div className="mt-0.5">{errorMsg}</div>
            </div>
          </div>
        )}

        {/* Success Alert */}
        {successMsg && (
          <div className="p-3.5 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs font-medium flex items-start gap-2.5">
            <span className="text-base leading-none">✅</span>
            <div>
              <div className="font-bold">Ekspor Berhasil</div>
              <div className="mt-0.5">{successMsg}</div>
            </div>
          </div>
        )}

        {/* Progress Bar */}
        {isExporting && (
          <div className="p-4 rounded-xl bg-blue-50/70 border border-blue-200 space-y-2.5">
            <div className="flex items-center justify-between text-xs font-bold text-blue-900">
              <span className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-blue-600 animate-ping inline-block" />
                {progressText}
              </span>
              <span>{progressPercent}%</span>
            </div>
            <div className="w-full h-2 rounded-full bg-blue-200 overflow-hidden">
              <div
                className="h-full bg-blue-600 transition-all duration-300 rounded-full"
                style={{ width: `${progressPercent}%` }}
              />
            </div>
          </div>
        )}

        {/* Scope Selector (if multiple scope options exist) */}
        {scopeOptions.length > 0 && (
          <div className="space-y-2">
            <label className="text-xs font-bold text-[#1C1C1A] uppercase tracking-wider block">
              1. Cakupan Data Laporan
            </label>
            <div className="grid grid-cols-1 gap-2">
              {scopeOptions.map(opt => {
                const isSelected = scope === opt.key
                return (
                  <label
                    key={opt.key}
                    className={`flex items-start gap-3 p-3 rounded-xl border transition-all cursor-pointer ${
                      isSelected
                        ? 'border-blue-600 bg-blue-50/40 text-blue-950 shadow-2xs'
                        : 'border-[#E2E2DC] hover:border-gray-300 text-[#4A4A45]'
                    }`}
                  >
                    <input
                      type="radio"
                      name="universal_export_scope"
                      value={opt.key}
                      checked={isSelected}
                      onChange={() => setScope(opt.key)}
                      disabled={isExporting}
                      className="mt-0.5 accent-blue-600 cursor-pointer"
                    />
                    <div className="flex-1 text-xs">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-bold">{opt.label}</span>
                        {opt.badge && (
                          <span className="px-2 py-0.5 text-[10px] font-extrabold rounded-full bg-blue-100 text-blue-800 shrink-0">
                            {opt.badge}
                          </span>
                        )}
                      </div>
                      <p className="text-[11px] text-[#6B6B63] mt-0.5">
                        {opt.description}
                      </p>
                    </div>
                  </label>
                )
              })}
            </div>
          </div>
        )}

        {/* Format Selector */}
        <div className="space-y-2">
          <label className="text-xs font-bold text-[#1C1C1A] uppercase tracking-wider block">
            {scopeOptions.length > 0 ? '2. Format Berkas' : '1. Format Berkas'}
          </label>
          <div className="grid grid-cols-2 gap-3">
            <button
              type="button"
              disabled={isExporting}
              onClick={() => setFormat('xlsx')}
              className={`p-3 rounded-xl border text-left transition-all cursor-pointer ${
                format === 'xlsx'
                  ? 'border-emerald-600 bg-emerald-50/40 text-emerald-950 ring-1 ring-emerald-600'
                  : 'border-[#E2E2DC] hover:border-gray-300 text-[#4A4A45]'
              }`}
            >
              <div className="flex items-center gap-2">
                <span className="text-base">📊</span>
                <span className="font-bold text-xs">Excel (.xlsx)</span>
              </div>
              <p className="text-[10px] text-[#6B6B63] mt-1">
                Format spreadsheet lengkap dengan lebar kolom rapi otomatis.
              </p>
            </button>

            <button
              type="button"
              disabled={isExporting}
              onClick={() => setFormat('csv')}
              className={`p-3 rounded-xl border text-left transition-all cursor-pointer ${
                format === 'csv'
                  ? 'border-emerald-600 bg-emerald-50/40 text-emerald-950 ring-1 ring-emerald-600'
                  : 'border-[#E2E2DC] hover:border-gray-300 text-[#4A4A45]'
              }`}
            >
              <div className="flex items-center gap-2">
                <span className="text-base">📄</span>
                <span className="font-bold text-xs">CSV (.csv)</span>
              </div>
              <p className="text-[10px] text-[#6B6B63] mt-1">
                Format teks universal dengan UTF-8 BOM untuk sistem akuntansi.
              </p>
            </button>
          </div>
        </div>

        {/* APK / PWA Info Box */}
        <div className="p-3 rounded-xl bg-[#F7F7F5] border border-[#E2E2DC] text-[#6B6B63] text-[11px] flex items-start gap-2.5">
          <span className="text-sm leading-none mt-0.5">📱</span>
          <div className="space-y-0.5">
            <div className="font-bold text-[#1C1C1A]">Kompatibel Penuh APK, PWA &amp; Desktop</div>
            <div>
              {footnote ||
                'Berkas diunduh melalui jalur HTTP langsung sehingga dapat disimpan ke folder Downloads HP/Tablet maupun dibagikan ke WhatsApp/Email.'}
            </div>
          </div>
        </div>
      </div>
    </FullScreenModal>
  )
}

