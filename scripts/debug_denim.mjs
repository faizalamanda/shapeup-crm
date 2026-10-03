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

async function debugDenim() {
  const productId = '2399caa1-72be-408c-a77c-9f6fa98f352b' // Kardigan Rajut Oversize - Denim

  const { data: prod } = await supabase.from('products').select('*').eq('id', productId).single()
  console.log('--- PRODUCT DATA ---')
  console.log('ID:', prod.id)
  console.log('Name:', prod.name)
  console.log('stock_quantity in DB:', prod.stock_quantity)

  const { data: ledger } = await supabase
    .from('v_stock_moves_ledger')
    .select('*')
    .eq('product_id', productId)
    .order('created_at', { ascending: false })

  console.log('\n--- V_STOCK_MOVES_LEDGER (Top 5) ---')
  console.table(ledger?.slice(0, 5).map(m => ({
    created_at: m.created_at,
    reference: m.reference,
    type: m.type,
    origin_location_id: m.origin_location_id,
    destination_location_id: m.destination_location_id,
    qty: m.qty,
    system_stock: m.system_stock,
    status: m.status
  })))

  const { data: rawMoves } = await supabase
    .from('stock_moves')
    .select('*')
    .eq('product_id', productId)

  console.log(`\nTotal stock_moves count for Denim: ${rawMoves?.length || 0}`)

  let statusMap = {}
  let typeMap = {}
  let calcSum = 0

  for (const m of rawMoves || []) {
    statusMap[m.status] = (statusMap[m.status] || 0) + 1
    typeMap[m.type] = (typeMap[m.type] || 0) + 1

    if (m.status === 'done') {
      if (m.type === 'receipt' || m.type === 'refund') {
        calcSum += Number(m.qty)
      } else if (m.type === 'delivery') {
        calcSum -= Number(m.qty)
      } else if (m.type === 'adjustment') {
        if (!m.origin_location_id || (m.destination_location_id && !m.origin_location_id)) {
          calcSum += Number(m.qty)
        } else {
          calcSum -= Number(m.qty)
        }
      }
    }
  }

  console.log('Status breakdown:', statusMap)
  console.log('Type breakdown:', typeMap)
  console.log('Calculated net sum (status=done):', calcSum)
}

debugDenim().catch(console.error)
