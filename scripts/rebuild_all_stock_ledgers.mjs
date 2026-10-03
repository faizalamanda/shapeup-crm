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
  console.error('Missing Supabase credentials')
  process.exit(1)
}

const supabase = createClient(supabaseUrl, supabaseServiceKey)

// Helper: Fetch ALL rows from a table using pagination (bypass 1000 row limit)
async function fetchAllRows(tableName, selectQuery, filterFn = null) {
  let allRows = []
  let page = 0
  const pageSize = 1000
  let hasMore = true

  while (hasMore) {
    const from = page * pageSize
    const to = from + pageSize - 1

    let query = supabase.from(tableName).select(selectQuery).range(from, to)
    if (filterFn) {
      query = filterFn(query)
    }

    const { data, error } = await query
    if (error) {
      console.error(`[FetchAllRows] Error fetching ${tableName} (page ${page}):`, error.message)
      break
    }

    if (data && data.length > 0) {
      allRows.push(...data)
      if (data.length < pageSize) hasMore = false
      else page++
    } else {
      hasMore = false
    }
  }

  return allRows
}

async function rebuildAllStockLedgers() {
  console.log('========================================================================')
  console.log('   SHAPEUP CRM - FULL PAGINATED REBUILD & RESYNC OF ALL STOCK MOVEMENTS')
  console.log('========================================================================\n')

  // 1. Fetch all businesses
  const { data: businesses, error: bizErr } = await supabase.from('businesses').select('id, name')
  if (bizErr) {
    console.error('Failed to fetch businesses:', bizErr.message)
    return
  }

  for (const biz of businesses || []) {
    console.log(`\n------------------------------------------------------------------------`)
    console.log(`Processing Business: ${biz.name} (${biz.id})`)
    console.log(`------------------------------------------------------------------------`)

    // 2. Fetch ALL products for this business
    console.log('1. Fetching all products...')
    const products = await fetchAllRows(
      'products',
      'id, name, sku, cost_price, stock_quantity, stock_type',
      q => q.eq('business_id', biz.id)
    )
    console.log(`   ✓ Found ${products.length} products.`)

    if (products.length === 0) continue

    // Maps for fast product lookup
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

    // 3. Fetch ALL existing stock_moves for this business
    console.log('2. Fetching all existing stock_moves...')
    const existingMoves = await fetchAllRows(
      'stock_moves',
      'id, product_id, reference, qty, type, status, source_type, source_id, origin_location_id, destination_location_id, created_at',
      q => q.eq('business_id', biz.id)
    )
    console.log(`   ✓ Found ${existingMoves.length} existing stock_moves.`)

    const existingKeySet = new Set()
    for (const m of existingMoves) {
      if (m.source_type && m.source_id) {
        existingKeySet.add(`${m.product_id}_${m.source_type}_${m.source_id}_${m.type}`)
      }
      existingKeySet.add(`${m.product_id}_${m.reference}_${m.type}`)
    }

    // 4. Fetch ALL purchases
    console.log('3. Fetching all purchases...')
    const purchases = await fetchAllRows(
      'purchases',
      'id, purchase_number, payment_status, items_json, date, created_at',
      q => q.eq('business_id', biz.id)
    )
    console.log(`   ✓ Found ${purchases.length} purchases.`)

    // 5. Fetch ALL opnames
    console.log('4. Fetching all stock_opname...')
    const opnames = await fetchAllRows(
      'stock_opname',
      'id, opname_number, items_json, date, created_at',
      q => q.eq('business_id', biz.id)
    )
    console.log(`   ✓ Found ${opnames.length} opnames.`)

    // 6. Fetch ALL orders
    console.log('5. Fetching all orders...')
    const orders = await fetchAllRows(
      'orders',
      'id, order_number, status, items_json, order_date, order_date_utc, raw_source_data, created_at',
      q => q.eq('business_id', biz.id)
    )
    console.log(`   ✓ Found ${orders.length} orders.`)

    // 7. Determine missing moves to insert
    const movesToInsert = []

    // Process Purchases -> Receipt Moves
    for (const pur of purchases) {
      const items = Array.isArray(pur.items_json) ? pur.items_json : []
      const moveDate = pur.date || pur.created_at || new Date().toISOString()
      for (const item of items) {
        const prod = resolveProduct(item)
        if (!prod || prod.stock_type !== 'tracked') continue

        const qty = Number(item.quantity || item.qty || 1)
        const keySource = `${prod.id}_purchase_${pur.id}_receipt`
        const keyRef = `${prod.id}_${pur.purchase_number || `PO-${pur.id.slice(0, 6)}`}_receipt`

        if (!existingKeySet.has(keySource) && !existingKeySet.has(keyRef)) {
          existingKeySet.add(keySource)
          existingKeySet.add(keyRef)
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
      }
    }

    // Process Opnames -> Adjustment Moves
    for (const op of opnames) {
      const items = Array.isArray(op.items_json) ? op.items_json : []
      let moveDate = op.date || op.created_at || new Date().toISOString()
      if (moveDate && !moveDate.includes('T')) {
        moveDate = `${moveDate}T16:59:59.000Z`
      }
      for (const item of items) {
        const prod = resolveProduct(item)
        if (!prod || prod.stock_type !== 'tracked') continue

        const recordedQty = Number(item.recorded_quantity || 0)
        const actualQty = Number(item.actual_quantity || 0)
        const diff = actualQty - recordedQty
        if (diff === 0) continue

        const keySource = `${prod.id}_stock_opname_${op.id}_adjustment`
        const keyRef = `${prod.id}_${op.opname_number || `OPN-${op.id.slice(0, 6)}`}_adjustment`

        if (!existingKeySet.has(keySource) && !existingKeySet.has(keyRef)) {
          existingKeySet.add(keySource)
          existingKeySet.add(keyRef)
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
            origin_location_id: diff < 0 ? '00000000-0000-0000-0000-000000000000' : null,
            created_at: moveDate
          })
        }
      }
    }

    // Process Orders -> Delivery Moves
    for (const ord of orders) {
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
        if (!prod || prod.stock_type !== 'tracked') continue

        const qty = Number(item.quantity || item.qty || 1)
        const keySource = `${prod.id}_order_${ord.id}_delivery`
        const keyRef = `${prod.id}_Order #${ord.order_number}_delivery`
        const keyRefPlain = `${prod.id}_${ord.order_number}_delivery`

        if (!existingKeySet.has(keySource) && !existingKeySet.has(keyRef) && !existingKeySet.has(keyRefPlain)) {
          existingKeySet.add(keySource)
          existingKeySet.add(keyRef)
          movesToInsert.push({
            business_id: biz.id,
            product_id: prod.id,
            reference: ord.order_number ? (String(ord.order_number).startsWith('Order #') ? ord.order_number : `Order #${ord.order_number}`) : `ORD-${ord.id.slice(0, 6)}`,
            qty: qty,
            unit_cost: Number(prod.cost_price || 0),
            status: 'done',
            type: 'delivery',
            source_type: 'order',
            source_id: ord.id,
            created_at: orderMoveDate
          })
        }
      }
    }

    console.log(`6. Backfilling missing stock_moves: ${movesToInsert.length} new move rows to insert.`)

    if (movesToInsert.length > 0) {
      const batchSize = 250
      for (let i = 0; i < movesToInsert.length; i += batchSize) {
        const batch = movesToInsert.slice(i, i + batchSize)
        const { error: insErr } = await supabase.from('stock_moves').insert(batch)
        if (insErr) {
          console.error(`   ✕ Error inserting stock moves batch:`, insErr.message)
        }
      }
      console.log(`   ✓ Successfully backfilled ${movesToInsert.length} stock moves.`)
    }

    // 8. Recalculate exact net stock for ALL products from all done stock_moves
    console.log('7. Recalculating net stock for all products from stock_moves ledger...')
    const allUpdatedMoves = await fetchAllRows(
      'stock_moves',
      'product_id, qty, type, status, origin_location_id, destination_location_id',
      q => q.eq('business_id', biz.id).eq('status', 'done')
    )

    const netStockMap = new Map()
    for (const p of products) {
      netStockMap.set(p.id, 0)
    }

    for (const m of allUpdatedMoves) {
      if (!netStockMap.has(m.product_id)) continue
      let current = netStockMap.get(m.product_id) || 0
      if (m.type === 'receipt' || m.type === 'refund') {
        current += Number(m.qty)
      } else if (m.type === 'delivery') {
        current -= Number(m.qty)
      } else if (m.type === 'adjustment') {
        if (!m.origin_location_id || (m.destination_location_id && !m.origin_location_id)) {
          current += Number(m.qty)
        } else {
          current -= Number(m.qty)
        }
      }
      netStockMap.set(m.product_id, current)
    }

    // Update products.stock_quantity for products that mismatch
    let updatedProductCount = 0
    const updatePromises = []

    for (const p of products) {
      const targetStock = netStockMap.get(p.id) ?? 0
      if (Number(p.stock_quantity || 0) !== targetStock) {
        updatePromises.push(
          supabase
            .from('products')
            .update({ stock_quantity: targetStock, updated_at: new Date().toISOString() })
            .eq('id', p.id)
            .then(({ error }) => {
              if (error) console.error(`  ✕ Error updating product ${p.name}:`, error.message)
              else updatedProductCount++
            })
        )
      }
    }

    if (updatePromises.length > 0) {
      // Execute in chunks of 50
      const batchSize = 50
      for (let i = 0; i < updatePromises.length; i += batchSize) {
        await Promise.all(updatePromises.slice(i, i + batchSize))
      }
    }

    console.log(`   ✓ Updated physical stock_quantity for ${updatedProductCount} products in ${biz.name}.`)
  }

  console.log('\n========================================================================')
  console.log('   FULL REBUILD & RESYNC COMPLETED SUCCESSFULLY ACROSS ALL BUSINESSES!  ')
  console.log('========================================================================')
}

rebuildAllStockLedgers().catch(console.error)
