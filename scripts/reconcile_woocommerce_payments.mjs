import { createClient } from '@supabase/supabase-js'
import fs from 'fs'
import path from 'path'

const envPath = path.resolve(process.cwd(), '.env.local')
const envConfig = fs.readFileSync(envPath, 'utf8')
const envMap = {}
envConfig.split('\n').forEach(line => {
  const [k, ...rest] = line.split('=')
  if (k && rest.length) envMap[k.trim()] = rest.join('=').trim().replace(/^["']|["']$/g, '')
})

const supabase = createClient(envMap.NEXT_PUBLIC_SUPABASE_URL, envMap.SUPABASE_SERVICE_ROLE_KEY)

async function reconcileWooCommercePayments() {
  console.log('--- STARTING WOOCOMMERCE PAYMENT STATUS RECONCILIATION ---')

  // 1. Fetch non-COD orders that are shipped, processing, or completed but still marked unpaid
  const { data: candidates, error } = await supabase
    .from('orders')
    .select('id, business_id, order_number, status, payment_status, amount_paid, grand_total, payment_method, order_date, raw_source_data')
    .eq('source_platform', 'WooCommerce')
    .eq('payment_status', 'unpaid')
    .in('status', ['shipped', 'processing', 'completed'])

  if (error) {
    console.error('Error fetching candidates:', error)
    return
  }

  const filtered = candidates.filter(o => {
    const isCod = (o.payment_method || '').toUpperCase().includes('COD') || (o.payment_method || '').toLowerCase().includes('bayar di tempat')
    const hasDatePaid = !!o.raw_source_data?.date_paid
    return !isCod || hasDatePaid
  })

  console.log(`Found ${filtered.length} WooCommerce non-COD orders to reconcile to 'paid'.`)

  let updatedCount = 0
  let orderPaymentsCreated = 0

  for (const o of filtered) {
    const grandTotal = Number(o.grand_total) || 0
    const raw = o.raw_source_data || {}
    const payDate = raw.date_paid ? raw.date_paid.split('T')[0] : (o.order_date ? o.order_date.split('T')[0] : new Date().toISOString().split('T')[0])

    // Find if a Pembayaran transaction exists
    const { data: payTx } = await supabase
      .from('transactions')
      .select('id')
      .eq('order_id', o.id)
      .ilike('description', '%Pembayaran%')
      .maybeSingle()

    // Update orders table
    const { error: updErr } = await supabase
      .from('orders')
      .update({
        payment_status: 'paid',
        amount_paid: grandTotal
      })
      .eq('id', o.id)

    if (updErr) {
      console.error(`Failed to update order #${o.order_number}:`, updErr.message)
      continue
    }
    updatedCount++

    // Check if order_payments exists
    const { data: existingPays } = await supabase
      .from('order_payments')
      .select('id')
      .eq('order_id', o.id)
      .eq('payment_kind', 'payment')

    if (!existingPays || existingPays.length === 0) {
      const { error: insertPayErr } = await supabase
        .from('order_payments')
        .insert({
          payment_kind: 'payment',
          business_id: o.business_id,
          order_id: o.id,
          transaction_id: payTx?.id || null,
          date: payDate,
          amount: grandTotal,
          payment_method: o.payment_method || 'Bank Transfer',
          cash_received: 0,
          change_amount: 0,
          notes: `Pembayaran WooCommerce #${o.order_number}`
        })

      if (insertPayErr) {
        console.warn(`Failed to insert order_payment for #${o.order_number}:`, insertPayErr.message)
      } else {
        orderPaymentsCreated++
      }
    }
  }

  console.log(`--- RECONCILIATION FINISHED ---`)
  console.log(`Orders updated to 'paid': ${updatedCount}`)
  console.log(`New order_payments records created: ${orderPaymentsCreated}`)
}

reconcileWooCommercePayments()
