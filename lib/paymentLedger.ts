import { SupabaseClient } from '@supabase/supabase-js'
import { postJournalTransaction } from './journalHelper'
import { getOrCreateDefaultAccounts } from './accountHelper'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const isUuid = (v: unknown): v is string => typeof v === 'string' && UUID_RE.test(v)

export interface RecordPaymentParams {
  businessId: string
  orderId: string
  amount: number
  paymentMethod: string
  paymentMethodAccountId?: string | null
  cashReceived?: number
  changeAmount?: number
  referenceNumber?: string | null
  notes?: string | null
  shiftId?: string | null
  cashierName?: string | null
  supabase: SupabaseClient
}

export interface VoidPaymentParams {
  businessId: string
  paymentId: string
  voidReason?: string | null
  shiftId?: string | null
  cashierName?: string | null
  supabase: SupabaseClient
}

export interface PaymentActionResult {
  success: boolean
  message: string
  amount_paid: number
  payment_status: 'paid' | 'partial' | 'unpaid'
  outstanding: number
  payment?: any
}

/**
 * Recalculates net paid amount for an order from order_payments table
 * Net Paid = SUM(payments) - SUM(voids) - SUM(refunds)
 */
export async function recalculateOrderPaymentStatus(
  orderId: string,
  grandTotal: number,
  supabase: SupabaseClient
): Promise<{ netPaid: number; paymentStatus: 'paid' | 'partial' | 'unpaid'; outstanding: number }> {
  const { data: allOrderPays } = await supabase
    .from('order_payments')
    .select('amount, payment_kind')
    .eq('order_id', orderId)

  let totalInflow = 0
  let totalOutflow = 0
  if (allOrderPays) {
    for (const p of allOrderPays) {
      const amt = Number(p.amount) || 0
      if (p.payment_kind === 'payment') totalInflow += amt
      else if (p.payment_kind === 'refund' || p.payment_kind === 'void') totalOutflow += amt
    }
  }

  const netPaid = Math.max(0, totalInflow - totalOutflow)
  const paymentStatus: 'paid' | 'partial' | 'unpaid' =
    netPaid >= grandTotal - 0.01 ? 'paid' : (netPaid > 0 ? 'partial' : 'unpaid')
  const outstanding = Math.max(0, grandTotal - netPaid)

  await supabase
    .from('orders')
    .update({
      amount_paid: netPaid,
      payment_status: paymentStatus
    })
    .eq('id', orderId)

  return { netPaid, paymentStatus, outstanding }
}

/**
 * Universal payment recording engine (Single Source of Truth)
 * Used by POS checkout, installment payments, invoice payments, etc.
 */
export async function recordOrderPayment(params: RecordPaymentParams): Promise<PaymentActionResult> {
  const {
    businessId,
    orderId,
    amount,
    paymentMethod = 'cash',
    paymentMethodAccountId,
    cashReceived,
    changeAmount,
    referenceNumber,
    notes,
    shiftId,
    cashierName = 'Kasir',
    supabase
  } = params

  if (!isUuid(orderId)) {
    throw new Error('orderId tidak valid')
  }

  const numAmount = Number(amount)
  if (isNaN(numAmount) || numAmount <= 0) {
    throw new Error('Nominal pembayaran harus lebih besar dari 0')
  }

  // 1. Fetch order
  const { data: order, error: orderErr } = await supabase
    .from('orders')
    .select('id, order_number, grand_total, amount_paid, payment_status, status')
    .eq('id', orderId)
    .eq('business_id', businessId)
    .single()

  if (orderErr || !order) {
    throw new Error('Pesanan tidak ditemukan')
  }

  if (order.status === 'cancelled') {
    throw new Error('Pesanan sudah dibatalkan dan tidak dapat menerima pembayaran.')
  }

  const grandTotal = Number(order.grand_total) || 0
  const currentPaid = Number(order.amount_paid) || 0
  const remainingBalance = Math.max(0, grandTotal - currentPaid)

  if (currentPaid >= grandTotal - 0.01) {
    throw new Error('Pesanan ini sudah lunas sebelumnya.')
  }

  if (numAmount > remainingBalance + 0.01) {
    throw new Error(`Nominal pembayaran melebihi sisa tagihan (Rp ${remainingBalance.toLocaleString('id-ID')})`)
  }

  // 2. Resolve Chart of Accounts
  const accountMap = await getOrCreateDefaultAccounts(businessId, supabase)
  const accPiutang = accountMap['103000'] // Piutang Usaha

  let payAccId = paymentMethodAccountId
  const isCash = String(paymentMethod).toLowerCase() === 'cash'

  if (!payAccId) {
    payAccId = isCash ? accountMap['101000'] : accountMap['101200']
    if (isCash && shiftId) {
      // Check if shift has register account
      const { data: shiftData } = await supabase
        .from('pos_shifts')
        .select('register_id, pos_registers:register_id(account_id)')
        .eq('id', shiftId)
        .maybeSingle()

      const regAccId = (shiftData as any)?.pos_registers?.account_id
      if (regAccId) payAccId = regAccId
    }
  }

  // 3. Post Accounting Journal: Debit Kas/Bank, Credit Piutang Usaha
  let payTxId: string | null = null
  if (payAccId && accPiutang) {
    try {
      const postRes = await postJournalTransaction(
        businessId,
        order.id,
        new Date().toISOString(),
        `Pembayaran POS #${order.order_number} - ${cashierName}`,
        [
          { account_id: payAccId, debit: numAmount, credit: 0 },
          { account_id: accPiutang, debit: 0, credit: numAmount }
        ],
        supabase,
        true
      )
      payTxId = postRes?.transactionId || null
    } catch (jErr: any) {
      console.warn('[recordOrderPayment] Journal posting warning:', jErr?.message)
    }
  }

  // 4. Insert Payment Entry into order_payments (Single Source of Truth)
  const { data: newPayment, error: payInsertErr } = await supabase
    .from('order_payments')
    .insert({
      business_id: businessId,
      order_id: order.id,
      shift_id: isUuid(shiftId) ? shiftId : null,
      transaction_id: payTxId,
      date: new Date().toISOString().split('T')[0],
      amount: numAmount,
      payment_method: isCash ? 'cash' : (paymentMethod || 'bank'),
      payment_method_account_id: isUuid(payAccId) ? payAccId : null,
      cash_received: isCash ? Number(cashReceived || numAmount) : numAmount,
      change_amount: isCash ? Number(changeAmount || 0) : 0,
      reference_number: referenceNumber || null,
      notes: notes || `Pembayaran Pesanan #${order.order_number}`,
      payment_kind: 'payment'
    })
    .select()
    .single()

  if (payInsertErr) {
    throw new Error('Gagal mencatat rincian pembayaran: ' + payInsertErr.message)
  }

  // 5. Recalculate status and totals
  const { netPaid, paymentStatus, outstanding } = await recalculateOrderPaymentStatus(order.id, grandTotal, supabase)

  return {
    success: true,
    message: paymentStatus === 'paid' ? 'Pesanan berhasil dilunasi!' : 'Pembayaran berhasil dicatat.',
    payment: newPayment,
    amount_paid: netPaid,
    payment_status: paymentStatus,
    outstanding
  }
}

/**
 * Universal payment void engine (Append-Only Compensating Event)
 */
export async function voidOrderPayment(params: VoidPaymentParams): Promise<PaymentActionResult> {
  const {
    businessId,
    paymentId,
    voidReason = 'Koreksi Kasir',
    shiftId,
    cashierName = 'Kasir',
    supabase
  } = params

  if (!isUuid(paymentId)) {
    throw new Error('paymentId tidak valid')
  }

  // 1. Fetch target payment
  const { data: targetPay, error: payErr } = await supabase
    .from('order_payments')
    .select('*')
    .eq('id', paymentId)
    .eq('business_id', businessId)
    .single()

  if (payErr || !targetPay) {
    throw new Error('Data pembayaran tidak ditemukan')
  }

  if (targetPay.payment_kind !== 'payment') {
    throw new Error('Hanya pembayaran bertipe payment yang dapat dibatalkan (void).')
  }

  // 2. Verify not already voided
  const { data: existingVoid } = await supabase
    .from('order_payments')
    .select('id')
    .eq('voided_payment_id', paymentId)
    .maybeSingle()

  if (existingVoid) {
    throw new Error('Pembayaran ini sudah pernah dibatalkan (void) sebelumnya.')
  }

  // 3. Resolve Accounts & Post Reversal Journal
  const accountMap = await getOrCreateDefaultAccounts(businessId, supabase)
  const accPiutang = accountMap['103000']
  const payAccId = targetPay.payment_method_account_id || (targetPay.payment_method === 'cash' ? accountMap['101000'] : accountMap['101200'])

  let voidTxId: string | null = null
  if (payAccId && accPiutang) {
    try {
      const postRes = await postJournalTransaction(
        businessId,
        targetPay.order_id,
        new Date().toISOString(),
        `Void Pembayaran POS: ${voidReason} - ${cashierName}`,
        [
          { account_id: accPiutang, debit: Number(targetPay.amount), credit: 0 },
          { account_id: payAccId, debit: 0, credit: Number(targetPay.amount) }
        ],
        supabase,
        true
      )
      voidTxId = postRes?.transactionId || null
    } catch (jErr: any) {
      console.warn('[voidOrderPayment] Reversal journal posting warning:', jErr?.message)
    }
  }

  // 4. Insert Compensating Void Event (Append-Only)
  const { error: insVoidErr } = await supabase
    .from('order_payments')
    .insert({
      business_id: businessId,
      order_id: targetPay.order_id,
      shift_id: isUuid(shiftId) ? shiftId : (targetPay.shift_id || null),
      transaction_id: voidTxId,
      date: new Date().toISOString().split('T')[0],
      amount: targetPay.amount,
      payment_method: targetPay.payment_method,
      payment_method_account_id: payAccId,
      cash_received: 0,
      change_amount: 0,
      reference_number: targetPay.reference_number || null,
      notes: voidReason ? `Void: ${voidReason}` : 'Pembatalan Pembayaran',
      payment_kind: 'void',
      voided_payment_id: targetPay.id
    })

  if (insVoidErr) {
    throw new Error('Gagal mencatat event void: ' + insVoidErr.message)
  }

  // 5. Recalculate order paid amount & payment status
  const { data: orderData } = await supabase
    .from('orders')
    .select('grand_total')
    .eq('id', targetPay.order_id)
    .single()

  const grandTotal = Number(orderData?.grand_total) || 0
  const { netPaid, paymentStatus, outstanding } = await recalculateOrderPaymentStatus(targetPay.order_id, grandTotal, supabase)

  return {
    success: true,
    message: 'Pembayaran berhasil dibatalkan (void).',
    amount_paid: netPaid,
    payment_status: paymentStatus,
    outstanding
  }
}
