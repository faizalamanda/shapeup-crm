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

async function run() {
  const productId = '518db35d-43d7-487a-841a-862f0871b5f4' // Kardigan Rajut Oversize - Maroon

  const { data: prod } = await supabase.from('products').select('*').eq('id', productId).single()
  console.log('--- PRODUCT TABLE ---')
  console.log('Name:', prod.name, '| stock_quantity:', prod.stock_quantity)

  const { data: ledger } = await supabase
    .from('v_stock_moves_ledger')
    .select('*')
    .eq('product_id', productId)
    .order('created_at', { ascending: false })

  console.log('\n--- V_STOCK_MOVES_LEDGER (Top 10) ---')
  console.table(ledger?.slice(0, 10).map(m => ({
    time: m.created_at,
    ref: m.reference,
    type: m.type,
    origin: m.origin_location_id,
    dest: m.destination_location_id,
    qty: m.qty,
    system_stock: m.system_stock
  })))

  const { data: rawMoves } = await supabase
    .from('stock_moves')
    .select('*')
    .eq('product_id', productId)
    .order('created_at', { ascending: true })

  let calculatedStock = 0
  for (const m of rawMoves || []) {
    let delta = 0
    if (m.type === 'receipt' || m.type === 'refund') {
      delta = Number(m.qty)
    } else if (m.type === 'delivery') {
      delta = -Number(m.qty)
    } else if (m.type === 'adjustment') {
      if (!m.origin_location_id || (m.destination_location_id && !m.origin_location_id)) {
        delta = Number(m.qty)
      } else {
        delta = -Number(m.qty)
      }
    }
    calculatedStock += delta
  }

  console.log('\nCalculated Stock from all raw moves sum:', calculatedStock)
}

run().catch(console.error)
