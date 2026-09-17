import { createClient } from '@supabase/supabase-js'
import { syncOrderToLedger } from '../lib/orderLedger'
import fs from 'fs'

const envContent = fs.readFileSync('.env.local', 'utf8')
const env: Record<string, string> = {}
envContent.split('\n').forEach(line => {
  const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/)
  if (match) env[match[1]] = (match[2] || '').replace(/^"|"$/g, '')
})

async function run() {
  const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)
  const { data: orders, error } = await supabase
    .from('orders')
    .select('id, order_number, status')
    .ilike('source_platform', '%Accurate%')

  if (error) {
    console.error('Error fetching orders:', error)
    return
  }

  console.log('Accurate orders count:', orders?.length)

  for (const o of orders || []) {
    console.log(`Syncing order #${o.order_number} (${o.id}), status: ${o.status}`)
    const res = await syncOrderToLedger(o.id, supabase)
    console.log('  Result:', res)
  }
}

run().catch(console.error)
