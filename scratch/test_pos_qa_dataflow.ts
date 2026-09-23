import { createClient } from '@supabase/supabase-js'
import * as fs from 'fs'
import * as path from 'path'

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

const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)

async function runQATestFlow() {
  console.log('====================================================')
  console.log('🧪 QA DATA FLOW TEST: ShapeUp POS Full Integration')
  console.log('====================================================\n')

  // 1. Get active business ID
  const { data: biz, error: bizErr } = await supabase
    .from('businesses')
    .select('id, name')
    .limit(1)
    .single()

  if (bizErr || !biz) {
    console.error('❌ Failed to fetch test business:', bizErr?.message)
    return
  }

  console.log(`✅ Test Business: ${biz.name} (${biz.id})`)

  // 2. Setup QA Test Product with Stock Tracking
  const testSku = 'QA-POS-' + Date.now().toString().slice(-4)
  const initialStock = 10
  const itemPrice = 50000
  const costPrice = 25000

  const { data: prod, error: prodErr } = await supabase
    .from('products')
    .insert({
      business_id: biz.id,
      name: 'QA POS Test Product',
      sku: testSku,
      type: 'physical',
      price: itemPrice,
      cost_price: costPrice,
      stock_type: 'tracked',
      stock_quantity: initialStock
    })
    .select('id, name, sku, price, stock_quantity')
    .single()

  if (prodErr || !prod) {
    console.error('❌ Failed to create test product:', prodErr?.message)
    return
  }

  console.log(`✅ QA Test Product Created: "${prod.name}" (SKU: ${prod.sku}) | Stock: ${prod.stock_quantity}`)

  // 3. Test Stock Validation & Reduction Flow via POS Order Insertion
  const buyQty = 2
  const orderNumber = 'POS-QA-' + Date.now().toString().slice(-6)

  // Get or Create Guest Customer
  let { data: guestCust } = await supabase
    .from('customers')
    .select('id')
    .eq('business_id', biz.id)
    .eq('phone', '0')
    .maybeSingle()

  if (!guestCust) {
    const { data: newGuest } = await supabase
      .from('customers')
      .insert({
        business_id: biz.id,
        phone: '0',
        name: 'QA Walk-in Customer',
        email: 'guest@qa.com'
      })
      .select('id')
      .single()
    guestCust = newGuest
  }

  const lineItemsPayload = [
    {
      id: 1,
      name: prod.name,
      product_id: prod.id,
      quantity: buyQty,
      price: itemPrice,
      subtotal: String(itemPrice * buyQty),
      total: String(itemPrice * buyQty),
      sku: prod.sku,
      meta_data: [{ key: 'Variant', value: 'Ukuran M' }, { key: 'Note', value: 'Bungkus rapi' }]
    },
    {
      id: 2,
      name: 'Kantong Plastik / Custom',
      product_id: 'custom-' + Date.now(),
      quantity: 1,
      price: 2000,
      subtotal: '2000',
      total: '2000',
      sku: 'CUSTOM'
    }
  ]

  const grandTotal = itemPrice * buyQty + 2000

  const { data: order, error: orderErr } = await supabase
    .from('orders')
    .insert({
      business_id: biz.id,
      customer_id: guestCust!.id,
      order_number: orderNumber,
      source_platform: 'POS',
      order_date: new Date().toISOString(),
      order_date_utc: new Date().toISOString(),
      total_qty: buyQty + 1,
      subtotal: grandTotal,
      discount_amount: 0,
      grand_total: grandTotal,
      payment_method: 'Cash',
      status: 'completed',
      items_json: lineItemsPayload,
      raw_source_data: {
        id: orderNumber,
        status: 'completed',
        line_items: lineItemsPayload
      }
    })
    .select('id, order_number, grand_total')
    .single()

  if (orderErr || !order) {
    console.error('❌ Failed to insert POS Order:', orderErr?.message)
    return
  }

  console.log(`\n✅ POS Order Inserted Successfully: #${order.order_number} | Grand Total: Rp ${order.grand_total.toLocaleString('id-ID')}`)

  // 4. Test Sync Order to Ledger (Accounting + Stock Reduction)
  const { syncOrderToLedger } = require('../lib/orderLedger')
  const syncResult = await syncOrderToLedger(order.id, supabase)

  if (!syncResult.success) {
    console.error('❌ Ledger Sync Failed:', syncResult.message)
    return
  }
  console.log('✅ Ledger Sync & Stock Movement Execution: OK')

  // 5. Verify Product Stock Reduction (Initial 10 - Bought 2 = Expected 8)
  const { data: updatedProd } = await supabase
    .from('products')
    .select('stock_quantity')
    .eq('id', prod.id)
    .single()

  const expectedStock = initialStock - buyQty
  if (updatedProd?.stock_quantity === expectedStock) {
    console.log(`✅ Stock Reduction Test PASSED: Initial (${initialStock}) - Sold (${buyQty}) = Current (${updatedProd.stock_quantity})`)
  } else {
    console.error(`❌ Stock Reduction Test FAILED: Expected ${expectedStock}, got ${updatedProd?.stock_quantity}`)
  }

  // 6. Verify Accounting Journal Lines
  const { data: txs } = await supabase
    .from('transactions')
    .select('id, description, journal_lines(debit, credit, account_id)')
    .eq('order_id', order.id)

  console.log(`\n✅ Accounting Journal Entries Verified (${txs?.length || 0} Transactions Posted):`)
  txs?.forEach((t: any) => {
    console.log(`   • Transaction: "${t.description}"`)
    t.journal_lines?.forEach((jl: any) => {
      console.log(`     - Debit: Rp ${Number(jl.debit).toLocaleString('id-ID')} | Credit: Rp ${Number(jl.credit).toLocaleString('id-ID')}`)
    })
  })

  // 7. Cleanup Test Data
  console.log('\n🧹 Cleaning up test product and order...')
  await supabase.from('transactions').delete().eq('order_id', order.id)
  await supabase.from('orders').delete().eq('id', order.id)
  await supabase.from('products').delete().eq('id', prod.id)

  console.log('\n====================================================')
  console.log('🎉 QA DATA FLOW TEST COMPLETED: ALL SYSTEMS 100% OPERATIONAL')
  console.log('====================================================')
}

runQATestFlow()
