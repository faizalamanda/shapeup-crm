import { createClient } from '@supabase/supabase-js'
import fs from 'fs'
import path from 'path'
import { syncOrderToLedger } from '../lib/orderLedger'

const envPath = path.join(__dirname, '..', '.env.local')
const envContent = fs.readFileSync(envPath, 'utf8')
const env: Record<string, string> = {}
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

const supabase = createClient(
  env.NEXT_PUBLIC_SUPABASE_URL,
  env.SUPABASE_SERVICE_ROLE_KEY
)

async function testPosCheckout() {
  console.log('--- Testing POS Order Ledger Sync ---')
  
  // Find latest POS order
  const { data: posOrders, error: posErr } = await supabase
    .from('orders')
    .select('id, order_number, status')
    .eq('source_platform', 'POS')
    .order('created_at', { ascending: false })
    .limit(3)

  if (posErr || !posOrders || posOrders.length === 0) {
    console.error('No POS order found to test:', posErr)
    return
  }

  for (const posOrd of posOrders) {
    console.log(`Testing POS Sync for Order #${posOrd.order_number} (${posOrd.id})...`)
    const res = await syncOrderToLedger(posOrd.id, supabase)
    console.log(`POS Sync Result:`, res)

    const { data: txs } = await supabase
      .from('transactions')
      .select('id, description, journal_lines(id, debit, credit, account_id)')
      .eq('order_id', posOrd.id)

    console.log(`Transactions found for POS Order #${posOrd.order_number}:`, txs?.length || 0)
    txs?.forEach(t => {
      console.log(` - TX: "${t.description}", lines count: ${t.journal_lines?.length}`)
    })
  }
}

testPosCheckout()
