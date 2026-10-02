"use client"
import React, { useState, useEffect, useCallback, useRef } from 'react'
import * as XLSX from 'xlsx'
import {
  StockReportItem,
  LocationReportSummary,
  StockMove,
  InventoryReportMetrics,
  PaginationMeta,
} from '../types'
import { useUserContext } from '@/components/UserContext'

import StockReportTab, { SortField } from './StockReportTab'
import LocationReportTab from './LocationReportTab'
import MoveAnalysisTab from './MoveAnalysisTab'
import ValuationTab from './ValuationTab'
import PendingReturnsTab from './PendingReturnsTab'

type ActiveTab = 'stock' | 'location' | 'analysis' | 'valuation' | 'returns'

const globalMovesCache = new Map<string, { moves: StockMove[]; timestamp: number }>()
const GLOBAL_MOVES_CACHE_TTL = 60_000 // 60 detik

export default function InventoryReportsMain() {
  const { activeBusiness } = useUserContext()

  // ⚡ Read active business name instantly from UserContext or localStorage (0ms sync)
  const [activeBizName, setActiveBizName] = useState<string>(() => {
    if (activeBusiness?.name) return activeBusiness.name
    if (typeof window !== 'undefined' && window.localStorage) {
      try {
        const saved = localStorage.getItem('su_cached_active_biz')
        if (saved) {
          const parsed = JSON.parse(saved)
          return parsed.name || ''
        }
      } catch (e) {}
    }
    return ''
  })

  // Sync activeBizName when activeBusiness loads from context
  useEffect(() => {
    if (activeBusiness?.name) {
      setActiveBizName(activeBusiness.name)
    }
  }, [activeBusiness])

  // Active tab state initialized with localStorage persistence (default to 'stock')
  const [activeTab, setActiveTab] = useState<ActiveTab>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('shapeup_inventory_active_tab') as ActiveTab
      if (['stock', 'location', 'analysis', 'valuation'].includes(saved)) {
        return saved
      }
    }
    return 'stock'
  })

  const [loading, setLoading] = useState(true)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  // Move History Filters
  const [moveStatusFilter, setMoveStatusFilter] = useState<any>('all')
  const [moveLotFilter, setMoveLotFilter] = useState<string>('')
  const [loadingMoves, setLoadingMoves] = useState(false)

  // Backfill state
  const [showBackfillModal, setShowBackfillModal] = useState(false)
  const [backfillLoading, setBackfillLoading] = useState(false)
  const [backfillDryRun, setBackfillDryRun] = useState<any>(null)
  const [backfillResult, setBackfillResult] = useState<any>(null)
  const [backfillError, setBackfillError] = useState<string | null>(null)
  const [isMovesFromCache, setIsMovesFromCache] = useState(false)
  const [isMovesRevalidating, setIsMovesRevalidating] = useState(false)

  // Server Pagination State
  const [page, setPage] = useState(1)
  const [limit, setLimit] = useState<number>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('shapeup_inventory_page_size')
      if (saved) return Number(saved)
    }
    return 25
  })
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedCategory, setSelectedCategory] = useState('')
  
  const [sortField, setSortField] = useState<SortField>('productName')
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('asc')

  // Report Data State
  const [metrics, setMetrics] = useState<InventoryReportMetrics | null>(null)
  const [pagination, setPagination] = useState<PaginationMeta>({
    page: 1,
    limit: 25,
    totalItems: 0,
    totalPages: 1,
  })
  const [categories, setCategories] = useState<string[]>([])
  const [stockReportItems, setStockReportItems] = useState<StockReportItem[]>([])
  const [locationReportSummaries, setLocationReportSummaries] = useState<LocationReportSummary[]>([])
  const [moves, setMoves] = useState<StockMove[]>([])

  // Handler for tab switching
  const handleTabChange = (tab: ActiveTab) => {
    setActiveTab(tab)
    if (typeof window !== 'undefined') {
      localStorage.setItem('shapeup_inventory_active_tab', tab)
    }
  }

  const handlePageSizeChange = (newLimit: number) => {
    setLimit(newLimit)
    setPage(1)
    if (typeof window !== 'undefined') {
      localStorage.setItem('shapeup_inventory_page_size', String(newLimit))
    }
  }

  // ⚡ Fast Paginated Data Fetcher
  const loadInventoryData = useCallback(
    async (targetPage = page, targetLimit = limit, targetSearch = searchQuery, targetCat = selectedCategory, targetSortField = sortField, targetSortOrder = sortOrder) => {
      try {
        setLoading(true)
        setErrorMsg(null)

        const params = new URLSearchParams({
          action: 'summary',
          page: String(targetPage),
          limit: String(targetLimit),
          search: targetSearch,
          category: targetCat,
          sortField: targetSortField,
          sortOrder: targetSortOrder
        })

        const res = await fetch(`/api/inventory/reports?${params.toString()}`)
        const json = await res.json()

        if (!res.ok || !json.success) {
          throw new Error(json.error || 'Gagal memuat data persediaan stok')
        }

        if (json.metrics) setMetrics(json.metrics)
        if (json.pagination) setPagination(json.pagination)
        if (json.categories) setCategories(json.categories)
        if (json.stockReportItems) setStockReportItems(json.stockReportItems)
      } catch (err: any) {
        console.error('[InventoryReportsMain] Error loading inventory data:', err)
        setErrorMsg(err.message || 'Gagal memuat data persediaan stok.')
      } finally {
        setLoading(false)
      }
    },
    [page, limit, searchQuery, selectedCategory, sortField, sortOrder]
  )

  // Search debounce ref
  const searchTimeoutRef = useRef<NodeJS.Timeout | null>(null)

  const handleSearchChange = (val: string) => {
    setSearchQuery(val)
    setPage(1)
    if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current)
    searchTimeoutRef.current = setTimeout(() => {
      loadInventoryData(1, limit, val, selectedCategory, sortField, sortOrder)
    }, 350)
  }

  const handleCategoryChange = (val: string) => {
    setSelectedCategory(val)
    setPage(1)
    loadInventoryData(1, limit, searchQuery, val, sortField, sortOrder)
  }

  // Fetch when page or limit changes directly
  const handlePageChange = (newPage: number) => {
    setPage(newPage)
    loadInventoryData(newPage, limit, searchQuery, selectedCategory, sortField, sortOrder)
  }
  
  const handleSortChange = (field: SortField) => {
    let newOrder: 'asc' | 'desc' = 'asc'
    if (sortField === field) {
      newOrder = sortOrder === 'asc' ? 'desc' : 'asc'
      setSortOrder(newOrder)
    } else {
      setSortField(field)
      setSortOrder('asc')
    }
    setPage(1)
    loadInventoryData(1, limit, searchQuery, selectedCategory, field, newOrder)
  }

  // Initial fetch on mount
  useEffect(() => {
    loadInventoryData(1, limit, '', '')
  }, [])

  // ⚡ SWR Fast Global Moves Loader — fix: hanya load jika activeBusiness sudah ada, + TTL cache
  const loadGlobalMoves = useCallback(async () => {
    if (!activeBusiness?.id) return // Tunggu business context siap dulu
    const cacheKey = `global_moves_${activeBusiness.id}`
    const cached = globalMovesCache.get(cacheKey)
    const isCacheValid = cached && (Date.now() - cached.timestamp < GLOBAL_MOVES_CACHE_TTL)

    if (isCacheValid) {
      setMoves(cached.moves)
      setIsMovesFromCache(true)
      setLoadingMoves(false)
      setIsMovesRevalidating(true)
    } else {
      setLoadingMoves(true)
      setIsMovesFromCache(false)
      setIsMovesRevalidating(false)
    }

    try {
      const res = await fetch('/api/inventory/reports?action=global_moves&limit=200')
      const json = await res.json()
      if (json.success && json.moves) {
        setMoves(json.moves)
        globalMovesCache.set(cacheKey, { moves: json.moves, timestamp: Date.now() })
        setIsMovesFromCache(false)
      }
    } catch (e) {
      console.error('Failed fetching global moves:', e)
    } finally {
      setLoadingMoves(false)
      setIsMovesRevalidating(false)
    }
  }, [activeBusiness?.id])

  // Lazy load moves when analysis tab is active
  useEffect(() => {
    if (activeTab === 'analysis' && moves.length === 0) {
      loadGlobalMoves()
    }
  }, [activeTab, moves.length, loadGlobalMoves])

  // Lazy fetch location report data when location tab is selected
  useEffect(() => {
    if (activeTab === 'location' && locationReportSummaries.length === 0) {
      setLoading(true)
      fetch('/api/inventory/reports?action=location_report')
        .then(res => res.json())
        .then(json => {
          if (json.locationReportSummaries) setLocationReportSummaries(json.locationReportSummaries)
        })
        .finally(() => setLoading(false))
    }
  }, [activeTab, locationReportSummaries.length])

  // ─── Backfill Handler ───────────────────────────────────────────────────────
  const handleBackfillDryRun = async () => {
    setBackfillLoading(true)
    setBackfillError(null)
    setBackfillDryRun(null)
    try {
      const res = await fetch('/api/inventory/backfill-moves', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dryRun: true })
      })
      const json = await res.json()
      if (json.success) {
        setBackfillDryRun(json.summary)
      } else {
        setBackfillError(json.error || 'Gagal menjalankan preview')
      }
    } catch (e: any) {
      setBackfillError(e.message || 'Terjadi kesalahan')
    } finally {
      setBackfillLoading(false)
    }
  }

  const handleBackfillExecute = async () => {
    setBackfillLoading(true)
    setBackfillError(null)
    setBackfillResult(null)
    try {
      const res = await fetch('/api/inventory/backfill-moves', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dryRun: false })
      })
      const json = await res.json()
      if (json.success) {
        setBackfillResult(json)
        // Clear moves cache agar fresh setelah rebuild
        globalMovesCache.clear()
        setMoves([])
        // Refresh stock report juga
        loadInventoryData(1, limit, '', '')
      } else {
        setBackfillError(json.error || 'Gagal menjalankan rebuild')
      }
    } catch (e: any) {
      setBackfillError(e.message || 'Terjadi kesalahan')
    } finally {
      setBackfillLoading(false)
    }
  }

  // Export Excel Handler
  const handleExportExcel = () => {
    const fileName = `Laporan_Inventory_${activeTab}_${new Date().toISOString().slice(0, 10)}.xlsx`
    const exportData = stockReportItems.map(item => ({
      SKU: item.sku || '-',
      'Nama Produk': item.productName,
      Kategori: item.categoryName,
      'Stok Fisik (On Hand)': item.onHandQty,
      'Harga Unit (Cost)': item.unitCost,
      'Total Nilai Persediaan': item.totalValue,
    }))

    const worksheet = XLSX.utils.json_to_sheet(exportData)
    const workbook = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Report')
    XLSX.writeFile(workbook, fileName)
  }

  return (
    <div className="space-y-6">
      {/* Top Animated Loading Bar */}
      {loading && (
        <div className="fixed top-0 left-0 right-0 z-50 h-1.5 bg-blue-100 overflow-hidden">
          <div className="h-full bg-gradient-to-r from-blue-500 via-indigo-600 to-blue-500 animate-pulse transition-all duration-300 w-full" />
        </div>
      )}

      {/* Error Alert Box */}
      {errorMsg && (
        <div className="bg-rose-50 border border-rose-200 text-rose-800 p-4 rounded-xl flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 shadow-xs">
          <div className="flex items-start sm:items-center gap-3">
            <span className="text-2xl">⚠️</span>
            <div>
              <div className="font-bold text-xs sm:text-sm">Gagal Memuat Laporan Stok</div>
              <div className="text-xs text-rose-600 mt-0.5">{errorMsg}</div>
            </div>
          </div>
          <button
            onClick={() => loadInventoryData(page, limit, searchQuery, selectedCategory, sortField, sortOrder)}
            className="px-4 py-2 bg-rose-600 hover:bg-rose-700 text-white rounded-lg text-xs font-bold transition-all shadow-xs cursor-pointer whitespace-nowrap"
          >
            🔄 Coba Lagi
          </button>
        </div>
      )}

      {/* Top Header & Business Info (Instant Business Name from LocalStorage/Context) */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-white border border-[#E2E2DC] p-5 rounded-2xl shadow-xs">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-2xl">📦</span>
            <h1 className="text-xl font-extrabold text-[#1C1C1A] tracking-tight">
              Laporan Inventory & Stok
            </h1>
            <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-blue-50 text-blue-700 border border-blue-200">
              Paginated Fast Engine v3.0
            </span>
          </div>
          <p className="text-xs text-[#6B6B63] mt-1">
            {activeBizName ? `Bisnis: ${activeBizName}` : 'ShapeUp CRM'} — Pantau stok, lokasi gudang, analisis mutasi, dan penilaian persediaan.
          </p>
        </div>

        <div className="flex items-center gap-3 flex-wrap">
          <button
            onClick={() => loadInventoryData(page, limit, searchQuery, selectedCategory, sortField, sortOrder)}
            title="Segarkan Data dari Database"
            className="flex items-center gap-2 px-3.5 py-2 rounded-xl bg-[#F7F7F5] hover:bg-[#EAEAEA] text-[#1C1C1A] border border-[#E2E2DC] text-xs font-bold transition-all cursor-pointer"
          >
            <svg
              className={`w-3.5 h-3.5 ${loading ? 'animate-spin text-blue-600' : 'text-[#6B6B63]'}`}
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
            >
              <path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67" />
            </svg>
            Refresh
          </button>

          <button
            onClick={() => {
              setShowBackfillModal(true)
              setBackfillDryRun(null)
              setBackfillResult(null)
              setBackfillError(null)
            }}
            title="Rebuild ulang semua log mutasi stok dari transaksi"
            className="flex items-center gap-2 px-3.5 py-2 rounded-xl bg-amber-50 hover:bg-amber-100 text-amber-800 border border-amber-300 text-xs font-bold transition-all cursor-pointer"
          >
            🔧 Rebuild Stock Moves
          </button>

          <button
            onClick={handleExportExcel}
            className="flex items-center gap-2 px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold shadow-xs transition-all cursor-pointer"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="7 10 12 15 17 10" />
              <line x1="12" y1="15" x2="12" y2="3" />
            </svg>
            Export Excel / CSV
          </button>
        </div>
      </div>

      {/* Navigation Tabs */}
      <div className="flex border-b border-[#E2E2DC] space-x-1 overflow-x-auto bg-white p-1 rounded-t-xl">
        {[
          { key: 'stock', label: '📦 Stock Report', desc: 'Stok saat ini per halaman' },
          { key: 'location', label: '📍 Location Report', desc: 'Distribusi per gudang & outlet' },
          { key: 'analysis', label: '📊 Move Analysis', desc: 'Pivot table & visual charts' },
          { key: 'valuation', label: '💰 Valuation', desc: 'Penilaian FIFO, LIFO, AVCO' },
          { key: 'returns', label: '🔄 Karantina Retur', desc: 'Penerimaan barang retur/batal' },
        ].map(t => {
          const isActive = activeTab === t.key
          return (
            <button
              key={t.key}
              onClick={() => handleTabChange(t.key as ActiveTab)}
              className={`px-4 py-2.5 text-xs font-bold transition-all border-b-2 whitespace-nowrap cursor-pointer ${
                isActive
                  ? 'border-blue-600 text-blue-700 bg-blue-50/60'
                  : 'border-transparent text-[#6B6B63] hover:text-[#1C1C1A] hover:bg-[#F7F7F5]'
              }`}
            >
              {t.label}
            </button>
          )
        })}
      </div>

      {/* Search & Filter Bar */}
      {activeTab === 'stock' && (
        <div className="flex flex-wrap items-center justify-between gap-3 bg-white p-3.5 rounded-xl border border-[#E2E2DC] shadow-xs">
          <div className="flex flex-wrap items-center gap-3 w-full sm:w-auto">
            <div className="relative w-full sm:w-64">
              <input
                type="text"
                placeholder="Cari nama produk, SKU..."
                value={searchQuery}
                onChange={e => handleSearchChange(e.target.value)}
                className="w-full bg-[#F7F7F5] text-[#1C1C1A] text-xs border border-[#E2E2DC] rounded-lg pl-8 pr-3 py-1.5 focus:outline-none focus:border-blue-500"
              />
              <svg
                className="absolute left-2.5 top-2.5 text-[#82827A]"
                width="12"
                height="12"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
              >
                <circle cx="11" cy="11" r="8" />
                <line x1="21" y1="21" x2="16.65" y2="16.65" />
              </svg>
            </div>

            {categories.length > 0 && (
              <select
                value={selectedCategory}
                onChange={e => handleCategoryChange(e.target.value)}
                className="bg-[#F7F7F5] text-[#1C1C1A] text-xs border border-[#E2E2DC] rounded-lg px-3 py-1.5 focus:outline-none focus:border-blue-500 cursor-pointer"
              >
                <option value="">Semua Kategori</option>
                {categories.map(cat => (
                  <option key={cat} value={cat}>
                    {cat}
                  </option>
                ))}
              </select>
            )}
          </div>
        </div>
      )}

      {/* Tab Content Display */}
      <div>
        {activeTab === 'stock' && (
          <StockReportTab
            items={stockReportItems}
            metrics={metrics}
            pagination={pagination}
            loading={loading}
            searchQuery={searchQuery}
            selectedCategory={selectedCategory}
            onPageChange={handlePageChange}
            onPageSizeChange={handlePageSizeChange}
            sortField={sortField}
            sortOrder={sortOrder}
            onSortChange={handleSortChange}
          />
        )}

        {activeTab === 'location' && (
          <LocationReportTab locations={locationReportSummaries} loading={loading} />
        )}

        {activeTab === 'analysis' && <MoveAnalysisTab moves={moves} loading={loadingMoves} />}

        {activeTab === 'valuation' && (
          <ValuationTab stockItems={stockReportItems} moves={moves} loading={loading} />
        )}

        {activeTab === 'returns' && <PendingReturnsTab />}
      </div>

      {/* ─── Backfill Confirmation Modal ─────────────────────────────────────── */}
      {showBackfillModal && (
        <div
          className="fixed inset-0 z-[9999] bg-black/60 backdrop-blur-xs flex items-center justify-center p-4"
          onClick={() => !backfillLoading && setShowBackfillModal(false)}
        >
          <div
            className="bg-white rounded-2xl border border-[#E2E2DC] shadow-2xl w-full max-w-lg p-6 space-y-5"
            onClick={e => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-amber-100 text-amber-700 flex items-center justify-center text-xl shrink-0">🔧</div>
              <div>
                <h3 className="text-base font-extrabold text-[#1C1C1A]">Rebuild Stock Moves</h3>
                <p className="text-xs text-[#6B6B63] mt-0.5">Regenerasi ulang semua log mutasi stok dari data transaksi</p>
              </div>
            </div>

            {/* Info */}
            {!backfillResult && (
              <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-xs space-y-2">
                <div className="font-bold text-amber-800 flex items-center gap-1.5">⚠️ Yang akan terjadi:</div>
                <ul className="text-amber-700 space-y-1 list-disc list-inside">
                  <li>Semua data <code className="bg-amber-100 px-1 rounded">stock_moves</code> lama akan <strong>dihapus</strong></li>
                  <li>Di-generate ulang dari: Pembelian, Penjualan, Stock Opname</li>
                  <li>Produk tanpa histori → dibuat entry <strong>STOK-AWAL</strong> otomatis</li>
                  <li>Stok fisik produk dihitung ulang dari log baru</li>
                </ul>
              </div>
            )}

            {/* Error */}
            {backfillError && (
              <div className="bg-rose-50 border border-rose-200 text-rose-800 p-3 rounded-xl text-xs font-medium">
                ⚠️ {backfillError}
              </div>
            )}

            {/* Dry Run Preview */}
            {backfillDryRun && !backfillResult && (
              <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 text-xs space-y-2">
                <div className="font-bold text-blue-800 flex items-center gap-1.5">📋 Preview Hasil:</div>
                <div className="grid grid-cols-2 gap-2">
                  {[
                    ['Total Log Baru', backfillDryRun.totalMoveRowsToInsert],
                    ['Dari Pembelian', backfillDryRun.fromPurchases],
                    ['Dari Penjualan', backfillDryRun.fromOrders],
                    ['Dari Stock Opname', backfillDryRun.fromOpname],
                    ['Entry Stok Awal', backfillDryRun.openingStockEntries],
                    ['Produk di-update', backfillDryRun.productsToRecalculate],
                  ].map(([label, val]) => (
                    <div key={label as string} className="bg-white rounded-lg border border-blue-200 p-2">
                      <div className="text-[10px] text-blue-600">{label}</div>
                      <div className="font-extrabold text-blue-800 text-sm">{val}</div>
                    </div>
                  ))}
                </div>
                <p className="text-blue-700 mt-1">Klik <strong>Jalankan Sekarang</strong> untuk eksekusi.</p>
              </div>
            )}

            {/* Success Result */}
            {backfillResult && (
              <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4 text-xs space-y-2">
                <div className="font-bold text-emerald-800 flex items-center gap-1.5">✅ Rebuild Berhasil!</div>
                <div className="grid grid-cols-2 gap-2">
                  {[
                    ['Total Log Baru', backfillResult.summary?.totalInserted],
                    ['Dari Pembelian', backfillResult.summary?.fromPurchases],
                    ['Dari Penjualan', backfillResult.summary?.fromOrders],
                    ['Dari Stock Opname', backfillResult.summary?.fromOpname],
                    ['Entry Stok Awal', backfillResult.summary?.openingStockEntries],
                    ['Produk Di-update', backfillResult.summary?.productsRecalculated],
                  ].map(([label, val]) => (
                    <div key={label as string} className="bg-white rounded-lg border border-emerald-200 p-2">
                      <div className="text-[10px] text-emerald-600">{label}</div>
                      <div className="font-extrabold text-emerald-800 text-sm">{val ?? '-'}</div>
                    </div>
                  ))}
                </div>
                <p className="text-emerald-700 text-[11px] mt-1">{backfillResult.message}</p>
              </div>
            )}

            {/* Actions */}
            <div className="flex items-center gap-3 pt-1">
              {!backfillResult ? (
                <>
                  {!backfillDryRun ? (
                    <button
                      disabled={backfillLoading}
                      onClick={handleBackfillDryRun}
                      className="flex-1 py-2.5 rounded-xl bg-blue-50 hover:bg-blue-100 text-blue-700 border border-blue-200 text-xs font-bold transition-all cursor-pointer disabled:opacity-50"
                    >
                      {backfillLoading ? '⏳ Loading...' : '🔍 Preview Dulu'}
                    </button>
                  ) : (
                    <button
                      disabled={backfillLoading}
                      onClick={handleBackfillExecute}
                      className="flex-1 py-2.5 rounded-xl bg-amber-600 hover:bg-amber-700 text-white text-xs font-bold transition-all cursor-pointer disabled:opacity-50"
                    >
                      {backfillLoading ? '⏳ Memproses...' : '🚀 Jalankan Sekarang'}
                    </button>
                  )}
                  <button
                    disabled={backfillLoading}
                    onClick={() => setShowBackfillModal(false)}
                    className="px-5 py-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-[#1C1C1A] text-xs font-bold transition-all cursor-pointer disabled:opacity-50"
                  >
                    Batal
                  </button>
                </>
              ) : (
                <button
                  onClick={() => setShowBackfillModal(false)}
                  className="flex-1 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold transition-all cursor-pointer"
                >
                  ✅ Tutup
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
