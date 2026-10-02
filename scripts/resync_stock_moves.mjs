import { createClient } from '@supabase/supabase-js'
import fs from 'fs'
import path from 'path'

const envPath = path.resolve(process.cwd(), '.env.local')
if (fs.existsSync(envPath)) {
  const envConfig = fs.readFileSync(envPath, 'utf8')
  envConfig.split('\n').forEach(line => {
    const trimmed = line.trim()
    if (trimmed && !trimmed.startsWith('#') && trimmed.includes('=')) {
      const idx = trimmed.indexOf('=')
      const key = trimmed.slice(0, idx).trim()
      let val = trimmed.slice(idx + 1).trim()
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1)
      }
      if (!process.env[key]) {
        process.env[key] = val
      }
    }
  })
}

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('Missing Supabase env variables')
  process.exit(1)
}

const supabase = createClient(supabaseUrl, supabaseServiceKey)

async function resyncStockData() {
  console.log('====================================================')
  console.log('   SHAPEUP CRM - FULL STOCK AUDIT & RESYNC EXECUTION')
  console.log('====================================================\n')

  const { data: businesses, error: bizErr } = await supabase.from('businesses').select('id, name')
  if (bizErr) {
    console.error('Failed to fetch businesses:', bizErr.message)
    return
  }

  for (const biz of businesses || []) {
    console.log(`Processing Business: ${biz.name} (${biz.id})`)

    // Fetch products
    const { data: products } = await supabase
      .from('products')
      .select('id, name, sku, stock_quantity')
      .eq('business_id', biz.id)

    if (!products || products.length === 0) {
      console.log(`No products found for ${biz.name}, skipping.\n`)
      continue
    }

    // Fetch purchases
    const { data: purchases } = await supabase
      .from('purchases')
      .select('id, purchase_number, payment_status, items_json, date, created_at')
      .eq('business_id', biz.id)

    // Fetch orders
    const { data: orders } = await supabase
      .from('orders')
      .select('id, order_number, status, items_json, order_date, order_date_utc, raw_source_data, created_at, updated_at')
      .eq('business_id', biz.id)

    // Fetch opnames
    const { data: opnames } = await supabase
      .from('stock_opname')
      .select('id, opname_number, items_json, date, created_at')
      .eq('business_id', biz.id)

    // Fetch existing moves
    let allExistingMoves = []
    let hasMore = true
    let page = 0
    const pageSize = 1000

    while (hasMore) {
      const { data: pageMoves } = await supabase
        .from('stock_moves')
        .select('id, product_id, reference, qty, type, status, source_type, source_id, created_at')
        .eq('business_id', biz.id)
        .range(page * pageSize, (page + 1) * pageSize - 1)

      if (pageMoves && pageMoves.length > 0) {
        allExistingMoves.push(...pageMoves)
        if (pageMoves.length < pageSize) hasMore = false
        else page++
      } else {
        hasMore = false
      }
    }

    const prodMap = new Map()
    const skuMap = new Map()
    const nameMap = new Map()

    for (const p of products) {
      prodMap.set(p.id, p)
      if (p.sku) skuMap.set(String(p.sku).trim().toLowerCase(), p)
      if (p.name) nameMap.set(String(p.name).trim().toLowerCase(), p)
    }

    const resolveProduct = (item) => {
      const pId = String(item.product_id || item.id || '')
      if (pId && prodMap.has(pId)) return prodMap.get(pId)
      const sku = String(item.sku || '').trim().toLowerCase()
      if (sku && skuMap.has(sku)) return skuMap.get(sku)
      const name = String(item.name || '').trim().toLowerCase()
      if (name && nameMap.has(name)) return nameMap.get(name)
      return null
    }

    const existingKeySet = new Set()
    for (const m of allExistingMoves) {
      const key = m.source_type && m.source_id 
        ? `${m.product_id}_${m.source_type}_${m.source_id}_${m.type}`
        : `${m.product_id}_${m.reference}_${m.type}`
      existingKeySet.add(key)
    }

    const movesToInsert = []
    const productStockTotals = new Map()

    for (const p of products) {
      productStockTotals.set(p.id, 0)
    }

    // 1. Process Opnames
    for (const op of opnames || []) {
      const items = Array.isArray(op.items_json) ? op.items_json : []
      const moveDate = op.date || op.created_at || new Date().toISOString()
      for (const item of items) {
        const prod = resolveProduct(item)
        if (!prod) continue

        const recordedQty = Number(item.recorded_quantity || 0)
        const actualQty = Number(item.actual_quantity || 0)
        const diff = actualQty - recordedQty
        if (diff === 0) continue

        const key = `${prod.id}_stock_opname_${op.id}_adjustment`
        if (!existingKeySet.has(key)) {
          existingKeySet.add(key)
          movesToInsert.push({
            business_id: biz.id,
            product_id: prod.id,
            reference: op.opname_number || `OPN-${op.id.slice(0, 6)}`,
            qty: Math.abs(diff),
            unit_cost: Number(prod.cost_price || 0),
            status: 'done',
            type: 'adjustment',
            source_type: 'stock_opname',
            source_id: op.id,
            created_at: moveDate
          })
        }
        productStockTotals.set(prod.id, (productStockTotals.get(prod.id) || 0) + diff)
      }
    }

    // 2. Process Purchases
    for (const pur of purchases || []) {
      const items = Array.isArray(pur.items_json) ? pur.items_json : []
      const moveDate = pur.date || pur.created_at || new Date().toISOString()
      for (const item of items) {
        const prod = resolveProduct(item)
        if (!prod) continue

        const qty = Number(item.quantity || item.qty || 1)
        const key = `${prod.id}_purchase_${pur.id}_receipt`
        if (!existingKeySet.has(key)) {
          existingKeySet.add(key)
          movesToInsert.push({
            business_id: biz.id,
            product_id: prod.id,
            reference: pur.purchase_number || `PO-${pur.id.slice(0, 6)}`,
            qty: qty,
            unit_cost: Number(item.unit_price || item.price || prod.cost_price || 0),
            status: 'done',
            type: 'receipt',
            source_type: 'purchase',
            source_id: pur.id,
            created_at: moveDate
          })
        }
        productStockTotals.set(prod.id, (productStockTotals.get(prod.id) || 0) + qty)
      }
    }

    // 3. Process Orders
    for (const ord of orders || []) {
      const status = (ord.status || '').toLowerCase()
      const isActiveOrder = ['shipped', 'completed', 'delivered', 'done', 'processing'].includes(status)
      if (!isActiveOrder) continue

      const raw = ord.raw_source_data || {}
      let orderMoveDate = ''
      if (raw.date_shipped_gmt) orderMoveDate = new Date(raw.date_shipped_gmt + 'Z').toISOString()
      else if (raw.date_shipped) orderMoveDate = new Date(raw.date_shipped).toISOString()
      else if (raw.date_paid_gmt) orderMoveDate = new Date(raw.date_paid_gmt + 'Z').toISOString()
      else if (raw.date_paid) orderMoveDate = new Date(raw.date_paid).toISOString()
      else if (raw.date_completed_gmt) orderMoveDate = new Date(raw.date_completed_gmt + 'Z').toISOString()
      else if (raw.date_completed) orderMoveDate = new Date(raw.date_completed).toISOString()
      else orderMoveDate = ord.order_date_utc || ord.order_date || ord.created_at || new Date().toISOString()

      const items = Array.isArray(ord.items_json) ? ord.items_json : []
      for (const item of items) {
        const prod = resolveProduct(item)
        if (!prod) continue

        const qty = Number(item.quantity || item.qty || 1)
        const key = `${prod.id}_order_${ord.id}_delivery`
        if (!existingKeySet.has(key)) {
          existingKeySet.add(key)
          movesToInsert.push({
            business_id: biz.id,
            product_id: prod.id,
            reference: ord.order_number || `ORD-${ord.id.slice(0, 6)}`,
            qty: qty,
            unit_cost: Number(prod.cost_price || 0),
            status: 'done',
            type: 'delivery',
            source_type: 'order',
            source_id: ord.id,
            created_at: orderMoveDate
          })
        }
        productStockTotals.set(prod.id, (productStockTotals.get(prod.id) || 0) - qty)
      }
    }

    console.log(`- New Move Rows to Insert: ${movesToInsert.length}`)

    // Batch insert movesToInsert
    if (movesToInsert.length > 0) {
      const batchSize = 200
      for (let i = 0; i < movesToInsert.length; i += batchSize) {
        const batch = movesToInsert.slice(i, i + batchSize)
        const { error: insErr } = await supabase.from('stock_moves').insert(batch)
        if (insErr) {
          console.error(`Error inserting stock moves batch:`, insErr.message)
        }
      }
      console.log(`✓ Inserted ${movesToInsert.length} stock moves into database.`)
    }

    // Update products.stock_quantity in DB
    let updatedCount = 0
    for (const p of products) {
      const targetQty = productStockTotals.get(p.id) ?? 0
      if (Number(p.stock_quantity || 0) !== targetQty) {
        const { error: updErr } = await supabase
          .from('products')
          .update({ stock_quantity: targetQty })
          .eq('id', p.id)

        if (!updErr) updatedCount++
      }
    }

    console.log(`✓ Updated stock quantity for ${updatedCount} products in ${biz.name}.\n`)
  }

  console.log('====================================================')
  console.log('   AUDIT & RESYNC COMPLETED SUCCESSFULLY!          ')
  console.log('====================================================')
}

resyncStockData().catch(console.error)
