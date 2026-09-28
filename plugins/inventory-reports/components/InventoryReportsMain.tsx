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

import StockReportTab from './StockReportTab'
import LocationReportTab from './LocationReportTab'
import MoveAnalysisTab from './MoveAnalysisTab'
import ValuationTab from './ValuationTab'

type ActiveTab = 'stock' | 'location' | 'analysis' | 'valuation'

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
    async (targetPage = page, targetLimit = limit, targetSearch = searchQuery, targetCat = selectedCategory) => {
      try {
        setLoading(true)
        setErrorMsg(null)

        const params = new URLSearchParams({
          action: 'summary',
          page: String(targetPage),
          limit: String(targetLimit),
          search: targetSearch,
          category: targetCat,
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
    [page, limit, searchQuery, selectedCategory]
  )

  // Search debounce ref
  const searchTimeoutRef = useRef<NodeJS.Timeout | null>(null)

  const handleSearchChange = (val: string) => {
    setSearchQuery(val)
    setPage(1)
    if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current)
    searchTimeoutRef.current = setTimeout(() => {
      loadInventoryData(1, limit, val, selectedCategory)
    }, 350)
  }

  const handleCategoryChange = (val: string) => {
    setSelectedCategory(val)
    setPage(1)
    loadInventoryData(1, limit, searchQuery, val)
  }

  // Fetch when page or limit changes directly
  const handlePageChange = (newPage: number) => {
    setPage(newPage)
    loadInventoryData(newPage, limit, searchQuery, selectedCategory)
  }

  // Initial fetch on mount
  useEffect(() => {
    loadInventoryData(1, limit, '', '')
  }, [])

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
            onClick={() => loadInventoryData(page, limit, searchQuery, selectedCategory)}
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

        <div className="flex items-center gap-3">
          <button
            onClick={() => loadInventoryData(page, limit, searchQuery, selectedCategory)}
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
          />
        )}

        {activeTab === 'location' && (
          <LocationReportTab locations={locationReportSummaries} loading={loading} />
        )}

        {activeTab === 'analysis' && <MoveAnalysisTab moves={moves} loading={loading} />}

        {activeTab === 'valuation' && (
          <ValuationTab stockItems={stockReportItems} moves={moves} loading={loading} />
        )}
      </div>
    </div>
  )
}
