import { getApiContext } from '@/lib/apiContext'
import { NextResponse } from 'next/server'
import {
  buildUnifiedMoveHistory,
  buildStockReport,
  buildLocationReport,
  calculateValuation,
} from '@/plugins/inventory-reports/inventoryHelper'
import { InventoryLocation, StockMove } from '@/plugins/inventory-reports/types'

export async function GET(req: Request) {
  const ctx = await getApiContext()
  if (ctx.error) return ctx.error
  const { businessId, supabase } = ctx

  try {
    const url = new URL(req.url)
    const action = url.searchParams.get('action') || 'summary'
    const productId = url.searchParams.get('productId')

    // Fetch Business Name
    const { data: biz } = await supabase
      .from('businesses')
      .select('name')
      .eq('id', businessId)
      .single()

    const businessName = biz?.name || ''

    if (action === 'product_detail' && productId) {
      // ⚡ FAST QUERY: Detail data for a SINGLE product
      const [
        { data: product },
        { data: rawMoves },
        { data: locationsDataRaw },
        { data: purchasesData },
        { data: ordersData },
        { data: opnamesData },
      ] = await Promise.all([
        supabase
          .from('products')
          .select('id, name, sku, unit, cost_price, price, description, hpp_type, stock_quantity, category_id, categories(id, name)')
          .eq('business_id', businessId)
          .eq('id', productId)
          .single(),
        supabase
          .from('stock_moves')
          .select('id, product_id, reference, origin_location_id, destination_location_id, qty, unit_cost, lot_number, status, type, created_at')
          .eq('business_id', businessId)
          .eq('product_id', productId)
          .order('created_at', { ascending: false }),
        supabase
          .from('inventory_locations')
          .select('id, name, code, type, is_default')
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
      ])

      if (!product) {
        return NextResponse.json({ error: 'Produk tidak ditemukan' }, { status: 404 })
      }

      let locations = (locationsDataRaw || []) as InventoryLocation[]
      if (locations.length === 0) {
        locations = [
          { id: 'wh-main', business_id: businessId, name: 'Gudang Utama (WH-MAIN)', type: 'internal', code: 'WH-MAIN', is_default: true, created_at: new Date().toISOString() },
          { id: 'wh-store', business_id: businessId, name: 'Toko / Display Outlet', type: 'internal', code: 'STORE-1', is_default: false, created_at: new Date().toISOString() },
          { id: 'wh-vendor', business_id: businessId, name: 'Pemasok / Vendor', type: 'vendor', code: 'VENDOR', is_default: false, created_at: new Date().toISOString() },
          { id: 'wh-customer', business_id: businessId, name: 'Transit Pelanggan', type: 'customer', code: 'CUSTOMER', is_default: false, created_at: new Date().toISOString() },
        ]
      }

      // Filter purchases/orders/opnames specifically containing this productId
      const filteredPurchases = (purchasesData || []).filter(p => {
        const items = Array.isArray(p.items_json) ? p.items_json : []
        return items.some((i: any) => (i.product_id || i.id) === productId)
      })
      const filteredOrders = (ordersData || []).filter(o => {
        const items = Array.isArray(o.items_json) ? o.items_json : []
        return items.some((i: any) => (i.product_id || i.id) === productId)
      })
      const filteredOpnames = (opnamesData || []).filter(op => {
        const items = Array.isArray(op.items_json) ? op.items_json : []
        return items.some((i: any) => i.product_id === productId)
      })

      const productList = [product]
      const customMoves = (rawMoves || []) as StockMove[]
      const productMoves = buildUnifiedMoveHistory(
        productList,
        filteredPurchases,
        filteredOrders,
        filteredOpnames,
        locations,
        customMoves
      )

      const stockReportSingle = buildStockReport(productList, productMoves, locations)[0]

      const fifoVal = calculateValuation('FIFO', [stockReportSingle], productMoves)
      const lifoVal = calculateValuation('LIFO', [stockReportSingle], productMoves)
      const avcoVal = calculateValuation('AVCO', [stockReportSingle], productMoves)
      const standardVal = calculateValuation('STANDARD', [stockReportSingle], productMoves)

      return NextResponse.json({
        success: true,
        businessName,
        product,
        stockReportItem: stockReportSingle,
        moves: productMoves,
        valuation: {
          fifo: fifoVal,
          lifo: lifoVal,
          avco: avcoVal,
          standard: standardVal,
        },
      })
    }

    // ⚡ FAST QUERY: Full inventory summary data
    const [
      { data: productsData },
      { data: purchasesData },
      { data: ordersData },
      { data: opnamesData },
      { data: locationsDataRaw },
      { data: movesDataRaw },
    ] = await Promise.all([
      supabase
        .from('products')
        .select('id, name, sku, unit, cost_price, price, description, stock_quantity, category_id, categories(id, name)')
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

    const prods = productsData || []
    let locations = (locationsDataRaw || []) as InventoryLocation[]
    if (locations.length === 0) {
      locations = [
        { id: 'wh-main', business_id: businessId, name: 'Gudang Utama (WH-MAIN)', type: 'internal', code: 'WH-MAIN', is_default: true, created_at: new Date().toISOString() },
        { id: 'wh-store', business_id: businessId, name: 'Toko / Display Outlet', type: 'internal', code: 'STORE-1', is_default: false, created_at: new Date().toISOString() },
        { id: 'wh-vendor', business_id: businessId, name: 'Pemasok / Vendor', type: 'vendor', code: 'VENDOR', is_default: false, created_at: new Date().toISOString() },
        { id: 'wh-customer', business_id: businessId, name: 'Transit Pelanggan', type: 'customer', code: 'CUSTOMER', is_default: false, created_at: new Date().toISOString() },
      ]
    }

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

    return NextResponse.json({
      success: true,
      businessName,
      products: prods,
      locations,
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
