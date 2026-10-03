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

async function fixStocks() {
  console.log('--- SYNCING PRODUCTS.STOCK_QUANTITY FROM STOCK_MOVES LEDGER ---')

  const { data: prods, error: pErr } = await supabase.from('products').select('id, name, stock_quantity')
  if (pErr) throw pErr

  let fixedCount = 0

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
      const { error: uErr } = await supabase
        .from('products')
        .update({ stock_quantity: movesSum, updated_at: new Date().toISOString() })
        .eq('id', p.id)

      if (!uErr) {
        fixedCount++
        console.log(`Updated ${p.name}: stock_quantity was ${p.stock_quantity}, now fixed to ${movesSum}`)
      } else {
        console.error(`Error updating ${p.name}:`, uErr.message)
      }
    }
  }

  console.log(`\nSuccessfully fixed ${fixedCount} products!`)
}

fixStocks().catch(console.error)
