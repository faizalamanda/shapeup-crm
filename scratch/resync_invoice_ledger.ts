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

async function resyncInvoices() {
  console.log('--- Re-syncing Invoice Orders to Ledger ---')

  const { data: orders, error: oErr } = await supabase
    .from('orders')
    .select('id, order_number, status')
    .ilike('order_number', '%INV-29082026-001%')

  if (oErr || !orders) {
    console.error('Error fetching orders:', oErr)
    return
  }

  for (const ord of orders) {
    console.log(`Re-syncing Order #${ord.order_number} (${ord.id})...`)
    const res = await syncOrderToLedger(ord.id, supabase)
    console.log(`Sync Result for #${ord.order_number}:`, res)
  }

  console.log('\nVerifying generated ledger transactions & journal lines:')
  for (const ord of orders) {
    const { data: txs } = await supabase
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

    console.log(`\nTransactions for Order #${ord.order_number}:`)
    console.dir(txs, { depth: null })
  }
}

resyncInvoices()
