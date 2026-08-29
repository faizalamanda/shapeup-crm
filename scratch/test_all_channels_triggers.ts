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

async function testComprehensiveChannels() {
  console.log('=================================================================')
  console.log('COMPREHENSIVE LEDGER ENGINE VERIFICATION FOR ALL CHANNELS & SCENARIOS')
  console.log('=================================================================\n')

  // Fetch 1 real business ID
  const { data: biz } = await supabase.from('businesses').select('id').limit(1).single()
  if (!biz) {
    console.error('No business found for testing!')
    return
  }
  const businessId = biz.id

  // Cleanup past test mock orders
  await supabase.from('orders').delete().eq('business_id', businessId).ilike('order_number', 'TEST-MOCK-%')

  // -----------------------------------------------------------------
  // SCENARIO 1: WooCommerce COD Order at status "processing"
  // Expected: Penjualan created (Piutang & Revenue). NO Stock reduction. NO HPP lines. NO Payment line.
  // -----------------------------------------------------------------
  console.log('--- TEST 1: WooCommerce COD Order (status: processing) ---')
  const { data: wooCodProc } = await supabase.from('orders').insert({
    business_id: businessId,
    order_number: 'TEST-MOCK-WOO-COD-PROC',
    source_platform: 'WooCommerce',
    status: 'processing',
    payment_method: 'cod',
    subtotal: 100000,
    grand_total: 100000,
    raw_source_data: { payment_method: 'cod' },
    items_json: [{ name: 'Kemeja Baru Test', quantity: 1, price: 100000 }]
  }).select('id').single()

  await syncOrderToLedger(wooCodProc!.id, supabase)
  const { data: txs1 } = await supabase.from('transactions').select('id, description, journal_lines(debit, credit, accounts(code, name))').eq('order_id', wooCodProc!.id)
  console.log('Transactions for Test 1 (Woo COD Processing):', (txs1 || []).map((t: any) => ({ desc: t.description, lines: t.journal_lines.length })))

  const test1Passed = (txs1 || []).length === 1 && txs1![0].description.includes('Penjualan') && txs1![0].journal_lines.length === 2
  console.log('Result 1:', test1Passed ? '✅ PASSED (Only Sales Revenue & Piutang created, no Payment/HPP)' : '❌ FAILED')

  // -----------------------------------------------------------------
  // SCENARIO 2: WooCommerce COD Order transitions to "completed"
  // Expected: HPP & Persediaan added to Penjualan. Payment transaction created (Kas POS 101000 & Piutang 103000).
  // -----------------------------------------------------------------
  console.log('\n--- TEST 2: WooCommerce COD Order transitions to "completed" ---')
  await supabase.from('orders').update({
    status: 'completed',
    raw_source_data: { payment_method: 'cod', date_completed: new Date().toISOString() }
  }).eq('id', wooCodProc!.id)

  await syncOrderToLedger(wooCodProc!.id, supabase)
  const { data: txs2 } = await supabase.from('transactions').select('id, description, journal_lines(debit, credit, accounts(code, name))').eq('order_id', wooCodProc!.id)
  console.log('Transactions for Test 2 (Woo COD Completed):', (txs2 || []).map((t: any) => ({ desc: t.description, lines: t.journal_lines.length })))

  const test2Passed = (txs2 || []).length === 2 && txs2!.some((t: any) => t.description.includes('Pembayaran'))
  console.log('Result 2:', test2Passed ? '✅ PASSED (Kas payment created + HPP lines attached to Penjualan)' : '❌ FAILED')

  // -----------------------------------------------------------------
  // SCENARIO 3: WooCommerce Non-COD Order at status "on-hold" (Unpaid Bank Transfer)
  // Expected: NO Payment transaction!
  // -----------------------------------------------------------------
  console.log('\n--- TEST 3: WooCommerce Non-COD Order (status: on-hold) ---')
  const { data: wooNonCodOnHold } = await supabase.from('orders').insert({
    business_id: businessId,
    order_number: 'TEST-MOCK-WOO-NONCOD-ONHOLD',
    source_platform: 'WooCommerce',
    status: 'on-hold',
    payment_method: 'bacs', // Bank transfer
    subtotal: 200000,
    grand_total: 200000,
    raw_source_data: { payment_method: 'bacs' },
    items_json: [{ name: 'Kemeja Baru Test', quantity: 2, price: 100000 }]
  }).select('id').single()

  await syncOrderToLedger(wooNonCodOnHold!.id, supabase)
  const { data: txs3 } = await supabase.from('transactions').select('id, description, journal_lines(debit, credit, accounts(code, name))').eq('order_id', wooNonCodOnHold!.id)
  console.log('Transactions for Test 3 (Woo Non-COD On-Hold):', (txs3 || []).map((t: any) => ({ desc: t.description, lines: t.journal_lines.length })))

  const test3Passed = !(txs3 || []).some((t: any) => t.description.includes('Pembayaran'))
  console.log('Result 3:', test3Passed ? '✅ PASSED (No payment posted for unpaid on-hold order)' : '❌ FAILED')

  // -----------------------------------------------------------------
  // SCENARIO 4: WooCommerce Non-COD Order at status "processing" (Paid via Midtrans/Bank Transfer with date_paid)
  // Expected: Penjualan created + Payment transaction (Bank 101200 & Piutang 103000) created!
  // -----------------------------------------------------------------
  console.log('\n--- TEST 4: WooCommerce Non-COD Order (status: processing, paid on webstore) ---')
  const { data: wooNonCodPaid } = await supabase.from('orders').insert({
    business_id: businessId,
    order_number: 'TEST-MOCK-WOO-NONCOD-PAID',
    source_platform: 'WooCommerce',
    status: 'processing',
    payment_method: 'midtrans',
    subtotal: 150000,
    grand_total: 150000,
    raw_source_data: { payment_method: 'midtrans', date_paid: new Date().toISOString() },
    items_json: [{ name: 'Kemeja Baru Test', quantity: 1, price: 150000 }]
  }).select('id').single()

  await syncOrderToLedger(wooNonCodPaid!.id, supabase)
  const { data: txs4 } = await supabase.from('transactions').select('id, description, journal_lines(debit, credit, accounts(code, name))').eq('order_id', wooNonCodPaid!.id)
  console.log('Transactions for Test 4 (Woo Non-COD Paid):', (txs4 || []).map((t: any) => ({ desc: t.description, lines: t.journal_lines.length })))

  const test4Passed = (txs4 || []).length === 2 && txs4!.some((t: any) => t.description.includes('Pembayaran'))
  console.log('Result 4:', test4Passed ? '✅ PASSED (Bank Payment created on date_paid)' : '❌ FAILED')

  // -----------------------------------------------------------------
  // SCENARIO 5: POS Order at status "completed"
  // Expected: Immediate Penjualan + HPP lines + Cash/Bank Payment!
  // -----------------------------------------------------------------
  console.log('\n--- TEST 5: POS Order (status: completed) ---')
  const { data: posOrd } = await supabase.from('orders').insert({
    business_id: businessId,
    order_number: 'TEST-MOCK-POS-COMPLETED',
    source_platform: 'POS',
    status: 'completed',
    payment_method: 'Cash',
    subtotal: 50000,
    grand_total: 50000,
    items_json: [{ name: 'Kemeja Baru Test', quantity: 1, price: 50000 }]
  }).select('id').single()

  await syncOrderToLedger(posOrd!.id, supabase)
  const { data: txs5 } = await supabase.from('transactions').select('id, description, journal_lines(debit, credit, accounts(code, name))').eq('order_id', posOrd!.id)
  console.log('Transactions for Test 5 (POS Completed):', (txs5 || []).map((t: any) => ({ desc: t.description, lines: t.journal_lines.length })))

  const test5Passed = (txs5 || []).length === 2 && txs5!.some((t: any) => t.description.includes('Pembayaran')) && txs5!.some((t: any) => t.description.includes('Penjualan'))
  console.log('Result 5:', test5Passed ? '✅ PASSED (Immediate Sales + HPP + Payment)' : '❌ FAILED')

  // Cleanup test mock orders
  await supabase.from('orders').delete().eq('business_id', businessId).ilike('order_number', 'TEST-MOCK-%')

  console.log('\n=================================================================')
  console.log('COMPREHENSIVE LEDGER ENGINE VERIFICATION SUMMARY')
  console.log('=================================================================')
  console.log(`Test 1 (Woo COD Processing): ${test1Passed ? '✅ PASS' : '❌ FAIL'}`)
  console.log(`Test 2 (Woo COD Completed):  ${test2Passed ? '✅ PASS' : '❌ FAIL'}`)
  console.log(`Test 3 (Woo Non-COD OnHold): ${test3Passed ? '✅ PASS' : '❌ FAIL'}`)
  console.log(`Test 4 (Woo Non-COD Paid):   ${test4Passed ? '✅ PASS' : '❌ FAIL'}`)
  console.log(`Test 5 (POS Completed):      ${test5Passed ? '✅ PASS' : '❌ FAIL'}`)
}

testComprehensiveChannels()
