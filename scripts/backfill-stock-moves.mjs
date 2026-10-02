/**
 * Backfill Stock Moves — Direct Script
 * Jalankan: node scripts/backfill-stock-moves.mjs [--dry-run] [--business-id=xxx]
 */

import { createClient } from '@supabase/supabase-js'

// Fetch semua rows bypass limit 1000 Supabase
async function fetchAll(query) {
  const PAGE = 1000
  let allData = []
  let from = 0
  while (true) {
    const { data, error } = await query.range(from, from + PAGE - 1)
    if (error) throw new Error(error.message)
    if (!data || data.length === 0) break
    allData = allData.concat(data)
    if (data.length < PAGE) break
    from += PAGE
  }
  return allData
}

const SUPABASE_URL = 'https://supabase.tokoalamanda.com'
const SERVICE_ROLE_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIiwiaXNzIjoic3VwYWJhc2UiLCJpYXQiOjE3ODkwMTc4ODIsImV4cCI6MTk0NjY5Nzg4Mn0.W3KA5K-6fKXlu4Kqi_96f8l9BmMfOnU373IB7Bx_-7M'

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)

const args = process.argv.slice(2)
const DRY_RUN = args.includes('--dry-run')
const businessIdArg = args.find(a => a.startsWith('--business-id='))?.split('=')[1]

const STOCK_REDUCTION_STATUSES = ['shipped', 'completed', 'delivered', 'done']

function log(msg) { console.log(`  ${msg}`) }
function section(msg) { console.log(`\n${'─'.repeat(60)}\n  ${msg}\n${'─'.repeat(60)}`) }

async function runBackfill(businessId) {
  section(`Memproses bisnis: ${businessId}`)

  log('📥 Mengambil data dari database...')
  const [products, purchases, orders, opnames] = await Promise.all([
    fetchAll(supabase.from('products').select('id, name, sku, stock_quantity, cost_price, stock_type, created_at').eq('business_id', businessId)),
    fetchAll(supabase.from('purchases').select('id, purchase_number, payment_status, items_json, date, created_at').eq('business_id', businessId).order('date', { ascending: true })),
    fetchAll(supabase.from('orders').select('id, order_number, status, items_json, order_date, created_at').eq('business_id', businessId).order('order_date', { ascending: true })),
    fetchAll(supabase.from('stock_opname').select('id, opname_number, items_json, date, created_at').eq('business_id', businessId).order('date', { ascending: true })),
  ])

  const allProducts = products || []
  const allPurchases = purchases || []
  const allOrders = orders || []
  const allOpnames = opnames || []

  log(`✓ Produk: ${allProducts.length}`)
  log(`✓ Pembelian: ${allPurchases.length}`)
  log(`✓ Orders: ${allOrders.length}`)
  log(`✓ Stock Opname: ${allOpnames.length}`)

  const productMap = new Map()
  allProducts.forEach(p => productMap.set(p.id, p))

  // Fallback: lookup by name (lowercase) untuk order dari Accurate/external yang tidak punya product_id
  const productNameMap = new Map()
  allProducts.forEach(p => productNameMap.set(p.name.trim().toLowerCase(), p))

  const newMoveRows = []

  // --- PURCHASES → receipt ---
  for (const purchase of allPurchases) {
    const items = Array.isArray(purchase.items_json) ? purchase.items_json : []
    const ref = purchase.purchase_number || `PO-${purchase.id.slice(0, 6)}`
    const moveDate = purchase.date || purchase.created_at

    const aggByProduct = new Map()
    for (const item of items) {
      const productId = item.product_id || item.id
      if (!productId || !productMap.has(productId)) continue
      const prod = productMap.get(productId)
      if (prod?.stock_type !== 'tracked') continue

      const qty = parseFloat(item.quantity || item.qty || 1) || 0
      const unitCost = parseFloat(item.price || item.unit_price || item.cost_price || prod?.cost_price || 0) || 0
      const existing = aggByProduct.get(productId)
      if (existing) {
        const totalQty = existing.qty + qty
        const newUnitCost = totalQty > 0 ? (existing.qty * existing.unitCost + qty * unitCost) / totalQty : unitCost
        aggByProduct.set(productId, { qty: totalQty, unitCost: newUnitCost })
      } else {
        aggByProduct.set(productId, { qty, unitCost })
      }
    }

    for (const [productId, agg] of aggByProduct.entries()) {
      if (agg.qty <= 0) continue
      newMoveRows.push({ business_id: businessId, product_id: productId, reference: ref, qty: agg.qty, unit_cost: Math.round(agg.unitCost), status: 'done', type: 'receipt', source_type: 'purchase', source_id: purchase.id, origin_location_id: null, destination_location_id: null, lot_number: null, created_at: moveDate })
    }
  }

  // --- ORDERS → delivery ---
  for (const order of allOrders) {
    const status = (order.status || '').toLowerCase()
    if (!STOCK_REDUCTION_STATUSES.includes(status)) continue

    const items = Array.isArray(order.items_json) ? order.items_json : []
    const ref = order.order_number || `ORD-${order.id.slice(0, 6)}`
    const moveDate = order.order_date || order.created_at

    const aggByProduct = new Map()
    for (const item of items) {
      // Coba cari via product_id dulu, fallback ke name matching
      let productId = item.product_id || item.id
      let prod = productMap.get(productId)

      // Fallback: name matching (untuk Accurate/external yang tidak punya product_id)
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
      newMoveRows.push({ business_id: businessId, product_id: productId, reference: ref, qty: agg.qty, unit_cost: Math.round(agg.unitCost), status: 'done', type: 'delivery', source_type: 'order', source_id: order.id, origin_location_id: null, destination_location_id: null, lot_number: null, created_at: moveDate })
    }
  }

  // --- STOCK OPNAME → adjustment ---
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
      newMoveRows.push({ business_id: businessId, product_id: productId, reference: ref, qty: Math.abs(diff), unit_cost: Math.round(Number(prod?.cost_price || 0)), status: 'done', type: 'adjustment', source_type: 'stock_opname', source_id: opname.id, origin_location_id: null, destination_location_id: null, lot_number: null, created_at: moveDate })
    }
  }

  // --- Hitung stok dari moves ---
  const productsWithHistory = new Set(newMoveRows.map(r => r.product_id))
  const calculatedStockMap = new Map()

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

  // --- STOK-AWAL untuk produk (Discrepancy Check) ---
  const openingStockRows = []
  for (const prod of allProducts) {
    if (prod.stock_type !== 'tracked') continue

    const currentStock = Number(prod.stock_quantity || 0)
    const calculatedNet = calculatedStockMap.get(prod.id) || 0
    const discrepancy = currentStock - calculatedNet

    if (discrepancy !== 0) {
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
        origin_location_id: discrepancy < 0 ? '00000000-0000-0000-0000-000000000000' : null, 
        destination_location_id: null, 
        lot_number: null, 
        created_at: prodDate.toISOString() 
      })

      calculatedStockMap.set(prod.id, currentStock)
    }
  }

  const allNewRows = [...newMoveRows, ...openingStockRows]
  const stockUpdates = []
  for (const [productId, calcQty] of calculatedStockMap.entries()) {
    stockUpdates.push({ productId, newQty: Math.max(0, Math.round(calcQty)) })
  }

  // --- SUMMARY ---
  section('📊 Ringkasan')
  log(`Total log baru       : ${allNewRows.length}`)
  log(`  - Dari Pembelian   : ${newMoveRows.filter(r => r.source_type === 'purchase').length} rows`)
  log(`  - Dari Penjualan   : ${newMoveRows.filter(r => r.source_type === 'order').length} rows`)
  log(`  - Dari Stock Opname: ${newMoveRows.filter(r => r.source_type === 'stock_opname').length} rows`)
  log(`  - Entry STOK-AWAL  : ${openingStockRows.length} produk`)
  log(`Produk stok diupdate : ${stockUpdates.length}`)

  if (stockUpdates.length > 0) {
    console.log('\n  Perubahan stok (10 pertama):')
    console.log('  ' + '─'.repeat(55))
    console.log('  Produk                          Stok Lama  → Stok Baru')
    console.log('  ' + '─'.repeat(55))
    for (const { productId, newQty } of stockUpdates.slice(0, 10)) {
      const prod = productMap.get(productId)
      const oldQty = Number(prod?.stock_quantity || 0)
      const changed = oldQty !== newQty ? ' ⚠️' : ' ✓'
      console.log(`  ${(prod?.name || productId).substring(0, 32).padEnd(32)} ${String(oldQty).padStart(6)}  →  ${String(newQty).padStart(6)}${changed}`)
    }
  }

  if (DRY_RUN) {
    console.log('\n  ℹ️  DRY RUN — tidak ada yang dieksekusi.')
    return
  }

  // --- EKSEKUSI ---
  section('🚀 Eksekusi')

  log('🗑️  Menghapus stock_moves lama...')
  const { error: deleteErr } = await supabase.from('stock_moves').delete().eq('business_id', businessId)
  if (deleteErr) throw new Error(`Hapus gagal: ${deleteErr.message}`)
  log('✓ Hapus selesai')

  log(`📝 Memasukkan ${allNewRows.length} rows baru...`)
  const BATCH_SIZE = 500
  let totalInserted = 0
  for (let i = 0; i < allNewRows.length; i += BATCH_SIZE) {
    const batch = allNewRows.slice(i, i + BATCH_SIZE)
    const { error: insErr } = await supabase.from('stock_moves').insert(batch)
    if (insErr) throw new Error(`Insert batch gagal: ${insErr.message}`)
    totalInserted += batch.length
    log(`  ✓ ${totalInserted}/${allNewRows.length} rows`)
  }

  log(`\n📦 Update stok ${stockUpdates.length} produk...`)
  const updatePromises = stockUpdates.map(({ productId, newQty }) =>
    supabase.from('products').update({ stock_quantity: newQty }).eq('id', productId).eq('business_id', businessId)
  )
  await Promise.all(updatePromises)
  log('✓ Stok produk diperbarui')

  section('✅ Selesai')
  log(`Total log diinsert   : ${totalInserted}`)
  log(`Produk diupdate      : ${stockUpdates.length}`)
  log('Stock moves = single source of truth 🎉')
}

async function main() {
  console.log('\n' + '═'.repeat(60))
  console.log('  🔧 BACKFILL STOCK MOVES — ShapeUp CRM')
  console.log(`  Mode: ${DRY_RUN ? 'DRY RUN (preview saja)' : 'EKSEKUSI PENUH'}`)
  console.log('═'.repeat(60))

  let businessIds = []
  if (businessIdArg) {
    businessIds = [businessIdArg]
  } else {
    const { data: biz, error } = await supabase.from('businesses').select('id, name').order('created_at', { ascending: true })
    if (error) throw new Error(`Gagal ambil businesses: ${error.message}`)
    businessIds = (biz || []).map(b => b.id)
    console.log(`\n  Ditemukan ${businessIds.length} bisnis:`)
    ;(biz || []).forEach(b => console.log(`    - ${b.name} (${b.id})`))
  }

  if (businessIds.length === 0) {
    console.log('\n  ⚠️  Tidak ada bisnis ditemukan.')
    process.exit(0)
  }

  for (const bId of businessIds) {
    await runBackfill(bId)
  }

  console.log('\n' + '═'.repeat(60) + '\n  DONE\n' + '═'.repeat(60) + '\n')
}

main().catch(err => {
  console.error('\n❌ ERROR:', err.message)
  process.exit(1)
})
