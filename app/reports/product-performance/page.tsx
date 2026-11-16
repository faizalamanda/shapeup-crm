"use client"

import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import Link from 'next/link'
import * as XLSX from 'xlsx'
import { supabase } from '@/lib/supabase'
import { useUserContext } from '@/components/UserContext'
import { usePageBackNavigation } from '@/hooks/usePageBackNavigation'
import { fetchAllSupabaseRows, fetchAllBusinessProducts } from '@/lib/chunkedQueryHelper'
import { calculateProductsHppBatch, ProductHppResult } from '@/lib/recipeHelper'
import { TemporalDateFilter, TemporalFilterValue } from '@/components/ui/TemporalDateFilter'
import {
  getLocalDateRangeLimits,
  resolveComparisonRange,
  getBusinessTimezone,
  getOrderLocalDateKey,
  localDateToUtcBounds,
} from '@/lib/localzone'

// ─── Types ────────────────────────────────────────────────────────────────────
type RawOrderRow = {
  id: string
  order_number?: string | null
  order_date: string | null
  order_date_utc?: string | null
  created_at?: string | null
  status?: string | null
  payment_status?: string | null
  source_platform?: string | null
  subtotal?: number | string | null
  shipping_cost?: number | string | null
  discount_amount?: number | string | null
  other_fees?: number | string | null
  grand_total?: number | string | null
  items_json?: any
}

type CatalogProductRow = {
  id: string
  name: string
  sku?: string | null
  price?: number | string | null
  cost_price?: number | string | null
  type?: string | null
  hpp_type?: string | null
  category_id?: string | null
  stock_quantity?: number | string | null
  stock_type?: string | null
  unit?: string | null
  categories?: { id: string; name: string } | Array<{ id: string; name: string }> | null
  product_variants?: Array<{
    id: string
    name: string
    sku?: string | null
    price?: number | string | null
    cost_price?: number | string | null
    stock_quantity?: number | string | null
  }> | null
}

type RawPurchaseRow = {
  id: string
  purchase_number: string | null
  date: string | null
  subtotal: number | string | null
  discount_amount: number | string | null
  other_fees: number | string | null
  grand_total: number | string | null
  items_json: any
}

type HppSourceType =
  | 'recipe'
  | 'master'
  | 'order_fallback'
  | 'purchase_fallback'
  | 'default_pct'
  | 'missing'

type QuadrantType = 'star' | 'cash_cow' | 'puzzle' | 'dog' | 'no_sales'

type YAxisMetric = 'totalProfit' | 'unitMargin' | 'marginPct'
type ThresholdMode = 'mean' | 'median'

type ProductMatrixRow = {
  key: string
  productId: string | null
  variantId: string | null
  name: string
  sku: string
  categoryName: string
  unit: string
  stockQuantity: number
  // Current Period Metrics
  ordersCount: number
  qtySold: number
  qtySharePct: number
  grossSales: number
  netSales: number
  avgSellingPrice: number
  unitHpp: number
  totalHpp: number
  grossProfit: number
  unitMargin: number
  marginPct: number
  // HPP Source Metadata
  hppSource: HppSourceType
  hppSourceLabel: string
  hppSourceDetail: string
  // Comparison Period Metrics
  compQtySold: number
  compNetSales: number
  compGrossProfit: number
  compQuadrant: QuadrantType | null
  // Classification
  quadrant: QuadrantType
  recommendation: string
}

type SortField =
  | 'name'
  | 'quadrant'
  | 'qtySold'
  | 'netSales'
  | 'unitHpp'
  | 'grossProfit'
  | 'unitMargin'
  | 'marginPct'

type GroupDimension = 'quadrant' | 'category' | 'hpp_source' | 'platform'
type GroupSortField = 'label' | 'skuCount' | 'qtySold' | 'netSales' | 'totalHpp' | 'grossProfit' | 'marginPct'

type GroupedSummaryRow = {
  key: string
  label: string
  badge?: string
  skuCount: number
  qtySold: number
  netSales: number
  totalHpp: number
  grossProfit: number
  marginPct: number
}

// ─── L1 In-Memory Cache (60s TTL) ─────────────────────────────────────────────
const ordersMemoryCache = new Map<string, { rows: RawOrderRow[]; timestamp: number }>()
const catalogMemoryCache = new Map<
  string,
  {
    products: CatalogProductRow[]
    categoryMap: Map<string, string>
    recipeMap: Map<string, ProductHppResult>
    purchases: RawPurchaseRow[]
    defaultHppPct: number
    timestamp: number
  }
>()
const CACHE_TTL_MS = 60 * 1000

const COUNTED_ORDER_STATUSES = new Set([
  'shipped',
  'processing',
  'complete',
  'completed',
])

const normalizeStatus = (status?: string | null) =>
  (status || '').toLowerCase().replace(/[^a-z0-9]/g, '')

const isCountedOrderStatus = (status?: string | null) =>
  COUNTED_ORDER_STATUSES.has(normalizeStatus(status))

const toNum = (v: unknown): number => {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

const cleanText = (v: unknown): string =>
  String(v || '')
    .replace(/\s+/g, ' ')
    .trim()

const formatIDR = (val: number) =>
  new Intl.NumberFormat('id-ID', {
    style: 'currency',
    currency: 'IDR',
    maximumFractionDigits: 0,
  }).format(Math.round(val || 0))

const formatAxisIDR = (val: number) => {
  const abs = Math.abs(val)
  if (abs === 0) return 'Rp0'
  if (abs >= 1_000_000_000) return `Rp${(val / 1_000_000_000).toFixed(1)}M`
  if (abs >= 1_000_000) return `Rp${(val / 1_000_000).toFixed(1)}jt`
  if (abs >= 1_000) return `Rp${Math.round(val / 1_000)}rb`
  return `Rp${Math.round(val)}`
}

const formatNumber = (val: number) =>
  new Intl.NumberFormat('id-ID', { maximumFractionDigits: 1 }).format(val || 0)

const calcGrowthPct = (curr: number, prev: number): number => {
  if (prev === 0) return curr > 0 ? 100 : 0
  return ((curr - prev) / Math.abs(prev)) * 100
}

const parseJsonArray = (raw: any): any[] => {
  if (Array.isArray(raw)) return raw
  if (typeof raw === 'string' && raw.trim()) {
    try {
      const parsed = JSON.parse(raw)
      return Array.isArray(parsed) ? parsed : []
    } catch {
      return []
    }
  }
  return []
}

const extractItemEmbeddedCost = (item: any): number => {
  const direct = toNum(item?.cost_price ?? item?.costPrice)
  if (direct > 0) return direct

  if (item?.cost_of_goods_sold && typeof item.cost_of_goods_sold === 'object') {
    const cogVal = toNum(item.cost_of_goods_sold.value)
    if (cogVal > 0) return cogVal
  }

  if (Array.isArray(item?.meta_data)) {
    const cogMeta = item.meta_data.find((m: any) =>
      ['_wc_cog_item_cost', '_cog_item_cost', 'cost_price', 'cost', 'hpp'].includes(
        String(m?.key || '').toLowerCase()
      )
    )
    if (cogMeta) {
      const metaVal = toNum(cogMeta.value)
      if (metaVal > 0) return metaVal
    }
  }

  return 0
}

const QUADRANT_META: Record<
  QuadrantType,
  {
    label: string
    shortLabel: string
    icon: string
    badgeBg: string
    badgeText: string
    badgeBorder: string
    dotColor: string
    hexColor: string
  }
> = {
  star: {
    label: 'Star (Volume Tinggi, Profit Tinggi)',
    shortLabel: 'Star',
    icon: '⭐',
    badgeBg: 'bg-emerald-50',
    badgeText: 'text-emerald-700',
    badgeBorder: 'border-emerald-200',
    dotColor: 'bg-emerald-500',
    hexColor: '#10B981',
  },
  cash_cow: {
    label: 'Cash Cow (Volume Tinggi, Profit Rendah)',
    shortLabel: 'Cash Cow',
    icon: '🐄',
    badgeBg: 'bg-indigo-50',
    badgeText: 'text-indigo-700',
    badgeBorder: 'border-indigo-200',
    dotColor: 'bg-indigo-500',
    hexColor: '#6366F1',
  },
  puzzle: {
    label: 'Puzzle (Volume Rendah, Profit Tinggi)',
    shortLabel: 'Puzzle',
    icon: '🧩',
    badgeBg: 'bg-amber-50',
    badgeText: 'text-amber-700',
    badgeBorder: 'border-amber-200',
    dotColor: 'bg-amber-500',
    hexColor: '#F59E0B',
  },
  dog: {
    label: 'Dog (Volume Rendah, Profit Rendah)',
    shortLabel: 'Dog',
    icon: '🐶',
    badgeBg: 'bg-rose-50',
    badgeText: 'text-rose-700',
    badgeBorder: 'border-rose-200',
    dotColor: 'bg-rose-500',
    hexColor: '#F43F5E',
  },
  no_sales: {
    label: 'Dead Stock (Belum Terjual)',
    shortLabel: 'Tanpa Penjualan',
    icon: '💤',
    badgeBg: 'bg-slate-100',
    badgeText: 'text-slate-600',
    badgeBorder: 'border-slate-200',
    dotColor: 'bg-slate-400',
    hexColor: '#94A3B8',
  },
}

const HPP_SOURCE_META: Record<
  HppSourceType,
  {
    label: string
    badgeClass: string
  }
> = {
  recipe: {
    label: 'Resep (Variable)',
    badgeClass: 'bg-purple-50 text-purple-700 border-purple-200',
  },
  master: {
    label: 'Master Produk',
    badgeClass: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  },
  order_fallback: {
    label: 'Ref: Data Order',
    badgeClass: 'bg-blue-50 text-blue-700 border-blue-200',
  },
  purchase_fallback: {
    label: 'Ref: Pembelian',
    badgeClass: 'bg-cyan-50 text-cyan-700 border-cyan-200',
  },
  default_pct: {
    label: 'Ref: Default %',
    badgeClass: 'bg-slate-100 text-slate-700 border-slate-300',
  },
  missing: {
    label: '⚠️ HPP Kosong',
    badgeClass: 'bg-amber-100 text-amber-900 border-amber-300 font-extrabold',
  },
}

// ─── Data Fetchers (Compliant with `high-cardinality-data` skill) ─────────────
async function fetchOrdersWindowCompliant(
  businessId: string,
  startIso: string,
  endIso: string
): Promise<RawOrderRow[]> {
  const cacheKey = `${businessId}_${startIso || 'ALL'}_${endIso || 'ALL'}`
  const cached = ordersMemoryCache.get(cacheKey)
  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    return cached.rows
  }

  const selectCols =
    'id, order_number, order_date, order_date_utc, created_at, status, payment_status, source_platform, subtotal, shipping_cost, discount_amount, other_fees, grand_total, items_json'

  const rows = await fetchAllSupabaseRows<RawOrderRow>(
    (from, to) => {
      let q = supabase
        .from('orders')
        .select(selectCols)
        .eq('business_id', businessId)

      if (startIso) q = q.gte('order_date', startIso)
      if (endIso) q = q.lte('order_date', endIso)

      return q
        .order('order_date', { ascending: true })
        .order('id', { ascending: true })
        .range(from, to)
    },
    1000
  )

  ordersMemoryCache.set(cacheKey, { rows, timestamp: Date.now() })
  return rows
}

async function fetchCatalogAndHppSourcesCompliant(businessId: string) {
  const cached = catalogMemoryCache.get(businessId)
  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    return cached
  }

  // Parallel fetch: Products + Categories + Purchases + Global Integration Config
  const [products, categoriesRes, purchases, globalConfigRes] = await Promise.all([
    fetchAllBusinessProducts<CatalogProductRow>(supabase, businessId, {
      selectWithVariants:
        'id, name, price, sku, unit, type, hpp_type, category_id, cost_price, stock_quantity, stock_type, categories(id, name), product_variants(id, name, sku, price, cost_price, stock_quantity)',
      selectVariantsOnly:
        'id, name, price, sku, unit, type, hpp_type, category_id, cost_price, stock_quantity, stock_type, product_variants(id, name, sku, price, cost_price, stock_quantity)',
      selectFallback:
        'id, name, price, sku, cost_price, stock_quantity, stock_type',
    }),
    supabase
      .from('categories')
      .select('id, name')
      .eq('business_id', businessId),
    fetchAllSupabaseRows<RawPurchaseRow>(
      (from, to) =>
        supabase
          .from('purchases')
          .select('id, purchase_number, date, subtotal, discount_amount, other_fees, grand_total, items_json')
          .eq('business_id', businessId)
          .order('date', { ascending: false })
          .order('id', { ascending: true })
          .range(from, to),
      1000
    ).catch(() => [] as RawPurchaseRow[]),
    supabase
      .from('integrations')
      .select('platform_name, api_credentials')
      .eq('platform_name', 'global')
      .filter('api_credentials->>business_id', 'eq', businessId)
      .maybeSingle(),
  ])

  const categoryMap = new Map<string, string>()
  if (Array.isArray(categoriesRes.data)) {
    for (const c of categoriesRes.data) {
      if (c?.id && c?.name) categoryMap.set(c.id, c.name)
    }
  }

  // Batch fetch variable recipes HPP
  const physicalIds = products
    .filter(p => (p.type || 'physical') === 'physical')
    .map(p => p.id)

  const recipeMap =
    physicalIds.length > 0
      ? await calculateProductsHppBatch(physicalIds, supabase)
      : new Map<string, ProductHppResult>()

  let defaultHppPct = 0
  const creds = (globalConfigRes.data as any)?.api_credentials
  if (creds && typeof creds.global_default_hpp_percentage === 'number') {
    defaultHppPct = Math.max(0, Math.min(100, creds.global_default_hpp_percentage))
  }

  const result = {
    products,
    categoryMap,
    recipeMap,
    purchases,
    defaultHppPct,
    timestamp: Date.now(),
  }
  catalogMemoryCache.set(businessId, result)
  return result
}

function computeMedian(values: number[]): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 !== 0
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2
}

function buildRecommendation(
  quadrant: QuadrantType,
  hppSource: HppSourceType,
  marginPct: number
): string {
  const hppPrefix =
    hppSource === 'missing'
      ? '⚠️ Lengkapi HPP di Master Produk terlebih dahulu (saat ini Rp 0). '
      : hppSource === 'order_fallback' || hppSource === 'purchase_fallback'
      ? 'ℹ️ HPP dari referensi histori — simpan permanen di Master Produk. '
      : ''

  switch (quadrant) {
    case 'star':
      return `${hppPrefix}Pertahankan stok & kualitas, posisikan di etalase utama, hindari diskon berlebih.`
    case 'cash_cow':
      return `${hppPrefix}Produk penarik trafik namun margin tipis (${marginPct.toFixed(1)}%). Negosiasi HPP supplier, naikkan harga bertahap, atau bundling dengan produk Puzzle.`
    case 'puzzle':
      return `${hppPrefix}Margin tinggi (${marginPct.toFixed(1)}%) tapi jarang terjual. Tingkatkan promosi, beri insentif upsell kasir/CS, atau jadikan paket bundling.`
    case 'dog':
      return `${hppPrefix}Volume & profit rendah. Evaluasi penghentian stok (discontinue), habiskan via clearance sale, atau rombak ulang.`
    case 'no_sales':
      return `${hppPrefix}Tidak ada penjualan di periode ini. Cek ketersediaan stok atau jalankan promo cuci gudang.`
  }
}

export default function ProductPerformancePage() {
  const goBack = usePageBackNavigation({ mobileFallback: '/onboarding' })
  const { activeBusiness } = useUserContext()
  const businessTz = getBusinessTimezone(activeBusiness?.timezone)

  // Default to 'last-30' (30 Hari Terakhir) per user confirmation
  const [temporalFilter, setTemporalFilter] = useState<TemporalFilterValue>(() => {
    const limits = getLocalDateRangeLimits('last-30', businessTz)
    const comp = resolveComparisonRange('previous_period', limits.start, limits.end)
    return {
      startDate: limits.start,
      endDate: limits.end,
      preset: 'last-30',
      comparisonMode: 'previous_period',
      comparisonStartDate: comp.start,
      comparisonEndDate: comp.end,
      comparisonLabel: comp.label,
    }
  })

  // Matrix Chart Controls
  const [yAxisMetric, setYAxisMetric] = useState<YAxisMetric>('totalProfit')
  const [thresholdMode, setThresholdMode] = useState<ThresholdMode>('mean')
  const [excludeMissingHppFromThreshold, setExcludeMissingHppFromThreshold] = useState<boolean>(true)
  const [hoveredProduct, setHoveredProduct] = useState<ProductMatrixRow | null>(null)

  // Segment Popover Filters
  const [isSegmentOpen, setIsSegmentOpen] = useState<boolean>(false)
  const [selectedCategory, setSelectedCategory] = useState<string>('all')
  const [selectedPlatform, setSelectedPlatform] = useState<string>('all')
  const [selectedHppFilter, setSelectedHppFilter] = useState<
    'all' | 'valid_master' | 'fallback_only' | 'missing_only'
  >('all')

  // Table Filters & Sorting
  const [activeQuadrantTab, setActiveQuadrantTab] = useState<'all_sold' | QuadrantType | 'missing_hpp'>('all_sold')
  const [searchQuery, setSearchQuery] = useState<string>('')
  const [sortField, setSortField] = useState<SortField>('grossProfit')
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc')

  // Grouped By Section
  const [groupDim, setGroupDim] = useState<GroupDimension>('quadrant')
  const [groupSortField, setGroupSortField] = useState<GroupSortField>('grossProfit')
  const [groupSortOrder, setGroupSortOrder] = useState<'asc' | 'desc'>('desc')

  // Loaded Data State
  const [rawCurrentOrders, setRawCurrentOrders] = useState<RawOrderRow[]>([])
  const [rawComparisonOrders, setRawComparisonOrders] = useState<RawOrderRow[]>([])
  const [catalogData, setCatalogData] = useState<{
    products: CatalogProductRow[]
    categoryMap: Map<string, string>
    recipeMap: Map<string, ProductHppResult>
    purchases: RawPurchaseRow[]
    defaultHppPct: number
  }>({
    products: [],
    categoryMap: new Map(),
    recipeMap: new Map(),
    purchases: [],
    defaultHppPct: 0,
  })
  const [loading, setLoading] = useState<boolean>(true)
  const [isSyncing, setIsSyncing] = useState<boolean>(false)
  const hasLoadedOnceRef = useRef<boolean>(false)

  // Period UTC Bounds
  const periodBounds = useMemo(() => {
    const isAllTime =
      temporalFilter.preset === 'all' || (!temporalFilter.startDate && !temporalFilter.endDate)
    if (isAllTime) {
      return {
        isAllTime: true,
        currUtcStart: '',
        currUtcEnd: '',
        hasComp: false,
        compUtcStart: '',
        compUtcEnd: '',
      }
    }

    const currBounds = localDateToUtcBounds(
      temporalFilter.startDate,
      temporalFilter.endDate,
      businessTz
    )
    const hasComp =
      temporalFilter.comparisonMode !== 'none' &&
      Boolean(temporalFilter.comparisonStartDate && temporalFilter.comparisonEndDate)

    const compBounds = hasComp
      ? localDateToUtcBounds(
          temporalFilter.comparisonStartDate,
          temporalFilter.comparisonEndDate,
          businessTz
        )
      : { startOfDayISO: null, endOfDayISO: null }

    return {
      isAllTime: false,
      currUtcStart: currBounds.startOfDayISO || `${temporalFilter.startDate}T00:00:00.000Z`,
      currUtcEnd: currBounds.endOfDayISO || `${temporalFilter.endDate}T23:59:59.999Z`,
      hasComp,
      compUtcStart: hasComp
        ? compBounds.startOfDayISO || `${temporalFilter.comparisonStartDate}T00:00:00.000Z`
        : '',
      compUtcEnd: hasComp
        ? compBounds.endOfDayISO || `${temporalFilter.comparisonEndDate}T23:59:59.999Z`
        : '',
    }
  }, [
    temporalFilter.preset,
    temporalFilter.startDate,
    temporalFilter.endDate,
    temporalFilter.comparisonMode,
    temporalFilter.comparisonStartDate,
    temporalFilter.comparisonEndDate,
    businessTz,
  ])

  const loadData = useCallback(
    async (
      bid: string,
      currStartIso: string,
      currEndIso: string,
      hasComp: boolean,
      compStartIso: string,
      compEndIso: string
    ) => {
      if (!hasLoadedOnceRef.current) {
        setLoading(true)
      }
      setIsSyncing(true)

      try {
        const currOrdersPromise = fetchOrdersWindowCompliant(bid, currStartIso, currEndIso)
        const catalogPromise = fetchCatalogAndHppSourcesCompliant(bid)
        const compOrdersPromise =
          hasComp && compStartIso && compEndIso
            ? fetchOrdersWindowCompliant(bid, compStartIso, compEndIso)
            : Promise.resolve([] as RawOrderRow[])

        const [currOrders, catRes] = await Promise.all([currOrdersPromise, catalogPromise])
        setRawCurrentOrders(currOrders)
        setCatalogData(catRes)
        hasLoadedOnceRef.current = true
        setLoading(false)

        const compOrders = await compOrdersPromise
        setRawComparisonOrders(compOrders)
      } catch (err) {
        console.error('[ProductPerformance] Error loading data:', err)
      } finally {
        setLoading(false)
        setIsSyncing(false)
      }
    },
    []
  )

  useEffect(() => {
    if (!activeBusiness?.id) return
    loadData(
      activeBusiness.id,
      periodBounds.currUtcStart,
      periodBounds.currUtcEnd,
      periodBounds.hasComp,
      periodBounds.compUtcStart,
      periodBounds.compUtcEnd
    )
  }, [
    activeBusiness?.id,
    periodBounds.currUtcStart,
    periodBounds.currUtcEnd,
    periodBounds.hasComp,
    periodBounds.compUtcStart,
    periodBounds.compUtcEnd,
    loadData,
  ])

  // Filter valid orders within local calendar dates
  const countedCurrentOrders = useMemo(() => {
    const isAllTime = periodBounds.isAllTime
    const cStart = temporalFilter.startDate
    const cEnd = temporalFilter.endDate
    return rawCurrentOrders.filter(o => {
      if (!isCountedOrderStatus(o.status)) return false
      const localDate = getOrderLocalDateKey(o, businessTz)
      if (!localDate || !/^\d{4}-\d{2}-\d{2}$/.test(localDate)) return false
      if (!isAllTime && (localDate < cStart || localDate > cEnd)) return false
      return true
    })
  }, [rawCurrentOrders, businessTz, periodBounds.isAllTime, temporalFilter.startDate, temporalFilter.endDate])

  const countedComparisonOrders = useMemo(() => {
    if (!periodBounds.hasComp) return []
    const pStart = temporalFilter.comparisonStartDate
    const pEnd = temporalFilter.comparisonEndDate
    return rawComparisonOrders.filter(o => {
      if (!isCountedOrderStatus(o.status)) return false
      const localDate = getOrderLocalDateKey(o, businessTz)
      if (!localDate || !/^\d{4}-\d{2}-\d{2}$/.test(localDate)) return false
      return localDate >= pStart && localDate <= pEnd
    })
  }, [
    rawComparisonOrders,
    businessTz,
    periodBounds.hasComp,
    temporalFilter.comparisonStartDate,
    temporalFilter.comparisonEndDate,
  ])

  // Available Platforms & Categories for Segment Filter
  const availablePlatforms = useMemo(() => {
    const set = new Set<string>()
    for (const o of countedCurrentOrders) {
      const p = cleanText(o.source_platform || 'Manual') || 'Manual'
      set.add(p)
    }
    return Array.from(set).sort()
  }, [countedCurrentOrders])

  const availableCategories = useMemo(() => {
    const set = new Set<string>()
    for (const p of catalogData.products) {
      let catName = 'Tanpa Kategori'
      if (p.categories) {
        const cObj = Array.isArray(p.categories) ? p.categories[0] : p.categories
        if (cObj?.name) catName = cObj.name
      } else if (p.category_id && catalogData.categoryMap.has(p.category_id)) {
        catName = catalogData.categoryMap.get(p.category_id)!
      }
      set.add(catName)
    }
    return Array.from(set).sort()
  }, [catalogData])

  // ─── Build Lookup Maps for Catalog & Purchase Fallback HPP ──────────────────
  const catalogAndFallbackMaps = useMemo(() => {
    const byProductId = new Map<string, CatalogProductRow>()
    const byVariantId = new Map<
      string,
      { parent: CatalogProductRow; variant: NonNullable<CatalogProductRow['product_variants']>[number] }
    >()
    const bySku = new Map<string, { product: CatalogProductRow; variant?: any }>()
    const byName = new Map<string, { product: CatalogProductRow; variant?: any }>()

    for (const p of catalogData.products) {
      byProductId.set(p.id, p)
      if (p.sku) bySku.set(cleanText(p.sku).toLowerCase(), { product: p })
      if (p.name) byName.set(cleanText(p.name).toLowerCase(), { product: p })

      if (Array.isArray(p.product_variants)) {
        for (const v of p.product_variants) {
          byVariantId.set(v.id, { parent: p, variant: v })
          if (v.sku) bySku.set(cleanText(v.sku).toLowerCase(), { product: p, variant: v })
          const fullVarName = `${cleanText(p.name)} - ${cleanText(v.name)}`.toLowerCase()
          byName.set(fullVarName, { product: p, variant: v })
        }
      }
    }

    // Build Purchase History Cost Fallback Map (Weighted Average & Latest Reference)
    type PurchaseCostStat = {
      totalCost: number
      totalQty: number
      latestUnitCost: number
      latestPurchaseNumber: string
      latestDate: string
    }
    const purchaseCostByKey = new Map<string, PurchaseCostStat>()

    const recordPurchaseStat = (
      lookupKey: string,
      unitCost: number,
      qty: number,
      poNumber: string,
      poDate: string
    ) => {
      if (!lookupKey || unitCost <= 0 || qty <= 0) return
      const existing = purchaseCostByKey.get(lookupKey)
      if (!existing) {
        purchaseCostByKey.set(lookupKey, {
          totalCost: unitCost * qty,
          totalQty: qty,
          latestUnitCost: unitCost, // purchases are ordered by date DESC so first seen is latest
          latestPurchaseNumber: poNumber,
          latestDate: poDate,
        })
      } else {
        existing.totalCost += unitCost * qty
        existing.totalQty += qty
      }
    }

    for (const po of catalogData.purchases) {
      const items = parseJsonArray(po.items_json)
      if (items.length === 0) continue
      const sub = toNum(po.subtotal)
      const grand = toNum(po.grand_total)
      // Distribute purchase discount/fees proportionally just like POST /api/purchases
      const ratio = sub > 0 && grand > 0 ? grand / sub : 1
      const poNumber = cleanText(po.purchase_number) || 'Nota Pembelian'
      const poDate = cleanText(po.date).slice(0, 10)

      for (const item of items) {
        const rawPrice = toNum(item?.price ?? item?.unit_price ?? item?.cost_price)
        const qty = Math.max(1, toNum(item?.quantity) || 1)
        const netUnitCost = rawPrice * ratio
        if (netUnitCost <= 0) continue

        if (item?.variant_id) {
          recordPurchaseStat(`var:${item.variant_id}`, netUnitCost, qty, poNumber, poDate)
        }
        if (item?.product_id) {
          recordPurchaseStat(`prod:${item.product_id}`, netUnitCost, qty, poNumber, poDate)
        }
        if (item?.sku) {
          recordPurchaseStat(`sku:${cleanText(item.sku).toLowerCase()}`, netUnitCost, qty, poNumber, poDate)
        }
        if (item?.name) {
          recordPurchaseStat(`name:${cleanText(item.name).toLowerCase()}`, netUnitCost, qty, poNumber, poDate)
        }
      }
    }

    return {
      byProductId,
      byVariantId,
      bySku,
      byName,
      purchaseCostByKey,
    }
  }, [catalogData])

  // ─── Core Aggregation & 6-Tier Waterfall HPP Resolution ─────────────────────
  const { matrixRows, platformSummaryRows, thresholdValues } = useMemo(() => {
    const {
      byProductId,
      byVariantId,
      bySku,
      byName,
      purchaseCostByKey,
    } = catalogAndFallbackMaps

    type ItemAccumulator = {
      key: string
      productId: string | null
      variantId: string | null
      name: string
      sku: string
      categoryName: string
      unit: string
      stockQuantity: number
      orderIds: Set<string>
      qtySold: number
      grossSales: number
      netSales: number
      // Order-embedded cost fallback tracking
      orderCostTotal: number
      orderCostQty: number
      lastOrderNumberWithCost: string
      // Comparison period
      compQtySold: number
      compNetSales: number
    }

    const accumMap = new Map<string, ItemAccumulator>()
    const platformAggMap = new Map<
      string,
      {
        label: string
        skuSet: Set<string>
        qtySold: number
        netSales: number
        totalHpp: number
      }
    >()

    const getCategoryNameForProduct = (p?: CatalogProductRow | null): string => {
      if (!p) return 'Tanpa Kategori'
      if (p.categories) {
        const cObj = Array.isArray(p.categories) ? p.categories[0] : p.categories
        if (cObj?.name) return cObj.name
      }
      if (p.category_id && catalogData.categoryMap.has(p.category_id)) {
        return catalogData.categoryMap.get(p.category_id)!
      }
      return 'Tanpa Kategori'
    }

    const resolveItemIdentity = (item: any) => {
      const rawVarId = cleanText(item?.variant_id || item?.variation_id || item?.variantId)
      const rawProdId = cleanText(item?.product_id || item?.id)
      const rawSku = cleanText(item?.sku)
      const rawName = cleanText(item?.name || item?.product_name || item?.parent_name || 'Produk Tanpa Nama')

      let matchedProd: CatalogProductRow | null = null
      let matchedVar: any = null

      if (rawVarId && byVariantId.has(rawVarId)) {
        const hit = byVariantId.get(rawVarId)!
        matchedProd = hit.parent
        matchedVar = hit.variant
      } else if (rawProdId && byProductId.has(rawProdId)) {
        matchedProd = byProductId.get(rawProdId)!
      } else if (rawSku && bySku.has(rawSku.toLowerCase())) {
        const hit = bySku.get(rawSku.toLowerCase())!
        matchedProd = hit.product
        matchedVar = hit.variant || null
      } else if (rawName && byName.has(rawName.toLowerCase())) {
        const hit = byName.get(rawName.toLowerCase())!
        matchedProd = hit.product
        matchedVar = hit.variant || null
      }

      const productId = matchedProd?.id || null
      const variantId = matchedVar?.id || null

      const canonicalKey = variantId
        ? `var:${variantId}`
        : productId
        ? `prod:${productId}`
        : rawSku
        ? `sku:${rawSku.toLowerCase()}`
        : `name:${rawName.toLowerCase()}`

      const displayName = matchedVar
        ? `${matchedProd?.name || rawName}${
            matchedVar.name && !String(matchedProd?.name || '').toLowerCase().includes(String(matchedVar.name).toLowerCase())
              ? ` - ${matchedVar.name}`
              : ''
          }`
        : matchedProd?.name || rawName

      const displaySku = cleanText(matchedVar?.sku || matchedProd?.sku || rawSku) || '-'
      const categoryName = getCategoryNameForProduct(matchedProd)
      const unit = cleanText(matchedProd?.unit) || 'Pcs'
      const stockQuantity = toNum(matchedVar?.stock_quantity ?? matchedProd?.stock_quantity)

      return {
        canonicalKey,
        productId,
        variantId,
        displayName,
        displaySku,
        categoryName,
        unit,
        stockQuantity,
        matchedProd,
        matchedVar,
      }
    }

    // 1. Seed catalog products so we can also detect Dead Stock (Qty = 0) & resolve their HPP
    for (const p of catalogData.products) {
      if ((p.type || 'physical') !== 'physical') continue
      const catName = getCategoryNameForProduct(p)
      if (selectedCategory !== 'all' && catName !== selectedCategory) continue

      if (Array.isArray(p.product_variants) && p.product_variants.length > 0) {
        for (const v of p.product_variants) {
          const key = `var:${v.id}`
          const fullName = `${p.name} - ${v.name}`
          accumMap.set(key, {
            key,
            productId: p.id,
            variantId: v.id,
            name: fullName,
            sku: cleanText(v.sku || p.sku) || '-',
            categoryName: catName,
            unit: cleanText(p.unit) || 'Pcs',
            stockQuantity: toNum(v.stock_quantity),
            orderIds: new Set(),
            qtySold: 0,
            grossSales: 0,
            netSales: 0,
            orderCostTotal: 0,
            orderCostQty: 0,
            lastOrderNumberWithCost: '',
            compQtySold: 0,
            compNetSales: 0,
          })
        }
      } else {
        const key = `prod:${p.id}`
        accumMap.set(key, {
          key,
          productId: p.id,
          variantId: null,
          name: p.name,
          sku: cleanText(p.sku) || '-',
          categoryName: catName,
          unit: cleanText(p.unit) || 'Pcs',
          stockQuantity: toNum(p.stock_quantity),
          orderIds: new Set(),
          qtySold: 0,
          grossSales: 0,
          netSales: 0,
          orderCostTotal: 0,
          orderCostQty: 0,
          lastOrderNumberWithCost: '',
          compQtySold: 0,
          compNetSales: 0,
        })
      }
    }

    // Helper to process order items for Current or Comparison window
    const processOrders = (orders: RawOrderRow[], isCurrent: boolean) => {
      for (const order of orders) {
        const platform = cleanText(order.source_platform || 'Manual') || 'Manual'
        if (selectedPlatform !== 'all' && platform !== selectedPlatform) continue

        const items = parseJsonArray(order.items_json)
        if (items.length === 0) continue

        // Compute order-level discount ratio so net item sales match actual net order revenue
        let itemsRawTotalSum = 0
        for (const it of items) {
          const qty = Math.max(0, toNum(it?.quantity) || 1)
          const unitPrice = toNum(it?.price)
          const itemDisc = toNum(it?.discount)
          const lineTotal =
            it?.total !== undefined && it?.total !== null && it?.total !== ''
              ? toNum(it.total)
              : Math.max(0, (unitPrice - itemDisc) * qty)
          itemsRawTotalSum += Math.max(0, lineTotal)
        }

        const orderSubtotal = toNum(order.subtotal) || itemsRawTotalSum
        const orderDiscount = Math.max(0, toNum(order.discount_amount))
        const expectedNetAfterOrderDisc = Math.max(0, orderSubtotal - orderDiscount)
        // If itemsRawTotalSum hasn't deducted order-level discount yet, apply proportional factor
        const netAllocationRatio =
          itemsRawTotalSum > 0 && expectedNetAfterOrderDisc < itemsRawTotalSum
            ? expectedNetAfterOrderDisc / itemsRawTotalSum
            : 1

        for (const it of items) {
          const qty = Math.max(0, toNum(it?.quantity) || 1)
          if (qty <= 0) continue

          const idInfo = resolveItemIdentity(it)
          if (selectedCategory !== 'all' && idInfo.categoryName !== selectedCategory) continue

          const unitPrice = toNum(it?.price)
          const itemDisc = toNum(it?.discount)
          const rawLineGross =
            toNum(it?.subtotal) > 0 ? toNum(it.subtotal) : Math.max(0, unitPrice * qty)
          const rawLineTotal =
            it?.total !== undefined && it?.total !== null && it?.total !== ''
              ? toNum(it.total)
              : Math.max(0, (unitPrice - itemDisc) * qty)

          const itemGrossSales = Math.max(0, rawLineGross || rawLineTotal)
          const itemNetSales = Math.max(0, rawLineTotal * netAllocationRatio)
          const embeddedUnitCost = extractItemEmbeddedCost(it)

          let acc = accumMap.get(idInfo.canonicalKey)
          if (!acc) {
            acc = {
              key: idInfo.canonicalKey,
              productId: idInfo.productId,
              variantId: idInfo.variantId,
              name: idInfo.displayName,
              sku: idInfo.displaySku,
              categoryName: idInfo.categoryName,
              unit: idInfo.unit,
              stockQuantity: idInfo.stockQuantity,
              orderIds: new Set(),
              qtySold: 0,
              grossSales: 0,
              netSales: 0,
              orderCostTotal: 0,
              orderCostQty: 0,
              lastOrderNumberWithCost: '',
              compQtySold: 0,
              compNetSales: 0,
            }
            accumMap.set(idInfo.canonicalKey, acc)
          }

          if (embeddedUnitCost > 0) {
            acc.orderCostTotal += embeddedUnitCost * qty
            acc.orderCostQty += qty
            if (!acc.lastOrderNumberWithCost && order.order_number) {
              acc.lastOrderNumberWithCost = order.order_number
            }
          }

          if (isCurrent) {
            acc.orderIds.add(String(order.id))
            acc.qtySold += qty
            acc.grossSales += itemGrossSales
            acc.netSales += itemNetSales

            // Track platform summary
            let pRow = platformAggMap.get(platform)
            if (!pRow) {
              pRow = {
                label: platform,
                skuSet: new Set(),
                qtySold: 0,
                netSales: 0,
                totalHpp: 0,
              }
              platformAggMap.set(platform, pRow)
            }
            pRow.skuSet.add(idInfo.canonicalKey)
            pRow.qtySold += qty
            pRow.netSales += itemNetSales
          } else {
            acc.compQtySold += qty
            acc.compNetSales += itemNetSales
          }
        }
      }
    }

    processOrders(countedCurrentOrders, true)
    processOrders(countedComparisonOrders, false)

    // 2. Resolve 6-Tier Waterfall HPP for each product & compute profit metrics
    const totalVolumeAllSold = Array.from(accumMap.values()).reduce(
      (sum, r) => sum + r.qtySold,
      0
    )

    const resolveProductHpp = (acc: ItemAccumulator): {
      unitHpp: number
      hppSource: HppSourceType
      hppSourceLabel: string
      hppSourceDetail: string
    } => {
      const dbProd = acc.productId ? byProductId.get(acc.productId) : null
      const dbVar = acc.variantId ? byVariantId.get(acc.variantId)?.variant : null

      // Tier 1: Variable Recipe HPP (`product_recipes`)
      if (dbProd?.id) {
        const recipeInfo = catalogData.recipeMap.get(dbProd.id)
        if (recipeInfo?.isVariable && recipeInfo.unitHpp > 0) {
          return {
            unitHpp: recipeInfo.unitHpp,
            hppSource: 'recipe',
            hppSourceLabel: HPP_SOURCE_META.recipe.label,
            hppSourceDetail: `Dihitung otomatis dari ${recipeInfo.ingredients.length} bahan baku resep aktif`,
          }
        }
      }

      // Tier 2: Master Product / Variant Cost Price (`cost_price > 0`)
      const varMasterCost = toNum(dbVar?.cost_price)
      const prodMasterCost = toNum(dbProd?.cost_price)
      if (varMasterCost > 0) {
        return {
          unitHpp: varMasterCost,
          hppSource: 'master',
          hppSourceLabel: HPP_SOURCE_META.master.label,
          hppSourceDetail: 'Diambil dari HPP variasi pada Master Katalog Produk',
        }
      }
      if (prodMasterCost > 0 && dbProd?.hpp_type !== 'variable') {
        return {
          unitHpp: prodMasterCost,
          hppSource: 'master',
          hppSourceLabel: HPP_SOURCE_META.master.label,
          hppSourceDetail: 'Diambil dari HPP tetap pada Master Katalog Produk',
        }
      }

      // Tier 3: Fallback 1 — Snapshot HPP di Data Order (`orders.items_json`)
      if (acc.orderCostQty > 0 && acc.orderCostTotal > 0) {
        const avgOrderCost = acc.orderCostTotal / acc.orderCostQty
        const refTag = acc.lastOrderNumberWithCost ? ` (misal #${acc.lastOrderNumberWithCost})` : ''
        return {
          unitHpp: avgOrderCost,
          hppSource: 'order_fallback',
          hppSourceLabel: HPP_SOURCE_META.order_fallback.label,
          hppSourceDetail: `HPP Master Rp 0 — menggunakan rata-rata HPP tercatat di item pesanan${refTag}`,
        }
      }

      // Tier 4: Fallback 2 — Riwayat Pembelian Supplier (`purchases.items_json`)
      const purchaseStat =
        (acc.variantId && purchaseCostByKey.get(`var:${acc.variantId}`)) ||
        (acc.productId && purchaseCostByKey.get(`prod:${acc.productId}`)) ||
        (acc.sku !== '-' && purchaseCostByKey.get(`sku:${acc.sku.toLowerCase()}`)) ||
        purchaseCostByKey.get(`name:${acc.name.toLowerCase()}`) ||
        null

      if (purchaseStat && purchaseStat.totalQty > 0) {
        const avgPurchaseCost = purchaseStat.totalCost / purchaseStat.totalQty
        return {
          unitHpp: avgPurchaseCost,
          hppSource: 'purchase_fallback',
          hppSourceLabel: HPP_SOURCE_META.purchase_fallback.label,
          hppSourceDetail: `HPP Master Rp 0 — diambil dari referensi Pembelian (${purchaseStat.latestPurchaseNumber}${
            purchaseStat.latestDate ? `, ${purchaseStat.latestDate}` : ''
          })`,
        }
      }

      // Tier 5: Fallback 3 — Persentase Default HPP Global (`integrations`)
      const avgSell =
        acc.qtySold > 0
          ? acc.netSales / acc.qtySold
          : toNum(dbVar?.price ?? dbProd?.price)
      if (catalogData.defaultHppPct > 0 && avgSell > 0) {
        return {
          unitHpp: avgSell * (catalogData.defaultHppPct / 100),
          hppSource: 'default_pct',
          hppSourceLabel: `Ref: Default ${catalogData.defaultHppPct}%`,
          hppSourceDetail: `HPP Master Rp 0 — diestimasi ${catalogData.defaultHppPct}% dari harga jual sesuai pengaturan bisnis`,
        }
      }

      // Tier 6: HPP Kosong (`Rp 0`)
      const isBrokenRecipe = dbProd?.hpp_type === 'variable'
      return {
        unitHpp: 0,
        hppSource: 'missing',
        hppSourceLabel: HPP_SOURCE_META.missing.label,
        hppSourceDetail: isBrokenRecipe
          ? 'Produk bertipe Resep (Variable) namun belum memiliki bahan baku berharga modal > Rp 0. Margin tampil 100% (semu).'
          : 'HPP belum diatur di Master Produk & tidak ditemukan di riwayat Order/Pembelian. Margin tampil 100% (semu).',
      }
    }

    const preliminaryRows: ProductMatrixRow[] = []

    for (const acc of accumMap.values()) {
      const hppResolved = resolveProductHpp(acc)

      // Apply HPP Segment Filter if active
      if (selectedHppFilter === 'valid_master' && !['master', 'recipe'].includes(hppResolved.hppSource)) {
        continue
      }
      if (
        selectedHppFilter === 'fallback_only' &&
        !['order_fallback', 'purchase_fallback', 'default_pct'].includes(hppResolved.hppSource)
      ) {
        continue
      }
      if (selectedHppFilter === 'missing_only' && hppResolved.hppSource !== 'missing') {
        continue
      }

      const avgSellingPrice =
        acc.qtySold > 0
          ? acc.netSales / acc.qtySold
          : toNum(
              (acc.variantId && byVariantId.get(acc.variantId)?.variant?.price) ||
                (acc.productId && byProductId.get(acc.productId)?.price)
            )

      const totalHpp = hppResolved.unitHpp * acc.qtySold
      const grossProfit = acc.netSales - totalHpp
      const unitMargin =
        acc.qtySold > 0 ? grossProfit / acc.qtySold : avgSellingPrice - hppResolved.unitHpp
      const marginPct = acc.netSales > 0 ? (grossProfit / acc.netSales) * 100 : 0
      const qtySharePct = totalVolumeAllSold > 0 ? (acc.qtySold / totalVolumeAllSold) * 100 : 0

      const compTotalHpp = hppResolved.unitHpp * acc.compQtySold
      const compGrossProfit = acc.compNetSales - compTotalHpp

      preliminaryRows.push({
        key: acc.key,
        productId: acc.productId,
        variantId: acc.variantId,
        name: acc.name,
        sku: acc.sku,
        categoryName: acc.categoryName,
        unit: acc.unit,
        stockQuantity: acc.stockQuantity,
        ordersCount: acc.orderIds.size,
        qtySold: acc.qtySold,
        qtySharePct,
        grossSales: acc.grossSales,
        netSales: acc.netSales,
        avgSellingPrice,
        unitHpp: hppResolved.unitHpp,
        totalHpp,
        grossProfit,
        unitMargin,
        marginPct,
        hppSource: hppResolved.hppSource,
        hppSourceLabel: hppResolved.hppSourceLabel,
        hppSourceDetail: hppResolved.hppSourceDetail,
        compQtySold: acc.compQtySold,
        compNetSales: acc.compNetSales,
        compGrossProfit,
        compQuadrant: null,
        quadrant: 'no_sales',
        recommendation: '',
      })
    }

    // 3. Calculate BCG Quadrant Cut-off Thresholds (X = Volume, Y = Selected Profit Metric)
    const soldRows = preliminaryRows.filter(r => r.qtySold > 0)
    // Optionally exclude missing HPP items when computing the Y-axis profit threshold so 100% fake margins don't skew the cut-off line
    const yEligibleRows =
      excludeMissingHppFromThreshold && soldRows.some(r => r.hppSource !== 'missing')
        ? soldRows.filter(r => r.hppSource !== 'missing')
        : soldRows

    const getYValue = (r: ProductMatrixRow): number => {
      if (yAxisMetric === 'unitMargin') return r.unitMargin
      if (yAxisMetric === 'marginPct') return r.marginPct
      return r.grossProfit
    }

    let xThreshold = 0
    let yThreshold = 0

    if (soldRows.length > 0) {
      if (thresholdMode === 'median') {
        xThreshold = computeMedian(soldRows.map(r => r.qtySold))
        yThreshold = computeMedian(yEligibleRows.map(r => getYValue(r)))
      } else {
        xThreshold = soldRows.reduce((s, r) => s + r.qtySold, 0) / soldRows.length
        yThreshold =
          yEligibleRows.length > 0
            ? yEligibleRows.reduce((s, r) => s + getYValue(r), 0) / yEligibleRows.length
            : 0
      }
    }

    // Also compute Comparison Period Thresholds so we know if a product shifted quadrants!
    const compSoldRows = preliminaryRows.filter(r => r.compQtySold > 0)
    const compXThreshold =
      compSoldRows.length > 0
        ? thresholdMode === 'median'
          ? computeMedian(compSoldRows.map(r => r.compQtySold))
          : compSoldRows.reduce((s, r) => s + r.compQtySold, 0) / compSoldRows.length
        : 0
    const compYThreshold =
      compSoldRows.length > 0
        ? thresholdMode === 'median'
          ? computeMedian(compSoldRows.map(r => r.compGrossProfit))
          : compSoldRows.reduce((s, r) => s + r.compGrossProfit, 0) / compSoldRows.length
        : 0

    const classifyPoint = (qty: number, yVal: number, xCut: number, yCut: number): QuadrantType => {
      if (qty <= 0) return 'no_sales'
      const isHighVol = qty >= xCut
      const isHighProfit = yVal >= yCut
      if (isHighVol && isHighProfit) return 'star'
      if (isHighVol && !isHighProfit) return 'cash_cow'
      if (!isHighVol && isHighProfit) return 'puzzle'
      return 'dog'
    }

    for (const r of preliminaryRows) {
      r.quadrant = classifyPoint(r.qtySold, getYValue(r), xThreshold, yThreshold)
      if (r.compQtySold > 0) {
        const compYVal =
          yAxisMetric === 'unitMargin'
            ? r.compGrossProfit / r.compQtySold
            : yAxisMetric === 'marginPct'
            ? r.compNetSales > 0
              ? (r.compGrossProfit / r.compNetSales) * 100
              : 0
            : r.compGrossProfit
        r.compQuadrant = classifyPoint(r.compQtySold, compYVal, compXThreshold, compYThreshold)
      }
      r.recommendation = buildRecommendation(r.quadrant, r.hppSource, r.marginPct)
    }

    // Finalize platform summary HPP using resolved unitHpp
    const rowByKey = new Map(preliminaryRows.map(r => [r.key, r]))
    for (const order of countedCurrentOrders) {
      const platform = cleanText(order.source_platform || 'Manual') || 'Manual'
      const pRow = platformAggMap.get(platform)
      if (!pRow) continue
      const items = parseJsonArray(order.items_json)
      for (const it of items) {
        const qty = Math.max(0, toNum(it?.quantity) || 1)
        const idInfo = resolveItemIdentity(it)
        const resolvedRow = rowByKey.get(idInfo.canonicalKey)
        if (resolvedRow) {
          pRow.totalHpp += resolvedRow.unitHpp * qty
        }
      }
    }

    const platformSummary: GroupedSummaryRow[] = Array.from(platformAggMap.values()).map(p => {
      const profit = p.netSales - p.totalHpp
      return {
        key: p.label,
        label: p.label,
        skuCount: p.skuSet.size,
        qtySold: p.qtySold,
        netSales: p.netSales,
        totalHpp: p.totalHpp,
        grossProfit: profit,
        marginPct: p.netSales > 0 ? (profit / p.netSales) * 100 : 0,
      }
    })

    return {
      matrixRows: preliminaryRows,
      platformSummaryRows: platformSummary,
      thresholdValues: {
        xThreshold,
        yThreshold,
      },
    }
  }, [
    catalogAndFallbackMaps,
    catalogData,
    countedCurrentOrders,
    countedComparisonOrders,
    selectedCategory,
    selectedPlatform,
    selectedHppFilter,
    yAxisMetric,
    thresholdMode,
    excludeMissingHppFromThreshold,
  ])

  // ─── KPI & Quadrant Summary Aggregations ────────────────────────────────────
  const kpiSummary = useMemo(() => {
    const soldRows = matrixRows.filter(r => r.qtySold > 0)
    const deadStockRows = matrixRows.filter(r => r.qtySold === 0)

    const totalNetSales = soldRows.reduce((s, r) => s + r.netSales, 0)
    const totalGrossProfit = soldRows.reduce((s, r) => s + r.grossProfit, 0)
    const totalHpp = soldRows.reduce((s, r) => s + r.totalHpp, 0)
    const totalQtySold = soldRows.reduce((s, r) => s + r.qtySold, 0)
    const overallMarginPct = totalNetSales > 0 ? (totalGrossProfit / totalNetSales) * 100 : 0

    const compNetSales = matrixRows.reduce((s, r) => s + r.compNetSales, 0)
    const compGrossProfit = matrixRows.reduce((s, r) => s + r.compGrossProfit, 0)
    const compQtySold = matrixRows.reduce((s, r) => s + r.compQtySold, 0)

    const byQuadrant: Record<
      QuadrantType,
      { count: number; qty: number; netSales: number; profit: number; profitSharePct: number }
    > = {
      star: { count: 0, qty: 0, netSales: 0, profit: 0, profitSharePct: 0 },
      cash_cow: { count: 0, qty: 0, netSales: 0, profit: 0, profitSharePct: 0 },
      puzzle: { count: 0, qty: 0, netSales: 0, profit: 0, profitSharePct: 0 },
      dog: { count: 0, qty: 0, netSales: 0, profit: 0, profitSharePct: 0 },
      no_sales: {
        count: deadStockRows.length,
        qty: 0,
        netSales: 0,
        profit: 0,
        profitSharePct: 0,
      },
    }

    for (const r of soldRows) {
      const bucket = byQuadrant[r.quadrant]
      bucket.count += 1
      bucket.qty += r.qtySold
      bucket.netSales += r.netSales
      bucket.profit += r.grossProfit
    }

    for (const q of ['star', 'cash_cow', 'puzzle', 'dog'] as QuadrantType[]) {
      byQuadrant[q].profitSharePct =
        totalGrossProfit > 0 ? Math.max(0, (byQuadrant[q].profit / totalGrossProfit) * 100) : 0
    }

    const masterOrRecipeCount = soldRows.filter(r =>
      ['master', 'recipe'].includes(r.hppSource)
    ).length
    const fallbackCount = soldRows.filter(r =>
      ['order_fallback', 'purchase_fallback', 'default_pct'].includes(r.hppSource)
    ).length
    const missingHppCount = soldRows.filter(r => r.hppSource === 'missing').length

    return {
      soldSkuCount: soldRows.length,
      deadStockCount: deadStockRows.length,
      totalNetSales,
      totalGrossProfit,
      totalHpp,
      totalQtySold,
      overallMarginPct,
      growth: {
        grossProfit: calcGrowthPct(totalGrossProfit, compGrossProfit),
        netSales: calcGrowthPct(totalNetSales, compNetSales),
        qtySold: calcGrowthPct(totalQtySold, compQtySold),
      },
      byQuadrant,
      hppHealth: {
        masterOrRecipeCount,
        fallbackCount,
        missingHppCount,
      },
    }
  }, [matrixRows])

  // ─── Scatter Plot Coordinates Calculation ───────────────────────────────────
  const scatterData = useMemo(() => {
    const soldRows = matrixRows.filter(r => r.qtySold > 0)
    if (soldRows.length === 0) {
      return {
        points: [],
        maxX: 10,
        minY: 0,
        maxY: 100,
        xThresholdPct: 50,
        yThresholdPct: 50,
      }
    }

    const getY = (r: ProductMatrixRow) =>
      yAxisMetric === 'unitMargin'
        ? r.unitMargin
        : yAxisMetric === 'marginPct'
        ? r.marginPct
        : r.grossProfit

    const xVals = soldRows.map(r => r.qtySold)
    const yVals = soldRows.map(getY)

    // Ensure threshold lines sit nicely inside the visual plot area (clamped 15%..85%)
    const rawMaxX = Math.max(...xVals, thresholdValues.xThreshold * 1.6, 1)
    const rawMinY = Math.min(0, ...yVals)
    const rawMaxY = Math.max(...yVals, thresholdValues.yThreshold * 1.6, 1)
    const ySpan = Math.max(1, rawMaxY - rawMinY)

    const maxRevenue = Math.max(...soldRows.map(r => r.netSales), 1)

    const clampPct = (pct: number) => Math.max(6, Math.min(94, pct))

    const xThresholdPct = clampPct((thresholdValues.xThreshold / rawMaxX) * 100)
    const yThresholdPct = clampPct(((thresholdValues.yThreshold - rawMinY) / ySpan) * 100)

    const points = soldRows.map(r => {
      const yVal = getY(r)
      // Piecewise linear scaling around threshold so quadrant membership 100% matches visual quadrant!
      let xPct = 50
      if (r.qtySold >= thresholdValues.xThreshold) {
        const rightSpan = Math.max(1e-6, rawMaxX - thresholdValues.xThreshold)
        xPct =
          xThresholdPct +
          ((r.qtySold - thresholdValues.xThreshold) / rightSpan) * (94 - xThresholdPct)
      } else {
        const leftSpan = Math.max(1e-6, thresholdValues.xThreshold)
        xPct = 6 + (r.qtySold / leftSpan) * Math.max(0, xThresholdPct - 6)
      }

      let yPct = 50
      if (yVal >= thresholdValues.yThreshold) {
        const topSpan = Math.max(1e-6, rawMaxY - thresholdValues.yThreshold)
        yPct =
          yThresholdPct +
          ((yVal - thresholdValues.yThreshold) / topSpan) * (94 - yThresholdPct)
      } else {
        const bottomSpan = Math.max(1e-6, thresholdValues.yThreshold - rawMinY)
        yPct = 6 + ((yVal - rawMinY) / bottomSpan) * Math.max(0, yThresholdPct - 6)
      }

      // Bubble diameter 12px..28px based on Net Sales
      const sizePx = Math.round(12 + Math.sqrt(r.netSales / maxRevenue) * 16)

      return {
        row: r,
        xPct: clampPct(xPct),
        yPct: clampPct(yPct),
        sizePx,
      }
    })

    return {
      points,
      maxX: rawMaxX,
      minY: rawMinY,
      maxY: rawMaxY,
      xThresholdPct,
      yThresholdPct,
    }
  }, [matrixRows, yAxisMetric, thresholdValues])

  // ─── Filtered & Sorted Breakdown Table Rows ─────────────────────────────────
  const filteredTableRows = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    return matrixRows
      .filter(r => {
        if (activeQuadrantTab === 'all_sold' && r.qtySold <= 0) return false
        if (activeQuadrantTab === 'missing_hpp' && !(r.qtySold > 0 && r.hppSource === 'missing')) {
          return false
        }
        if (
          ['star', 'cash_cow', 'puzzle', 'dog', 'no_sales'].includes(activeQuadrantTab) &&
          r.quadrant !== activeQuadrantTab
        ) {
          return false
        }

        if (q) {
          const matchName = r.name.toLowerCase().includes(q)
          const matchSku = r.sku.toLowerCase().includes(q)
          const matchCat = r.categoryName.toLowerCase().includes(q)
          if (!matchName && !matchSku && !matchCat) return false
        }
        return true
      })
      .sort((a, b) => {
        const dir = sortOrder === 'asc' ? 1 : -1
        if (sortField === 'name') return a.name.localeCompare(b.name) * dir
        if (sortField === 'quadrant') return a.quadrant.localeCompare(b.quadrant) * dir
        return ((a[sortField] as number) - (b[sortField] as number)) * dir
      })
  }, [matrixRows, activeQuadrantTab, searchQuery, sortField, sortOrder])

  // ─── Grouped By Summary Rows ────────────────────────────────────────────────
  const groupedSummaryRows = useMemo(() => {
    if (groupDim === 'platform') {
      return [...platformSummaryRows].sort((a, b) => {
        const dir = groupSortOrder === 'asc' ? 1 : -1
        if (groupSortField === 'label') return a.label.localeCompare(b.label) * dir
        return ((a[groupSortField] as number) - (b[groupSortField] as number)) * dir
      })
    }

    const map = new Map<string, GroupedSummaryRow>()
    const soldOrAll = groupDim === 'quadrant' ? matrixRows : matrixRows.filter(r => r.qtySold > 0)

    for (const r of soldOrAll) {
      let key = ''
      let label = ''
      let badge = ''

      if (groupDim === 'quadrant') {
        key = r.quadrant
        label = QUADRANT_META[r.quadrant].label
        badge = QUADRANT_META[r.quadrant].icon
      } else if (groupDim === 'category') {
        key = r.categoryName
        label = r.categoryName
      } else if (groupDim === 'hpp_source') {
        key = r.hppSource
        label = HPP_SOURCE_META[r.hppSource].label
      }

      let g = map.get(key)
      if (!g) {
        g = {
          key,
          label,
          badge,
          skuCount: 0,
          qtySold: 0,
          netSales: 0,
          totalHpp: 0,
          grossProfit: 0,
          marginPct: 0,
        }
        map.set(key, g)
      }

      g.skuCount += 1
      g.qtySold += r.qtySold
      g.netSales += r.netSales
      g.totalHpp += r.totalHpp
      g.grossProfit += r.grossProfit
    }

    const list = Array.from(map.values()).map(g => ({
      ...g,
      marginPct: g.netSales > 0 ? (g.grossProfit / g.netSales) * 100 : 0,
    }))

    return list.sort((a, b) => {
      const dir = groupSortOrder === 'asc' ? 1 : -1
      if (groupSortField === 'label') return a.label.localeCompare(b.label) * dir
      return ((a[groupSortField] as number) - (b[groupSortField] as number)) * dir
    })
  }, [matrixRows, platformSummaryRows, groupDim, groupSortField, groupSortOrder])

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortOrder(prev => (prev === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortField(field)
      setSortOrder(field === 'name' ? 'asc' : 'desc')
    }
  }

  const handleGroupSort = (field: GroupSortField) => {
    if (groupSortField === field) {
      setGroupSortOrder(prev => (prev === 'asc' ? 'desc' : 'asc'))
    } else {
      setGroupSortField(field)
      setGroupSortOrder(field === 'label' ? 'asc' : 'desc')
    }
  }

  const handleExportExcel = () => {
    const exportData = filteredTableRows.map(r => ({
      'Nama Produk': r.name,
      SKU: r.sku,
      Kategori: r.categoryName,
      'Kuadran BCG': QUADRANT_META[r.quadrant].shortLabel,
      'Qty Terjual': r.qtySold,
      'Share Volume (%)': Number(r.qtySharePct.toFixed(2)),
      'Harga Jual Rata-rata (IDR)': Math.round(r.avgSellingPrice),
      'Net Sales / Omzet (IDR)': Math.round(r.netSales),
      'HPP per Unit (IDR)': Math.round(r.unitHpp),
      'Sumber Data HPP': r.hppSourceLabel,
      'Keterangan HPP': r.hppSourceDetail,
      'Total HPP (IDR)': Math.round(r.totalHpp),
      'Gross Profit / Laba Kotor (IDR)': Math.round(r.grossProfit),
      'Margin per Unit (IDR)': Math.round(r.unitMargin),
      'Gross Margin (%)': Number(r.marginPct.toFixed(2)),
      'Stok Saat Ini': r.stockQuantity,
      'Rekomendasi Strategis': r.recommendation,
    }))

    const ws = XLSX.utils.json_to_sheet(exportData)
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Product_Performance_BCG')
    XLSX.writeFile(
      wb,
      `Product_Performance_BCG_${temporalFilter.startDate || 'all'}_to_${temporalFilter.endDate || 'all'}.xlsx`
    )
  }

  const renderGrowthPill = (pct: number, inverse = false) => {
    if (temporalFilter.comparisonMode === 'none') return null
    const rounded = Math.round(pct * 10) / 10
    const isPositive = rounded >= 0
    const isGood = inverse ? !isPositive : isPositive
    const colorClass =
      rounded === 0
        ? 'bg-slate-100 text-slate-600'
        : isGood
        ? 'bg-emerald-50 text-emerald-700 border border-emerald-200/70'
        : 'bg-rose-50 text-rose-700 border border-rose-200/70'

    return (
      <span
        className={`inline-flex items-center px-1.5 py-0.5 rounded-md text-[11px] font-bold ${colorClass}`}
      >
        {isPositive ? '+' : ''}
        {rounded}%
      </span>
    )
  }

  const formatYValue = (val: number) => {
    if (yAxisMetric === 'marginPct') return `${val.toFixed(1)}%`
    return formatIDR(val)
  }

  return (
    <div className="min-h-screen bg-[#F8FAFC] text-slate-900 p-4 sm:p-6 lg:p-7 space-y-5">
      {/* ── TOP HEADER BAR (1:1 Character with Revenue Report) ────────────── */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
        <div className="flex items-center gap-2.5 flex-wrap">
          <button
            type="button"
            onClick={goBack}
            className="w-8 h-8 rounded-lg bg-white border border-slate-200 hover:bg-slate-50 flex items-center justify-center text-slate-600 shadow-2xs transition cursor-pointer"
            aria-label="Kembali"
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <polyline points="15 18 9 12 15 6" />
            </svg>
          </button>

          <h1 className="text-xl sm:text-2xl font-extrabold text-slate-900 tracking-tight">
            Product Performance
          </h1>

          {/* Segment Filter Button & Popover */}
          <div className="relative">
            <button
              type="button"
              onClick={() => setIsSegmentOpen(prev => !prev)}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold border transition cursor-pointer shadow-2xs ${
                selectedCategory !== 'all' ||
                selectedPlatform !== 'all' ||
                selectedHppFilter !== 'all'
                  ? 'bg-indigo-600 text-white border-indigo-600'
                  : 'bg-white text-indigo-600 border-indigo-200 hover:border-indigo-400 hover:bg-indigo-50/40'
              }`}
            >
              <svg
                width="13"
                height="13"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />
              </svg>
              <span>Segment</span>
              {(selectedCategory !== 'all' ||
                selectedPlatform !== 'all' ||
                selectedHppFilter !== 'all') && (
                <span className="ml-0.5 px-1.5 py-0.2 bg-white/20 rounded-full text-[10px]">
                  Aktif
                </span>
              )}
            </button>

            {isSegmentOpen && (
              <div className="absolute left-0 mt-2 w-76 bg-white border border-slate-200 rounded-xl shadow-xl p-4 z-40 space-y-3">
                <div className="flex items-center justify-between border-b border-slate-100 pb-2">
                  <span className="text-xs font-extrabold text-slate-800 uppercase tracking-wider">
                    Filter Segmen Produk
                  </span>
                  <button
                    type="button"
                    onClick={() => setIsSegmentOpen(false)}
                    className="text-slate-400 hover:text-slate-700 text-xs font-bold cursor-pointer"
                  >
                    ✕
                  </button>
                </div>

                <div>
                  <label className="block text-[11px] font-bold text-slate-600 mb-1">
                    Kategori Produk
                  </label>
                  <select
                    value={selectedCategory}
                    onChange={e => setSelectedCategory(e.target.value)}
                    className="w-full px-2.5 py-1.5 text-xs border border-slate-200 rounded-lg bg-slate-50 font-semibold text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  >
                    <option value="all">Semua Kategori ({availableCategories.length})</option>
                    {availableCategories.map(c => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-[11px] font-bold text-slate-600 mb-1">
                    Platform / Channel Pesanan
                  </label>
                  <select
                    value={selectedPlatform}
                    onChange={e => setSelectedPlatform(e.target.value)}
                    className="w-full px-2.5 py-1.5 text-xs border border-slate-200 rounded-lg bg-slate-50 font-semibold text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  >
                    <option value="all">Semua Platform ({availablePlatforms.length})</option>
                    {availablePlatforms.map(p => (
                      <option key={p} value={p}>
                        {p}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-[11px] font-bold text-slate-600 mb-1">
                    Status Sumber Data HPP
                  </label>
                  <select
                    value={selectedHppFilter}
                    onChange={e => setSelectedHppFilter(e.target.value as any)}
                    className="w-full px-2.5 py-1.5 text-xs border border-slate-200 rounded-lg bg-slate-50 font-semibold text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  >
                    <option value="all">Semua Sumber HPP</option>
                    <option value="valid_master">🟢 Master Produk / Resep</option>
                    <option value="fallback_only">🔵 Fallback (Order / Pembelian)</option>
                    <option value="missing_only">⚠️ Hanya HPP Kosong (Rp 0)</option>
                  </select>
                </div>

                {(selectedCategory !== 'all' ||
                  selectedPlatform !== 'all' ||
                  selectedHppFilter !== 'all') && (
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedCategory('all')
                      setSelectedPlatform('all')
                      setSelectedHppFilter('all')
                    }}
                    className="w-full py-1.5 text-xs font-bold text-rose-600 hover:bg-rose-50 rounded-lg border border-rose-200 transition cursor-pointer"
                  >
                    Reset Filter Segmen
                  </button>
                )}
              </div>
            )}
          </div>

          {isSyncing && (
            <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-indigo-600 bg-indigo-50 px-2.5 py-1 rounded-full border border-indigo-100">
              <span className="w-2 h-2 rounded-full bg-indigo-600 animate-ping" />
              Menyinkronkan...
            </span>
          )}
        </div>

        {/* TemporalDateFilter (Default 30 Hari Terakhir) */}
        <div className="flex items-center justify-end">
          <TemporalDateFilter
            value={temporalFilter}
            onChange={setTemporalFilter}
            timezone={activeBusiness?.timezone}
            showComparison={true}
            allowAllTime={true}
            align="right"
          />
        </div>
      </div>

      {/* ── SUBTITLE & CATALOG LINK ──────────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs text-slate-600 border-b border-slate-200/80 pb-3">
        <p>
          Analisa <strong className="font-bold text-slate-900">BCG Product Matrix</strong> — memetakan setiap produk berdasarkan{' '}
          <strong className="font-semibold text-slate-800">Volume Terjual</strong> vs{' '}
          <strong className="font-semibold text-slate-800">Kontribusi Profit (Laba Kotor)</strong> ke dalam kuadran{' '}
          <span className="font-semibold text-emerald-700">⭐ Star</span>,{' '}
          <span className="font-semibold text-indigo-700">🐄 Cash Cow</span>,{' '}
          <span className="font-semibold text-amber-700">🧩 Puzzle</span>, dan{' '}
          <span className="font-semibold text-rose-700">🐶 Dog</span>.
        </p>
        <Link
          href="/products"
          className="text-indigo-600 hover:text-indigo-800 font-bold inline-flex items-center gap-1 shrink-0 hover:underline"
        >
          <span>Kelola HPP di Katalog Produk</span>
          <span>&rsaquo;</span>
        </Link>
      </div>

      {/* ── DATA HEALTH BANNER (HPP FALLBACK & MISSING HPP INFO) ─────────── */}
      {!loading &&
        (kpiSummary.hppHealth.missingHppCount > 0 ||
          kpiSummary.hppHealth.fallbackCount > 0) && (
          <div className="bg-amber-50/90 border border-amber-200/90 rounded-xl px-4 py-3 flex flex-col lg:flex-row lg:items-center justify-between gap-3 text-xs">
            <div className="flex items-start sm:items-center gap-2.5 text-amber-900">
              <span className="text-base leading-none">💡</span>
              <div>
                <span className="font-extrabold">Informasi Sumber HPP: </span>
                {kpiSummary.hppHealth.fallbackCount > 0 && (
                  <span>
                    Terdapat{' '}
                    <strong className="underline decoration-amber-500">
                      {kpiSummary.hppHealth.fallbackCount} produk
                    </strong>{' '}
                    yang HPP Master-nya kosong namun berhasil diestimasi otomatis dari{' '}
                    <strong>Data Order / Nota Pembelian</strong>.{' '}
                  </span>
                )}
                {kpiSummary.hppHealth.missingHppCount > 0 && (
                  <span>
                    Terdapat{' '}
                    <strong className="text-rose-700 underline">
                      {kpiSummary.hppHealth.missingHppCount} produk terjual dengan HPP Kosong (Rp 0)
                    </strong>{' '}
                    sehingga margin terlihat 100% (semu).
                  </span>
                )}
              </div>
            </div>

            <div className="flex items-center gap-2.5 flex-wrap shrink-0">
              {kpiSummary.hppHealth.missingHppCount > 0 && (
                <>
                  <label className="inline-flex items-center gap-1.5 text-[11px] font-bold text-amber-900 bg-white/80 px-2.5 py-1 rounded-lg border border-amber-300 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={excludeMissingHppFromThreshold}
                      onChange={e => setExcludeMissingHppFromThreshold(e.target.checked)}
                      className="rounded border-amber-400 text-indigo-600 focus:ring-indigo-500"
                    />
                    <span>Kecualikan HPP Kosong dari Garis Rata-rata</span>
                  </label>
                  <button
                    type="button"
                    onClick={() =>
                      setActiveQuadrantTab(prev =>
                        prev === 'missing_hpp' ? 'all_sold' : 'missing_hpp'
                      )
                    }
                    className={`px-2.5 py-1 rounded-lg text-[11px] font-bold border transition cursor-pointer ${
                      activeQuadrantTab === 'missing_hpp'
                        ? 'bg-amber-800 text-white border-amber-900'
                        : 'bg-white text-amber-900 border-amber-300 hover:bg-amber-100'
                    }`}
                  >
                    {activeQuadrantTab === 'missing_hpp'
                      ? 'Tampilkan Semua Produk'
                      : `Lihat ${kpiSummary.hppHealth.missingHppCount} HPP Kosong`}
                  </button>
                </>
              )}
            </div>
          </div>
        )}

      {/* ── SECTION 1: BCG MATRIX SCATTER PLOT (LEFT 8) + KPI GRID (RIGHT 4) ─ */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-stretch">
        {/* LEFT: Interactive 4-Quadrant BCG Matrix Card (8 Cols) */}
        <div className="lg:col-span-8 bg-white border border-slate-200/90 rounded-xl shadow-2xs flex flex-col justify-between">
          {/* Card Header */}
          <div className="px-5 py-3.5 border-b border-slate-100 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2.5 flex-wrap">
              <h2 className="text-sm font-extrabold text-slate-900">
                BCG Product Portfolio Matrix
              </h2>
              <button
                type="button"
                onClick={handleExportExcel}
                title="Download Data Matriks (Excel)"
                className="p-1.5 rounded-lg border border-slate-200 text-slate-500 hover:text-slate-800 hover:bg-slate-50 transition cursor-pointer"
              >
                <svg
                  width="13"
                  height="13"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                  <polyline points="7 10 12 15 17 10" />
                  <line x1="12" y1="15" x2="12" y2="3" />
                </svg>
              </button>

              <div className="hidden sm:inline-flex items-center gap-2.5 ml-1 text-[11px] font-semibold text-slate-500">
                <span className="inline-flex items-center gap-1">
                  <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 inline-block" />
                  <span>Star</span>
                </span>
                <span className="inline-flex items-center gap-1">
                  <span className="w-2.5 h-2.5 rounded-full bg-indigo-500 inline-block" />
                  <span>Cash Cow</span>
                </span>
                <span className="inline-flex items-center gap-1">
                  <span className="w-2.5 h-2.5 rounded-full bg-amber-500 inline-block" />
                  <span>Puzzle</span>
                </span>
                <span className="inline-flex items-center gap-1">
                  <span className="w-2.5 h-2.5 rounded-full bg-rose-500 inline-block" />
                  <span>Dog</span>
                </span>
              </div>
            </div>

            {/* Matrix Controls */}
            <div className="flex items-center gap-2 flex-wrap">
              {/* Threshold Mode Toggle */}
              <div className="inline-flex rounded-lg border border-slate-200 overflow-hidden bg-white text-[11px] font-bold">
                <button
                  type="button"
                  onClick={() => setThresholdMode('mean')}
                  className={`px-2.5 py-1 transition cursor-pointer ${
                    thresholdMode === 'mean'
                      ? 'bg-indigo-600 text-white'
                      : 'text-slate-600 hover:bg-slate-50'
                  }`}
                  title="Garis batas kuadran menggunakan nilai Rata-rata"
                >
                  Rata-rata
                </button>
                <button
                  type="button"
                  onClick={() => setThresholdMode('median')}
                  className={`px-2.5 py-1 transition cursor-pointer border-l border-slate-200 ${
                    thresholdMode === 'median'
                      ? 'bg-indigo-600 text-white'
                      : 'text-slate-600 hover:bg-slate-50'
                  }`}
                  title="Garis batas kuadran menggunakan Nilai Tengah (Median) agar tahan terhadap outlier"
                >
                  Median
                </button>
              </div>

              {/* Y-Axis Metric Selector */}
              <select
                value={yAxisMetric}
                onChange={e => setYAxisMetric(e.target.value as YAxisMetric)}
                className="px-2.5 py-1 rounded-lg text-xs font-bold border border-slate-200 bg-white text-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 cursor-pointer"
              >
                <option value="totalProfit">Sumbu Y: Total Profit (Rp)</option>
                <option value="unitMargin">Sumbu Y: Margin / Unit (Rp)</option>
                <option value="marginPct">Sumbu Y: Gross Margin (%)</option>
              </select>
            </div>
          </div>

          {/* Matrix Plot Area */}
          <div className="p-5 flex-1 flex flex-col justify-between relative min-h-[380px]">
            {/* Hover Tooltip Banner (Matches Revenue Report Tooltip Style) */}
            {hoveredProduct && (
              <div className="absolute top-3 right-5 left-5 sm:left-auto z-30 bg-slate-900/95 text-white px-3.5 py-2.5 rounded-xl shadow-lg text-xs flex flex-wrap items-center gap-3 pointer-events-none border border-slate-700">
                <span className="font-extrabold text-amber-300">
                  {QUADRANT_META[hoveredProduct.quadrant].icon} {hoveredProduct.name}
                </span>
                <span>
                  Qty: <strong className="font-mono">{formatNumber(hoveredProduct.qtySold)}</strong>
                </span>
                <span>
                  Omzet: <strong className="font-mono text-indigo-300">{formatIDR(hoveredProduct.netSales)}</strong>
                </span>
                <span>
                  HPP/unit:{' '}
                  <strong className="font-mono">
                    {hoveredProduct.hppSource === 'missing'
                      ? '⚠️ Kosong (Rp 0)'
                      : `${formatIDR(hoveredProduct.unitHpp)} (${hoveredProduct.hppSourceLabel})`}
                  </strong>
                </span>
                <span>
                  Profit:{' '}
                  <strong className="font-mono text-emerald-300">
                    {formatIDR(hoveredProduct.grossProfit)} ({hoveredProduct.marginPct.toFixed(1)}%)
                  </strong>
                </span>
              </div>
            )}

            {loading ? (
              <div className="flex-1 flex items-center justify-center text-xs font-bold text-slate-400 animate-pulse">
                Memuat pemetaan BCG Matrix...
              </div>
            ) : scatterData.points.length === 0 ? (
              <div className="flex-1 flex items-center justify-center text-xs font-semibold text-slate-400">
                Tidak ada penjualan produk pada rentang tanggal ini.
              </div>
            ) : (
              <div className="flex-1 flex flex-col justify-between">
                <div className="relative flex-1 flex min-h-[310px]">
                  {/* Y-Axis Label & Ticks */}
                  <div className="w-20 sm:w-24 pr-2.5 flex flex-col justify-between text-[10px] font-mono text-slate-400 text-right select-none py-1">
                    <span>
                      {yAxisMetric === 'marginPct'
                        ? `${scatterData.maxY.toFixed(0)}%`
                        : formatAxisIDR(scatterData.maxY)}
                    </span>
                    <span className="text-indigo-600 font-bold">
                      {yAxisMetric === 'marginPct'
                        ? `${thresholdValues.yThreshold.toFixed(1)}%`
                        : formatAxisIDR(thresholdValues.yThreshold)}
                    </span>
                    <span>
                      {yAxisMetric === 'marginPct'
                        ? `${scatterData.minY.toFixed(0)}%`
                        : formatAxisIDR(scatterData.minY)}
                    </span>
                  </div>

                  {/* 4-Quadrant Canvas */}
                  <div className="flex-1 relative rounded-xl border border-slate-200 overflow-hidden bg-slate-50/40">
                    {/* Top-Left Quadrant: PUZZLE */}
                    <div
                      style={{
                        left: 0,
                        width: `${scatterData.xThresholdPct}%`,
                        bottom: `${scatterData.yThresholdPct}%`,
                        top: 0,
                      }}
                      className="absolute bg-amber-50/35 pointer-events-none p-2.5 flex flex-col justify-start items-start"
                    >
                      <span className="text-[11px] font-extrabold text-amber-800/80 bg-white/80 px-2 py-0.5 rounded-md border border-amber-200/70 shadow-2xs">
                        🧩 PUZZLE / QUESTION MARK
                      </span>
                      <span className="text-[10px] text-amber-700/70 mt-0.5 hidden sm:inline">
                        Profit Tinggi • Volume Rendah
                      </span>
                    </div>

                    {/* Top-Right Quadrant: STAR */}
                    <div
                      style={{
                        left: `${scatterData.xThresholdPct}%`,
                        right: 0,
                        bottom: `${scatterData.yThresholdPct}%`,
                        top: 0,
                      }}
                      className="absolute bg-emerald-50/40 pointer-events-none p-2.5 flex flex-col justify-start items-end text-right"
                    >
                      <span className="text-[11px] font-extrabold text-emerald-800/85 bg-white/80 px-2 py-0.5 rounded-md border border-emerald-200/70 shadow-2xs">
                        ⭐ STAR (UNGGULAN)
                      </span>
                      <span className="text-[10px] text-emerald-700/75 mt-0.5 hidden sm:inline">
                        Profit Tinggi • Volume Tinggi
                      </span>
                    </div>

                    {/* Bottom-Left Quadrant: DOG */}
                    <div
                      style={{
                        left: 0,
                        width: `${scatterData.xThresholdPct}%`,
                        top: `${100 - scatterData.yThresholdPct}%`,
                        bottom: 0,
                      }}
                      className="absolute bg-rose-50/30 pointer-events-none p-2.5 flex flex-col justify-end items-start"
                    >
                      <span className="text-[10px] text-rose-700/70 mb-0.5 hidden sm:inline">
                        Profit Rendah • Volume Rendah
                      </span>
                      <span className="text-[11px] font-extrabold text-rose-800/80 bg-white/80 px-2 py-0.5 rounded-md border border-rose-200/70 shadow-2xs">
                        🐶 DOG
                      </span>
                    </div>

                    {/* Bottom-Right Quadrant: CASH COW */}
                    <div
                      style={{
                        left: `${scatterData.xThresholdPct}%`,
                        right: 0,
                        top: `${100 - scatterData.yThresholdPct}%`,
                        bottom: 0,
                      }}
                      className="absolute bg-indigo-50/35 pointer-events-none p-2.5 flex flex-col justify-end items-end text-right"
                    >
                      <span className="text-[10px] text-indigo-700/70 mb-0.5 hidden sm:inline">
                        Profit Rendah • Volume Tinggi
                      </span>
                      <span className="text-[11px] font-extrabold text-indigo-800/85 bg-white/80 px-2 py-0.5 rounded-md border border-indigo-200/70 shadow-2xs">
                        🐄 CASH COW / PLOWHORSE
                      </span>
                    </div>

                    {/* Vertical Cut-off Line (Volume Threshold) */}
                    <div
                      style={{ left: `${scatterData.xThresholdPct}%` }}
                      className="absolute inset-y-0 border-l-2 border-dashed border-slate-400/80 pointer-events-none z-10"
                    >
                      <span className="absolute bottom-1.5 left-1.5 bg-slate-800/90 text-white text-[9px] font-mono px-1.5 py-0.5 rounded whitespace-nowrap">
                        Batas Qty: {formatNumber(thresholdValues.xThreshold)}
                      </span>
                    </div>

                    {/* Horizontal Cut-off Line (Profit Threshold) */}
                    <div
                      style={{ bottom: `${scatterData.yThresholdPct}%` }}
                      className="absolute inset-x-0 border-t-2 border-dashed border-slate-400/80 pointer-events-none z-10"
                    >
                      <span className="absolute right-1.5 -top-5 bg-slate-800/90 text-white text-[9px] font-mono px-1.5 py-0.5 rounded whitespace-nowrap">
                        Batas Y: {formatYValue(thresholdValues.yThreshold)}
                      </span>
                    </div>

                    {/* Product Bubbles */}
                    {scatterData.points.map(({ row, xPct, yPct, sizePx }) => {
                      const qMeta = QUADRANT_META[row.quadrant]
                      const isMissingHpp = row.hppSource === 'missing'
                      const isHovered = hoveredProduct?.key === row.key
                      const isDimmed =
                        activeQuadrantTab !== 'all_sold' &&
                        ((activeQuadrantTab === 'missing_hpp' && !isMissingHpp) ||
                          (['star', 'cash_cow', 'puzzle', 'dog'].includes(activeQuadrantTab) &&
                            row.quadrant !== activeQuadrantTab))

                      return (
                        <button
                          key={row.key}
                          type="button"
                          onMouseEnter={() => setHoveredProduct(row)}
                          onMouseLeave={() => setHoveredProduct(null)}
                          onClick={() =>
                            setActiveQuadrantTab(prev =>
                              prev === row.quadrant ? 'all_sold' : row.quadrant
                            )
                          }
                          style={{
                            left: `${xPct}%`,
                            bottom: `${yPct}%`,
                            width: `${sizePx}px`,
                            height: `${sizePx}px`,
                            backgroundColor: qMeta.hexColor,
                          }}
                          className={`absolute -translate-x-1/2 translate-y-1/2 rounded-full transition-all duration-200 cursor-pointer flex items-center justify-center ${
                            isHovered
                              ? 'z-30 scale-125 ring-4 ring-slate-900/80 opacity-100 shadow-lg'
                              : isDimmed
                              ? 'z-10 opacity-20'
                              : 'z-20 opacity-85 hover:opacity-100 hover:scale-110 shadow-xs'
                          } ${
                            isMissingHpp
                              ? 'ring-2 ring-amber-400 border-2 border-dashed border-white'
                              : 'border border-white/90'
                          }`}
                          aria-label={row.name}
                        />
                      )
                    })}
                  </div>
                </div>

                {/* X-Axis Footer */}
                <div className="flex pl-20 sm:pl-24 pt-2 items-center justify-between text-[10px] font-semibold text-slate-500 select-none">
                  <span>0 Unit</span>
                  <span className="text-slate-600 font-bold">
                    Sumbu X: Volume Penjualan (Qty Terjual) &rarr;
                  </span>
                  <span>Maks: {formatNumber(scatterData.maxX)} Unit</span>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* RIGHT: Metorik-Style KPI & Quadrant Summary Grid Card (4 Cols) */}
        <div className="lg:col-span-4 bg-white border border-slate-200/90 rounded-xl shadow-2xs flex flex-col justify-between overflow-hidden divide-y divide-slate-100">
          {/* Top Primary Metric: Total Gross Profit */}
          <div className="p-5 space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-1.5 text-xs font-bold text-slate-600">
                <span>Total Gross Profit (Produk)</span>
                <span className="w-2 h-2 rounded-full bg-emerald-500 inline-block" />
              </div>
              <span className="text-[11px] font-extrabold text-indigo-700 bg-indigo-50 px-2 py-0.5 rounded-md border border-indigo-100">
                Margin {kpiSummary.overallMarginPct.toFixed(1)}%
              </span>
            </div>
            <div className="flex items-baseline gap-2.5 flex-wrap">
              <span className="text-2xl sm:text-3xl font-extrabold text-slate-900 tracking-tight">
                {formatIDR(kpiSummary.totalGrossProfit)}
              </span>
              {renderGrowthPill(kpiSummary.growth.grossProfit)}
            </div>
            <div className="text-[11px] text-slate-500 font-medium">
              Dari Net Sales Produk{' '}
              <strong className="text-slate-700">{formatIDR(kpiSummary.totalNetSales)}</strong>{' '}
              (Total HPP: {formatIDR(kpiSummary.totalHpp)})
            </div>
          </div>

          {/* Row 2: Stars | Cash Cows (Clickable Filter Cards) */}
          <div className="grid grid-cols-2 divide-x divide-slate-100">
            <button
              type="button"
              onClick={() =>
                setActiveQuadrantTab(prev => (prev === 'star' ? 'all_sold' : 'star'))
              }
              className={`p-4 text-left space-y-1 transition cursor-pointer ${
                activeQuadrantTab === 'star'
                  ? 'bg-emerald-50/70 ring-1 ring-inset ring-emerald-300'
                  : 'hover:bg-slate-50/80'
              }`}
            >
              <div className="flex items-center justify-between text-[11px] font-bold text-emerald-700">
                <span>⭐ Stars</span>
                <span className="px-1.5 py-0.2 rounded bg-emerald-100 text-emerald-800 text-[10px]">
                  {kpiSummary.byQuadrant.star.count} SKU
                </span>
              </div>
              <div className="text-sm sm:text-base font-extrabold text-slate-900">
                {formatIDR(kpiSummary.byQuadrant.star.profit)}
              </div>
              <div className="text-[10px] font-semibold text-slate-500">
                {kpiSummary.byQuadrant.star.profitSharePct.toFixed(1)}% dari total profit
              </div>
            </button>

            <button
              type="button"
              onClick={() =>
                setActiveQuadrantTab(prev => (prev === 'cash_cow' ? 'all_sold' : 'cash_cow'))
              }
              className={`p-4 text-left space-y-1 transition cursor-pointer ${
                activeQuadrantTab === 'cash_cow'
                  ? 'bg-indigo-50/70 ring-1 ring-inset ring-indigo-300'
                  : 'hover:bg-slate-50/80'
              }`}
            >
              <div className="flex items-center justify-between text-[11px] font-bold text-indigo-700">
                <span>🐄 Cash Cows</span>
                <span className="px-1.5 py-0.2 rounded bg-indigo-100 text-indigo-800 text-[10px]">
                  {kpiSummary.byQuadrant.cash_cow.count} SKU
                </span>
              </div>
              <div className="text-sm sm:text-base font-extrabold text-slate-900">
                {formatIDR(kpiSummary.byQuadrant.cash_cow.profit)}
              </div>
              <div className="text-[10px] font-semibold text-slate-500">
                {formatNumber(kpiSummary.byQuadrant.cash_cow.qty)} unit terjual
              </div>
            </button>
          </div>

          {/* Row 3: Puzzles | Dogs (Clickable Filter Cards) */}
          <div className="grid grid-cols-2 divide-x divide-slate-100">
            <button
              type="button"
              onClick={() =>
                setActiveQuadrantTab(prev => (prev === 'puzzle' ? 'all_sold' : 'puzzle'))
              }
              className={`p-4 text-left space-y-1 transition cursor-pointer ${
                activeQuadrantTab === 'puzzle'
                  ? 'bg-amber-50/70 ring-1 ring-inset ring-amber-300'
                  : 'hover:bg-slate-50/80'
              }`}
            >
              <div className="flex items-center justify-between text-[11px] font-bold text-amber-700">
                <span>🧩 Puzzles</span>
                <span className="px-1.5 py-0.2 rounded bg-amber-100 text-amber-800 text-[10px]">
                  {kpiSummary.byQuadrant.puzzle.count} SKU
                </span>
              </div>
              <div className="text-sm sm:text-base font-extrabold text-slate-900">
                {formatIDR(kpiSummary.byQuadrant.puzzle.profit)}
              </div>
              <div className="text-[10px] font-semibold text-slate-500">
                Potensi upsell tinggi
              </div>
            </button>

            <button
              type="button"
              onClick={() =>
                setActiveQuadrantTab(prev => (prev === 'dog' ? 'all_sold' : 'dog'))
              }
              className={`p-4 text-left space-y-1 transition cursor-pointer ${
                activeQuadrantTab === 'dog'
                  ? 'bg-rose-50/70 ring-1 ring-inset ring-rose-300'
                  : 'hover:bg-slate-50/80'
              }`}
            >
              <div className="flex items-center justify-between text-[11px] font-bold text-rose-700">
                <span>🐶 Dogs</span>
                <span className="px-1.5 py-0.2 rounded bg-rose-100 text-rose-800 text-[10px]">
                  {kpiSummary.byQuadrant.dog.count} SKU
                </span>
              </div>
              <div className="text-sm sm:text-base font-extrabold text-slate-900">
                {formatIDR(kpiSummary.byQuadrant.dog.profit)}
              </div>
              <div className="text-[10px] font-semibold text-slate-500">
                Evaluasi / clearance
              </div>
            </button>
          </div>

          {/* Row 4: HPP Data Source Coverage */}
          <div className="p-4 space-y-2">
            <div className="flex items-center justify-between text-[11px] font-bold text-slate-500">
              <span>Status Sumber HPP (Produk Terjual)</span>
              <span>{kpiSummary.soldSkuCount} SKU</span>
            </div>
            <div className="grid grid-cols-3 gap-1.5 text-[11px]">
              <div className="bg-emerald-50/70 border border-emerald-200/70 rounded-lg px-2.5 py-1.5">
                <div className="font-extrabold text-emerald-800">
                  {kpiSummary.hppHealth.masterOrRecipeCount}
                </div>
                <div className="text-[10px] text-emerald-700 font-medium truncate">
                  Master / Resep
                </div>
              </div>
              <div className="bg-blue-50/70 border border-blue-200/70 rounded-lg px-2.5 py-1.5">
                <div className="font-extrabold text-blue-800">
                  {kpiSummary.hppHealth.fallbackCount}
                </div>
                <div className="text-[10px] text-blue-700 font-medium truncate">
                  Ref Order/Beli
                </div>
              </div>
              <button
                type="button"
                onClick={() =>
                  setActiveQuadrantTab(prev =>
                    prev === 'missing_hpp' ? 'all_sold' : 'missing_hpp'
                  )
                }
                className="bg-amber-50 hover:bg-amber-100/80 border border-amber-300 rounded-lg px-2.5 py-1.5 text-left transition cursor-pointer"
              >
                <div className="font-extrabold text-amber-900">
                  {kpiSummary.hppHealth.missingHppCount}
                </div>
                <div className="text-[10px] text-amber-800 font-bold truncate">
                  ⚠️ HPP Kosong
                </div>
              </button>
            </div>
          </div>

          {/* Row 5: Total Qty Sold | Active Sold SKUs */}
          <div className="grid grid-cols-2 divide-x divide-slate-100 bg-slate-50/40">
            <div className="p-4 space-y-1">
              <div className="text-[11px] font-bold text-slate-500">Total Qty Terjual</div>
              <div className="flex items-baseline gap-2 flex-wrap">
                <span className="text-base sm:text-lg font-extrabold text-slate-900">
                  {formatNumber(kpiSummary.totalQtySold)}
                </span>
                {renderGrowthPill(kpiSummary.growth.qtySold)}
              </div>
            </div>

            <div className="p-4 space-y-1">
              <div className="text-[11px] font-bold text-slate-500">SKU Aktif vs Dead Stock</div>
              <div className="flex items-baseline gap-2 flex-wrap">
                <span className="text-base sm:text-lg font-extrabold text-slate-900">
                  {kpiSummary.soldSkuCount} Aktif
                </span>
                {kpiSummary.deadStockCount > 0 && (
                  <button
                    type="button"
                    onClick={() =>
                      setActiveQuadrantTab(prev =>
                        prev === 'no_sales' ? 'all_sold' : 'no_sales'
                      )
                    }
                    className="text-[11px] font-bold text-slate-500 hover:text-indigo-600 underline cursor-pointer"
                  >
                    ({kpiSummary.deadStockCount} Qty=0)
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ── SECTION 2: PRODUCT MATRIX BREAKDOWN TABLE ───────────────────── */}
      <div className="bg-white border border-slate-200/90 rounded-xl shadow-2xs overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-100 flex flex-col lg:flex-row lg:items-center justify-between gap-3">
          <div className="flex items-center gap-2 flex-wrap">
            <h2 className="text-sm font-extrabold text-slate-900 mr-2">
              Product Matrix Breakdown
            </h2>

            {/* Quadrant Filter Pills */}
            {(
              [
                { id: 'all_sold', label: `Semua Terjual (${kpiSummary.soldSkuCount})` },
                { id: 'star', label: `⭐ Star (${kpiSummary.byQuadrant.star.count})` },
                { id: 'cash_cow', label: `🐄 Cash Cow (${kpiSummary.byQuadrant.cash_cow.count})` },
                { id: 'puzzle', label: `🧩 Puzzle (${kpiSummary.byQuadrant.puzzle.count})` },
                { id: 'dog', label: `🐶 Dog (${kpiSummary.byQuadrant.dog.count})` },
                ...(kpiSummary.hppHealth.missingHppCount > 0
                  ? [
                      {
                        id: 'missing_hpp',
                        label: `⚠️ HPP Kosong (${kpiSummary.hppHealth.missingHppCount})`,
                      },
                    ]
                  : []),
                ...(kpiSummary.deadStockCount > 0
                  ? [
                      {
                        id: 'no_sales',
                        label: `💤 Tanpa Penjualan (${kpiSummary.deadStockCount})`,
                      },
                    ]
                  : []),
              ] as Array<{ id: typeof activeQuadrantTab; label: string }>
            ).map(tab => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveQuadrantTab(tab.id)}
                className={`px-2.5 py-1 rounded-lg text-xs font-bold border transition cursor-pointer ${
                  activeQuadrantTab === tab.id
                    ? 'bg-indigo-600 text-white border-indigo-600 shadow-2xs'
                    : 'bg-slate-50 text-slate-600 border-slate-200 hover:bg-slate-100'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <input
              type="text"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="Cari nama produk / SKU / kategori..."
              className="px-3 py-1.5 rounded-lg text-xs border border-slate-200 bg-slate-50 font-medium text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500 w-56"
            />

            <button
              type="button"
              onClick={handleExportExcel}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 transition cursor-pointer shadow-2xs"
            >
              <svg
                width="13"
                height="13"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="7 10 12 15 17 10" />
                <line x1="12" y1="15" x2="12" y2="3" />
              </svg>
              <span>Export</span>
            </button>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs min-w-[980px]">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50/60 text-slate-600 font-bold">
                {(
                  [
                    { key: 'name', label: 'Product / SKU', align: 'left' },
                    { key: 'quadrant', label: 'BCG Quadrant', align: 'left' },
                    { key: 'qtySold', label: 'Qty Sold', align: 'right' },
                    { key: 'netSales', label: 'Net Sales', align: 'right' },
                    { key: 'unitHpp', label: 'HPP / Unit & Sumber', align: 'left' },
                    { key: 'grossProfit', label: 'Gross Profit', align: 'right' },
                    { key: 'unitMargin', label: 'Margin / Unit', align: 'right' },
                    { key: 'marginPct', label: 'Margin %', align: 'right' },
                  ] as Array<{ key: SortField; label: string; align: 'left' | 'right' }>
                ).map(col => (
                  <th
                    key={col.key}
                    onClick={() => handleSort(col.key)}
                    className={`py-3 px-4 cursor-pointer select-none hover:text-slate-900 transition ${
                      col.align === 'right' ? 'text-right' : 'text-left'
                    }`}
                  >
                    <div className="inline-flex items-center gap-1">
                      <span>{col.label}</span>
                      <span className="text-[10px] text-slate-400">
                        {sortField === col.key ? (sortOrder === 'asc' ? '↑' : '↓') : '⇅'}
                      </span>
                    </div>
                  </th>
                ))}
                <th className="py-3 px-4 text-left">Action / Insight</th>
              </tr>
            </thead>

            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr>
                  <td colSpan={9} className="py-10 text-center text-slate-400 font-semibold">
                    Memuat rincian Product Matrix Breakdown...
                  </td>
                </tr>
              ) : filteredTableRows.length === 0 ? (
                <tr>
                  <td colSpan={9} className="py-10 text-center text-slate-400 font-semibold">
                    Tidak ada produk yang cocok dengan filter saat ini.
                  </td>
                </tr>
              ) : (
                filteredTableRows.slice(0, 150).map(row => {
                  const qMeta = QUADRANT_META[row.quadrant]
                  const hppMeta = HPP_SOURCE_META[row.hppSource]
                  const hasShifted =
                    temporalFilter.comparisonMode !== 'none' &&
                    row.compQuadrant &&
                    row.compQuadrant !== 'no_sales' &&
                    row.compQuadrant !== row.quadrant

                  return (
                    <tr key={row.key} className="hover:bg-slate-50/70 transition-colors">
                      {/* Product & SKU */}
                      <td className="py-3 px-4">
                        <div className="font-bold text-slate-900">{row.name}</div>
                        <div className="text-[11px] text-slate-500 flex items-center gap-2 mt-0.5">
                          {row.sku !== '-' && (
                            <span className="font-mono bg-slate-100 px-1.5 py-0.2 rounded text-slate-600">
                              {row.sku}
                            </span>
                          )}
                          <span>{row.categoryName}</span>
                        </div>
                      </td>

                      {/* BCG Quadrant Badge */}
                      <td className="py-3 px-4 whitespace-nowrap">
                        <span
                          className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-bold border ${qMeta.badgeBg} ${qMeta.badgeText} ${qMeta.badgeBorder}`}
                        >
                          <span>{qMeta.icon}</span>
                          <span>{qMeta.shortLabel}</span>
                        </span>
                        {hasShifted && row.compQuadrant && (
                          <div className="text-[10px] text-slate-500 mt-1 font-medium">
                            Sebelumnya: {QUADRANT_META[row.compQuadrant].icon}{' '}
                            {QUADRANT_META[row.compQuadrant].shortLabel}
                          </div>
                        )}
                      </td>

                      {/* Qty Sold */}
                      <td className="py-3 px-4 text-right whitespace-nowrap">
                        <div className="font-extrabold text-slate-900">
                          {formatNumber(row.qtySold)} {row.unit}
                        </div>
                        <div className="text-[10px] text-slate-500">
                          {row.qtySharePct.toFixed(1)}% vol • {row.ordersCount} order
                        </div>
                      </td>

                      {/* Net Sales */}
                      <td className="py-3 px-4 text-right whitespace-nowrap">
                        <div className="font-bold text-slate-800">{formatIDR(row.netSales)}</div>
                        <div className="text-[10px] text-slate-500">
                          @{formatIDR(row.avgSellingPrice)}/{row.unit}
                        </div>
                      </td>

                      {/* Unit HPP & Explicit Source Badge */}
                      <td className="py-3 px-4">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="font-bold text-slate-800">
                            {row.hppSource === 'missing' ? 'Rp 0' : formatIDR(row.unitHpp)}
                          </span>
                          <span
                            className={`inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-bold border ${hppMeta.badgeClass}`}
                          >
                            {row.hppSourceLabel}
                          </span>
                        </div>
                        <div className="text-[10px] text-slate-500 mt-0.5 max-w-[230px] leading-snug">
                          {row.hppSourceDetail}
                        </div>
                      </td>

                      {/* Gross Profit */}
                      <td className="py-3 px-4 text-right whitespace-nowrap">
                        <div
                          className={`font-extrabold ${
                            row.grossProfit < 0
                              ? 'text-rose-600'
                              : row.hppSource === 'missing'
                              ? 'text-amber-700'
                              : 'text-slate-900'
                          }`}
                        >
                          {formatIDR(row.grossProfit)}
                        </div>
                        {row.hppSource === 'missing' && row.qtySold > 0 && (
                          <div className="text-[10px] font-semibold text-amber-700">
                            *(Belum dikurangi HPP)*
                          </div>
                        )}
                      </td>

                      {/* Margin / Unit */}
                      <td className="py-3 px-4 text-right whitespace-nowrap font-medium text-slate-700">
                        {formatIDR(row.unitMargin)}
                      </td>

                      {/* Margin % */}
                      <td className="py-3 px-4 text-right whitespace-nowrap">
                        <span
                          className={`inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-bold ${
                            row.hppSource === 'missing'
                              ? 'bg-amber-50 text-amber-800 border border-amber-200'
                              : row.marginPct >= 30
                              ? 'bg-emerald-50 text-emerald-700'
                              : row.marginPct > 0
                              ? 'bg-slate-100 text-slate-700'
                              : 'bg-rose-50 text-rose-700'
                          }`}
                        >
                          {row.marginPct.toFixed(1)}%
                        </span>
                      </td>

                      {/* Strategic Recommendation */}
                      <td className="py-3 px-4 text-[11px] text-slate-600 max-w-[260px] leading-relaxed">
                        {row.recommendation}
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>

            {!loading && filteredTableRows.length > 0 && (
              <tfoot>
                <tr className="border-t-2 border-slate-200 bg-slate-50/80 font-extrabold text-slate-900">
                  <td className="py-3.5 px-4" colSpan={2}>
                    Totals ({filteredTableRows.length} SKU ditampilkan)
                  </td>
                  <td className="py-3.5 px-4 text-right whitespace-nowrap">
                    {formatNumber(filteredTableRows.reduce((s, r) => s + r.qtySold, 0))}
                  </td>
                  <td className="py-3.5 px-4 text-right whitespace-nowrap">
                    {formatIDR(filteredTableRows.reduce((s, r) => s + r.netSales, 0))}
                  </td>
                  <td className="py-3.5 px-4 text-slate-600 font-bold">
                    Total HPP: {formatIDR(filteredTableRows.reduce((s, r) => s + r.totalHpp, 0))}
                  </td>
                  <td className="py-3.5 px-4 text-right whitespace-nowrap">
                    {formatIDR(filteredTableRows.reduce((s, r) => s + r.grossProfit, 0))}
                  </td>
                  <td className="py-3.5 px-4 text-right whitespace-nowrap">-</td>
                  <td className="py-3.5 px-4 text-right whitespace-nowrap">
                    {(() => {
                      const net = filteredTableRows.reduce((s, r) => s + r.netSales, 0)
                      const prof = filteredTableRows.reduce((s, r) => s + r.grossProfit, 0)
                      return net > 0 ? `${((prof / net) * 100).toFixed(1)}%` : '0%'
                    })()}
                  </td>
                  <td className="py-3.5 px-4" />
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>

      {/* ── SECTION 3: GROUPED BY SUMMARY TABLE (Matches Revenue Report) ──── */}
      <div className="bg-white border border-slate-200/90 rounded-xl shadow-2xs overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-100 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <span className="text-sm font-extrabold text-slate-900">Grouped by</span>
            <select
              value={groupDim}
              onChange={e => setGroupDim(e.target.value as GroupDimension)}
              className="px-3 py-1.5 rounded-lg text-xs font-bold border border-slate-200 bg-white text-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 cursor-pointer shadow-2xs"
            >
              <option value="quadrant">Kuadran BCG (Star, Cash Cow, Puzzle, Dog)</option>
              <option value="category">Kategori Produk</option>
              <option value="hpp_source">Sumber Data HPP (Master, Order, Pembelian, Kosong)</option>
              <option value="platform">Platform / Channel Penjualan</option>
            </select>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs min-w-[720px]">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50/60 text-slate-600 font-bold">
                {(
                  [
                    { key: 'label', label: 'Dimensi Grup', align: 'left' },
                    { key: 'skuCount', label: 'Jumlah SKU', align: 'right' },
                    { key: 'qtySold', label: 'Qty Terjual', align: 'right' },
                    { key: 'netSales', label: 'Net Sales', align: 'right' },
                    { key: 'totalHpp', label: 'Total HPP', align: 'right' },
                    { key: 'grossProfit', label: 'Gross Profit', align: 'right' },
                    { key: 'marginPct', label: 'Gross Margin %', align: 'right' },
                  ] as Array<{ key: GroupSortField; label: string; align: 'left' | 'right' }>
                ).map((col, idx) => (
                  <th
                    key={col.key}
                    onClick={() => handleGroupSort(col.key)}
                    className={`py-3 ${idx === 0 || idx === 6 ? 'px-5' : 'px-4'} ${
                      col.align === 'right' ? 'text-right' : 'text-left'
                    } cursor-pointer select-none hover:text-slate-900 transition`}
                  >
                    <span className="inline-flex items-center gap-1">
                      <span>{col.label}</span>
                      <span className="text-[10px] text-slate-400">
                        {groupSortField === col.key
                          ? groupSortOrder === 'asc'
                            ? '↑'
                            : '↓'
                          : '⇅'}
                      </span>
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {groupedSummaryRows.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-8 text-center text-slate-400 font-medium">
                    Belum ada data pengelompokan.
                  </td>
                </tr>
              ) : (
                groupedSummaryRows.map(row => (
                  <tr key={row.key} className="hover:bg-slate-50/70 transition-colors">
                    <td className="py-3 px-5 font-semibold text-slate-800">
                      <span className="inline-flex items-center gap-2">
                        {row.badge && <span>{row.badge}</span>}
                        <span>{row.label}</span>
                      </span>
                    </td>
                    <td className="py-3 px-4 text-right font-bold text-indigo-600">
                      {formatNumber(row.skuCount)}
                    </td>
                    <td className="py-3 px-4 text-right font-medium text-slate-700">
                      {formatNumber(row.qtySold)}
                    </td>
                    <td className="py-3 px-4 text-right font-medium text-slate-700">
                      {formatIDR(row.netSales)}
                    </td>
                    <td className="py-3 px-4 text-right font-medium text-slate-600">
                      {formatIDR(row.totalHpp)}
                    </td>
                    <td className="py-3 px-4 text-right font-extrabold text-slate-900">
                      {formatIDR(row.grossProfit)}
                    </td>
                    <td className="py-3 px-5 text-right font-bold text-emerald-700">
                      {row.marginPct.toFixed(1)}%
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

