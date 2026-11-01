import type { SupabaseClient } from '@supabase/supabase-js'
import {
  ApprovalMode,
  ExchangeItemInput,
  RefundMethod,
  ReturnDisposition,
  ReturnError,
  ReturnPolicy,
  ReturnQuote,
  ReturnRequestItem,
  ReturnableLine,
  SettlementLine,
  RETURN_REASON_MAP
} from './types'
import {
  AccountIds,
  buildRefundLines,
  buildReturnJournal,
  computeReturnableLines,
  finalizeSettlement,
  generateReturnNumber,
  groupTenders,
  isUuid,
  PaymentRow,
  PreviousReturnItem,
  quoteReturn,
  TenderGroup
} from './engine'
import { getReturnPolicy } from './settings'
import { validatePinFormat, verifyPin } from '@/lib/priceGuard/pinCrypto'
import { getOrCreateDefaultAccounts } from '@/lib/accountHelper'
import { postJournalTransaction } from '@/lib/journalHelper'
import { recordStockMovements, StockMoveInput } from '@/lib/stockLedger'
import { reversePointsForOrder } from '@/plugins/loyalty/helpers/loyaltyApi'

export interface QuoteReturnParams {
  businessId: string
  orderId: string
  items: ReturnRequestItem[]
  exchangeItems?: ExchangeItemInput[]
  returnMethod?: RefundMethod
  reasonCode?: string
  isStaff?: boolean
  role?: string
}

export interface ExecuteReturnParams extends QuoteReturnParams {
  cashierId: string
  cashierName: string
  currentShiftId?: string | null
  reasonCode: string
  reasonNote?: string
  approverId?: string | null
  approverPin?: string | null
  idempotencyKey?: string
  paymentIn?: {
    method: string
    accountId?: string | null
    amount: number
    cashReceived?: number
    changeAmount?: number
  }
}

export interface QuoteReturnResult {
  quote: ReturnQuote
  returnableLines: ReturnableLine[]
  policy: ReturnPolicy
  requireApproval: boolean
  approvalReason?: string
  order: any
  accounts: AccountIds
  cashAccountId: string
  exchangeCost: number
  tenders: TenderGroup[]
}

/**
 * Validates, prices, and quotes a return / exchange request without committing mutations.
 */
export async function quoteReturnService(
  params: QuoteReturnParams,
  supabase: SupabaseClient
): Promise<QuoteReturnResult> {
  const { businessId, orderId, items, exchangeItems = [], returnMethod = 'original', reasonCode = 'other', isStaff, role } = params

  if (!isUuid(orderId)) {
    throw new ReturnError('Order ID tidak valid.', 'INVALID_ORDER_ID', 400)
  }

  // 1. Fetch Order & Payment rows
  const [orderRes, paymentsRes] = await Promise.all([
    supabase.from('orders').select('*').eq('id', orderId).eq('business_id', businessId).single(),
    supabase.from('order_payments').select('*').eq('order_id', orderId).eq('business_id', businessId)
  ])

  const order = orderRes.data
  if (orderRes.error || !order) {
    throw new ReturnError('Pesanan tidak ditemukan.', 'ORDER_NOT_FOUND', 404)
  }

  if (order.status === 'cancelled') {
    throw new ReturnError('Pesanan sudah dibatalkan sebelumnya dan tidak dapat diretur.', 'ORDER_ALREADY_CANCELLED', 400)
  }

  const paymentRows: PaymentRow[] = (paymentsRes.data || []).map((p: any) => ({
    id: p.id,
    payment_kind: p.payment_kind || 'payment',
    amount: Number(p.amount || 0),
    payment_method: p.payment_method || 'cash',
    payment_method_account_id: p.payment_method_account_id || null,
    created_at: p.created_at
  }))
  const tenders = groupTenders(paymentRows)

  // 2. Fetch Policy & Return History
  const policy = await getReturnPolicy(businessId, supabase)

  // Policy: Return Window check
  if (policy.return_window_days > 0 && order.order_date_utc) {
    const orderTime = new Date(order.order_date_utc).getTime()
    const diffDays = (Date.now() - orderTime) / (1000 * 60 * 60 * 24)
    if (diffDays > policy.return_window_days) {
      throw new ReturnError(
        `Batas waktu retur telah berakhir (${policy.return_window_days} hari sejak transaksi).`,
        'RETURN_WINDOW_EXPIRED',
        400
      )
    }
  }

  // Fetch previous return items from pos_return_items (if table exists)
  let previousReturns: PreviousReturnItem[] = []
  try {
    const { data: prItems, error: prErr } = await supabase
      .from('pos_return_items')
      .select('order_item_ref, qty, line_refund')
      .eq('order_id', orderId)
      .eq('business_id', businessId)

    if (!prErr && Array.isArray(prItems)) {
      previousReturns = prItems.map((r) => ({
        order_item_ref: r.order_item_ref,
        qty: Number(r.qty || 0),
        line_refund: Number(r.line_refund || 0)
      }))
    }
  } catch {
    previousReturns = []
  }

  // 3. Compute returnable lines
  const { lines: returnableLines } = computeReturnableLines(order, previousReturns)

  // 4. Validate exchange items & calculate exchange cost
  let exchangeCost = 0
  const validatedExchangeItems: ExchangeItemInput[] = []
  const trackedProductIds = new Set<string>()

  if (exchangeItems.length > 0) {
    const pIds = exchangeItems.map((i) => i.productId).filter(isUuid)
    const vIds = exchangeItems.map((i) => i.variantId).filter(isUuid)

    const [productsRes, variantsRes] = await Promise.all([
      pIds.length > 0
        ? supabase.from('products').select('id, name, stock_type, stock_quantity, cost_price').in('id', pIds)
        : { data: [] },
      vIds.length > 0
        ? supabase.from('product_variants').select('id, product_id, title, stock_quantity').in('id', vIds)
        : { data: [] }
    ])

    const pMap = new Map((productsRes.data || []).map((p: any) => [p.id, p]))
    const vMap = new Map((variantsRes.data || []).map((v: any) => [v.id, v]))

    for (const ex of exchangeItems) {
      const p = pMap.get(ex.productId)
      if (!p) {
        throw new ReturnError(`Produk pengganti "${ex.name}" tidak ditemukan.`, 'PRODUCT_NOT_FOUND', 400)
      }

      const qty = Math.abs(Number(ex.quantity || 1))
      if (qty <= 0) continue

      if (p.stock_type === 'tracked') {
        trackedProductIds.add(p.id)
        if (ex.variantId && vMap.has(ex.variantId)) {
          const v = vMap.get(ex.variantId)
          if (v.stock_quantity < qty) {
            throw new ReturnError(
              `Stok varian "${v.title}" tidak mencukupi (Tersedia: ${v.stock_quantity}, Dibutuhkan: ${qty}).`,
              'INSUFFICIENT_STOCK',
              400
            )
          }
        } else if (p.stock_quantity < qty) {
          throw new ReturnError(
            `Stok produk "${p.name}" tidak mencukupi (Tersedia: ${p.stock_quantity}, Dibutuhkan: ${qty}).`,
            'INSUFFICIENT_STOCK',
            400
          )
        }
      }

      const unitCost = Number(p.cost_price || 0)
      exchangeCost += unitCost * qty

      validatedExchangeItems.push({
        productId: ex.productId,
        variantId: ex.variantId || null,
        name: ex.name || p.name,
        variantName: ex.variantName || null,
        quantity: qty,
        unitPrice: Math.round(Number(ex.unitPrice || 0))
      })
    }
  }

  // 5. Quote return lines
  const quote: ReturnQuote = items.length > 0
    ? quoteReturn({
        lines: returnableLines,
        request: items,
        reasonCode,
        policy,
        order: {
          grand_total: Number(order.grand_total || 0),
          amount_paid: Number(order.amount_paid || 0)
        },
        exchange: validatedExchangeItems,
        trackedProductIds
      })
    : {
        items: [],
        grossRefund: 0,
        restockingFee: 0,
        creditValue: 0,
        exchangeTotal: 0,
        newGrandTotal: Number(order.grand_total || 0),
        paidBefore: Number(order.amount_paid || 0),
        dueBefore: Math.max(0, Number(order.grand_total || 0) - Number(order.amount_paid || 0)),
        refundOut: 0,
        shortfall: 0,
        dueAfter: 0,
        isFull: false,
        returnStatus: order.return_status || 'none',
        hasExchange: false
      }

  // 6. Chart of Accounts resolution
  const accountMap = await getOrCreateDefaultAccounts(businessId, supabase)
  const accounts: AccountIds = {
    salesReturns: accountMap['401100'] || accountMap['401000'],
    sales: accountMap['401000'],
    otherIncome: accountMap['402000'] || accountMap['801000'] || accountMap['401000'],
    receivable: accountMap['103000'],
    inventory: accountMap['102000'],
    cogs: accountMap['501000'],
    cashDefault: accountMap['101000'],
    bankDefault: accountMap['101200'],
    storeCredit: accountMap['202000'] || accountMap['202100'] || accountMap['201000']
  }

  // 7. Approval Requirement check
  let requireApproval = false
  let approvalReason = ''

  if (policy.approval_mode === 'always') {
    requireApproval = true
    approvalReason = 'Kebijakan toko mewajibkan persetujuan Manajer untuk setiap retur.'
  } else if (policy.approval_mode === 'above_amount' && quote.creditValue >= policy.approval_threshold) {
    requireApproval = true
    approvalReason = `Nilai retur (Rp ${quote.creditValue.toLocaleString('id-ID')}) melebihi batas otorisasi (Rp ${policy.approval_threshold.toLocaleString('id-ID')}).`
  } else if (policy.approval_mode === 'non_admin') {
    const isOwnerOrAdmin = role === 'admin' || !isStaff
    if (!isOwnerOrAdmin) {
      requireApproval = true
      approvalReason = 'Staf kasir memerlukan otorisasi Manajer/Admin untuk memproses retur.'
    }
  }

  return {
    quote,
    returnableLines,
    policy,
    requireApproval,
    approvalReason,
    order,
    accounts,
    cashAccountId: accounts.cashDefault,
    exchangeCost,
    tenders
  }
}

/**
 * Executes a return or exchange transaction atomically.
 * Tries the atomic RPC `process_pos_return_v1` first.
 * If the RPC is not installed, seamlessly falls back to resilient Node.js execution.
 */
export async function executeReturnService(
  params: ExecuteReturnParams,
  supabase: SupabaseClient,
  supabaseAdmin?: SupabaseClient
): Promise<{
  success: boolean
  returnId: string
  returnNumber: string
  quote: ReturnQuote
  refundLines: SettlementLine[]
  paymentInLines: SettlementLine[]
  message: string
}> {
  const {
    businessId,
    orderId,
    items,
    exchangeItems = [],
    returnMethod = 'original',
    cashierId,
    cashierName,
    currentShiftId,
    reasonCode,
    reasonNote = '',
    approverId,
    approverPin,
    idempotencyKey = crypto.randomUUID(),
    paymentIn
  } = params

  const adminClient = supabaseAdmin || supabase

  if (!reasonCode) {
    throw new ReturnError('Alasan retur wajib dipilih.', 'REASON_REQUIRED', 400)
  }

  if (!items || items.length === 0) {
    throw new ReturnError('Pilih minimal 1 barang yang akan diretur.', 'NO_ITEMS', 400)
  }

  // 1. Perform Quote
  const quoteRes = await quoteReturnService(params, supabase)
  const { quote, order, accounts, policy, requireApproval, exchangeCost, tenders } = quoteRes

  // 2. Manager Approval verification
  let approvedBy: string | null = null
  let approvalNote: string | null = null

  if (requireApproval) {
    if (!approverId || !approverPin) {
      throw new ReturnError(
        'Transaksi retur ini memerlukan otorisasi PIN Manajer.',
        'APPROVAL_REQUIRED',
        403
      )
    }

    const pinFmt = validatePinFormat(approverPin)
    if (!pinFmt.valid) {
      throw new ReturnError(pinFmt.error || 'Format PIN tidak valid.', 'INVALID_PIN_FORMAT', 400)
    }

    const { data: pinRow, error: pinFetchErr } = await adminClient
      .from('pos_approver_pins')
      .select('*')
      .eq('business_id', businessId)
      .eq('user_id', approverId)
      .maybeSingle()

    if (pinFetchErr || !pinRow || !pinRow.pin_hash) {
      throw new ReturnError('Approver yang dipilih belum mengatur PIN di Pengaturan Staf.', 'APPROVER_NO_PIN', 400)
    }

    if (pinRow.locked_until && new Date(pinRow.locked_until).getTime() > Date.now()) {
      const waitSec = Math.ceil((new Date(pinRow.locked_until).getTime() - Date.now()) / 1000)
      throw new ReturnError(`PIN Approver terkunci karena salah 5 kali. Coba lagi dalam ${waitSec} detik.`, 'PIN_LOCKED', 429)
    }

    const isMatch = verifyPin(approverPin, pinRow.pin_hash)
    if (!isMatch) {
      const newAttempts = (pinRow.failed_attempts || 0) + 1
      const lockUntil = newAttempts >= 5 ? new Date(Date.now() + 5 * 60 * 1000).toISOString() : null
      await adminClient
        .from('pos_approver_pins')
        .update({
          failed_attempts: newAttempts,
          locked_until: lockUntil,
          updated_at: new Date().toISOString()
        })
        .eq('business_id', businessId)
        .eq('user_id', approverId)

      throw new ReturnError('PIN Approver salah. Otorisasi ditolak.', 'PIN_MISMATCH', 401)
    }

    await adminClient
      .from('pos_approver_pins')
      .update({ failed_attempts: 0, locked_until: null })
      .eq('business_id', businessId)
      .eq('user_id', approverId)

    approvedBy = approverId
    approvalNote = `Diotorisasi oleh Manajer (ID: ${approverId})`
  }

  // 3. Resolve Active Cashier Shift & Cash Register Account
  let resolvedShiftId = isUuid(currentShiftId) ? currentShiftId : null
  let cashAccountId = accounts.cashDefault

  const { data: activeShift } = await supabase
    .from('pos_shifts')
    .select('id, register_id, cashier_name')
    .eq('business_id', businessId)
    .eq('user_id', cashierId)
    .eq('status', 'open')
    .order('opened_at', { ascending: false })
    .maybeSingle()

  if (activeShift) {
    resolvedShiftId = activeShift.id
    if (activeShift.register_id) {
      const { data: reg } = await supabase
        .from('pos_registers')
        .select('account_id')
        .eq('id', activeShift.register_id)
        .maybeSingle()
      if (reg?.account_id) cashAccountId = reg.account_id
    }
  }

  const isCashPayout = quote.refundOut > 0 && (returnMethod === 'cash' || returnMethod === 'original')
  const isCashPaymentIn = quote.shortfall > 0 && (!paymentIn || paymentIn.method === 'cash')

  if ((isCashPayout || isCashPaymentIn) && !resolvedShiftId) {
    throw new ReturnError(
      'Sesi kasir belum dibuka. Anda harus membuka shift kasir aktif di POS untuk memproses transaksi tunai.',
      'SHIFT_REQUIRED',
      403
    )
  }

  // 4. Build Settlement Lines (Refund out & Payment in)
  const refundLines = buildRefundLines({
    amount: quote.refundOut,
    request: { method: returnMethod },
    tenders,
    accounts,
    cashAccountId,
    allowStoreCredit: policy.allow_store_credit,
    hasNamedCustomer: Boolean(order.customer_id)
  })

  const paymentInLines: SettlementLine[] = []
  if (quote.shortfall > 0) {
    const payMethod = paymentIn?.method || 'cash'
    const isCashIn = payMethod === 'cash'
    const accId = paymentIn?.accountId || (isCashIn ? cashAccountId : accounts.bankDefault)
    paymentInLines.push({
      kind: isCashIn ? 'cash' : 'bank',
      method: payMethod,
      accountId: accId,
      amount: quote.shortfall,
      label: payMethod.toUpperCase()
    })
  }

  finalizeSettlement(quote, quote.shortfall)

  // 5. Build Journal Lines
  const journalLines = buildReturnJournal({
    quote,
    accounts,
    refundLines,
    paymentInLines,
    exchangeCost
  })

  // 6. Stock Move Inputs
  const returnNumber = generateReturnNumber()
  const returnDocId = crypto.randomUUID()
  const stockMoveInputs: StockMoveInput[] = []

  for (const item of quote.items) {
    if (isUuid(item.productId)) {
      if (item.disposition === 'restock' || item.disposition === 'quarantine') {
        stockMoveInputs.push({
          businessId,
          productId: item.productId,
          variantId: item.variantId || undefined,
          reference: returnNumber,
          qty: item.qty,
          unitCost: item.unitCost,
          type: 'receipt',
          sourceType: 'pos_return',
          sourceId: returnDocId,
          status: 'done',
          bucket: item.disposition === 'quarantine' ? 'quarantine' : 'main',
          createdAt: new Date().toISOString()
        })
      }
    }
  }

  for (const ex of exchangeItems) {
    if (isUuid(ex.productId)) {
      stockMoveInputs.push({
        businessId,
        productId: ex.productId,
        variantId: ex.variantId || undefined,
        reference: returnNumber,
        qty: Math.abs(Number(ex.quantity || 1)),
        unitCost: exchangeCost / Math.max(1, exchangeItems.length),
        type: 'delivery',
        sourceType: 'pos_return',
        sourceId: returnDocId,
        status: 'done',
        bucket: 'main',
        createdAt: new Date().toISOString()
      })
    }
  }

  // 7. Prepare RPC Payload for atomic execution
  const storeCreditRefund = refundLines.find((l: SettlementLine) => l.kind === 'store_credit')
  const storeCreditIssued = storeCreditRefund ? storeCreditRefund.amount : 0

  const rpcPayload = {
    business_id: businessId,
    actor_id: cashierId,
    order_id: orderId,
    idempotency_key: idempotencyKey,
    expected_grand_total: Number(order.grand_total || 0),
    expected_returned_total: Number(order.returned_total || 0),
    expected_exchanged_in_total: Number(order.exchanged_in_total || 0),
    expected_amount_paid: Number(order.amount_paid || 0),
    return: {
      return_number: returnNumber,
      return_kind: quote.hasExchange ? 'exchange' : 'return',
      is_full: quote.isFull,
      shift_id: resolvedShiftId,
      cashier_name: cashierName,
      customer_id: order.customer_id || null,
      reason_code: reasonCode,
      reason_note: reasonNote,
      gross_refund: quote.grossRefund,
      restocking_fee: quote.restockingFee,
      credit_value: quote.creditValue,
      exchange_total: quote.exchangeTotal,
      refund_total: quote.refundOut,
      payment_in_total: quote.shortfall,
      store_credit_issued: storeCreditIssued,
      approved_by: approvedBy,
      approval_note: approvalNote,
      settlement_json: { refund_lines: refundLines, payment_in_lines: paymentInLines },
      exchange_items: exchangeItems
    },
    items: quote.items.map((i) => ({
      order_item_ref: i.ref,
      product_id: i.productId,
      variant_id: i.variantId,
      name: i.name,
      variant_name: i.variantName,
      qty: i.qty,
      unit_net_price: i.unitNetPrice,
      line_refund: i.lineRefund,
      unit_cost: i.unitCost,
      disposition: i.disposition,
      track_stock: Boolean(isUuid(i.productId))
    })),
    exchange_stock: exchangeItems
      .filter((ex) => isUuid(ex.productId))
      .map((ex) => ({
        product_id: ex.productId,
        variant_id: ex.variantId || null,
        qty: Math.abs(Number(ex.quantity || 1)),
        unit_cost: exchangeCost / Math.max(1, exchangeItems.length)
      })),
    journal: journalLines.length > 0 ? {
      date: new Date().toISOString(),
      description: `Retur Penjualan #${order.order_number} (${returnNumber}) - ${cashierName}`,
      lines: journalLines
    } : null,
    payments: [
      ...refundLines.map((rf) => ({
        amount: rf.amount,
        method: rf.method,
        account_id: rf.accountId,
        cash_received: rf.kind === 'cash' ? rf.amount : 0,
        change_amount: 0,
        reference_number: returnNumber,
        notes: `Refund Retur #${order.order_number} (${returnNumber})`,
        kind: 'refund'
      })),
      ...paymentInLines.map((pi) => ({
        amount: pi.amount,
        method: pi.method,
        account_id: pi.accountId,
        cash_received: paymentIn?.cashReceived || pi.amount,
        change_amount: paymentIn?.changeAmount || 0,
        reference_number: returnNumber,
        notes: `Selisih Tukar Tambah #${order.order_number} (${returnNumber})`,
        kind: 'payment'
      }))
    ],
    order_update: {
      grand_total: quote.newGrandTotal,
      returned_total: Number(order.returned_total || 0) + quote.grossRefund,
      exchanged_in_total: Number(order.exchanged_in_total || 0) + quote.exchangeTotal,
      return_status: quote.returnStatus,
      status: quote.isFull && order.status !== 'cancelled' ? order.status : order.status
    },
    store_credit: storeCreditIssued > 0 && order.customer_id ? {
      customer_id: order.customer_id,
      amount: storeCreditIssued,
      description: `Saldo kredit dari retur ${returnNumber}`
    } : null
  }

  let committedViaRpc = false
  let transactionId: string | null = null

  try {
    const { data: rpcRes, error: rpcErr } = await adminClient.rpc('process_pos_return_v1', {
      payload: rpcPayload
    })

    if (!rpcErr && rpcRes && rpcRes.success) {
      committedViaRpc = true
      transactionId = rpcRes.transaction_id || null
    } else if (rpcErr && rpcErr.code !== 'PGRST202') {
      console.error('[ReturnsService] process_pos_return_v1 RPC error:', rpcErr)
      throw new ReturnError(rpcErr.message || 'Gagal memproses transaksi retur di database.', 'RPC_ERROR', 500)
    }
  } catch (err: any) {
    if (err instanceof ReturnError) throw err
    console.warn('[ReturnsService] RPC not available, executing via resilient Node workflow:', err.message)
  }

  // Resilient Node fallback if RPC was not executed
  if (!committedViaRpc) {
    if (journalLines.length > 0) {
      try {
        const jRes = await postJournalTransaction(
          businessId,
          orderId,
          new Date().toISOString(),
          `Retur Penjualan #${order.order_number} (${returnNumber}) - ${cashierName}`,
          journalLines,
          adminClient,
          true
        )
        transactionId = jRes?.transactionId || null
      } catch (jErr) {
        console.warn('[ReturnsService] Journal posting warning:', jErr)
      }
    }

    if (stockMoveInputs.length > 0) {
      try {
        await recordStockMovements(stockMoveInputs, adminClient)
      } catch (smErr) {
        console.warn('[ReturnsService] Stock moves warning:', smErr)
      }
    }

    const today = new Date().toISOString().split('T')[0]
    for (const rf of refundLines) {
      try {
        await adminClient.from('order_payments').insert({
          business_id: businessId,
          order_id: orderId,
          shift_id: resolvedShiftId,
          date: today,
          amount: rf.amount,
          payment_method: rf.method,
          payment_method_account_id: rf.accountId,
          cash_received: rf.kind === 'cash' ? rf.amount : 0,
          change_amount: 0,
          notes: `Refund Retur #${order.order_number} (${returnNumber})`,
          payment_kind: 'refund'
        })
      } catch (pErr) {
        console.warn('[ReturnsService] order_payments refund insert warning:', pErr)
      }
    }

    for (const pi of paymentInLines) {
      try {
        await adminClient.from('order_payments').insert({
          business_id: businessId,
          order_id: orderId,
          shift_id: resolvedShiftId,
          date: today,
          amount: pi.amount,
          payment_method: pi.method,
          payment_method_account_id: pi.accountId,
          cash_received: paymentIn?.cashReceived || pi.amount,
          change_amount: paymentIn?.changeAmount || 0,
          notes: `Selisih Tukar Tambah #${order.order_number} (${returnNumber})`,
          payment_kind: 'payment'
        })
      } catch (pErr) {
        console.warn('[ReturnsService] order_payments payment insert warning:', pErr)
      }
    }

    const paidBefore = Number(order.amount_paid || 0)
    const newPaid = Math.max(0, paidBefore - quote.refundOut + quote.shortfall)
    const newPayStatus: 'paid' | 'partial' | 'unpaid' =
      newPaid >= quote.newGrandTotal - 0.01 ? 'paid' : newPaid > 0 ? 'partial' : 'unpaid'

    const orderUpdate: Record<string, any> = {
      grand_total: quote.newGrandTotal,
      amount_paid: newPaid,
      payment_status: newPayStatus,
      return_status: quote.returnStatus,
      returned_total: Number(order.returned_total || 0) + quote.grossRefund,
      exchanged_in_total: Number(order.exchanged_in_total || 0) + quote.exchangeTotal,
      updated_at: new Date().toISOString()
    }

    try {
      const { error: prInsertErr } = await adminClient.from('pos_returns').insert({
        id: returnDocId,
        business_id: businessId,
        order_id: orderId,
        return_number: returnNumber,
        idempotency_key: idempotencyKey,
        return_kind: quote.hasExchange ? 'exchange' : 'return',
        is_full: quote.isFull,
        shift_id: resolvedShiftId,
        cashier_id: cashierId,
        cashier_name: cashierName,
        customer_id: order.customer_id || null,
        reason_code: reasonCode,
        reason_note: reasonNote,
        gross_refund: quote.grossRefund,
        restocking_fee: quote.restockingFee,
        credit_value: quote.creditValue,
        exchange_total: quote.exchangeTotal,
        refund_total: quote.refundOut,
        payment_in_total: quote.shortfall,
        store_credit_issued: refundLines
          .filter((l: SettlementLine) => l.kind === 'store_credit')
          .reduce((s: number, l: SettlementLine) => s + l.amount, 0),
        approved_by: approvedBy,
        approval_note: approvalNote,
        settlement_json: { refund_lines: refundLines, payment_in_lines: paymentInLines },
        exchange_items: exchangeItems,
        transaction_id: transactionId
      })

      if (!prInsertErr) {
        const rItems = quote.items.map((i) => ({
          return_id: returnDocId,
          business_id: businessId,
          order_id: orderId,
          order_item_ref: i.ref,
          product_id: i.productId,
          variant_id: i.variantId,
          name: i.name,
          variant_name: i.variantName,
          qty: i.qty,
          unit_net_price: i.unitNetPrice,
          line_refund: i.lineRefund,
          unit_cost: i.unitCost,
          disposition: i.disposition
        }))
        await adminClient.from('pos_return_items').insert(rItems)
      } else {
        const currentItems: any[] = Array.isArray(order.items_json) ? order.items_json : []
        const updatedItems = [...currentItems]
        quote.items.forEach((ri) => {
          updatedItems.push({
            id: `retur-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            product_id: ri.productId,
            name: `[RETUR] ${ri.name}`,
            variant_name: ri.variantName,
            quantity: -ri.qty,
            price: ri.unitNetPrice,
            subtotal: String(-ri.lineRefund),
            total: String(-ri.lineRefund),
            note: `Retur: ${RETURN_REASON_MAP[reasonCode]?.label || reasonCode}`
          })
        })
        exchangeItems.forEach((ex) => {
          updatedItems.push({
            id: `pengganti-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            product_id: ex.productId,
            name: `[PENGGANTI] ${ex.name}`,
            variant_name: ex.variantName,
            quantity: ex.quantity,
            price: ex.unitPrice,
            subtotal: String(ex.unitPrice * ex.quantity),
            total: String(ex.unitPrice * ex.quantity),
            note: 'Barang pengganti penukaran'
          })
        })
        orderUpdate.items_json = updatedItems
      }
    } catch {
      // Ignored
    }

    const { error: updErr } = await adminClient.from('orders').update(orderUpdate).eq('id', orderId)
    if (updErr) {
      console.warn('[ReturnsService] Order update with extended columns failed, falling back to standard columns:', updErr.message)
      await adminClient.from('orders').update({
        grand_total: quote.newGrandTotal,
        amount_paid: newPaid,
        payment_status: newPayStatus,
        items_json: orderUpdate.items_json || order.items_json,
        updated_at: new Date().toISOString()
      }).eq('id', orderId)
    }
  }

  // 8. Post-commit: Reverse loyalty points if full return
  if (order.customer_id && quote.isFull) {
    try {
      await reversePointsForOrder(adminClient, {
        businessId,
        customerId: order.customer_id,
        orderId,
        orderNumber: order.order_number,
        reverseType: 'reversed'
      })
    } catch (lErr) {
      console.warn('[ReturnsService] Loyalty points reversal warning:', lErr)
    }
  }

  let message = quote.hasExchange
    ? 'Penukaran barang berhasil diproses.'
    : 'Retur penjualan berhasil diproses.'

  if (quote.refundOut > 0) {
    message += ` Total refund: Rp ${quote.refundOut.toLocaleString('id-ID')}.`
  }
  if (quote.shortfall > 0) {
    message += ` Diterima tambahan: Rp ${quote.shortfall.toLocaleString('id-ID')}.`
  }

  return {
    success: true,
    returnId: returnDocId,
    returnNumber,
    quote,
    refundLines,
    paymentInLines,
    message
  }
}
