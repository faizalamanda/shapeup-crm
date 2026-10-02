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

async function runDetailedAudit() {
  console.log('====================================================')
  console.log('   SHAPEUP CRM - FULL INVENTORY AUDIT & DUP CHECK   ')
  console.log('====================================================\n')

  const { data: businesses, error: bizErr } = await supabase.from('businesses').select('id, name')
  if (bizErr) {
    console.error('Failed to fetch businesses:', bizErr.message)
    return
  }

  for (const biz of businesses || []) {
    console.log(`Unit Bisnis: ${biz.name} (ID: ${biz.id})`)

    // 1. Check duplicate stock_moves in DB
    const { data: rawMoves } = await supabase
      .from('stock_moves')
      .select('id, business_id, product_id, reference, qty, type, status, source_type, source_id, created_at')
      .eq('business_id', biz.id)

    const movesList = rawMoves || []
    const seenMoves = new Map()
    const duplicateIds = []

    for (const m of movesList) {
      // Key by source or reference
      const key = m.source_type && m.source_id 
        ? `${m.product_id}_${m.source_type}_${m.source_id}_${m.type}`
        : `${m.product_id}_${m.reference}_${m.type}`
      
      if (seenMoves.has(key)) {
        duplicateIds.push(m.id)
      } else {
        seenMoves.set(key, m)
      }
    }

    console.log(`- Total Move History di DB: ${movesList.length}`)
    console.log(`- Data Mutasi Duplikat Ditemukan: ${duplicateIds.length}`)

    // 2. Check Order Date Fallbacks
    const { data: orders } = await supabase
      .from('orders')
      .select('id, order_number, status, raw_source_data, order_date, created_at')
      .eq('business_id', biz.id)

    let shippedDateCount = 0
    let processingDateCount = 0
    let completedDateCount = 0

    for (const ord of orders || []) {
      const raw = ord.raw_source_data || {}
      if (raw.date_shipped_gmt || raw.date_shipped) {
        shippedDateCount++
      } else if (raw.date_paid_gmt || raw.date_paid || ord.order_date) {
        processingDateCount++
      } else {
        completedDateCount++
      }
    }

    console.log(`- Total Pesanan/Orders: ${orders?.length || 0}`)
    console.log(`  └─ Menggunakan Tanggal Shipped: ${shippedDateCount}`)
    console.log(`  └─ Fallback Tanggal Processing/Paid: ${processingDateCount}`)
    console.log(`  └─ Fallback Tanggal Completed/Created: ${completedDateCount}`)

    console.log('----------------------------------------------------\n')
  }
}

runDetailedAudit().catch(console.error)
