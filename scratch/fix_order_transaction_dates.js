const { createClient } = require('@supabase/supabase-js')
const fs = require('fs')
const path = require('path')

const envPath = path.join(__dirname, '..', '.env.local')
const envContent = fs.readFileSync(envPath, 'utf8')
const env = {}
envContent.split('\n').forEach(line => {
  const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/)
  if (match) {
    let value = match[2] || ''
    if (value.length > 0 && value.charAt(0) === '"' && value.charAt(value.length - 1) === '"') {
      value = value.replace(/^"|"/g, '')
    }
    env[match[1]] = value
  }
})

const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)

async function fixWooCommerceTransactionDates() {
  console.log('Fetching WooCommerce Sales Transactions with mismatched dates...')

  let updatedCount = 0
  let page = 0
  const limit = 200

  while (true) {
    const { data: txs, error } = await supabase
      .from('transactions')
      .select('id, date, description, order_id, orders!order_id(id, order_number, order_date_utc)')
      .not('order_id', 'is', null)
      .ilike('description', 'Penjualan WooCommerce%')
      .range(page * limit, (page + 1) * limit - 1)

    if (error) {
      console.error('Error fetching transactions batch:', error.message)
      break
    }

    if (!txs || txs.length === 0) break

    for (const tx of txs) {
      const o = tx.orders
      if (o && o.order_date_utc && tx.date !== o.order_date_utc) {
        const { error: upErr } = await supabase
          .from('transactions')
          .update({ date: o.order_date_utc })
          .eq('id', tx.id)

        if (upErr) {
          console.error(`Failed to update transaction ${tx.id}: ${upErr.message}`)
        } else {
          updatedCount++
        }
      }
    }

    console.log(`Processed batch ${page + 1}, total updated so far: ${updatedCount}`)
    page++
    if (txs.length < limit) break
  }

  console.log(`Successfully fixed ${updatedCount} WooCommerce sales transaction dates!`)
}

fixWooCommerceTransactionDates()
