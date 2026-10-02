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

const supabase = createClient(supabaseUrl, supabaseServiceKey)

async function checkKardiganSum() {
  const prodId = '2399caa1-72be-408c-a77c-9f6fa98f352b' // Kardigan Rajut Oversize - Denim

  const { data: prod } = await supabase.from('products').select('*').eq('id', prodId).single()
  console.log('Product:', prod.name, '| DB stock_quantity:', prod.stock_quantity)

  const { data: moves } = await supabase
    .from('stock_moves')
    .select('*')
    .eq('product_id', prodId)
    .order('created_at', { ascending: true }) // Oldest first

  console.log(`Total Moves in DB for this product: ${moves?.length || 0}`)

  let forwardStock = 0
  let doneCount = 0
  let cancelledCount = 0

  console.log('\n--- CHRONOLOGICAL MOVES (OLDEST TO NEWEST) ---')
  for (let i = 0; i < (moves?.length || 0); i++) {
    const m = moves[i]
    let delta = 0
    if (m.status !== 'cancelled') {
      if (m.type === 'receipt' || m.type === 'refund') delta = Number(m.qty || 0)
      else if (m.type === 'delivery') delta = -Number(m.qty || 0)
      else if (m.type === 'adjustment') {
        const isIncrease = !m.origin_location_id || (m.destination_location_id && !m.origin_location_id)
        delta = isIncrease ? Number(m.qty || 0) : -Number(m.qty || 0)
      }
      forwardStock += delta
      doneCount++
    } else {
      cancelledCount++
    }

    if (i < 10 || i > (moves.length - 10) || m.type === 'adjustment') {
      console.log(`[${i+1}] ${m.created_at.slice(0, 10)} | Ref: ${m.reference} | Type: ${m.type} | Status: ${m.status} | Qty: ${m.qty} | Delta: ${delta} => Stock After: ${forwardStock}`)
    }
  }

  console.log(`\nFinal Forward Calculated Stock: ${forwardStock}`)
  console.log(`DB stock_quantity: ${prod.stock_quantity}`)
  console.log(`Active Moves Count: ${doneCount}, Cancelled Moves Count: ${cancelledCount}`)
}

checkKardiganSum().catch(console.error)
