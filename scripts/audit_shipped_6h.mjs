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

async function auditRecentOrders() {
  const sixHoursAgo = new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString()
  console.log(`Auditing orders updated/created since: ${sixHoursAgo}`)

  // Fetch recent shipped/completed/processing orders
  const { data: orders, error: ordErr } = await supabase
    .from('orders')
    .select('id, order_number, status, items_json, updated_at, created_at')
    .gte('updated_at', sixHoursAgo)
    .order('updated_at', { ascending: false })

  if (ordErr) {
    console.error('Error fetching orders:', ordErr.message)
    return
  }

  console.log(`Found ${orders?.length || 0} orders updated in the last 6 hours.`)

  const productIds = new Set()
  for (const ord of orders || []) {
    const items = Array.isArray(ord.items_json) ? ord.items_json : []
    for (const item of items) {
      if (item.product_id) productIds.add(item.product_id)
      if (item.id) productIds.add(item.id)
    }
  }

  console.log(`Found ${productIds.size} distinct products involved in recent orders.`)

  let mismatchedCount = 0

  for (const pId of Array.from(productIds)) {
    const { data: prod } = await supabase
      .from('products')
      .select('id, name, stock_quantity')
      .eq('id', pId)
      .maybeSingle()

    if (!prod) continue

    const { data: moves } = await supabase
      .from('stock_moves')
      .select('qty, type, status, origin_location_id, destination_location_id')
      .eq('product_id', pId)
      .eq('status', 'done')

    let movesSum = 0
    for (const m of moves || []) {
      if (m.type === 'receipt' || m.type === 'refund') {
        movesSum += Number(m.qty)
      } else if (m.type === 'delivery') {
        movesSum -= Number(m.qty)
      } else if (m.type === 'adjustment') {
        if (!m.origin_location_id || (m.destination_location_id && !m.origin_location_id)) {
          movesSum += Number(m.qty)
        } else {
          movesSum -= Number(m.qty)
        }
      }
    }

    if (Number(prod.stock_quantity || 0) !== movesSum) {
      mismatchedCount++
      console.log(`[MISMATCH FOUND] Product: "${prod.name}" (ID: ${prod.id})`)
      console.log(`  products.stock_quantity = ${prod.stock_quantity}`)
      console.log(`  stock_moves ledger sum = ${movesSum}\n`)
    }
  }

  console.log(`\nAudit complete. Mismatches found in recent products: ${mismatchedCount}`)
}

auditRecentOrders().catch(console.error)
