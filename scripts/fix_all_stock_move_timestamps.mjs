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

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)

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

function resolvePreciseTimestamp(docDate, docCreatedAt) {
  if (docCreatedAt && (docCreatedAt.includes('T') || docCreatedAt.includes(' '))) {
    if (docDate && docDate.length === 10 && !docDate.includes('T')) {
      // Combine docDate with time component of docCreatedAt
      const timePart = docCreatedAt.includes('T') ? docCreatedAt.split('T')[1] : docCreatedAt.split(' ')[1]
      return `${docDate}T${timePart}`
    }
    return new Date(docCreatedAt).toISOString()
  }

  if (docDate && (docDate.includes('T') || docDate.includes(' '))) {
    return new Date(docDate).toISOString()
  }

  if (docDate && docDate.length === 10) {
    const todayStr = new Date().toISOString().split('T')[0]
    if (docDate === todayStr) {
      return new Date().toISOString()
    }
    return `${docDate}T16:59:59.000Z`
  }

  return new Date().toISOString()
}

async function fixMoveTimestamps() {
  console.log('========================================================================')
  console.log('   SHAPEUP CRM - FIXING PRECISE TIMESTAMPS ON ALL STOCK MOVEMENTS')
  console.log('========================================================================\n')

  // 1. Fix Purchase Stock Move Timestamps
  console.log('1. Auditing Purchase Stock Moves...')
  const purchases = await fetchAllRows('purchases', 'id, purchase_number, date, created_at')
  console.log(`   ✓ Found ${purchases.length} purchases.`)

  let fixedPurCount = 0
  for (const pur of purchases) {
    const targetTimestamp = resolvePreciseTimestamp(pur.date, pur.created_at)

    const { data: moves } = await supabase
      .from('stock_moves')
      .select('id, created_at')
      .or(`source_id.eq.${pur.id},reference.eq.${pur.purchase_number}`)
      .eq('source_type', 'purchase')

    for (const m of moves || []) {
      if (m.created_at !== targetTimestamp && !m.created_at.endsWith(targetTimestamp.slice(11))) {
        await supabase
          .from('stock_moves')
          .update({ created_at: targetTimestamp })
          .eq('id', m.id)
        fixedPurCount++
      }
    }
  }
  console.log(`   ✓ Fixed timestamps for ${fixedPurCount} purchase stock moves.\n`)

  // 2. Fix Opname Stock Move Timestamps
  console.log('2. Auditing Opname Stock Moves...')
  const opnames = await fetchAllRows('stock_opname', 'id, opname_number, date, created_at')
  console.log(`   ✓ Found ${opnames.length} opnames.`)

  let fixedOpCount = 0
  for (const op of opnames) {
    const targetTimestamp = resolvePreciseTimestamp(op.date, op.created_at)

    const { data: moves } = await supabase
      .from('stock_moves')
      .select('id, created_at')
      .or(`source_id.eq.${op.id},reference.eq.${op.opname_number}`)
      .eq('source_type', 'stock_opname')

    for (const m of moves || []) {
      if (m.created_at !== targetTimestamp) {
        await supabase
          .from('stock_moves')
          .update({ created_at: targetTimestamp })
          .eq('id', m.id)
        fixedOpCount++
      }
    }
  }
  console.log(`   ✓ Fixed timestamps for ${fixedOpCount} opname stock moves.\n`)

  // 3. Fix Order Stock Move Timestamps
  console.log('3. Auditing Order Stock Moves...')
  const orders = await fetchAllRows('orders', 'id, order_number, order_date, order_date_utc, raw_source_data, created_at')
  console.log(`   ✓ Found ${orders.length} orders.`)

  let fixedOrdCount = 0
  for (const ord of orders) {
    const raw = ord.raw_source_data || {}
    let targetTimestamp = ''
    if (raw.date_shipped_gmt) targetTimestamp = new Date(raw.date_shipped_gmt + 'Z').toISOString()
    else if (raw.date_shipped) targetTimestamp = new Date(raw.date_shipped).toISOString()
    else if (raw.date_paid_gmt) targetTimestamp = new Date(raw.date_paid_gmt + 'Z').toISOString()
    else if (raw.date_paid) targetTimestamp = new Date(raw.date_paid).toISOString()
    else if (raw.date_completed_gmt) targetTimestamp = new Date(raw.date_completed_gmt + 'Z').toISOString()
    else if (raw.date_completed) targetTimestamp = new Date(raw.date_completed).toISOString()
    else targetTimestamp = resolvePreciseTimestamp(ord.order_date_utc || ord.order_date, ord.created_at)

    const refStr = ord.order_number ? (String(ord.order_number).startsWith('Order #') ? ord.order_number : `Order #${ord.order_number}`) : `ORD-${ord.id.slice(0, 6)}`

    const { data: moves } = await supabase
      .from('stock_moves')
      .select('id, created_at')
      .or(`source_id.eq.${ord.id},reference.eq.${refStr},reference.eq.${ord.order_number}`)
      .eq('source_type', 'order')

    for (const m of moves || []) {
      if (m.created_at !== targetTimestamp) {
        await supabase
          .from('stock_moves')
          .update({ created_at: targetTimestamp })
          .eq('id', m.id)
        fixedOrdCount++
      }
    }
  }
  console.log(`   ✓ Fixed timestamps for ${fixedOrdCount} order stock moves.\n`)

  console.log('========================================================================')
  console.log('   TIMESTAMP SINKRONISASI SELESAI DENGAN SUKSES!')
  console.log('========================================================================')
}

fixMoveTimestamps().catch(console.error)
