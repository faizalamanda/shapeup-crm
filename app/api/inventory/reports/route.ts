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

    // ─────────────────────────────────────────────────────────────────────
    // ⚡ ACTION: product_moves — Tab 3 modal (lazy). 1 query only.
    // ─────────────────────────────────────────────────────────────────────
    if (action === 'product_moves' && productId) {
      const { data: rawMoves } = await supabase
        .from('stock_moves')
        .select('id, product_id, reference, origin_location_id, destination_location_id, qty, unit_cost, lot_number, status, type, created_at')
        .eq('business_id', businessId)
        .eq('product_id', productId)
        .order('created_at', { ascending: false })

      return NextResponse.json({ success: true, moves: rawMoves || [] })
    }

    // ─────────────────────────────────────────────────────────────────────
    // ⚡ ACTION: product_valuation — Tab 2 modal (lazy).
    //    FIX C: Only fetch stock_moves — product data comes from client (unitCost param).
    // ─────────────────────────────────────────────────────────────────────
    if (action === 'product_valuation' && productId) {
      const unitCostParam = url.searchParams.get('unitCost')
      const onHandQtyParam = url.searchParams.get('onHandQty')
      const unitCost = Number(unitCostParam || 0)
      const onHandQty = Number(onHandQtyParam || 0)

      const { data: rawMoves } = await supabase
        .from('stock_moves')
        .select('id, product_id, reference, qty, unit_cost, status, type, created_at')
        .eq('business_id', businessId)
        .eq('product_id', productId)
        .order('created_at', { ascending: false })

      const productMoves = (rawMoves || []) as StockMove[]

      // Minimal stockItem for valuation calculation — built from client-provided params
      const minimalStockItem = {
        productId,
        productName: '',
        sku: null,
        categoryName: '',
        unit: '',
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
    // ⚡ ACTION: summary — Full inventory report.
    //    FIX A: businesses.name is now INSIDE Promise.all (parallel, not sequential).
    // ─────────────────────────────────────────────────────────────────────
    const [
      { data: biz },
      { data: productsData },
      { data: purchasesData },
      { data: ordersData },
      { data: opnamesData },
      { data: locationsDataRaw },
      { data: movesDataRaw },
    ] = await Promise.all([
      supabase.from('businesses').select('name').eq('id', businessId).single(),
      supabase
        .from('products')
        .select('id, name, sku, unit, cost_price, price, description, hpp_type, stock_quantity, category_id, categories(id, name)')
        .eq('business_id', businessId),
      supabase
        .from('purchases')
        .select('id, business_id, purchase_number, payment_status, items_json, date, created_at')
        .eq('business_id', businessId),
      supabase
        .from('orders')
        .select('id, business_id, order_number, status, items_json, order_date, created_at')
        .eq('business_id', businessId),
      supabase
        .from('stock_opname')
        .select('id, business_id, opname_number, items_json, date, created_at')
        .eq('business_id', businessId),
      supabase
        .from('inventory_locations')
        .select('id, name, code, type, is_default')
        .eq('business_id', businessId),
      supabase
        .from('stock_moves')
        .select('id, product_id, reference, origin_location_id, destination_location_id, qty, unit_cost, lot_number, status, type, created_at')
        .eq('business_id', businessId)
        .order('created_at', { ascending: false }),
    ])

    const businessName = biz?.name || ''
    const prods = productsData || []
    const locations = (locationsDataRaw && locationsDataRaw.length > 0)
      ? locationsDataRaw as InventoryLocation[]
      : DEFAULT_LOCATIONS(businessId)

    // Extract unique category names from products
    const catSet = new Set<string>()
    prods.forEach((p: any) => {
      const catName = Array.isArray(p.categories) ? p.categories[0]?.name : p.categories?.name
      if (catName) catSet.add(catName)
    })
    const categories = Array.from(catSet)

    const customMoves = (movesDataRaw || []) as StockMove[]
    const moves = buildUnifiedMoveHistory(
      prods,
      purchasesData || [],
      ordersData || [],
      opnamesData || [],
      locations,
      customMoves
    )

    const stockReportItems = buildStockReport(prods, moves, locations)
    const locationReportSummaries = buildLocationReport(locations, stockReportItems, moves)

    // FIX B: Only send what the client actually uses.
    // Removed: products (raw), locations (raw) — not consumed by any component.
    return NextResponse.json({
      success: true,
      businessName,
      categories,
      stockReportItems,
      locationReportSummaries,
      moves,
    })
  } catch (err: any) {
    console.error('[GET /api/inventory/reports] Error:', err)
    return NextResponse.json(
      { error: err.message || 'Gagal mengambil data laporan inventory' },
      { status: 500 }
    )
  }
}
