const fs = require('fs')
const path = require('path')

const envPath = path.join(__dirname, '..', '.env.local')
const envContent = fs.readFileSync(envPath, 'utf8')
const env = {}
envContent.split('\n').forEach(line => {
  const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/)
  if (match) {
    const key = match[1]
    let value = match[2] || ''
    if (value.length > 0 && value.charAt(0) === '"' && value.charAt(value.length - 1) === '"') {
      value = value.replace(/^"|"/g, '')
    }
    env[key] = value
  }
})

const isUuid = (str) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(str || ''))

async function backfillStockMoves() {
  const headers = {
    'apikey': env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    'Authorization': 'Bearer ' + env.SUPABASE_SERVICE_ROLE_KEY,
    'Content-Type': 'application/json',
    'Prefer': 'return=minimal'
  }

  console.log('🚀 Memulai Backfill Data Histori ke Tabel stock_moves...\n')

  const [resProds, resPurchases, resOrders, resOpnames] = await Promise.all([
    fetch(env.NEXT_PUBLIC_SUPABASE_URL + '/rest/v1/products?select=id,name,sku,cost_price', { headers }).then(r => r.json()),
    fetch(env.NEXT_PUBLIC_SUPABASE_URL + '/rest/v1/purchases?select=id,business_id,purchase_number,payment_status,items_json,date,created_at', { headers }).then(r => r.json()),
    fetch(env.NEXT_PUBLIC_SUPABASE_URL + '/rest/v1/orders?select=id,business_id,order_number,status,items_json,order_date,created_at', { headers }).then(r => r.json()),
    fetch(env.NEXT_PUBLIC_SUPABASE_URL + '/rest/v1/stock_opname?select=id,business_id,opname_number,items_json,date,created_at', { headers }).then(r => r.json()),
  ])

  const prodMap = new Map()
  ;(resProds || []).forEach(p => {
    prodMap.set(String(p.id), p)
    if (p.sku) prodMap.set(String(p.sku).toLowerCase(), p)
    if (p.name) prodMap.set(String(p.name).toLowerCase(), p)
  })

  // Fetch existing stock_moves to avoid duplicates
  const resExisting = await fetch(env.NEXT_PUBLIC_SUPABASE_URL + '/rest/v1/stock_moves?select=reference,product_id,type', { headers })
  const existingMoves = await resExisting.json()
  const existingKeySet = new Set((existingMoves || []).map(e => `${e.reference}_${e.product_id}_${e.type}`))

  const newMoveRows = []

  // 1. Process Purchases
  ;(resPurchases || []).forEach(p => {
    const items = Array.isArray(p.items_json) ? p.items_json : []
    const ref = p.purchase_number || `PO-${p.id.slice(0, 6)}`
    const date = p.date || p.created_at

    items.forEach(item => {
      const pIdRaw = String(item.product_id || item.id || '')
      const prod = prodMap.get(pIdRaw) || prodMap.get(String(item.sku || '').toLowerCase()) || prodMap.get(String(item.name || '').toLowerCase())
      const pId = prod ? prod.id : (isUuid(pIdRaw) ? pIdRaw : null)

      if (!pId || !isUuid(pId)) return

      const key = `${ref}_${pId}_receipt`
      if (!existingKeySet.has(key)) {
        existingKeySet.add(key)
        newMoveRows.push({
          business_id: p.business_id,
          product_id: pId,
          reference: ref,
          qty: parseFloat(item.quantity || item.qty || 1) || 1,
          unit_cost: parseFloat(item.unit_price || item.price || (prod?.cost_price || 0)) || 0,
          status: p.payment_status === 'paid' ? 'done' : 'pending',
          type: 'receipt',
          created_at: date
        })
      }
    })
  })

  // 2. Process Orders
  ;(resOrders || []).forEach(o => {
    const items = Array.isArray(o.items_json) ? o.items_json : []
    const ref = o.order_number || `ORD-${o.id.slice(0, 6)}`
    const date = o.order_date || o.created_at
    const isDone = ['completed', 'shipped', 'delivered', 'done'].includes((o.status || '').toLowerCase())

    items.forEach(item => {
      const pIdRaw = String(item.product_id || item.id || '')
      const prod = prodMap.get(pIdRaw) || prodMap.get(String(item.sku || '').toLowerCase()) || prodMap.get(String(item.name || '').toLowerCase())
      const pId = prod ? prod.id : (isUuid(pIdRaw) ? pIdRaw : null)

      if (!pId || !isUuid(pId)) return

      const key = `${ref}_${pId}_delivery`
      if (!existingKeySet.has(key)) {
        existingKeySet.add(key)
        newMoveRows.push({
          business_id: o.business_id,
          product_id: pId,
          reference: ref,
          qty: parseFloat(item.quantity || item.qty || 1) || 1,
          unit_cost: prod?.cost_price || 0,
          status: isDone ? 'done' : 'pending',
          type: 'delivery',
          created_at: date
        })
      }
    })
  })

  // 3. Process Stock Opnames
  ;(resOpnames || []).forEach(op => {
    const items = Array.isArray(op.items_json) ? op.items_json : []
    const ref = op.opname_number || `OPN-${op.id.slice(0, 6)}`
    const date = op.date || op.created_at

    items.forEach(item => {
      const pIdRaw = String(item.product_id || item.id || '')
      const prod = prodMap.get(pIdRaw) || prodMap.get(String(item.name || '').toLowerCase())
      const pId = prod ? prod.id : (isUuid(pIdRaw) ? pIdRaw : null)

      if (!pId || !isUuid(pId)) return

      const diff = (parseFloat(item.actual_quantity) || 0) - (parseFloat(item.recorded_quantity) || 0)
      const key = `${ref}_${pId}_adjustment`

      if (Math.abs(diff) > 0 && !existingKeySet.has(key)) {
        existingKeySet.add(key)
        newMoveRows.push({
          business_id: op.business_id,
          product_id: pId,
          reference: ref,
          qty: Math.abs(diff),
          unit_cost: prod?.cost_price || 0,
          status: 'done',
          type: 'adjustment',
          created_at: date
        })
      }
    })
  })

  console.log(`Menemukan ${newMoveRows.length} baris mutasi histori valid yang perlu di-backfill.`)

  if (newMoveRows.length === 0) {
    console.log('✅ Semua data histori sudah terisi di tabel stock_moves.')
    return
  }

  const batchSize = 100
  let successCount = 0
  for (let i = 0; i < newMoveRows.length; i += batchSize) {
    const chunk = newMoveRows.slice(i, i + batchSize)
    const res = await fetch(env.NEXT_PUBLIC_SUPABASE_URL + '/rest/v1/stock_moves', {
      method: 'POST',
      headers,
      body: JSON.stringify(chunk)
    })
    if (res.status < 300) {
      successCount += chunk.length
    } else {
      const txt = await res.text()
      console.error(`Batch ${Math.floor(i / batchSize) + 1} Error:`, txt)
    }
  }

  console.log(`\n🎉 Selesai! Berhasil menginsert ${successCount} data mutasi histori ke tabel stock_moves.`)
}

backfillStockMoves()
