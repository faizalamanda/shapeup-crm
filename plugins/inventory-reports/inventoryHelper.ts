import { SupabaseClient } from '@supabase/supabase-js'
import {
  InventoryLocation,
  StockMove,
  StockReportItem,
  LocationReportSummary,
  ValuationMethodResult,
  PivotGroupRow,
} from './types'

export async function fetchFullInventoryData(supabase: SupabaseClient, businessId: string) {
  // Execute independent Supabase queries in parallel using Promise.all (Hybrid Architecture)
  const [
    { data: productsData },
    { data: purchasesData },
    { data: ordersData },
    { data: opnamesData },
    { data: locationsDataRaw },
    { data: movesDataRaw },
    { data: summaryDataRaw },
  ] = await Promise.all([
    supabase.from('products').select('*, categories(id, name)').eq('business_id', businessId),
    supabase.from('purchases').select('*').eq('business_id', businessId),
    supabase.from('orders').select('*').eq('business_id', businessId),
    supabase.from('stock_opname').select('*').eq('business_id', businessId),
    supabase.from('inventory_locations').select('*').eq('business_id', businessId),
    supabase.from('stock_moves').select('*').eq('business_id', businessId).order('created_at', { ascending: false }),
    supabase.from('inventory_stock_summary').select('*').eq('business_id', businessId),
  ])

  let locationsData = locationsDataRaw
  if (!locationsData || locationsData.length === 0) {
    locationsData = [
      { id: 'wh-main', business_id: businessId, name: 'Gudang Utama (WH-MAIN)', type: 'internal', code: 'WH-MAIN', is_default: true, created_at: new Date().toISOString() },
      { id: 'wh-store', business_id: businessId, name: 'Toko / Display Outlet', type: 'internal', code: 'STORE-1', is_default: false, created_at: new Date().toISOString() },
      { id: 'wh-vendor', business_id: businessId, name: 'Pemasok / Vendor', type: 'vendor', code: 'VENDOR', is_default: false, created_at: new Date().toISOString() },
      { id: 'wh-customer', business_id: businessId, name: 'Transit Pelanggan', type: 'customer', code: 'CUSTOMER', is_default: false, created_at: new Date().toISOString() },
    ]
  }

  return {
    products: productsData || [],
    purchases: purchasesData || [],
    orders: ordersData || [],
    opnames: opnamesData || [],
    locations: (locationsData || []) as InventoryLocation[],
    customMoves: (movesDataRaw || []) as StockMove[],
    summaryData: summaryDataRaw || [],
  }
}

/**
 * Full Hybrid Architecture: Sync pre-aggregated metrics into inventory_stock_summary table
 */
export async function syncInventoryStockSummary(supabase: SupabaseClient, businessId: string) {
  try {
    const { products, purchases, orders, opnames, locations, customMoves } =
      await fetchFullInventoryData(supabase, businessId)

    const moves = buildUnifiedMoveHistory(products, purchases, orders, opnames, locations, customMoves)
    const stockReport = buildStockReport(products, moves, locations)

    const summaryRows = stockReport.map(item => {
      const fifoVal = calculateValuation('FIFO', [item], moves).totalValuation
      const lifoVal = calculateValuation('LIFO', [item], moves).totalValuation
      const avcoVal = calculateValuation('AVCO', [item], moves).totalValuation

      return {
        business_id: businessId,
        product_id: item.productId,
        location_id: null,
        on_hand_qty: item.onHandQty,
        available_qty: item.availableQty,
        reserved_qty: item.reservedQty,
        unit_cost: item.unitCost,
        total_value: item.totalValue,
        fifo_value: fifoVal,
        lifo_value: lifoVal,
        avco_value: avcoVal,
        updated_at: new Date().toISOString(),
      }
    })

    if (summaryRows.length > 0) {
      await supabase
        .from('inventory_stock_summary')
        .upsert(summaryRows, { onConflict: 'business_id, product_id, location_id' })
    }

    return { synced: true, count: summaryRows.length }
  } catch (err) {
    console.error('[InventoryPlugin] Failed to sync stock summary:', err)
    return { synced: false, count: 0 }
  }
}

/**
 * Generates unified Stock Moves by stitching Purchases (Receipts), Sales Orders (Deliveries),
 * Stock Opnames (Adjustments), and custom transfers.
 */
export function buildUnifiedMoveHistory(
  products: any[],
  purchases: any[],
  orders: any[],
  opnames: any[],
  locations: InventoryLocation[],
  customMoves: StockMove[]
): StockMove[] {
  const moves: StockMove[] = []
  const prodMap = new Map<string, any>()
  products.forEach(p => prodMap.set(p.id, p))

  const mainLocation = locations.find(l => l.is_default) || locations[0] || { id: 'wh-main', name: 'Gudang Utama' }
  const vendorLocation = locations.find(l => l.type === 'vendor') || { id: 'wh-vendor', name: 'Vendor' }
  const customerLocation = locations.find(l => l.type === 'customer') || { id: 'wh-customer', name: 'Customer' }

  // 1. Process Purchases (Receipts from Supplier)
  purchases.forEach(p => {
    const items = Array.isArray(p.items_json) ? p.items_json : []
    const moveStatus = p.payment_status === 'paid' ? 'done' : p.payment_status === 'partial' ? 'pending' : 'done'

    items.forEach((item: any) => {
      const prodId = item.product_id || item.id
      const prod = prodMap.get(prodId)
      const qty = parseFloat(String(item.quantity || item.qty || 1)) || 1
      const unitCost = parseFloat(String(item.unit_price || item.price || item.cost_price || (prod?.cost_price || 0))) || 0
      const lot = item.lot_number || item.batch_no || item.lot || null

      moves.push({
        id: `purchase-${p.id}-${prodId || Math.random()}`,
        business_id: p.business_id,
        product_id: prodId || 'unknown',
        product_name: prod?.name || item.name || 'Produk Pembelian',
        product_sku: prod?.sku || item.sku || null,
        reference: p.purchase_number || `PO-${p.id.slice(0, 6)}`,
        origin_location_id: vendorLocation.id,
        origin_location_name: vendorLocation.name,
        destination_location_id: mainLocation.id,
        destination_location_name: mainLocation.name,
        qty: qty,
        unit_cost: unitCost,
        lot_number: lot,
        status: moveStatus,
        type: 'receipt',
        created_at: p.date || p.created_at,
      })
    })
  })

  // 2. Process Orders (Deliveries to Customer & Reserved Items)
  orders.forEach(o => {
    const items = Array.isArray(o.items_json) ? o.items_json : []
    const isCompleted = ['completed', 'shipped', 'delivered', 'done'].includes((o.status || '').toLowerCase())
    const moveStatus: StockMove['status'] = isCompleted ? 'done' : ['cancelled', 'refunded'].includes((o.status || '').toLowerCase()) ? 'cancelled' : 'pending'

    items.forEach((item: any) => {
      const prodId = item.product_id || item.id
      const prod = prodMap.get(prodId)
      const qty = parseFloat(String(item.quantity || item.qty || 1)) || 1
      const unitCost = prod?.cost_price || parseFloat(String(item.price || 0)) * 0.5

      moves.push({
        id: `order-${o.id}-${prodId || Math.random()}`,
        business_id: o.business_id,
        product_id: prodId || 'unknown',
        product_name: prod?.name || item.name || 'Produk Pesanan',
        product_sku: prod?.sku || item.sku || null,
        reference: o.order_number || `ORD-${o.id.slice(0, 6)}`,
        origin_location_id: mainLocation.id,
        origin_location_name: mainLocation.name,
        destination_location_id: customerLocation.id,
        destination_location_name: customerLocation.name,
        qty: qty,
        unit_cost: unitCost,
        lot_number: item.lot_number || null,
        status: moveStatus,
        type: 'delivery',
        created_at: o.order_date || o.created_at,
      })
    })
  })

  // 3. Process Stock Opnames (Adjustments)
  opnames.forEach(op => {
    const items = Array.isArray(op.items_json) ? op.items_json : []
    items.forEach((item: any) => {
      const prod = prodMap.get(item.product_id)
      const diff = (item.actual_quantity || 0) - (item.recorded_quantity || 0)

      moves.push({
        id: `opname-${op.id}-${item.product_id}`,
        business_id: op.business_id,
        product_id: item.product_id,
        product_name: prod?.name || item.name || 'Produk Opname',
        product_sku: prod?.sku || null,
        reference: op.opname_number || `OPN-${op.id.slice(0, 6)}`,
        origin_location_id: diff < 0 ? mainLocation.id : null,
        origin_location_name: diff < 0 ? mainLocation.name : 'Penyesuaian System',
        destination_location_id: diff >= 0 ? mainLocation.id : null,
        destination_location_name: diff >= 0 ? mainLocation.name : 'Selisih Stok Opname',
        qty: Math.abs(diff),
        unit_cost: prod?.cost_price || 0,
        lot_number: null,
        status: 'done',
        type: 'adjustment',
        created_at: op.date || op.created_at,
      })
    })
  })

  // 4. Custom moves from table
  customMoves.forEach(m => moves.push(m))

  // Sort by date descending
  return moves.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
}

/**
 * Calculates Stock Report per Product
 */
export function buildStockReport(products: any[], moves: StockMove[], locations: InventoryLocation[]): StockReportItem[] {
  return products.map(prod => {
    const prodMoves = moves.filter(m => m.product_id === prod.id)

    // Calculate Reserved Stock (Pending Sales Orders)
    const reservedQty = prodMoves
      .filter(m => m.type === 'delivery' && m.status === 'pending')
      .reduce((sum, m) => sum + m.qty, 0)

    // Calculate Incoming Shipments (Pending Purchases)
    const incomingShipments = prodMoves
      .filter(m => m.type === 'receipt' && m.status === 'pending')
      .reduce((sum, m) => sum + m.qty, 0)

    // Calculate Outgoing Items (Completed Deliveries)
    const outgoingItems = prodMoves
      .filter(m => m.type === 'delivery' && m.status === 'done')
      .reduce((sum, m) => sum + m.qty, 0)

    const onHandQty = parseFloat(String(prod.stock_quantity || 0))
    const availableQty = Math.max(0, onHandQty - reservedQty)
    const unitCost = Number(prod.cost_price || 0)
    const totalValue = onHandQty * unitCost

    const categoryName = Array.isArray(prod.categories)
      ? prod.categories[0]?.name
      : prod.categories?.name || 'Tanpa Kategori'

    // Mock/Distribute stock across internal locations if 2+ internal locations exist
    const internalLocations = locations.filter(l => l.type === 'internal')
    const locationBreakdown: StockReportItem['locationBreakdown'] = {}

    if (internalLocations.length > 0) {
      const primaryLoc = internalLocations[0]
      locationBreakdown[primaryLoc.id] = {
        locationName: primaryLoc.name,
        qty: Math.round(onHandQty * 0.7 * 100) / 100,
        reserved: Math.round(reservedQty * 0.7 * 100) / 100,
      }

      if (internalLocations.length > 1) {
        const secLoc = internalLocations[1]
        locationBreakdown[secLoc.id] = {
          locationName: secLoc.name,
          qty: Math.round(onHandQty * 0.3 * 100) / 100,
          reserved: Math.round(reservedQty * 0.3 * 100) / 100,
        }
      }
    }

    return {
      productId: prod.id,
      productName: prod.name,
      sku: prod.sku || null,
      categoryName,
      unit: prod.unit || 'Pcs',
      onHandQty,
      availableQty,
      reservedQty,
      unitCost,
      totalValue,
      incomingShipments,
      outgoingItems,
      locationBreakdown,
    }
  })
}

/**
 * Calculates Location Report Summaries
 */
export function buildLocationReport(locations: InventoryLocation[], stockItems: StockReportItem[], moves: StockMove[]): LocationReportSummary[] {
  return locations.map(loc => {
    let totalQty = 0
    let reservedQty = 0
    let totalValue = 0
    let productsCount = 0

    stockItems.forEach(item => {
      const breakdown = item.locationBreakdown[loc.id]
      if (breakdown) {
        totalQty += breakdown.qty
        reservedQty += breakdown.reserved
        totalValue += breakdown.qty * item.unitCost
        if (breakdown.qty > 0) productsCount++
      } else if (loc.is_default) {
        totalQty += item.onHandQty
        reservedQty += item.reservedQty
        totalValue += item.totalValue
        if (item.onHandQty > 0) productsCount++
      }
    })

    const incomingQty = moves
      .filter(m => m.destination_location_id === loc.id && m.status === 'done')
      .reduce((sum, m) => sum + m.qty, 0)

    const outgoingQty = moves
      .filter(m => m.origin_location_id === loc.id && m.status === 'done')
      .reduce((sum, m) => sum + m.qty, 0)

    return {
      locationId: loc.id,
      locationName: loc.name,
      locationCode: loc.code,
      locationType: loc.type,
      isDefault: loc.is_default,
      totalProductsCount: productsCount,
      totalQty: Math.round(totalQty * 100) / 100,
      reservedQty: Math.round(reservedQty * 100) / 100,
      availableQty: Math.max(0, Math.round((totalQty - reservedQty) * 100) / 100),
      totalValue,
      incomingQty,
      outgoingQty,
    }
  })
}

/**
 * Multi-Method Inventory Valuation Engine (FIFO, LIFO, AVCO, Standard Price)
 */
export function calculateValuation(
  method: 'FIFO' | 'LIFO' | 'AVCO' | 'STANDARD',
  stockItems: StockReportItem[],
  moves: StockMove[]
): ValuationMethodResult {
  const itemBreakdown = stockItems.map(item => {
    const qtyOnHand = item.onHandQty
    const standardCost = item.unitCost
    let unitCostCalculated = standardCost
    let totalValueCalculated = qtyOnHand * standardCost

    // Fetch incoming purchase receipts for this product sorted by date
    const receiptMoves = moves
      .filter(m => m.product_id === item.productId && m.type === 'receipt' && m.status === 'done' && m.unit_cost > 0)
      .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())

    if (qtyOnHand > 0 && receiptMoves.length > 0) {
      if (method === 'FIFO') {
        // First-In, First-Out: Valuation uses most RECENT purchase lots for remaining on-hand stock
        let remainingToValue = qtyOnHand
        let accumulatedCost = 0
        // Iterate receipts backwards (latest purchases first)
        for (let i = receiptMoves.length - 1; i >= 0; i--) {
          const rec = receiptMoves[i]
          const takeQty = Math.min(remainingToValue, rec.qty)
          accumulatedCost += takeQty * rec.unit_cost
          remainingToValue -= takeQty
          if (remainingToValue <= 0) break
        }
        // If remaining stock exceeds receipt records, value remaining at standard cost
        if (remainingToValue > 0) {
          accumulatedCost += remainingToValue * standardCost
        }
        totalValueCalculated = accumulatedCost
        unitCostCalculated = accumulatedCost / qtyOnHand
      } else if (method === 'LIFO') {
        // Last-In, First-Out: Valuation uses OLDEST purchase lots for remaining on-hand stock
        let remainingToValue = qtyOnHand
        let accumulatedCost = 0
        for (let i = 0; i < receiptMoves.length; i++) {
          const rec = receiptMoves[i]
          const takeQty = Math.min(remainingToValue, rec.qty)
          accumulatedCost += takeQty * rec.unit_cost
          remainingToValue -= takeQty
          if (remainingToValue <= 0) break
        }
        if (remainingToValue > 0) {
          accumulatedCost += remainingToValue * standardCost
        }
        totalValueCalculated = accumulatedCost
        unitCostCalculated = accumulatedCost / qtyOnHand
      } else if (method === 'AVCO') {
        // Weighted Average Cost: Sum(qty * unit_cost) / Sum(qty)
        const totalReceiptQty = receiptMoves.reduce((sum, r) => sum + r.qty, 0)
        const totalReceiptCost = receiptMoves.reduce((sum, r) => sum + (r.qty * r.unit_cost), 0)

        if (totalReceiptQty > 0) {
          unitCostCalculated = totalReceiptCost / totalReceiptQty
          totalValueCalculated = qtyOnHand * unitCostCalculated
        }
      }
    }

    const varianceVsStandard = totalValueCalculated - (qtyOnHand * standardCost)

    return {
      productId: item.productId,
      productName: item.productName,
      sku: item.sku,
      qtyOnHand,
      unitCostCalculated: Math.round(unitCostCalculated * 100) / 100,
      totalValueCalculated: Math.round(totalValueCalculated),
      standardCost,
      varianceVsStandard: Math.round(varianceVsStandard),
    }
  })

  const totalValuation = itemBreakdown.reduce((sum, i) => sum + i.totalValueCalculated, 0)

  const descriptions: Record<string, { name: string; desc: string }> = {
    FIFO: {
      name: 'FIFO (First-In, First-Out)',
      desc: 'Menilai sisa stok fisik berdasarkan harga perolehan lot pembelian terbaru. Cocok untuk industri FMCG & barang ber-expired date.',
    },
    LIFO: {
      name: 'LIFO (Last-In, First-Out)',
      desc: 'Menilai sisa stok fisik berdasarkan harga perolehan lot pembelian lama. Cocok untuk meminimalkan beban pajak saat inflasi tinggi.',
    },
    AVCO: {
      name: 'AVCO (Weighted Average Cost / Rata-rata Tertimbang)',
      desc: 'Menilai persediaan berdasarkan harga rata-rata tertimbang dari seluruh riwayat penerimaan barang.',
    },
    STANDARD: {
      name: 'Standard Cost (Harga Modal Standar Produk)',
      desc: 'Menilai persediaan secara konstan berdasarkan cost_price yang terdaftar pada master data produk.',
    },
  }

  return {
    method,
    methodName: descriptions[method]?.name || method,
    description: descriptions[method]?.desc || '',
    totalValuation,
    itemBreakdown,
  }
}

/**
 * Builds Pivot Table Grouping for Move Analysis
 */
export function buildMoveAnalysisPivot(moves: StockMove[], groupBy: 'product' | 'type' | 'status'): PivotGroupRow[] {
  const groups = new Map<string, StockMove[]>()

  moves.forEach(m => {
    let key = 'Lainnya'
    if (groupBy === 'product') key = m.product_name || 'Produk'
    else if (groupBy === 'type') {
      const typeLabels: Record<string, string> = {
        receipt: 'Penerimaan Supplier (Receipt)',
        delivery: 'Pengiriman Pesanan (Delivery)',
        transfer: 'Transfer Antar Gudang',
        adjustment: 'Penyesuaian Stok Opname',
      }
      key = typeLabels[m.type] || m.type
    } else if (groupBy === 'status') {
      const statusLabels: Record<string, string> = {
        done: 'Selesai (Done)',
        pending: 'Dalam Proses / Pending',
        cancelled: 'Dibatalkan (Cancelled)',
      }
      key = statusLabels[m.status] || m.status
    }

    if (!groups.has(key)) groups.set(key, [])
    groups.get(key)!.push(m)
  })

  const pivotRows: PivotGroupRow[] = []

  groups.forEach((groupMoves, label) => {
    let totalQtyIn = 0
    let totalQtyOut = 0
    let totalValue = 0

    groupMoves.forEach(m => {
      if (m.type === 'receipt' || (m.type === 'adjustment' && m.qty > 0)) {
        totalQtyIn += m.qty
      } else {
        totalQtyOut += m.qty
      }
      totalValue += m.qty * m.unit_cost
    })

    pivotRows.push({
      groupKey: label,
      groupLabel: label,
      totalQtyIn,
      totalQtyOut,
      netMovement: totalQtyIn - totalQtyOut,
      totalValue,
      moveCount: groupMoves.length,
    })
  })

  return pivotRows.sort((a, b) => b.moveCount - a.moveCount)
}
