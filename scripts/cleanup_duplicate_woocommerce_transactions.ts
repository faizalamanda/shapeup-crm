import { createClient } from '@supabase/supabase-js'
import fs from 'fs'
import path from 'path'

const envPath = path.resolve(process.cwd(), '.env.local')
const envConfig = fs.readFileSync(envPath, 'utf8')
const envMap: Record<string, string> = {}
envConfig.split('\n').forEach(line => {
  const [k, ...rest] = line.split('=')
  if (k && rest.length) envMap[k.trim()] = rest.join('=').trim().replace(/^["']|["']$/g, '')
})

const supabase = createClient(envMap.NEXT_PUBLIC_SUPABASE_URL, envMap.SUPABASE_SERVICE_ROLE_KEY)

async function cleanupDuplicateTransactions() {
  console.log('=== STARTING WOOCOMMERCE TRANSACTION DEDUPLICATION ===')

  // 1. Fetch all Penjualan WooCommerce transactions
  let allSales: any[] = []
  let from = 0
  const limit = 1000
  while (true) {
    const { data } = await supabase
      .from('transactions')
      .select('id, order_id, description, date, journal_lines(id)')
      .ilike('description', 'Penjualan WooCommerce%')
      .range(from, from + limit - 1)

    if (!data || data.length === 0) break
    allSales = allSales.concat(data)
    from += limit
    if (data.length < limit) break
  }

  console.log(`Fetched ${allSales.length} Penjualan transactions.`)

  const salesByOrder = new Map<string, any[]>()
  allSales.forEach(t => {
    if (!t.order_id) return
    if (!salesByOrder.has(t.order_id)) salesByOrder.set(t.order_id, [])
    salesByOrder.get(t.order_id)!.push(t)
  })

  let salesDeletedCount = 0

  for (const [orderId, txList] of salesByOrder.entries()) {
    if (txList.length > 1) {
      // Sort: prioritize transactions that have lines
      const sorted = [...txList].sort((a, b) => (b.journal_lines?.length || 0) - (a.journal_lines?.length || 0))
      // Keep the first one, delete the rest
      const [keep, ...duplicates] = sorted

      for (const dupe of duplicates) {
        // Delete lines first (if any)
        await supabase.from('journal_lines').delete().eq('transaction_id', dupe.id)
        // Delete transaction header
        const { error } = await supabase.from('transactions').delete().eq('id', dupe.id)
        if (!error) {
          salesDeletedCount++
        } else {
          console.warn(`Failed to delete duplicate tx ${dupe.id}:`, error.message)
        }
      }
    }
  }

  console.log(`Deleted ${salesDeletedCount} duplicate Penjualan transactions.`)

  // 2. Fetch all Pembayaran WooCommerce transactions
  let allPayments: any[] = []
  from = 0
  while (true) {
    const { data } = await supabase
      .from('transactions')
      .select('id, order_id, description, date, journal_lines(id)')
      .ilike('description', 'Pembayaran WooCommerce%')
      .range(from, from + limit - 1)

    if (!data || data.length === 0) break
    allPayments = allPayments.concat(data)
    from += limit
    if (data.length < limit) break
  }

  console.log(`Fetched ${allPayments.length} Pembayaran transactions.`)

  const payByOrder = new Map<string, any[]>()
  allPayments.forEach(t => {
    if (!t.order_id) return
    if (!payByOrder.has(t.order_id)) payByOrder.set(t.order_id, [])
    payByOrder.get(t.order_id)!.push(t)
  })

  let payDeletedCount = 0

  for (const [orderId, txList] of payByOrder.entries()) {
    if (txList.length > 1) {
      const sorted = [...txList].sort((a, b) => (b.journal_lines?.length || 0) - (a.journal_lines?.length || 0))
      const [keep, ...duplicates] = sorted

      // Re-point order_payments to keep.id if any points to duplicate
      const dupeIds = duplicates.map(d => d.id)
      await supabase
        .from('order_payments')
        .update({ transaction_id: keep.id })
        .in('transaction_id', dupeIds)

      for (const dupe of duplicates) {
        await supabase.from('journal_lines').delete().eq('transaction_id', dupe.id)
        const { error } = await supabase.from('transactions').delete().eq('id', dupe.id)
        if (!error) {
          payDeletedCount++
        }
      }
    }
  }

  console.log(`Deleted ${payDeletedCount} duplicate Pembayaran transactions.`)
  console.log('=== DEDUPLICATION COMPLETED ===')
}

cleanupDuplicateTransactions().catch(console.error)
