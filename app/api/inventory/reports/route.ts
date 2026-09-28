import { getApiContext } from '@/lib/apiContext'
import { NextResponse } from 'next/server'
import {
  buildUnifiedMoveHistory,
  buildStockReport,
  buildLocationReport,
  calculateValuation,
} from '@/plugins/inventory-reports/inventoryHelper'
import { InventoryLocation, StockMove } from '@/plugins/inventory-reports/types'

const DEFAULT_LOCATIONS = (businessId: string): InventoryLocation[] => [
  { id: 'wh-main', business_id: businessId, name: 'Gudang Utama (WH-MAIN)', type: 'internal', code: 'WH-MAIN', is_default: true, created_at: new Date().toISOString() },
  { id: 'wh-store', business_id: businessId, name: 'Toko / Display Outlet', type: 'internal', code: 'STORE-1', is_default: false, created_at: new Date().toISOString() },
  { id: 'wh-vendor', business_id: businessId, name: 'Pemasok / Vendor', type: 'vendor', code: 'VENDOR', is_default: false, created_at: new Date().toISOString() },
  { id: 'wh-customer', business_id: businessId, name: 'Transit Pelanggan', type: 'customer', code: 'CUSTOMER', is_default: false, created_at: new Date().toISOString() },
]

export async function GET(req: Request) {
  const ctx = await getApiContext()
  if (ctx.error) return ctx.error
  const { businessId, supabase } = ctx

  try {
    const url = new URL(req.url)
    const action = url.searchParams.get('action') || 'summary'
    const productId = url.searchParams.get('productId')
    const page = Math.max(1, parseInt(url.searchParams.get('page') || '1', 10))
    const limit = Math.max(1, Math.min(100, parseInt(url.searchParams.get('limit') || '25', 10)))
    const search = url.searchParams.get('search') || ''
    const categoryFilter = url.searchParams.get('category') || ''

    // ─────────────────────────────────────────────────────────────────────
    // ⚡ ACTION: product_moves — Tab 3 modal (lazy).
    //    Stitches orders, purchases, opnames, and custom stock moves for productId.
    // ─────────────────────────────────────────────────────────────────────
    if (action === 'product_moves' && productId) {
      const [
        { data: prodData },
        { data: rawMoves },
        { data: rawPurchases },
        { data: rawOrders },
        { data: rawOpnames },
        { data: rawLocations },
      ] = await Promise.all([
        supabase.from('products').select('id, name, sku, unit, cost_price').eq('id', productId).maybeSingle(),
        supabase.from('stock_moves').select('id, product_id, reference, origin_location_id, destination_location_id, qty, unit_cost, lot_number, status, type, created_at').eq('business_id', businessId).eq('product_id', productId),
        supabase.from('purchases').select('id, business_id, purchase_number, payment_status, items_json, date, created_at').eq('business_id', businessId),
        supabase.from('orders').select('id, business_id, order_number, status, items_json, order_date, created_at').eq('business_id', businessId),
        supabase.from('stock_opname').select('id, business_id, opname_number, items_json, date, created_at').eq('business_id', businessId),
        supabase.from('inventory_locations').select('id, name, code, type, is_default').eq('business_id', businessId),
      ])

      const prod = prodData || { id: productId, name: 'Produk', sku: null, cost_price: 0 }
      const products = [prod]
      const locations = (rawLocations && rawLocations.length > 0) ? rawLocations as InventoryLocation[] : DEFAULT_LOCATIONS(businessId)

      const targetIdStr = String(productId)
      const targetNameLower = (prod.name || '').toLowerCase()
      const targetSkuLower = (prod.sku || '').toLowerCase()

      const matchesProduct = (item: any) => {
        if (!item) return false
        const itemId = String(item.product_id || item.id || '')
        if (itemId && itemId === targetIdStr) return true
        const itemSku = String(item.sku || '').toLowerCase()
        if (targetSkuLower && itemSku && itemSku === targetSkuLower) return true
        const itemName = String(item.name || '').toLowerCase()
        if (targetNameLower && itemName && (itemName === targetNameLower || itemName.includes(targetNameLower) || targetNameLower.includes(itemName))) return true
        return false
      }

      // Filter purchases, orders, opnames for this product
      const filteredPurchases = (rawPurchases || []).filter(p =>
        Array.isArray(p.items_json) && p.items_json.some(matchesProduct)
      )
      const filteredOrders = (rawOrders || []).filter(o =>
        Array.isArray(o.items_json) && o.items_json.some(matchesProduct)
      )
      const filteredOpnames = (rawOpnames || []).filter(op =>
        Array.isArray(op.items_json) && op.items_json.some(matchesProduct)
      )

      const moves = buildUnifiedMoveHistory(
        products,
        filteredPurchases,
        filteredOrders,
        filteredOpnames,
        locations,
        (rawMoves || []) as StockMove[]
      )

      return NextResponse.json({ success: true, moves })
    }

    // ─────────────────────────────────────────────────────────────────────
    // ⚡ ACTION: product_valuation — Tab 2 modal (lazy).
    // ─────────────────────────────────────────────────────────────────────
    if (action === 'product_valuation' && productId) {
      const unitCostParam = url.searchParams.get('unitCost')
      const onHandQtyParam = url.searchParams.get('onHandQty')
      const unitCost = Number(unitCostParam || 0)
      const onHandQty = Number(onHandQtyParam || 0)

      const [
        { data: prodData },
        { data: rawMoves },
        { data: rawPurchases },
        { data: rawOrders },
        { data: rawOpnames },
        { data: rawLocations },
      ] = await Promise.all([
        supabase.from('products').select('id, name, sku, unit, cost_price').eq('id', productId).maybeSingle(),
        supabase.from('stock_moves').select('id, product_id, reference, origin_location_id, destination_location_id, qty, unit_cost, lot_number, status, type, created_at').eq('business_id', businessId).eq('product_id', productId),
        supabase.from('purchases').select('id, business_id, purchase_number, payment_status, items_json, date, created_at').eq('business_id', businessId),
        supabase.from('orders').select('id, business_id, order_number, status, items_json, order_date, created_at').eq('business_id', businessId),
        supabase.from('stock_opname').select('id, business_id, opname_number, items_json, date, created_at').eq('business_id', businessId),
        supabase.from('inventory_locations').select('id, name, code, type, is_default').eq('business_id', businessId),
      ])

      const prod = prodData || { id: productId, name: 'Produk', sku: null, unit: 'Pcs', cost_price: unitCost }
      const products = [prod]
      const locations = (rawLocations && rawLocations.length > 0) ? rawLocations as InventoryLocation[] : DEFAULT_LOCATIONS(businessId)

      const targetIdStr = String(productId)
      const targetNameLower = (prod.name || '').toLowerCase()
      const targetSkuLower = (prod.sku || '').toLowerCase()

      const matchesProduct = (item: any) => {
        if (!item) return false
        const itemId = String(item.product_id || item.id || '')
        if (itemId && itemId === targetIdStr) return true
        const itemSku = String(item.sku || '').toLowerCase()
        if (targetSkuLower && itemSku && itemSku === targetSkuLower) return true
        const itemName = String(item.name || '').toLowerCase()
        if (targetNameLower && itemName && (itemName === targetNameLower || itemName.includes(targetNameLower) || targetNameLower.includes(itemName))) return true
        return false
      }

      const filteredPurchases = (rawPurchases || []).filter(p =>
        Array.isArray(p.items_json) && p.items_json.some(matchesProduct)
      )
      const filteredOrders = (rawOrders || []).filter(o =>
        Array.isArray(o.items_json) && o.items_json.some(matchesProduct)
      )
      const filteredOpnames = (rawOpnames || []).filter(op =>
        Array.isArray(op.items_json) && op.items_json.some(matchesProduct)
      )

      const productMoves = buildUnifiedMoveHistory(
        products,
        filteredPurchases,
        filteredOrders,
        filteredOpnames,
        locations,
        (rawMoves || []) as StockMove[]
      )

      const minimalStockItem = {
        productId,
        productName: prod.name || '',
        sku: prod.sku || null,
        categoryName: '',
        unit: prod.unit || 'Pcs',
        onHandQty,
        availableQty: onHandQty,
        reservedQty: 0,
        unitCost,
        totalValue: onHandQty * unitCost,
        incomingShipments: 0,
        outgoingItems: 0,
        locationBreakdown: {},
      }

      const [fifoVal, lifoVal, avcoVal, standardVal] = [
        calculateValuation('FIFO', [minimalStockItem], productMoves),
        calculateValuation('LIFO', [minimalStockItem], productMoves),
        calculateValuation('AVCO', [minimalStockItem], productMoves),
        calculateValuation('STANDARD', [minimalStockItem], productMoves),
      ]

      return NextResponse.json({
        success: true,
        valuation: { fifo: fifoVal, lifo: lifoVal, avco: avcoVal, standard: standardVal },
      })
    }

    // ─────────────────────────────────────────────────────────────────────
    // ⚡ ACTION: location_report — Lazy load for Location tab
    // ─────────────────────────────────────────────────────────────────────
    if (action === 'location_report') {
      const [{ data: locationsDataRaw }, { data: productsData }] = await Promise.all([
        supabase.from('inventory_locations').select('id, name, code, type, is_default').eq('business_id', businessId),
        supabase.from('products').select('id, name, sku, unit, stock_quantity, cost_price').eq('business_id', businessId)
      ])

      const locations = (locationsDataRaw && locationsDataRaw.length > 0)
        ? locationsDataRaw as InventoryLocation[]
        : DEFAULT_LOCATIONS(businessId)

      const stockReportItems = buildStockReport(productsData || [], [], locations)
      const locationReportSummaries = buildLocationReport(locations, stockReportItems, [])

      return NextResponse.json({ success: true, locationReportSummaries })
    }

    // ─────────────────────────────────────────────────────────────────────
    // ⚡ ACTION: summary (Fast Paginated Stock Report & Filtered Summary Metrics)
    // ─────────────────────────────────────────────────────────────────────
    const offset = (page - 1) * limit

    const metricsPromise = (async () => {
      try {
        const { data: rpcRes, error: rpcErr } = await supabase.rpc('get_inventory_summary_metrics', {
          p_business_id: businessId,
          p_search: search || null,
          p_category_name: categoryFilter || null
        })
        if (!rpcErr && rpcRes) {
          return {
            totalProducts: Number(rpcRes.total_products || 0),
            totalStockQty: Number(rpcRes.total_stock_qty || 0),
            totalValuation: Number(rpcRes.total_valuation || 0),
            outOfStockCount: Number(rpcRes.out_of_stock_count || 0),
            lowStockCount: Number(rpcRes.low_stock_count || 0),
            totalOnHand: Number(rpcRes.total_stock_qty || 0),
            totalAvailable: Number(rpcRes.total_stock_qty || 0),
            totalReserved: 0,
            totalIncoming: 0,
            totalOutgoing: 0
          }
        }
      } catch (e) {}

      let statsQuery = supabase
        .from('products')
        .select('stock_quantity, cost_price, category_id, categories(name)')
        .eq('business_id', businessId)

      if (search) {
        statsQuery = statsQuery.or(`name.ilike.%${search}%,sku.ilike.%${search}%`)
      }

      if (categoryFilter) {
        statsQuery = statsQuery.eq('categories.name', categoryFilter)
      }

      const { data: prodStats } = await statsQuery

      let totalStockQty = 0
      let totalValuation = 0
      let outOfStockCount = 0
      let lowStockCount = 0

      if (prodStats) {
        prodStats.forEach(p => {
          const q = Number(p.stock_quantity || 0)
          const c = Number(p.cost_price || 0)
          totalStockQty += q
          totalValuation += (q * c)
          if (q <= 0) outOfStockCount++
          else if (q <= 5) lowStockCount++
        })
      }

      return {
        totalProducts: prodStats?.length || 0,
        totalStockQty,
        totalValuation,
        outOfStockCount,
        lowStockCount,
        totalOnHand: totalStockQty,
        totalAvailable: totalStockQty,
        totalReserved: 0,
        totalIncoming: 0,
        totalOutgoing: 0
      }
    })()

    const categoriesPromise = supabase
      .from('categories')
      .select('name')
      .eq('business_id', businessId)
      .order('name', { ascending: true })

    let prodsQuery = supabase
      .from('products')
      .select('id, name, sku, unit, cost_price, price, description, hpp_type, stock_quantity, category_id, categories(id, name)', { count: 'exact' })
      .eq('business_id', businessId)

    if (search) {
      prodsQuery = prodsQuery.or(`name.ilike.%${search}%,sku.ilike.%${search}%`)
    }

    if (categoryFilter) {
      prodsQuery = prodsQuery.eq('categories.name', categoryFilter)
    }

    prodsQuery = prodsQuery
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1)

    const [metrics, categoriesRes, prodsRes, locationsRes] = await Promise.all([
      metricsPromise,
      categoriesPromise,
      prodsQuery,
      supabase.from('inventory_locations').select('id, name, code, type, is_default').eq('business_id', businessId)
    ])

    const totalItems = prodsRes.count || 0
    const totalPages = Math.ceil(totalItems / limit) || 1
    const paginatedProducts = prodsRes.data || []

    const categories = (categoriesRes.data || []).map(c => c.name).filter(Boolean)
    const locations = (locationsRes.data && locationsRes.data.length > 0)
      ? locationsRes.data as InventoryLocation[]
      : DEFAULT_LOCATIONS(businessId)

    const stockReportItems = buildStockReport(paginatedProducts, [], locations)

    return NextResponse.json({
      success: true,
      metrics,
      pagination: {
        page,
        limit,
        totalItems,
        totalPages
      },
      categories,
      stockReportItems,
    })
  } catch (err: any) {
    console.error('[GET /api/inventory/reports] Error:', err)
    return NextResponse.json(
      { error: err.message || 'Gagal mengambil data laporan inventory' },
      { status: 500 }
    )
  }
}
