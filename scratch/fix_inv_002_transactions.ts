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

async function fixInv002() {
  console.log('--- Cleaning Up & Re-syncing INV-29082026-002 ---')

  const { data: orders, error: oErr } = await supabase
    .from('orders')
    .select('id, order_number, status')
    .ilike('order_number', '%INV-29082026-002%')

  if (oErr || !orders) {
    console.error('Error fetching orders:', oErr)
    return
  }

  for (const ord of orders) {
    console.log(`Cleaning existing transactions for #${ord.order_number} (${ord.id}, Status: ${ord.status})...`)
    const { data: txs } = await supabase.from('transactions').select('id').eq('order_id', ord.id)
    if (txs && txs.length > 0) {
      const txIds = txs.map(t => t.id)
      await supabase.from('journal_lines').delete().in('transaction_id', txIds)
      await supabase.from('transactions').delete().eq('order_id', ord.id)
    }

    console.log(`Re-syncing Order #${ord.order_number}...`)
    const syncRes = await syncOrderToLedger(ord.id, supabase)
    console.log('Sync Result:', syncRes)

    const { data: newTxs } = await supabase
      .from('transactions')
      .select(`
        id,
        date,
        description,
        journal_lines (
          id,
          debit,
          credit,
          accounts (
            code,
            name
          )
        )
      `)
      .eq('order_id', ord.id)

    console.log(`\nResulting Ledger Transactions for #${ord.order_number}:`)
    console.dir(newTxs, { depth: null })
  }
}

fixInv002()
