const { createClient } = require('@supabase/supabase-js')
const fs = require('fs')
const path = require('path')

// Read env file manually
const envPath = path.join('/home/faiz-jazuli/shapeup-crm', '.env.local')
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

const supabaseUrl = env.NEXT_PUBLIC_SUPABASE_URL
const supabaseServiceKey = env.SUPABASE_SERVICE_ROLE_KEY
const supabase = createClient(supabaseUrl, supabaseServiceKey)

const businessId = '097211f4-2d19-4196-a7b7-5b2cd17c2588' // Toko Alamanda

async function run() {
  console.log(`Starting historical payment date correction for business ID: ${businessId}...`)

  let txs = []
  let offset = 0
  const limit = 1000

  while (true) {
    console.log(`Fetching transactions range ${offset} to ${offset + limit - 1}...`)
    const { data, error } = await supabase
      .from('transactions')
      .select('id, date, description, order_id')
      .eq('business_id', businessId)
      .not('order_id', 'is', null)
      .like('description', 'Pembayaran %')
      .range(offset, offset + limit - 1)

    if (error) {
      console.error('Error fetching transactions:', error)
      return
    }

    if (!data || data.length === 0) {
      break
    }

    txs = txs.concat(data)
    if (data.length < limit) {
      break
    }
    offset += limit
  }

  console.log(`Found a total of ${txs.length} payment transactions to process.`)

  let updateCount = 0
  let skipCount = 0
  let errorCount = 0

  for (let i = 0; i < txs.length; i++) {
    const tx = txs[i]
    
    // Fetch order details including payment_method and raw_source_data
    const { data: order, error: orderError } = await supabase
      .from('orders')
      .select('order_date, payment_method, raw_source_data')
      .eq('id', tx.order_id)
      .single()

    if (orderError) {
      console.error(`Error fetching order ${tx.order_id} for tx ${tx.id}:`, orderError.message)
      errorCount++
      continue
    }

    if (!order) {
      console.log(`Skipping tx ${tx.id} (${tx.description}) - no order found.`)
      skipCount++
      continue
    }

    // Determine target payment date based on WooCommerce rules
    let targetDate = order.order_date || new Date().toISOString()
    const isCod = (order.payment_method || '').toUpperCase().includes('COD')
    const raw = order.raw_source_data || {}
    if (isCod) {
      if (raw.date_completed_gmt) {
        targetDate = new Date(raw.date_completed_gmt + 'Z').toISOString()
      } else if (raw.date_completed) {
        targetDate = new Date(raw.date_completed).toISOString()
      }
    } else {
      if (raw.date_paid_gmt) {
        targetDate = new Date(raw.date_paid_gmt + 'Z').toISOString()
      } else if (raw.date_paid) {
        targetDate = new Date(raw.date_paid).toISOString()
      }
    }

    const targetDateISO = new Date(targetDate).toISOString()
    const txDateISO = new Date(tx.date).toISOString()

    // If dates are different (ignoring formatting quirks)
    if (targetDateISO !== txDateISO) {
      const { error: updateError } = await supabase
        .from('transactions')
        .update({ date: targetDate })
        .eq('id', tx.id)

      if (updateError) {
        console.error(`Failed to update tx ${tx.id}:`, updateError.message)
        errorCount++
      } else {
        updateCount++
        if (updateCount % 100 === 0 || updateCount === 1) {
          console.log(`[Progress] Updated ${updateCount} transactions. Example: "${tx.description}" moved from ${tx.date} to ${targetDate}`)
        }
      }
    } else {
      skipCount++
    }
  }

  console.log('\nPayment date correction finished!')
  console.log(`Successfully updated: ${updateCount}`)
  console.log(`Skipped (already correct): ${skipCount}`)
  console.log(`Errors encountered: ${errorCount}`)
}

run()
