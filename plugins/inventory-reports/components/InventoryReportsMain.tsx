"use client"
import React, { useState, useEffect, useMemo } from 'react'
import { createBrowserClient } from '@supabase/ssr'
import * as XLSX from 'xlsx'
import {
  StockReportItem,
  LocationReportSummary,
  StockMove,
  MoveStatus,
} from '../types'
import {
  fetchFullInventoryData,
  buildUnifiedMoveHistory,
  buildStockReport,
  buildLocationReport,
  calculateValuation,
} from '../inventoryHelper'

import StockReportTab from './StockReportTab'
import LocationReportTab from './LocationReportTab'
import MoveHistoryTab from './MoveHistoryTab'
import MoveAnalysisTab from './MoveAnalysisTab'
import ValuationTab from './ValuationTab'

type ActiveTab = 'stock' | 'location' | 'moves' | 'analysis' | 'valuation'

export default function InventoryReportsMain() {
  const supabase = useMemo(
    () =>
      createBrowserClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
      ),
    []
  )

  const [activeTab, setActiveTab] = useState<ActiveTab>('stock')
  const [loading, setLoading] = useState(true)
  const [activeBizId, setActiveBizId] = useState<string | null>(null)
  const [activeBizName, setActiveBizName] = useState<string>('')

  // Raw Data State
  const [products, setProducts] = useState<any[]>([])
  const [locations, setLocations] = useState<any[]>([])
  const [moves, setMoves] = useState<StockMove[]>([])
  const [categories, setCategories] = useState<string[]>([])

  // Filters State
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedCategory, setSelectedCategory] = useState('')
  const [statusFilter, setStatusFilter] = useState<MoveStatus | 'all'>('all')
  const [lotFilter, setLotFilter] = useState('')

  // Load User & Business
  useEffect(() => {
    async function loadData() {
      setLoading(true)
      const {
        data: { user },
      } = await supabase.auth.getUser()

      if (user) {
        const { data: profile } = await supabase
          .from('profiles')
          .select('active_business_id')
          .eq('id', user.id)
          .single()

        if (profile?.active_business_id) {
          setActiveBizId(profile.active_business_id)
          const { data: biz } = await supabase
            .from('businesses')
            .select('name')
            .eq('id', profile.active_business_id)
            .single()

          if (biz) setActiveBizName(biz.name)

          // Fetch full data (Hybrid Architecture)
          const { products: prods, purchases, orders, opnames, locations: locs, customMoves } =
            await fetchFullInventoryData(supabase, profile.active_business_id)

          setProducts(prods)
          setLocations(locs)

          // Extract category names
          const catSet = new Set<string>()
          prods.forEach(p => {
            const catName = Array.isArray(p.categories) ? p.categories[0]?.name : p.categories?.name
            if (catName) catSet.add(catName)
          })
          setCategories(Array.from(catSet))

          // Build unified move history
          const unifiedMoves = buildUnifiedMoveHistory(prods, purchases, orders, opnames, locs, customMoves)
          setMoves(unifiedMoves)
        }
      }
      setLoading(false)
    }

    loadData()
  }, [supabase])

  // Computed Derived Reports
  const stockReportItems: StockReportItem[] = useMemo(
    () => buildStockReport(products, moves, locations),
    [products, moves, locations]
  )

  const locationReportSummaries: LocationReportSummary[] = useMemo(
    () => buildLocationReport(locations, stockReportItems, moves),
    [locations, stockReportItems, moves]
  )

  // Export to Excel / CSV Handler
  const handleExportExcel = () => {
    let exportData: any[] = []
    let fileName = `Laporan_Inventory_${activeTab}_${new Date().toISOString().slice(0, 10)}.xlsx`

    if (activeTab === 'stock') {
      exportData = stockReportItems.map(item => ({
        'SKU': item.sku || '-',
        'Nama Produk': item.productName,
        'Kategori': item.categoryName,
        'Stok Fisik (On Hand)': item.onHandQty,
        'Stok Tersedia': item.availableQty,
        'Stok Terpesan': item.reservedQty,
        'Harga Unit (Cost)': item.unitCost,
        'Total Nilai Persediaan': item.totalValue,
        'Penerimaan (Incoming)': item.incomingShipments,
        'Pengiriman (Outgoing)': item.outgoingItems,
      }))
    } else if (activeTab === 'location') {
      exportData = locationReportSummaries.map(loc => ({
        'Kode Lokasi': loc.locationCode,
        'Nama Lokasi / Gudang': loc.locationName,
        'Tipe Lokasi': loc.locationType,
        'Jumlah Produk': loc.totalProductsCount,
        'Total Stok': loc.totalQty,
        'Stok Tersedia': loc.availableQty,
        'Stok Terpesan': loc.reservedQty,
        'Total Nilai Persediaan': loc.totalValue,
      }))
    } else if (activeTab === 'moves') {
      exportData = moves.map(m => ({
        'Waktu': m.created_at,
        'No. Referensi': m.reference,
        'Nama Produk': m.product_name,
        'SKU': m.product_sku || '-',
        'Tipe Mutasi': m.type,
        'Asal': m.origin_location_name || '-',
        'Tujuan': m.destination_location_name || '-',
        'No. Lot / Batch': m.lot_number || '-',
        'Jumlah (Qty)': m.qty,
        'Harga Unit': m.unit_cost,
        'Status': m.status,
      }))
    } else if (activeTab === 'valuation') {
      const fifoRes = calculateValuation('FIFO', stockReportItems, moves)
      exportData = fifoRes.itemBreakdown.map(i => ({
        'Nama Produk': i.productName,
        'SKU': i.sku || '-',
        'Stok Fisik': i.qtyOnHand,
        'Standard Cost': i.standardCost,
        'Unit Cost FIFO': i.unitCostCalculated,
        'Total Nilai FIFO': i.totalValueCalculated,
        'Selisih / Varians': i.varianceVsStandard,
      }))
    }

    const worksheet = XLSX.utils.json_to_sheet(exportData)
    const workbook = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Report')
    XLSX.writeFile(workbook, fileName)
  }

  return (
    <div className="space-y-6">
      {/* Top Header & Business Info */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-white border border-[#E2E2DC] p-5 rounded-2xl shadow-xs">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-2xl">📦</span>
            <h1 className="text-xl font-extrabold text-[#1C1C1A] tracking-tight">
              Laporan Inventory & Stok
            </h1>
            <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-blue-50 text-blue-700 border border-blue-200">
              Full Hybrid Architecture v1.0
            </span>
          </div>
          <p className="text-xs text-[#6B6B63] mt-1">
            {activeBizName ? `Bisnis: ${activeBizName}` : 'Memuat data bisnis...'} — Pantau stok, lokasi gudang, mutasi, analisis tren, dan penilaian persediaan (FIFO/LIFO/AVCO).
          </p>
        </div>

        <div className="flex items-center gap-3">
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
          { key: 'stock', label: '📦 Stock Report', desc: 'Stok saat ini, available, reserved, cost' },
          { key: 'location', label: '📍 Location Report', desc: 'Distribusi per gudang & outlet' },
          { key: 'moves', label: '📜 Move History', desc: 'Log mutasi, transfer & lot' },
          { key: 'analysis', label: '📊 Move Analysis', desc: 'Pivot table & visual charts' },
          { key: 'valuation', label: '💰 Valuation', desc: 'Penilaian FIFO, LIFO, AVCO' },
        ].map(t => {
          const isActive = activeTab === t.key
          return (
            <button
              key={t.key}
              onClick={() => setActiveTab(t.key as ActiveTab)}
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

      {/* Global Filter Bar (Search & Category) */}
      {(activeTab === 'stock' || activeTab === 'moves') && (
        <div className="flex flex-wrap items-center justify-between gap-3 bg-white p-3.5 rounded-xl border border-[#E2E2DC] shadow-xs">
          <div className="flex flex-wrap items-center gap-3 w-full sm:w-auto">
            <div className="relative w-full sm:w-64">
              <input
                type="text"
                placeholder="Cari nama produk, SKU..."
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
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

            {categories.length > 0 && activeTab === 'stock' && (
              <select
                value={selectedCategory}
                onChange={e => setSelectedCategory(e.target.value)}
                className="bg-[#F7F7F5] text-[#1C1C1A] text-xs border border-[#E2E2DC] rounded-lg px-3 py-1.5 focus:outline-none focus:border-blue-500"
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
            loading={loading}
            searchQuery={searchQuery}
            selectedCategory={selectedCategory}
          />
        )}

        {activeTab === 'location' && (
          <LocationReportTab locations={locationReportSummaries} loading={loading} />
        )}

        {activeTab === 'moves' && (
          <MoveHistoryTab
            moves={moves}
            loading={loading}
            searchQuery={searchQuery}
            statusFilter={statusFilter}
            lotFilter={lotFilter}
            setStatusFilter={setStatusFilter}
            setLotFilter={setLotFilter}
          />
        )}

        {activeTab === 'analysis' && <MoveAnalysisTab moves={moves} loading={loading} />}

        {activeTab === 'valuation' && (
          <ValuationTab stockItems={stockReportItems} moves={moves} loading={loading} />
        )}
      </div>
    </div>
  )
}
