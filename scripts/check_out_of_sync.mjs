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

async function checkSync() {
  const { data: prods } = await supabase.from('products').select('id, name, stock_quantity, business_id')
  console.log(`Total products to audit: ${prods?.length || 0}`)

  let mismatched = 0

  for (const p of prods || []) {
    const { data: moves } = await supabase
      .from('stock_moves')
      .select('qty, type, status, origin_location_id, destination_location_id')
      .eq('product_id', p.id)
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

    if (Number(p.stock_quantity || 0) !== movesSum) {
      mismatched++
      console.log(`[MISMATCH] ${p.name} (ID: ${p.id}): products.stock_quantity=${p.stock_quantity}, stock_moves sum=${movesSum}`)
    }
  }

  console.log(`\nAudit finished: ${mismatched} products out of sync.`)
}

checkSync().catch(console.error)
