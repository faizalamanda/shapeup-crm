import { createClient } from '@supabase/supabase-js'
import * as fs from 'fs'
import * as path from 'path'
import { syncOrderToLedger } from './lib/orderLedger'

// Read env file manually
const envPath = path.join('/home/faiz-jazuli/shapeup-crm', '.env.local')
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

const supabaseUrl = env.NEXT_PUBLIC_SUPABASE_URL
const supabaseServiceKey = env.SUPABASE_SERVICE_ROLE_KEY

const supabase = createClient(supabaseUrl, supabaseServiceKey)
const businessId = '097211f4-2d19-4196-a7b7-5b2cd17c2588' // Alamanda

async function run() {
  console.log(`Starting migration for business: ${businessId}...`)

  // 1. Delete all products for Alamanda only if --clear-products flag is passed
  const clearProducts = process.argv.includes('--clear-products')
  if (clearProducts) {
    console.log('Deleting products for Alamanda to allow rebuilding stock and HPP...')
    const { error: delProdErr } = await supabase
      .from('products')
      .delete()
      .eq('business_id', businessId)

    if (delProdErr) {
      console.error('Failed to delete products:', delProdErr)
      return
    }
    console.log('Successfully deleted existing products.')
  } else {
    console.log('Preserving existing products. Existing products will retain their database HPP (cost_price) values.')
  }

  // 2. Fetch transactions for Alamanda to delete
  const { data: txs, error: fetchTxErr } = await supabase
    .from('transactions')
    .select('id')
    .eq('business_id', businessId)

  if (fetchTxErr) {
    console.error('Failed to fetch transactions:', fetchTxErr)
    return
  }

  const txIds = txs?.map(t => t.id) || []
  console.log(`Found ${txIds.length} transactions to delete.`)

  if (txIds.length > 0) {
    console.log('Deleting transactions (and cascade deleting journal lines)...')
    const { error: delTxErr } = await supabase
      .from('transactions')
      .delete()
      .eq('business_id', businessId)

    if (delTxErr) {
      console.error('Failed to delete transactions:', delTxErr)
      return
    }

    console.log('Successfully cleared old transactions and journal lines.')
  }

  // 3. Fetch all orders for Alamanda that should have ledger entries using pagination
  console.log('Fetching all orders with target statuses (paginated)...')
  const targetStatuses = ['processing', 'shipped', 'completed', 'cancelled', 'failed', 'refunded', 'returned']
  const orders: any[] = []
  const limit = 1000
  let offset = 0
  let hasMore = true

  while (hasMore) {
    const { data, error } = await supabase
      .from('orders')
      .select('id, order_number, status')
      .eq('business_id', businessId)
      .in('status', targetStatuses)
      .range(offset, offset + limit - 1)
      .order('order_number', { ascending: false })

    if (error) {
      console.error('Failed to fetch orders page:', error)
      return
    }

    if (!data || data.length === 0) {
      hasMore = false
    } else {
      orders.push(...data)
      offset += limit
      if (data.length < limit) {
        hasMore = false
      }
    }
  }

  console.log(`Found ${orders.length} orders to re-sync.`)

  let successCount = 0
  let failCount = 0
  const startTime = Date.now()

  for (let i = 0; i < orders.length; i++) {
    const order = orders[i]
    const currentNum = i + 1
    const percent = ((currentNum / orders.length) * 100).toFixed(2)
    
    // ETA calculation
    const elapsed = Date.now() - startTime
    const avgTimePerOrder = elapsed / currentNum
    const remainingOrders = orders.length - currentNum
    const remainingMs = avgTimePerOrder * remainingOrders
    
    let etaStr = 'Calculating...'
    if (currentNum > 3) {
      const remainingSec = Math.ceil(remainingMs / 1000)
      if (remainingSec > 60) {
        const mins = Math.floor(remainingSec / 60)
        const secs = remainingSec % 60
        etaStr = `${mins}m ${secs}s`
      } else {
        etaStr = `${remainingSec}s`
      }
    }

    console.log(`[${currentNum}/${orders.length}] (${percent}%) - ETA: ${etaStr} | Syncing order #${order.order_number} (Status: ${order.status})...`)
    
    try {
      const res = await syncOrderToLedger(order.id, supabase)
      if (res.success) {
        successCount++
      } else {
        console.error(`Failed to sync order #${order.order_number}:`, res.message)
        failCount++
      }
    } catch (e: any) {
      console.error(`Exception syncing order #${order.order_number}:`, e.message)
      failCount++
    }
  }

  console.log('Migration finished!')
  console.log(`Successful syncs: ${successCount}`)
  console.log(`Failed syncs: ${failCount}`)
}

run()
