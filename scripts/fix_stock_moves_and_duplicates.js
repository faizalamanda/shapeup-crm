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

async function fixStockMoves() {
  const headers = {
    'apikey': env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    'Authorization': 'Bearer ' + env.SUPABASE_SERVICE_ROLE_KEY,
    'Content-Type': 'application/json'
  }

  const url = env.NEXT_PUBLIC_SUPABASE_URL

  console.log("🚀 1. CLEANING UP DUPLICATE STOCK MOVES IN DATABASE...")

  // Fetch all stock_moves
  let allMoves = []
  let page = 0
  while (true) {
    const res = await fetch(`${url}/rest/v1/stock_moves?select=id,business_id,product_id,reference,type,qty,created_at,source_type,source_id&order=created_at.asc&limit=1000&offset=${page * 1000}`, { headers }).then(r => r.json())
    if (!Array.isArray(res) || res.length === 0) break
    allMoves.push(...res)
    if (res.length < 1000) break
    page++
  }

  console.log(`Total stock_moves in database: ${allMoves.length}`)

  // Deduplicate strategy:
  // Group by business_id + product_id + reference + type
  const groupMap = new Map()
  allMoves.forEach(m => {
    const key = `${m.business_id}_${m.product_id}_${m.reference}_${m.type}`
    if (!groupMap.has(key)) groupMap.set(key, [])
    groupMap.get(key).push(m)
  })

  const idsToDelete = []
  groupMap.forEach((moves, key) => {
    if (moves.length > 1) {
      // Keep 1 move (preferably one with source_type if present, else oldest)
      moves.sort((a, b) => {
        if (a.source_type && !b.source_type) return -1
        if (!a.source_type && b.source_type) return 1
        return new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
      })
      const primary = moves[0]
      const duplicates = moves.slice(1)
      duplicates.forEach(d => idsToDelete.push(d.id))
    }
  })

  console.log(`Found ${idsToDelete.length} duplicate stock_moves rows to delete.`)

  if (idsToDelete.length > 0) {
    const batchSize = 100
    for (let i = 0; i < idsToDelete.length; i += batchSize) {
      const batch = idsToDelete.slice(i, i + batchSize)
      const delRes = await fetch(`${url}/rest/v1/stock_moves?id=in.(${batch.join(',')})`, {
        method: 'DELETE',
        headers
      })
      if (delRes.ok) {
        console.log(`Deleted batch of ${batch.length} duplicates.`)
      } else {
        console.error(`Failed to delete batch:`, await delRes.text())
      }
    }
  }

  console.log("\n🚀 2. BACKFILLING MISSING STOCK OPNAMES INTO stock_moves...")

  // Fetch all stock_opname
  const resOpnames = await fetch(`${url}/rest/v1/stock_opname?select=*`, { headers }).then(r => r.json())
  console.log(`Fetched ${resOpnames.length} stock_opnames.`)

  // Fetch remaining stock_moves references
  const { data: currentMoves } = await fetch(`${url}/rest/v1/stock_moves?select=reference,product_id,type`, { headers }).then(r => r.json())
  const existingSet = new Set((currentMoves || []).map(m => `${m.reference}_${m.product_id}_${m.type}`))

  const newOpnameMoves = []
  ;(resOpnames || []).forEach(op => {
    const items = Array.isArray(op.items_json) ? op.items_json : []
    const ref = op.opname_number || `OPN-${op.id.slice(0, 6)}`
    const date = op.date || op.created_at

    items.forEach(item => {
      const pId = item.product_id || item.id
      if (!pId) return
      const diff = (parseFloat(item.actual_quantity) || 0) - (parseFloat(item.recorded_quantity) || 0)
      if (diff === 0) return

      const key = `${ref}_${pId}_adjustment`
      if (!existingSet.has(key)) {
        existingSet.add(key)
        newOpnameMoves.push({
          business_id: op.business_id,
          product_id: pId,
          reference: ref,
          qty: Math.abs(diff),
          unit_cost: 0,
          status: 'done',
          type: 'adjustment',
          source_type: 'stock_opname',
          source_id: op.id,
          origin_location_id: diff < 0 ? 'wh-main' : null,
          destination_location_id: diff >= 0 ? 'wh-main' : null,
          created_at: date ? new Date(date).toISOString() : op.created_at
        })
      }
    })
  })

  console.log(`Found ${newOpnameMoves.length} missing opname stock_moves to insert.`)

  if (newOpnameMoves.length > 0) {
    const insRes = await fetch(`${url}/rest/v1/stock_moves`, {
      method: 'POST',
      headers,
      body: JSON.stringify(newOpnameMoves)
    })
    if (insRes.ok) {
      console.log(`Successfully inserted ${newOpnameMoves.length} opname stock_moves!`)
    } else {
      console.error(`Failed to insert opname stock_moves:`, await insRes.text())
    }
  }

  console.log("\n🎉 Clean up & Backfill finished!")
}

fixStockMoves().catch(console.error)
