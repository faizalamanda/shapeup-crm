import { getApiContext } from '@/lib/apiContext'
import { NextResponse } from 'next/server'

/**
 * POST /api/inventory/backfill-moves
 *
 * Regenerasi ulang tabel stock_moves dari nol berdasarkan data transaksi yang ada:
 * 1. Hapus semua stock_moves untuk bisnis ini
 * 2. Rebuild dari: purchases (receipt), orders (delivery), stock_opname (adjustment)
 * 3. Produk tanpa histori → buat entry STOK-AWAL dari stock_quantity sekarang
 * 4. Hitung ulang stock_quantity dari stock_moves untuk produk yang punya histori
 */
export async function POST(req: Request) {
  const ctx = await getApiContext()
  if (ctx.error) return ctx.error
  const { businessId, supabase } = ctx

  try {
    const body = await req.json().catch(() => ({}))
    const dryRun = body.dryRun === true // dryRun=true → hanya preview, tidak eksekusi

    // ─────────────────────────────────────────────────────────────────
    // 1. Fetch semua data sumber secara paralel
    // ─────────────────────────────────────────────────────────────────
    const [
      { data: products, error: prodErr },
      { data: purchases, error: purErr },
      { data: orders, error: ordErr },
      { data: opnames, error: opnErr },
    ] = await Promise.all([
      supabase
        .from('products')
        .select('id, name, sku, stock_quantity, cost_price, stock_type, created_at')
        .eq('business_id', businessId),
      supabase
        .from('purchases')
        .select('id, purchase_number, payment_status, items_json, date, created_at')
        .eq('business_id', businessId)
        .order('date', { ascending: true }),
      supabase
        .from('orders')
        .select('id, order_number, status, items_json, order_date, created_at, source_platform')
        .eq('business_id', businessId)
        .order('order_date', { ascending: true }),
      supabase
        .from('stock_opname')
        .select('id, opname_number, items_json, date, created_at')
        .eq('business_id', businessId)
        .order('date', { ascending: true }),
    ])

    if (prodErr) return NextResponse.json({ error: `Gagal fetch produk: ${prodErr.message}` }, { status: 500 })
    if (purErr) return NextResponse.json({ error: `Gagal fetch pembelian: ${purErr.message}` }, { status: 500 })
    if (ordErr) return NextResponse.json({ error: `Gagal fetch orders: ${ordErr.message}` }, { status: 500 })
    if (opnErr) return NextResponse.json({ error: `Gagal fetch opname: ${opnErr.message}` }, { status: 500 })

    const allProducts = products || []
    const allPurchases = purchases || []
    const allOrders = orders || []
    const allOpnames = opnames || []

    // Build product lookup map by ID
    const productMap = new Map<string, any>()
    allProducts.forEach(p => productMap.set(p.id, p))

    // Fallback: lookup by name untuk order dari Accurate/external yang tidak punya product_id
    const productNameMap = new Map<string, any>()
    allProducts.forEach(p => productNameMap.set(p.name.trim().toLowerCase(), p))

    // Status order yang memotong stok (sesuai default business)
    const STOCK_REDUCTION_STATUSES = ['shipped', 'completed', 'delivered', 'done']

    // ─────────────────────────────────────────────────────────────────
    // 2. Build rows stock_moves dari setiap sumber transaksi
    // ─────────────────────────────────────────────────────────────────
    const newMoveRows: any[] = []

    // --- PURCHASES → receipt moves ---
    for (const purchase of allPurchases) {
      const items = Array.isArray(purchase.items_json) ? purchase.items_json : []
      const ref = purchase.purchase_number || `PO-${purchase.id.slice(0, 6)}`
      const moveDate = purchase.date || purchase.created_at

      // Agregasi qty per product (jika ada duplikat produk dalam 1 PO)
      const aggByProduct = new Map<string, { qty: number; unitCost: number }>()
      for (const item of items) {
        const productId = item.product_id || item.id
        if (!productId || !productMap.has(productId)) continue
        const prod = productMap.get(productId)
        if (prod?.stock_type !== 'tracked') continue

        const qty = parseFloat(item.quantity || item.qty || 1) || 0
        const unitCost = parseFloat(item.price || item.unit_price || item.cost_price || prod?.cost_price || 0) || 0
        const existing = aggByProduct.get(productId)
        if (existing) {
          // WAC average
          const totalQty = existing.qty + qty
          const newUnitCost = totalQty > 0 ? (existing.qty * existing.unitCost + qty * unitCost) / totalQty : unitCost
          aggByProduct.set(productId, { qty: totalQty, unitCost: newUnitCost })
        } else {
          aggByProduct.set(productId, { qty, unitCost })
        }
      }

      for (const [productId, agg] of aggByProduct.entries()) {
        if (agg.qty <= 0) continue
        newMoveRows.push({
          business_id: businessId,
          product_id: productId,
          reference: ref,
          qty: agg.qty,
          unit_cost: Math.round(agg.unitCost),
          status: 'done',
          type: 'receipt',
          source_type: 'purchase',
          source_id: purchase.id,
          origin_location_id: null,
          destination_location_id: null,
          lot_number: null,
          created_at: moveDate,
        })
      }
    }

    // --- ORDERS → delivery moves ---
    for (const order of allOrders) {
      const status = (order.status || '').toLowerCase()
      if (!STOCK_REDUCTION_STATUSES.includes(status)) continue

      const items = Array.isArray(order.items_json) ? order.items_json : []
      const ref = order.order_number || `ORD-${order.id.slice(0, 6)}`
      const moveDate = order.order_date || order.created_at

      const aggByProduct = new Map<string, { qty: number; unitCost: number }>()
      for (const item of items) {
        // Coba cari via product_id dulu, fallback ke name matching (Accurate/external)
        let productId = item.product_id || item.id
        let prod = productMap.get(productId)

        if (!prod && item.name) {
          prod = productNameMap.get(item.name.trim().toLowerCase())
          if (prod) productId = prod.id
        }

        if (!prod || !productId) continue
        if (prod?.stock_type !== 'tracked') continue

        const qty = parseFloat(item.quantity || item.qty || 1) || 0
        const unitCost = Number(prod?.cost_price || 0)
        const existing = aggByProduct.get(productId)
        if (existing) {
          aggByProduct.set(productId, { qty: existing.qty + qty, unitCost })
        } else {
          aggByProduct.set(productId, { qty, unitCost })
        }
      }

      for (const [productId, agg] of aggByProduct.entries()) {
        if (agg.qty <= 0) continue
        newMoveRows.push({
          business_id: businessId,
          product_id: productId,
          reference: ref,
          qty: agg.qty,
          unit_cost: Math.round(agg.unitCost),
          status: 'done',
          type: 'delivery',
          source_type: 'order',
          source_id: order.id,
          origin_location_id: null,
          destination_location_id: null,
          lot_number: null,
          created_at: moveDate,
        })
      }
    }

    // --- STOCK OPNAME → adjustment moves ---
    for (const opname of allOpnames) {
      const items = Array.isArray(opname.items_json) ? opname.items_json : []
      const ref = opname.opname_number || `OPN-${opname.id.slice(0, 6)}`
      const moveDate = opname.date || opname.created_at

      for (const item of items) {
        const productId = item.product_id
        if (!productId || !productMap.has(productId)) continue

        const recorded = parseFloat(item.recorded_quantity || 0) || 0
        const actual = parseFloat(item.actual_quantity || 0) || 0
        const diff = actual - recorded
        if (diff === 0) continue

        const prod = productMap.get(productId)
        const unitCost = Number(prod?.cost_price || 0)

        newMoveRows.push({
          business_id: businessId,
          product_id: productId,
          reference: ref,
          qty: Math.abs(diff),
          unit_cost: Math.round(unitCost),
          status: 'done',
          type: 'adjustment',
          source_type: 'stock_opname',
          source_id: opname.id,
          // diff > 0 → tambah stok: origin null, dest null
          // diff < 0 → kurang stok: origin null, dest null (dulu wh-main, tapi error UUID)
          origin_location_id: null,
          destination_location_id: null,
          lot_number: null,
          created_at: moveDate,
        })
      }
    }

    // ─────────────────────────────────────────────────────────────────
    // 3. Hitung stok per produk dari moves yang baru dibuat
    // ─────────────────────────────────────────────────────────────────

    const calculatedStockMap = new Map<string, number>()
    for (const row of newMoveRows) {
      const current = calculatedStockMap.get(row.product_id) || 0
      if (row.type === 'receipt' || row.type === 'refund') {
        calculatedStockMap.set(row.product_id, current + row.qty)
      } else if (row.type === 'delivery') {
        calculatedStockMap.set(row.product_id, current - row.qty)
      } else if (row.type === 'adjustment') {
        const isIncrease = !row.origin_location_id
        calculatedStockMap.set(row.product_id, isIncrease ? current + row.qty : current - row.qty)
      }
    }

    // ─────────────────────────────────────────────────────────────────
    // 4. Koreksi Saldo Awal (Discrepancy Check)
    //    Memastikan forward calculation tidak pernah negatif di awal dan klop 100% dengan fisik.
    // ─────────────────────────────────────────────────────────────────

    const openingStockRows: any[] = []
    
    for (const prod of allProducts) {
      if (prod.stock_type !== 'tracked') continue

      const currentStock = Number(prod.stock_quantity || 0)
      const calculatedNet = calculatedStockMap.get(prod.id) || 0
      const discrepancy = currentStock - calculatedNet
      
      if (discrepancy !== 0) {
        // Suntik STOK-AWAL di waktu paling awal (1 menit sebelum produk dibuat) 
        // supaya urutannya muncul paling atas/awal di riwayat (forward calculation)
        const prodDate = new Date(prod.created_at || Date.now())
        prodDate.setMinutes(prodDate.getMinutes() - 1)
        
        openingStockRows.push({
          business_id: businessId,
          product_id: prod.id,
          reference: 'STOK-AWAL',
          qty: Math.abs(discrepancy),
          unit_cost: Math.round(Number(prod.cost_price || 0)),
          status: 'done',
          type: 'adjustment',
          source_type: 'manual',
          source_id: null,
          // discrepancy > 0 -> origin null, dest null (artinya stok nambah)
          // discrepancy < 0 -> origin = dummy UUID, dest null (artinya stok kurang)
          origin_location_id: discrepancy < 0 ? '00000000-0000-0000-0000-000000000000' : null,
          destination_location_id: null,
          lot_number: null,
          created_at: prodDate.toISOString(),
        })
        
        // Update perhitungan net dengan koreksi ini
        calculatedStockMap.set(prod.id, currentStock)
      }
    }

    const allNewRows = [...newMoveRows, ...openingStockRows]

    // ─────────────────────────────────────────────────────────────────
    // 4. Build daftar update stock_quantity per produk (hanya yang punya histori)
    // ─────────────────────────────────────────────────────────────────
    const stockUpdates: { productId: string; newQty: number }[] = []
    for (const [productId, calcQty] of calculatedStockMap.entries()) {
      stockUpdates.push({ productId, newQty: Math.max(0, Math.round(calcQty)) })
    }

    // ─────────────────────────────────────────────────────────────────
    // DRY RUN — preview saja tanpa eksekusi
    // ─────────────────────────────────────────────────────────────────
    if (dryRun) {
      return NextResponse.json({
        success: true,
        dryRun: true,
        summary: {
          totalMoveRowsToInsert: allNewRows.length,
          fromPurchases: newMoveRows.filter(r => r.source_type === 'purchase').length,
          fromOrders: newMoveRows.filter(r => r.source_type === 'order').length,
          fromOpname: newMoveRows.filter(r => r.source_type === 'stock_opname').length,
          openingStockEntries: openingStockRows.length,
          productsToRecalculate: stockUpdates.length,
          stockUpdates: stockUpdates.slice(0, 10), // preview 10 pertama
        }
      })
    }

    // ─────────────────────────────────────────────────────────────────
    // 5. EKSEKUSI — Hapus semua stock_moves, insert ulang, update stok
    // ─────────────────────────────────────────────────────────────────

    // 5a. Hapus semua stock_moves untuk bisnis ini
    const { error: deleteErr } = await supabase
      .from('stock_moves')
      .delete()
      .eq('business_id', businessId)

    if (deleteErr) {
      return NextResponse.json({ error: `Gagal hapus stock_moves lama: ${deleteErr.message}` }, { status: 500 })
    }

    // 5b. Insert semua rows baru dalam batch (max 500 per insert)
    const BATCH_SIZE = 500
    let totalInserted = 0
    for (let i = 0; i < allNewRows.length; i += BATCH_SIZE) {
      const batch = allNewRows.slice(i, i + BATCH_SIZE)
      const { error: insErr } = await supabase.from('stock_moves').insert(batch)
      if (insErr) {
        console.error('[Backfill] Insert batch error:', insErr.message)
        return NextResponse.json({ error: `Gagal insert stock_moves: ${insErr.message}` }, { status: 500 })
      }
      totalInserted += batch.length
    }

    // 5c. Update stock_quantity untuk produk yang punya histori transaksi
    if (stockUpdates.length > 0) {
      const updatePromises = stockUpdates.map(({ productId, newQty }) =>
        supabase
          .from('products')
          .update({ stock_quantity: newQty })
          .eq('id', productId)
          .eq('business_id', businessId)
      )
      await Promise.all(updatePromises)
    }

    return NextResponse.json({
      success: true,
      summary: {
        totalInserted,
        fromPurchases: newMoveRows.filter(r => r.source_type === 'purchase').length,
        fromOrders: newMoveRows.filter(r => r.source_type === 'order').length,
        fromOpname: newMoveRows.filter(r => r.source_type === 'stock_opname').length,
        openingStockEntries: openingStockRows.length,
        productsRecalculated: stockUpdates.length,
      },
      message: `Berhasil rebuild ${totalInserted} log mutasi stok. ${stockUpdates.length} produk stoknya diperbarui.`
    })
  } catch (err: any) {
    console.error('[POST /api/inventory/backfill-moves] Error:', err)
    return NextResponse.json({ error: err.message || 'Gagal menjalankan backfill' }, { status: 500 })
  }
}
