const { createClient } = require('@supabase/supabase-js')
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

const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)

async function fixOrphanedInvoices() {
  console.log('--- Cleaning Up & Re-syncing Invoice Ledger Transactions ---')

  // Find order INV-29082026-001
  const { data: orders, error: oErr } = await supabase
    .from('orders')
    .select('id, order_number, business_id, status')
    .ilike('order_number', '%INV-29082026-001%')

  if (oErr) {
    console.error('Error fetching order:', oErr)
    return
  }

  console.log('Found matching orders:', orders.length)

  for (const ord of orders) {
    console.log(`Processing Order #${ord.order_number} (ID: ${ord.id}, Status: ${ord.status})...`)

    // Find transactions associated with this order
    const { data: txs } = await supabase
      .from('transactions')
      .select('id, description')
      .eq('order_id', ord.id)

    if (txs && txs.length > 0) {
      for (const tx of txs) {
        // Check if transaction has journal lines
        const { data: lines } = await supabase
          .from('journal_lines')
          .select('id')
          .eq('transaction_id', tx.id)

        if (!lines || lines.length === 0) {
          console.log(`Deleting empty transaction header: "${tx.description}" (ID: ${tx.id})...`)
          await supabase.from('transactions').delete().eq('id', tx.id)
        }
      }
    }
  }

  console.log('\nDone cleaning empty transactions. Now re-running syncOrderToLedger...')
  // Re-sync using orderLedger module via tsx
}

fixOrphanedInvoices()
