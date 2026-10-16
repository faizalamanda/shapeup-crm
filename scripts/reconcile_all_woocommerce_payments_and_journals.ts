import { createClient } from '@supabase/supabase-js'
import fs from 'fs'
import path from 'path'
import { syncOrderToLedger } from '../lib/orderLedger'

const envPath = path.resolve(process.cwd(), '.env.local')
const envConfig = fs.readFileSync(envPath, 'utf8')
const envMap: Record<string, string> = {}
envConfig.split('\n').forEach(line => {
  const [k, ...rest] = line.split('=')
  if (k && rest.length) envMap[k.trim()] = rest.join('=').trim().replace(/^["']|["']$/g, '')
})

const supabase = createClient(envMap.NEXT_PUBLIC_SUPABASE_URL, envMap.SUPABASE_SERVICE_ROLE_KEY)

function resolveRealPaymentDate(order: any): string {
  const raw = order.raw_source_data || {}
  const paymentMethod = (order.payment_method || '').toLowerCase()
  const isCod = paymentMethod.includes('cod') || paymentMethod.includes('bayar di tempat')

  if (isCod) {
    if (raw.date_completed_gmt) return new Date(raw.date_completed_gmt.endsWith('Z') ? raw.date_completed_gmt : raw.date_completed_gmt + 'Z').toISOString()
    if (raw.date_completed) return new Date(raw.date_completed.includes('+') || raw.date_completed.endsWith('Z') ? raw.date_completed : raw.date_completed + '+07:00').toISOString()
    return order.order_date_utc || order.order_date || new Date().toISOString()
  } else {
    if (raw.date_paid_gmt) return new Date(raw.date_paid_gmt.endsWith('Z') ? raw.date_paid_gmt : raw.date_paid_gmt + 'Z').toISOString()
    if (raw.date_paid) return new Date(raw.date_paid.includes('+') || raw.date_paid.endsWith('Z') ? raw.date_paid : raw.date_paid + '+07:00').toISOString()
    return order.order_date_utc || order.order_date || new Date().toISOString()
  }
}

async function reconcileAllWooCommercePaymentsAndJournals() {
  console.log('=== STARTING COMPREHENSIVE WOOCOMMERCE PAYMENT & JOURNAL RECONCILIATION ===')

  // 1. Fetch all WooCommerce orders
  const { data: allOrders, error } = await supabase
    .from('orders')
    .select('id, business_id, order_number, status, payment_status, amount_paid, grand_total, payment_method, order_date, raw_source_data')
    .eq('source_platform', 'WooCommerce')
    .order('created_at', { ascending: false })

  if (error || !allOrders) {
    console.error('Error fetching WooCommerce orders:', error)
    return
  }

  console.log(`Fetched ${allOrders.length} total WooCommerce orders.`)

  // 2. Fetch existing payment transactions
  const { data: payTxs } = await supabase
    .from('transactions')
    .select('id, order_id, date, description')
    .ilike('description', '%Pembayaran%')

  const payTxByOrderId = new Map<string, any>()
  payTxs?.forEach(t => payTxByOrderId.set(t.order_id, t))

  // 3. Filter eligible orders that are or should be paid
  const paidCandidates = allOrders.filter(o => {
    const isCod = (o.payment_method || '').toUpperCase().includes('COD') || (o.payment_method || '').toLowerCase().includes('bayar di tempat')
    const hasDatePaid = !!o.raw_source_data?.date_paid
    const isPaidStatus = ['processing', 'shipped', 'completed'].includes(o.status)
    const isExplicitPaid = o.payment_status === 'paid'

    if (isCod) {
      return o.status === 'completed' || isExplicitPaid
    }
    return isPaidStatus || hasDatePaid || isExplicitPaid
  })

  console.log(`Found ${paidCandidates.length} paid / eligible WooCommerce orders.`)

  let journalCreatedCount = 0
  let orderPaymentUpdatedCount = 0
  let orderPaymentInsertedCount = 0

  // 4. Process sequentially or in batches of 5
  const CONCURRENCY = 5
  for (let i = 0; i < paidCandidates.length; i += CONCURRENCY) {
    const chunk = paidCandidates.slice(i, i + CONCURRENCY)
    await Promise.all(
      chunk.map(async (order) => {
        const orderId = order.id
        const orderNumber = order.order_number
        const realPayDate = resolveRealPaymentDate(order)
        let payTx = payTxByOrderId.get(orderId)

        // Case A: Missing Payment Journal Transaction -> Delegate to syncOrderToLedger
        if (!payTx) {
          try {
            await syncOrderToLedger(orderId, supabase)
            journalCreatedCount++
          } catch (syncErr: any) {
            console.warn(`[Sync Error #${orderNumber}]:`, syncErr.message)
          }

          // Fetch newly created payment transaction
          const { data: newPayTx } = await supabase
            .from('transactions')
            .select('id, date')
            .eq('order_id', orderId)
            .ilike('description', '%Pembayaran%')
            .maybeSingle()
          payTx = newPayTx
        }

        const effectiveTxId = payTx?.id || null
        const effectiveTxDate = payTx?.date || realPayDate

        // Case B: Ensure order_payments exists and has accurate real date & created_at
        const { data: pays } = await supabase
          .from('order_payments')
          .select('id, date, created_at, transaction_id')
          .eq('order_id', orderId)
          .eq('payment_kind', 'payment')

        if (pays && pays.length > 0) {
          // Update order_payments created_at and date to real payment date
          for (const p of pays) {
            await supabase
              .from('order_payments')
              .update({
                created_at: effectiveTxDate,
                date: effectiveTxDate.split('T')[0],
                transaction_id: effectiveTxId || p.transaction_id
              })
              .eq('id', p.id)
            orderPaymentUpdatedCount++
          }
        } else {
          // Insert missing order_payments row
          const grandTotal = Number(order.grand_total) || 0
          const { error: insErr } = await supabase
            .from('order_payments')
            .insert({
              payment_kind: 'payment',
              business_id: order.business_id,
              order_id: orderId,
              transaction_id: effectiveTxId,
              date: effectiveTxDate.split('T')[0],
              amount: grandTotal,
              payment_method: order.payment_method || 'Bank Transfer',
              cash_received: 0,
              change_amount: 0,
              notes: `Pembayaran WooCommerce #${orderNumber}`,
              created_at: effectiveTxDate
            })

          if (!insErr) {
            orderPaymentInsertedCount++
          }
        }
      })
    )

    if ((i + CONCURRENCY) % 50 === 0 || i + CONCURRENCY >= paidCandidates.length) {
      console.log(`Progress: ${Math.min(i + CONCURRENCY, paidCandidates.length)} / ${paidCandidates.length} orders processed...`)
    }
  }

  console.log('=== RECONCILIATION FINISHED ===')
  console.log(`Payment journal transactions created: ${journalCreatedCount}`)
  console.log(`order_payments records updated with real dates: ${orderPaymentUpdatedCount}`)
  console.log(`order_payments records newly inserted: ${orderPaymentInsertedCount}`)
}

reconcileAllWooCommercePaymentsAndJournals().catch(console.error)
