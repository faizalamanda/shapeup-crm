import { SupabaseClient } from '@supabase/supabase-js'
import { postJournalTransaction } from './journalHelper'
import { getOrCreateDefaultAccounts, getActivePaymentAccounts, resolvePaymentAccountFromCOA } from './accountHelper'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const isUuid = (v: unknown): v is string => typeof v === 'string' && UUID_RE.test(v)

export interface RecordPaymentParams {
  businessId: string
  orderId: string
  amount: number
  paymentMethod: string
  paymentMethodAccountId?: string | null
  paymentDate?: string | null
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
  reversalDate?: string | null
  sourceLabel?: string | null
  shiftId?: string | null
  cashierName?: string | null
  supabase: SupabaseClient
}

export interface VoidPosCashMovementParams {
  businessId: string
  movementId: string
  voidReason: string
  shiftId?: string | null
  cashierName?: string | null
  userId: string
  supabase: SupabaseClient
}

export interface PosMovementActionResult {
  success: boolean
  message: string
  movement: any
  transactionId?: string | null
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
 * Also synchronizes orders.payment_method with the latest active payment (or null if unpaid).
 */
export async function recalculateOrderPaymentStatus(
  orderId: string,
  grandTotal: number,
  supabase: SupabaseClient
): Promise<{ netPaid: number; paymentStatus: 'paid' | 'partial' | 'unpaid'; outstanding: number; latestPaymentMethod: string | null }> {
  const { data: allOrderPays } = await supabase
    .from('order_payments')
    .select('id, amount, payment_kind, payment_method, voided_payment_id, created_at')
    .eq('order_id', orderId)
    .order('created_at', { ascending: true })

  let totalInflow = 0
  let totalOutflow = 0
  const reversedIds = new Set<string>()

  if (allOrderPays) {
    for (const p of allOrderPays) {
      const amt = Number(p.amount) || 0
      if (p.payment_kind === 'payment') {
        totalInflow += amt
      } else if (p.payment_kind === 'refund' || p.payment_kind === 'void') {
        totalOutflow += amt
        if (p.voided_payment_id) reversedIds.add(p.voided_payment_id)
      }
    }
  }

  const activePays = (allOrderPays || []).filter(
    (p: any) => p.payment_kind === 'payment' && !reversedIds.has(p.id)
  )
  const latestActivePay = activePays.length > 0 ? activePays[activePays.length - 1] : null

  const netPaid = Math.max(0, totalInflow - totalOutflow)
  const paymentStatus: 'paid' | 'partial' | 'unpaid' =
    netPaid >= grandTotal - 0.01 ? 'paid' : (netPaid > 0 ? 'partial' : 'unpaid')
  const outstanding = Math.max(0, grandTotal - netPaid)
  const latestPaymentMethod = netPaid > 0 ? (latestActivePay?.payment_method || null) : null

  const updateData: Record<string, any> = {
    amount_paid: netPaid,
    payment_status: paymentStatus
  }
  if (netPaid <= 0) {
    updateData.payment_method = null
  } else if (latestPaymentMethod) {
    updateData.payment_method = latestPaymentMethod
  }

  await supabase
    .from('orders')
    .update(updateData)
    .eq('id', orderId)

  return { netPaid, paymentStatus, outstanding, latestPaymentMethod }
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
    paymentDate,
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
    .select('id, order_number, customer_id, grand_total, amount_paid, payment_status, status')
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
  const accStoreCredit = accountMap['202000'] // Saldo Kredit Pelanggan

  let payAccId = isUuid(paymentMethodAccountId) ? paymentMethodAccountId : null
  const lowerMethod = String(paymentMethod || '').toLowerCase()
  const isStoreCredit =
    lowerMethod === 'store_credit' ||
    lowerMethod.includes('saldo kredit') ||
    (Boolean(payAccId) && Boolean(accStoreCredit) && payAccId === accStoreCredit)
  const isCash =
    !isStoreCredit && (lowerMethod === 'cash' || lowerMethod.includes('tunai'))

  if (isStoreCredit) {
    if (!isUuid(order.customer_id)) {
      throw new Error('Saldo Kredit Pelanggan hanya dapat digunakan pada pesanan milik pelanggan terdaftar.')
    }
    payAccId = accStoreCredit || accountMap['201000']

    // Deduct Customer Store Credit atomically via row-locked RPC (with fallback)
    const { error: scRpcErr } = await supabase.rpc('redeem_store_credit_v1', {
      p_business_id: businessId,
      p_customer_id: order.customer_id,
      p_amount: numAmount,
      p_order_id: order.id,
      p_actor_id: null,
      p_description: notes || `Potong tagihan #${order.order_number} dengan Saldo Kredit`
    })

    if (scRpcErr) {
      // Fallback / direct balance check if RPC requires actor_id or isn't applied
      const { data: scRow } = await supabase
        .from('customer_store_credits')
        .select('balance')
        .eq('business_id', businessId)
        .eq('customer_id', order.customer_id)
        .maybeSingle()

      const currentBal = Number(scRow?.balance || 0)
      if (currentBal < numAmount - 0.01) {
        throw new Error(
          `Saldo Kredit Pelanggan tidak mencukupi (Tersedia: Rp ${currentBal.toLocaleString('id-ID')}).`
        )
      }
      const nextBal = Math.max(0, currentBal - numAmount)
      await supabase
        .from('customer_store_credits')
        .update({ balance: nextBal, updated_at: new Date().toISOString() })
        .eq('business_id', businessId)
        .eq('customer_id', order.customer_id)

      await supabase.from('store_credit_ledger').insert({
        business_id: businessId,
        customer_id: order.customer_id,
        entry_type: 'redeemed',
        amount: -numAmount,
        balance_after: nextBal,
        order_id: order.id,
        description: notes || `Potong tagihan #${order.order_number} dengan Saldo Kredit`
      })
    }
  } else if (!payAccId) {
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
    if (!payAccId) {
      const activePaymentAccounts = await getActivePaymentAccounts(businessId, supabase)
      const matched = resolvePaymentAccountFromCOA(activePaymentAccounts, paymentMethod, null)
      payAccId = matched?.id || (isCash ? accountMap['101000'] : accountMap['101200'])
    }
  }

  // 3. Post Accounting Journal: Debit Kas/Bank, Credit Piutang Usaha
  const resolvedIsoDate = paymentDate ? new Date(paymentDate).toISOString() : new Date().toISOString()
  const resolvedDateOnly = resolvedIsoDate.split('T')[0]

  let payTxId: string | null = null
  if (payAccId && accPiutang) {
    try {
      const postRes = await postJournalTransaction(
        businessId,
        order.id,
        resolvedIsoDate,
        notes || `Pembayaran #${order.order_number} - ${cashierName}`,
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
      date: resolvedDateOnly,
      amount: numAmount,
      payment_method: isStoreCredit ? 'Saldo Kredit Pelanggan' : (isCash ? 'cash' : (paymentMethod || 'bank')),
      payment_method_account_id: isUuid(payAccId) ? payAccId : null,
      cash_received: isStoreCredit ? 0 : (isCash ? Number(cashReceived || numAmount) : numAmount),
      change_amount: isCash ? Number(changeAmount || 0) : 0,
      reference_number: referenceNumber || null,
      notes: notes || `Pembayaran Pesanan #${order.order_number}`,
      payment_kind: 'payment',
      created_at: resolvedIsoDate
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
 * Universal payment void engine (Append-Only Compensating Event — PSAK 225 / IAS 8 & PSAK 109 / IFRS 9)
 * - Preserves full audit trail (Zero DELETE on order_payments & transactions).
 * - Posts reversal journal (Debit Piutang Usaha 103000, Credit Cash/Bank COA) on the original payment date
 *   (or explicit reversalDate) to prevent cut-off period balance distortion in bank reconciliation.
 */
export async function voidOrderPayment(params: VoidPaymentParams): Promise<PaymentActionResult> {
  const {
    businessId,
    paymentId,
    voidReason = 'Koreksi Pembayaran',
    reversalDate,
    sourceLabel,
    shiftId,
    cashierName = 'Kasir',
    supabase
  } = params

  if (!isUuid(paymentId)) {
    throw new Error('paymentId tidak valid')
  }

  const cleanReason = String(voidReason || 'Koreksi Pembayaran').trim()
  if (cleanReason.length < 3) {
    throw new Error('Alasan pembatalan (void) wajib diisi minimal 3 karakter.')
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

  // Fetch associated order for order_number & grand_total context
  const { data: orderData } = await supabase
    .from('orders')
    .select('id, order_number, customer_id, grand_total, source_platform, raw_source_data')
    .eq('id', targetPay.order_id)
    .single()

  const orderNumber = orderData?.order_number || String(targetPay.order_id).slice(0, 8)
  const isInvoice =
    orderData?.source_platform === 'Invoice' ||
    Boolean(orderData?.raw_source_data?.is_invoice) ||
    String(orderNumber).toUpperCase().startsWith('INV-')

  const effectiveSourceLabel = sourceLabel || (isInvoice ? `Invoice #${orderNumber}` : `POS #${orderNumber}`)

  // 3. Resolve Accounts dynamically from active COA & Post Reversal Journal
  const [accountMap, activePaymentAccounts] = await Promise.all([
    getOrCreateDefaultAccounts(businessId, supabase),
    getActivePaymentAccounts(businessId, supabase)
  ])
  const accPiutang = accountMap['103000']
  const accStoreCredit = accountMap['202000']

  let payAccId = isUuid(targetPay.payment_method_account_id) ? targetPay.payment_method_account_id : null
  const isVoidStoreCredit =
    String(targetPay.payment_method || '').toLowerCase() === 'store_credit' ||
    String(targetPay.payment_method || '').toLowerCase().includes('saldo kredit') ||
    (Boolean(payAccId) && Boolean(accStoreCredit) && payAccId === accStoreCredit)

  if (isVoidStoreCredit && accStoreCredit) {
    payAccId = accStoreCredit
  } else if (!payAccId) {
    const matched = resolvePaymentAccountFromCOA(activePaymentAccounts, targetPay.payment_method, null)
    const isCash = String(targetPay.payment_method || '').toLowerCase() === 'cash' || String(targetPay.payment_method || '').toLowerCase().includes('tunai')
    payAccId = matched?.id || (isCash ? accountMap['101000'] : accountMap['101200'])
  }

  // PSAK 225 / IAS 8 Same-Date Reversal Principle:
  // Default reversal journal date to the original payment date so bank reconciliation on that date nets to zero,
  // while created_at records the exact real-time audit timestamp of when the void was executed.
  const effectiveReversalIso = reversalDate
    ? new Date(reversalDate).toISOString()
    : (targetPay.created_at
        ? new Date(targetPay.created_at).toISOString()
        : (targetPay.date ? `${targetPay.date}T12:00:00.000Z` : new Date().toISOString()))
  const effectiveReversalDateOnly = effectiveReversalIso.split('T')[0]

  let voidTxId: string | null = null
  if (payAccId && accPiutang) {
    try {
      const postRes = await postJournalTransaction(
        businessId,
        targetPay.order_id,
        effectiveReversalIso,
        `Void Pembayaran ${effectiveSourceLabel} (Ref ${String(targetPay.id).slice(0, 8)}): ${cleanReason} - ${cashierName}`,
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
  const { data: voidPaymentRow, error: insVoidErr } = await supabase
    .from('order_payments')
    .insert({
      business_id: businessId,
      order_id: targetPay.order_id,
      shift_id: isUuid(shiftId) ? shiftId : (targetPay.shift_id || null),
      transaction_id: voidTxId,
      date: effectiveReversalDateOnly,
      amount: targetPay.amount,
      payment_method: targetPay.payment_method,
      payment_method_account_id: payAccId,
      cash_received: 0,
      change_amount: 0,
      reference_number: targetPay.reference_number || null,
      notes: `Void: ${cleanReason}`,
      payment_kind: 'void',
      voided_payment_id: targetPay.id,
      created_at: new Date().toISOString()
    })
    .select()
    .single()

  if (insVoidErr) {
    throw new Error('Gagal mencatat event void: ' + insVoidErr.message)
  }

  // Restore customer store credit balance if the voided payment used Store Credit
  if (isVoidStoreCredit && isUuid(orderData?.customer_id)) {
    try {
      const voidAmt = Number(targetPay.amount || 0)
      const { data: scRow } = await supabase
        .from('customer_store_credits')
        .select('balance')
        .eq('business_id', businessId)
        .eq('customer_id', orderData.customer_id)
        .maybeSingle()

      const nextBal = Number(scRow?.balance || 0) + voidAmt
      await supabase
        .from('customer_store_credits')
        .upsert(
          {
            business_id: businessId,
            customer_id: orderData.customer_id,
            balance: nextBal,
            updated_at: new Date().toISOString()
          },
          { onConflict: 'business_id,customer_id' }
        )

      await supabase.from('store_credit_ledger').insert({
        business_id: businessId,
        customer_id: orderData.customer_id,
        entry_type: 'reversed',
        amount: voidAmt,
        balance_after: nextBal,
        order_id: targetPay.order_id,
        description: `Pemulihan Saldo Kredit dari Void Pembayaran ${effectiveSourceLabel} (${cleanReason})`
      })
    } catch (scErr) {
      console.warn('[voidOrderPayment] Failed to restore store credit balance:', scErr)
    }
  }

  // 5. Recalculate order paid amount & payment status
  const grandTotal = Number(orderData?.grand_total) || 0
  const { netPaid, paymentStatus, outstanding } = await recalculateOrderPaymentStatus(targetPay.order_id, grandTotal, supabase)

  return {
    success: true,
    message: 'Pembayaran berhasil dibatalkan (void) dan jurnal pembalik telah diposting ke Buku Besar.',
    amount_paid: netPaid,
    payment_status: paymentStatus,
    outstanding,
    payment: voidPaymentRow
  }
}

/**
 * Universal POS cash movement void engine (Append-Only Compensating Reversal)
 * Reverses petty cash in/out in the accounting ledger (transactions & journal_lines)
 * and marks the pos_shift_movements entry as voided.
 */
export async function voidPosCashMovement(params: VoidPosCashMovementParams): Promise<PosMovementActionResult> {
  const {
    businessId,
    movementId,
    voidReason,
    shiftId,
    cashierName = 'Kasir',
    userId,
    supabase
  } = params

  if (!isUuid(movementId)) {
    throw new Error('movementId tidak valid (format UUID diperlukan)')
  }

  const cleanReason = (voidReason || '').trim()
  if (!cleanReason || cleanReason.length < 5) {
    throw new Error('Alasan pembatalan (void) wajib diisi minimal 5 karakter.')
  }

  // 1. Fetch target movement
  const { data: movement, error: movErr } = await supabase
    .from('pos_shift_movements')
    .select('*')
    .eq('id', movementId)
    .eq('business_id', businessId)
    .single()

  if (movErr || !movement) {
    throw new Error('Data mutasi kas tidak ditemukan.')
  }

  // 2. Verify not already voided
  const isAlreadyVoided =
    movement.status === 'voided' ||
    (typeof movement.note === 'string' && movement.note.trim().startsWith('[VOID'))

  if (isAlreadyVoided) {
    throw new Error('Mutasi kas ini sudah pernah dibatalkan (void) sebelumnya.')
  }

  // 3. Verify Active Shift Gating (Zero-Bypass Policy)
  const targetShiftId = shiftId || movement.shift_id
  const { data: shift, error: shiftErr } = await supabase
    .from('pos_shifts')
    .select('id, status, user_id, cashier_name, register_id')
    .eq('id', targetShiftId)
    .eq('business_id', businessId)
    .single()

  if (shiftErr || !shift) {
    throw new Error('Sesi shift kasir tidak ditemukan.')
  }

  if (shift.status !== 'open') {
    throw new Error('Mutasi kas pada shift yang sudah ditutup tidak dapat dibatalkan (void). Silakan lakukan koreksi jurnal manual.')
  }

  // 4. Resolve Accounts from Bagan Akun (COA)
  const accountMap = await getOrCreateDefaultAccounts(businessId, supabase)

  // 4a. Kas POS Account (Register Specific or 101000)
  let kasPosAccId: string | null = null
  if (shift.register_id) {
    const { data: reg } = await supabase
      .from('pos_registers')
      .select('account_id')
      .eq('id', shift.register_id)
      .maybeSingle()
    if (reg?.account_id) kasPosAccId = reg.account_id
  }
  if (!kasPosAccId) {
    kasPosAccId = accountMap['101000'] || null
    if (!kasPosAccId) {
      const { data: fallbackKas } = await supabase
        .from('accounts')
        .select('id')
        .eq('business_id', businessId)
        .eq('code', '101000')
        .maybeSingle()
      if (fallbackKas) kasPosAccId = fallbackKas.id
    }
  }

  // 4b. Counterpart Account
  let counterAccountId: string | null = movement.account_id || null
  if (!counterAccountId) {
    const noteLower = (movement.note || '').toLowerCase()

    if (movement.type === 'cash_out') {
      const { data: expAccounts } = await supabase
        .from('accounts')
        .select('id, code, name')
        .eq('business_id', businessId)
        .eq('type', 'EXPENSE')

      const expList = expAccounts || []
      if (noteLower.includes('bensin') || noteLower.includes('ongkir') || noteLower.includes('kurir') || noteLower.includes('parkir') || noteLower.includes('transport')) {
        counterAccountId = expList.find(a => a.code === '503500' || a.name.toLowerCase().includes('transport'))?.id || null
      } else if (noteLower.includes('lakban') || noteLower.includes('plastik') || noteLower.includes('atk') || noteLower.includes('kertas') || noteLower.includes('tag')) {
        counterAccountId = expList.find(a => a.code === '503400' || a.name.toLowerCase().includes('perlengkapan'))?.id || null
      } else if (noteLower.includes('minuman') || noteLower.includes('makan') || noteLower.includes('es') || noteLower.includes('air') || noteLower.includes('galon') || noteLower.includes('susu') || noteLower.includes('snack') || noteLower.includes('konsumsi')) {
        counterAccountId = expList.find(a => a.code === '503900' || a.name.toLowerCase().includes('konsumsi'))?.id || null
      } else if (noteLower.includes('gas') || noteLower.includes('listrik') || noteLower.includes('lpg')) {
        counterAccountId = expList.find(a => a.code === '503200' || a.name.toLowerCase().includes('utilitas'))?.id || null
      }

      if (!counterAccountId) {
        counterAccountId = accountMap['503000'] || expList.find(a => a.code === '503000')?.id || expList[0]?.id || null
      }
    } else {
      if (noteLower.includes('modal') || noteLower.includes('owner') || noteLower.includes('pemilik')) {
        counterAccountId = accountMap['301000'] || null
      } else {
        counterAccountId = accountMap['101100'] || null
      }

      if (!counterAccountId) {
        const { data: bankAcc } = await supabase
          .from('accounts')
          .select('id')
          .eq('business_id', businessId)
          .eq('type', 'ASSET')
          .neq('code', '101000')
          .limit(1)
          .maybeSingle()
        if (bankAcc) counterAccountId = bankAcc.id
      }
    }
  }

  // 5. Post Reversal Journal Transaction (Compensating Double-Entry)
  const numAmount = Number(movement.amount) || 0
  let voidTxId: string | null = null

  if (kasPosAccId && counterAccountId && numAmount > 0) {
    try {
      const cleanOriginalNote = (movement.note || '').replace(/^\[VOID:[^\]]+\]\s*/i, '').trim()
      const isCashOut = movement.type === 'cash_out'

      // For cash_out reversal: Debit Kas POS, Credit Counterpart Expense
      // For cash_in reversal: Debit Counterpart Bank/Equity, Credit Kas POS
      const journalLines = isCashOut
        ? [
            { account_id: kasPosAccId, debit: numAmount, credit: 0 },
            { account_id: counterAccountId, debit: 0, credit: numAmount }
          ]
        : [
            { account_id: counterAccountId, debit: numAmount, credit: 0 },
            { account_id: kasPosAccId, debit: 0, credit: numAmount }
          ]

      const desc = isCashOut
        ? `[POS-MOV-VOID-${movement.id}] Void Pengeluaran Kas POS: ${cleanOriginalNote} (Alasan: ${cleanReason}) - ${cashierName}`
        : `[POS-MOV-VOID-${movement.id}] Void Kas Masuk Laci POS: ${cleanOriginalNote} (Alasan: ${cleanReason}) - ${cashierName}`

      const postRes = await postJournalTransaction(
        businessId,
        null,
        new Date().toISOString(),
        desc,
        journalLines,
        supabase,
        true
      )
      voidTxId = postRes?.transactionId || null
    } catch (jErr: any) {
      console.warn('[voidPosCashMovement] Reversal journal posting warning:', jErr?.message)
    }
  }

  // 6. Update pos_shift_movements record (Defensive against schema version)
  const cleanOriginalNote = (movement.note || '').replace(/^\[VOID:[^\]]+\]\s*/i, '').trim()
  const voidNote = `[VOID: ${cleanReason}] ${cleanOriginalNote}`.trim()

  let updatedMovement = null
  const fullUpdatePayload: any = {
    status: 'voided',
    void_reason: cleanReason,
    voided_at: new Date().toISOString(),
    voided_by: isUuid(userId) ? userId : null,
    reversal_transaction_id: voidTxId,
    note: voidNote
  }

  const { data: fullUpdate, error: fullUpdateErr } = await supabase
    .from('pos_shift_movements')
    .update(fullUpdatePayload)
    .eq('id', movementId)
    .eq('business_id', businessId)
    .select()
    .single()

  if (fullUpdateErr) {
    // Fallback: If DB columns status/void_reason are still being migrated, update note
    const { data: noteUpdate, error: noteUpdateErr } = await supabase
      .from('pos_shift_movements')
      .update({ note: voidNote })
      .eq('id', movementId)
      .eq('business_id', businessId)
      .select()
      .single()

    if (noteUpdateErr) {
      throw new Error('Gagal memperbarui status mutasi kas: ' + (fullUpdateErr.message || noteUpdateErr.message))
    }
    updatedMovement = { ...noteUpdate, status: 'voided', void_reason: cleanReason }
  } else {
    updatedMovement = fullUpdate
  }

  return {
    success: true,
    message: movement.type === 'cash_out'
      ? 'Pengeluaran kas berhasil dibatalkan (void) dan jurnal pembalik telah diposting.'
      : 'Kas masuk laci berhasil dibatalkan (void) dan jurnal pembalik telah diposting.',
    movement: updatedMovement,
    transactionId: voidTxId
  }
}
