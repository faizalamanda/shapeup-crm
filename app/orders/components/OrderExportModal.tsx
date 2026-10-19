"use client"

import { useState } from 'react'
import { FullScreenModal } from '@/components/ui/FullScreenModal'
import { exportOrdersToFile } from '../services/orderExportService'
import { DEFAULT_TIMEZONE } from '@/lib/timeUtils'

interface OrderExportModalProps {
  isOpen: boolean
  onClose: () => void
  businessName?: string
  businessTimezone?: string
  searchQuery: string
  rules: any[]
  currentPageOrders: any[]
  totalFilteredCount: number
}

type ExportScope = 'filtered' | 'page' | 'all'
type ExportFormat = 'xlsx' | 'csv'
type ExportLayout = 'multisheet' | 'summary' | 'items'

export function OrderExportModal({
  isOpen,
  onClose,
  businessName = 'Bisnis',
  businessTimezone = DEFAULT_TIMEZONE,
  searchQuery,
  rules,
  currentPageOrders,
  totalFilteredCount,
}: OrderExportModalProps) {
  const [scope, setScope] = useState<ExportScope>('filtered')
  const [format, setFormat] = useState<ExportFormat>('xlsx')
  const [layout, setLayout] = useState<ExportLayout>('multisheet')

  const [isExporting, setIsExporting] = useState(false)
  const [progressText, setProgressText] = useState('')
  const [progressPercent, setProgressPercent] = useState(0)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [successMsg, setSuccessMsg] = useState<string | null>(null)

  // Auto-adjust layout if user switches to CSV (CSV does not support multi-sheet)
  const handleFormatChange = (newFormat: ExportFormat) => {
    setFormat(newFormat)
    if (newFormat === 'csv' && layout === 'multisheet') {
      setLayout('summary')
    }
  }

  const handleStartExport = async () => {
    setIsExporting(true)
    setErrorMsg(null)
    setSuccessMsg(null)
    setProgressPercent(5)
    setProgressText('Menyiapkan parameter ekspor...')

    const dateStamp = new Date().toISOString().slice(0, 10)
    const cleanBizName = (businessName || 'Bisnis').replace(/[^a-zA-Z0-9_-]/g, '_')
    const fileName = `Export_Orders_${cleanBizName}_${dateStamp}`

    try {
      let ordersToExport: any[] = []

      if (scope === 'page') {
        // Fast-path: Current page in React state (0 network calls)
        setProgressPercent(60)
        setProgressText(`Menyusun ${currentPageOrders.length} pesanan dari halaman aktif...`)
        ordersToExport = currentPageOrders
      } else {
        // Progressive Chunking via server-side /api/orders/export (100% RLS Enforced)
        const activeSearch = scope === 'all' ? '' : searchQuery
        const activeRules = scope === 'all' ? [] : rules
        const targetTotal = scope === 'all' ? Math.max(totalFilteredCount, 1) : totalFilteredCount

        let offset = 0
        const CHUNK_SIZE = 1000
        let hasMore = true

        setProgressText(`Mengunduh data pesanan (0 / ${targetTotal.toLocaleString('id-ID')})...`)

        while (hasMore) {
          const res = await fetch('/api/orders/export', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              search: activeSearch,
              rules: activeRules,
              limit: CHUNK_SIZE,
              offset,
            }),
          })

          if (!res.ok) {
            const errJson = await res.json().catch(() => ({}))
            throw new Error(errJson.error || `Server error (${res.status}) saat mengambil data`)
          }

          const json = await res.json()
          const chunkOrders: any[] = json.orders || []

          if (chunkOrders.length === 0) {
            hasMore = false
            break
          }

          ordersToExport = ordersToExport.concat(chunkOrders)
          offset += chunkOrders.length

          const currentCount = ordersToExport.length
          const calcPercent = Math.min(85, Math.round((currentCount / Math.max(targetTotal, currentCount)) * 80) + 5)
          setProgressPercent(calcPercent)
          setProgressText(`Mengunduh: ${currentCount.toLocaleString('id-ID')} / ${targetTotal.toLocaleString('id-ID')} pesanan...`)

          // If chunk returned less than requested limit, we reached the end
          if (chunkOrders.length < CHUNK_SIZE) {
            hasMore = false
          }
        }
      }

      if (ordersToExport.length === 0) {
        throw new Error('Tidak ada data transaksi yang ditemukan untuk kriteria ekspor ini.')
      }

      setProgressPercent(90)
      setProgressText(`Menyusun berkas ${format.toUpperCase()} (${ordersToExport.length.toLocaleString('id-ID')} pesanan)...`)

      // Allow UI to paint progress update before heavy XLSX CPU serialization
      await new Promise(r => setTimeout(r, 60))

      exportOrdersToFile({
        orders: ordersToExport,
        format,
        layout: format === 'csv' && layout === 'multisheet' ? 'summary' : layout,
        fileName,
        timezone: businessTimezone,
      })

      setProgressPercent(100)
      setProgressText('Ekspor selesai! Berkas sedang diunduh.')
      setSuccessMsg(`Berhasil mengekspor ${ordersToExport.length.toLocaleString('id-ID')} pesanan ke dalam berkas ${format.toUpperCase()}.`)

      // Auto close after brief celebration
      setTimeout(() => {
        if (isOpen) {
          setIsExporting(false)
          onClose()
        }
      }, 1600)

    } catch (err: any) {
      console.error('[OrderExportModal] Export failed:', err)
      setErrorMsg(err.message || 'Terjadi kesalahan saat memproses ekspor.')
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
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center font-bold text-base border border-blue-100">
            📥
          </div>
          <div>
            <h2 className="text-base font-extrabold text-[#1C1C1A] leading-tight">
              Ekspor Data Pesanan
            </h2>
            <p className="text-xs text-[#6B6B63] font-normal">
              Unduh rekap transaksi untuk pembukuan, analisa produk, atau picking gudang.
            </p>
          </div>
        </div>
      }
      footer={
        <div className="flex items-center justify-between w-full gap-3">
          <button
            type="button"
            disabled={isExporting}
            onClick={onClose}
            className="px-4 py-2 rounded-xl border border-[#E2E2DC] text-[#4A4A45] hover:bg-[#F7F7F5] text-xs font-bold transition-all cursor-pointer disabled:opacity-50"
          >
            Tutup
          </button>

          <button
            type="button"
            disabled={isExporting}
            onClick={handleStartExport}
            className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold shadow-sm transition-all cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {isExporting ? (
              <>
                <div className="w-3.5 h-3.5 rounded-full border-2 border-white border-t-transparent animate-spin" />
                <span>Memproses Ekspor...</span>
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
      }
    >
      <div className="p-4 sm:p-5 space-y-5">

        {/* ── Status / Error / Success Alerts ───────────────────────────── */}
        {errorMsg && (
          <div className="p-3.5 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-xs font-medium flex items-start gap-2.5 animate-fadeIn">
            <span className="text-base leading-none">⚠️</span>
            <div>
              <div className="font-bold">Gagal Mengekspor Data</div>
              <div className="mt-0.5">{errorMsg}</div>
            </div>
          </div>
        )}

        {successMsg && (
          <div className="p-3.5 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs font-medium flex items-start gap-2.5 animate-fadeIn">
            <span className="text-base leading-none">✅</span>
            <div>
              <div className="font-bold">Ekspor Berhasil</div>
              <div className="mt-0.5">{successMsg}</div>
            </div>
          </div>
        )}

        {/* ── Progress Box when Exporting ────────────────────────────────── */}
        {isExporting && (
          <div className="p-4 rounded-xl bg-blue-50/70 border border-blue-200 space-y-2.5 animate-fadeIn">
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
            <p className="text-[11px] text-blue-700/90 font-normal">
              Mohon jangan menutup jendela ini hingga berkas selesai tersusun di peramban Anda.
            </p>
          </div>
        )}

        {/* ── Section 1: Cakupan Data (Scope) ───────────────────────────── */}
        <div className="space-y-2">
          <label className="text-xs font-bold text-[#1C1C1A] uppercase tracking-wider block">
            1. Cakupan Data Pesanan
          </label>
          <div className="grid grid-cols-1 gap-2">
            
            {/* Filtered Scope */}
            <label
              className={`flex items-start gap-3 p-3 rounded-xl border transition-all cursor-pointer ${
                scope === 'filtered'
                  ? 'border-blue-600 bg-blue-50/40 text-blue-950 shadow-xs'
                  : 'border-[#E2E2DC] hover:border-gray-300 text-[#4A4A45]'
              }`}
            >
              <input
                type="radio"
                name="export_scope"
                value="filtered"
                checked={scope === 'filtered'}
                onChange={() => setScope('filtered')}
                className="mt-0.5 accent-blue-600 cursor-pointer"
                disabled={isExporting}
              />
              <div className="flex-1 text-xs">
                <div className="flex items-center justify-between">
                  <span className="font-bold">Data Hasil Filter Saat Ini</span>
                  <span className="px-2 py-0.5 text-[10px] font-extrabold rounded-full bg-blue-100 text-blue-800">
                    {totalFilteredCount.toLocaleString('id-ID')} pesanan
                  </span>
                </div>
                <p className="text-[11px] text-[#6B6B63] mt-0.5">
                  Mengekspor seluruh pesanan yang memenuhi kriteria pencarian dan segmentasi aktif di FilterBar.
                </p>
              </div>
            </label>

            {/* Current Page Scope */}
            <label
              className={`flex items-start gap-3 p-3 rounded-xl border transition-all cursor-pointer ${
                scope === 'page'
                  ? 'border-blue-600 bg-blue-50/40 text-blue-950 shadow-xs'
                  : 'border-[#E2E2DC] hover:border-gray-300 text-[#4A4A45]'
              }`}
            >
              <input
                type="radio"
                name="export_scope"
                value="page"
                checked={scope === 'page'}
                onChange={() => setScope('page')}
                className="mt-0.5 accent-blue-600 cursor-pointer"
                disabled={isExporting}
              />
              <div className="flex-1 text-xs">
                <div className="flex items-center justify-between">
                  <span className="font-bold">Halaman Ini Saja</span>
                  <span className="px-2 py-0.5 text-[10px] font-extrabold rounded-full bg-gray-100 text-gray-700">
                    {currentPageOrders.length} pesanan
                  </span>
                </div>
                <p className="text-[11px] text-[#6B6B63] mt-0.5">
                  Ekspor kilat (instan &lt; 0.1s) hanya untuk baris pesanan yang saat ini tampil di tabel.
                </p>
              </div>
            </label>

            {/* All Orders Scope */}
            <label
              className={`flex items-start gap-3 p-3 rounded-xl border transition-all cursor-pointer ${
                scope === 'all'
                  ? 'border-blue-600 bg-blue-50/40 text-blue-950 shadow-xs'
                  : 'border-[#E2E2DC] hover:border-gray-300 text-[#4A4A45]'
              }`}
            >
              <input
                type="radio"
                name="export_scope"
                value="all"
                checked={scope === 'all'}
                onChange={() => setScope('all')}
                className="mt-0.5 accent-blue-600 cursor-pointer"
                disabled={isExporting}
              />
              <div className="flex-1 text-xs">
                <div className="flex items-center justify-between">
                  <span className="font-bold">Seluruh Riwayat Pesanan Bisnis</span>
                  <span className="px-2 py-0.5 text-[10px] font-extrabold rounded-full bg-amber-100 text-amber-800">
                    Semua Data
                  </span>
                </div>
                <p className="text-[11px] text-[#6B6B63] mt-0.5">
                  Mengambil seluruh histori transaksi bisnis <strong>{businessName}</strong> tanpa filter.
                </p>
              </div>
            </label>

          </div>
        </div>

        {/* ── Section 2: Format Berkas ──────────────────────────────────── */}
        <div className="space-y-2">
          <label className="text-xs font-bold text-[#1C1C1A] uppercase tracking-wider block">
            2. Format Berkas
          </label>
          <div className="grid grid-cols-2 gap-3">
            
            <button
              type="button"
              disabled={isExporting}
              onClick={() => handleFormatChange('xlsx')}
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
                Mendukung banyak lembar kerja (Multi-Sheet) dan lebar kolom otomatis.
              </p>
            </button>

            <button
              type="button"
              disabled={isExporting}
              onClick={() => handleFormatChange('csv')}
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
                Format teks datar universal untuk impor ke sistem akuntansi lain.
              </p>
            </button>

          </div>
        </div>

        {/* ── Section 3: Tata Letak Lembar Kerja ─────────────────────────── */}
        <div className="space-y-2">
          <label className="text-xs font-bold text-[#1C1C1A] uppercase tracking-wider block">
            3. Tata Letak Data (Sheet Layout)
          </label>
          <div className="grid grid-cols-1 gap-2">

            {/* Multi-sheet option (Excel only) */}
            <label
              className={`flex items-start gap-3 p-3 rounded-xl border transition-all ${
                format === 'csv'
                  ? 'opacity-40 cursor-not-allowed border-gray-200 bg-gray-50'
                  : layout === 'multisheet'
                  ? 'border-blue-600 bg-blue-50/40 text-blue-950 shadow-xs cursor-pointer'
                  : 'border-[#E2E2DC] hover:border-gray-300 text-[#4A4A45] cursor-pointer'
              }`}
            >
              <input
                type="radio"
                name="export_layout"
                value="multisheet"
                checked={layout === 'multisheet' && format === 'xlsx'}
                onChange={() => setLayout('multisheet')}
                className="mt-0.5 accent-blue-600 cursor-pointer"
                disabled={isExporting || format === 'csv'}
              />
              <div className="flex-1 text-xs">
                <div className="flex items-center justify-between">
                  <span className="font-bold">Buku Kerja Lengkap (Multi-Sheet)</span>
                  <span className="px-2 py-0.5 text-[9px] font-extrabold rounded-full bg-emerald-100 text-emerald-800 uppercase">
                    Rekomendasi
                  </span>
                </div>
                <p className="text-[11px] text-[#6B6B63] mt-0.5">
                  <strong>Sheet 1:</strong> Ringkasan Pesanan (1 baris/pesanan) &bull; <strong>Sheet 2:</strong> Rincian Produk Itemized (SKU, variasi, harga).
                </p>
              </div>
            </label>

            {/* Summary only */}
            <label
              className={`flex items-start gap-3 p-3 rounded-xl border transition-all cursor-pointer ${
                layout === 'summary'
                  ? 'border-blue-600 bg-blue-50/40 text-blue-950 shadow-xs'
                  : 'border-[#E2E2DC] hover:border-gray-300 text-[#4A4A45]'
              }`}
            >
              <input
                type="radio"
                name="export_layout"
                value="summary"
                checked={layout === 'summary'}
                onChange={() => setLayout('summary')}
                className="mt-0.5 accent-blue-600 cursor-pointer"
                disabled={isExporting}
              />
              <div className="flex-1 text-xs">
                <span className="font-bold">Hanya Ringkasan Pesanan (1 Baris per Order)</span>
                <p className="text-[11px] text-[#6B6B63] mt-0.5">
                  Menampilkan total nominal, ongkir, diskon, dan status pembayaran. Ideal untuk rekonsiliasi kas dan perpajakan.
                </p>
              </div>
            </label>

            {/* Itemized only */}
            <label
              className={`flex items-start gap-3 p-3 rounded-xl border transition-all cursor-pointer ${
                layout === 'items'
                  ? 'border-blue-600 bg-blue-50/40 text-blue-950 shadow-xs'
                  : 'border-[#E2E2DC] hover:border-gray-300 text-[#4A4A45]'
              }`}
            >
              <input
                type="radio"
                name="export_layout"
                value="items"
                checked={layout === 'items'}
                onChange={() => setLayout('items')}
                className="mt-0.5 accent-blue-600 cursor-pointer"
                disabled={isExporting}
              />
              <div className="flex-1 text-xs">
                <span className="font-bold">Hanya Rincian Produk (1 Baris per Item)</span>
                <p className="text-[11px] text-[#6B6B63] mt-0.5">
                  Menampilkan rincian SKU, variasi, dan kuantitas per baris. Ideal untuk tim logistik gudang (picking & packing).
                </p>
              </div>
            </label>

          </div>
        </div>

        {/* ── Info Box Timezone & Precision ─────────────────────────────── */}
        <div className="p-3 rounded-xl bg-gray-50 border border-gray-200 text-[#6B6B63] text-[11px] flex items-center gap-2">
          <span className="text-sm">🕒</span>
          <span>
            Waktu transaksi diformat sesuai zona waktu bisnis: <strong>{businessTimezone}</strong>. Semua nominal uang berupa IDR murni tanpa desimal.
          </span>
        </div>

      </div>
    </FullScreenModal>
  )
}
