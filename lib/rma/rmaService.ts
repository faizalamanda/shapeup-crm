import type { SupabaseClient } from '@supabase/supabase-js'
import { getOrCreateDefaultAccounts, getActivePaymentAccounts, resolvePaymentAccountFromCOA } from '@/lib/accountHelper'
import { postJournalTransaction } from '@/lib/journalHelper'
import { recordOrderPayment } from '@/lib/paymentLedger'
import { recordStockMovements, StockMoveInput } from '@/lib/stockLedger'
import {
  buildDispositionInventoryLines,
  computeReturnableLines,
  isUuid,
  PreviousReturnItem,
  quoteReturn
} from '@/lib/pos/returns/engine'
import { ReturnError } from '@/lib/pos/returns/types'
import { getReturnPolicy } from '@/lib/pos/returns/settings'
import { reversePointsForOrder } from '@/plugins/loyalty/helpers/loyaltyApi'
import { invalidateInvoicesCache } from '@/app/api/orders/invoices/route'
import {
  generateRmaNumber,
  RMA_REASON_MAP,
  RmaDisposition,
  RmaSettlementMethod
} from './types'

const round = (n: number) => Math.round(Number.isFinite(n) ? n : 0)

// 0ms In-Memory RBAC Cache for RMA & Quarantine Endpoints (TTL 60s)
const rmaAccessCache = new Map<string, { allowed: boolean; expiresAt: number }>()
const RMA_ACCESS_TTL_MS = 60_000
const ALLOWED_RMA_STAFF_PERMS = new Set([
  'full_access',
  'manage_invoices',
  'manage_products',
  'manage_purchases',
  'view_financials_no_salary'
])

export async function verifyRmaAccess(
  businessId: string,
  userId: string,
  supabaseAdmin: SupabaseClient
): Promise<boolean> {
  if (!isUuid(businessId) || !isUuid(userId)) return false
  const cacheKey = `${userId}:${businessId}`
  const now = Date.now()
  const cached = rmaAccessCache.get(cacheKey)
  if (cached && cached.expiresAt > now) {
    return cached.allowed
  }

  const [ownerRes, staffRes] = await Promise.all([
    supabaseAdmin
      .from('businesses')
      .select('id')
      .eq('id', businessId)
      .eq('owner_id', userId)
      .maybeSingle(),
    supabaseAdmin
      .from('business_staff')
      .select('role, permissions')
      .eq('business_id', businessId)
      .eq('profile_id', userId)
      .maybeSingle()
  ])

  const isOwner = Boolean(ownerRes.data?.id)
  const staffRole = staffRes.data?.role
  const staffPerms: string[] = Array.isArray(staffRes.data?.permissions)
    ? staffRes.data.permissions
    : []

  const allowed =
    isOwner ||
    staffRole === 'admin' ||
    staffPerms.some((p) => ALLOWED_RMA_STAFF_PERMS.has(p))

  rmaAccessCache.set(cacheKey, { allowed, expiresAt: now + RMA_ACCESS_TTL_MS })
  if (rmaAccessCache.size > 200) {
    for (const [k, v] of rmaAccessCache.entries()) {
      if (v.expiresAt <= now) rmaAccessCache.delete(k)
    }
  }
  return allowed
}

async function applyLegacyStoreCreditCompat(
  admin: SupabaseClient,
  params: {
    businessId: string
    customerId: string
    issuedAmount: number
    redeemedAmount: number
    rmaId: string | null
    rmaNumber: string
    sourceOrderId: string
    targetOrderId?: string | null
    targetOrderNumber?: string | null
    actorId: string
    description?: string
  }
) {
  const {
    businessId,
    customerId,
    issuedAmount,
    redeemedAmount,
    rmaId,
    rmaNumber,
    sourceOrderId,
    targetOrderId,
    targetOrderNumber,
    actorId,
    description
  } = params
  if (!isUuid(customerId) || issuedAmount <= 0) return null

  const nowIso = new Date().toISOString()
  const { data: curRow } = await admin
    .from('customer_store_credits')
    .select('balance')
    .eq('business_id', businessId)
    .eq('customer_id', customerId)
    .maybeSingle()

  const issuedBal = Math.max(0, round(Number(curRow?.balance || 0) + issuedAmount))
  const finalBal = Math.max(0, round(issuedBal - redeemedAmount))

  await admin.from('customer_store_credits').upsert(
    {
      business_id: businessId,
      customer_id: customerId,
      balance: finalBal,
      updated_at: nowIso
    },
    { onConflict: 'business_id,customer_id' }
  )

  await admin.from('store_credit_ledger').insert({
    business_id: businessId,
    customer_id: customerId,
    entry_type: 'issued',
    amount: issuedAmount,
    balance_after: issuedBal,
    rma_id: isUuid(rmaId) ? rmaId : null,
    order_id: sourceOrderId,
    description: description || `Saldo kredit dari RMA ${rmaNumber}`,
    created_by: isUuid(actorId) ? actorId : null
  })

  if (redeemedAmount > 0 && isUuid(targetOrderId)) {
    await admin.from('store_credit_ledger').insert({
      business_id: businessId,
      customer_id: customerId,
      entry_type: 'redeemed',
      amount: -redeemedAmount,
      balance_after: finalBal,
      rma_id: isUuid(rmaId) ? rmaId : null,
      order_id: targetOrderId,
      description: `Alokasi langsung ke piutang #${targetOrderNumber || targetOrderId} dari RMA ${rmaNumber}`,
      created_by: isUuid(actorId) ? actorId : null
    })
  }

  return finalBal
}

function isMissingLifetimeColError(err: any): boolean {
  if (!err) return false
  const msg = String(err.message || '')
  return (
    err.code === '42703' ||
    msg.includes('lifetime_issued') ||
    msg.includes('lifetime_redeemed')
  )
}

function isUnassignedVRmaError(err: any): boolean {
  if (!err) return false
  const msg = String(err.message || '')
  return err.code === '55000' || msg.includes('v_rma')
}

async function runSettleWithSchemaCompat(settlePayload: any, admin: SupabaseClient) {
  let { data, error } = await admin.rpc('process_rma_transition_v1', { payload: settlePayload })

  if (
    error &&
    settlePayload.header?.settlement_method === 'apply_other_invoice' &&
    (error.code === '23514' || error.message?.includes('rma_requests_settlement_method_check'))
  ) {
    settlePayload = {
      ...settlePayload,
      header: { ...settlePayload.header, settlement_method: 'store_credit' }
    }
    const r1 = await admin.rpc('process_rma_transition_v1', { payload: settlePayload })
    data = r1.data
    error = r1.error
  }

  if (error && isMissingLifetimeColError(error)) {
    const origSc = settlePayload.store_credit
    const origAlloc = settlePayload.cross_invoice_allocation
    const strippedPayload = {
      ...settlePayload,
      store_credit: null,
      cross_invoice_allocation: origAlloc ? { ...origAlloc, customer_id: null } : null
    }
    const r2 = await admin.rpc('process_rma_transition_v1', { payload: strippedPayload })
    data = r2.data
    error = r2.error

    if (!error && data?.success && origSc?.amount > 0 && isUuid(origSc?.customer_id)) {
      const allocAmt = Number(data?.allocated_amount || 0)
      await applyLegacyStoreCreditCompat(admin, {
        businessId: settlePayload.business_id,
        customerId: origSc.customer_id,
        issuedAmount: Number(origSc.amount || 0),
        redeemedAmount: allocAmt,
        rmaId: settlePayload.rma_id || data?.rma_id || null,
        rmaNumber: data?.rma_number || settlePayload.header?.rma_number || '',
        sourceOrderId: settlePayload.order_id,
        targetOrderId: data?.allocated_target_order_id || origAlloc?.target_order_id || null,
        targetOrderNumber: data?.allocated_target_order_number || null,
        actorId: settlePayload.actor_id,
        description: origSc.description
      })
    }
  }

  // Zero-Downtime Bridge for v1.0 RPC (commit 1a3c6a5) that did not yet know deposit_transfer_journal or cross_invoice_allocation:
  if (!error && data?.success && !('deposit_transfer_transaction_id' in data)) {
    const depJr = settlePayload.deposit_transfer_journal
    if (depJr?.lines?.length > 0) {
      await postJournalTransaction(
        settlePayload.business_id,
        settlePayload.order_id,
        depJr.date || new Date().toISOString(),
        depJr.description,
        depJr.lines,
        admin,
        false
      )
    }

    const alloc = settlePayload.cross_invoice_allocation
    if (alloc?.target_order_id && Number(alloc.amount || 0) > 0) {
      const { data: targetOrd } = await admin
        .from('orders')
        .select('id, order_number, grand_total, amount_paid, status')
        .eq('id', alloc.target_order_id)
        .eq('business_id', settlePayload.business_id)
        .maybeSingle()

      if (targetOrd && targetOrd.status !== 'cancelled') {
        const rem = Math.max(
          0,
          round(Number(targetOrd.grand_total || 0) - Number(targetOrd.amount_paid || 0))
        )
        const cutAmt = Math.min(round(Number(alloc.amount || 0)), rem)
        if (cutAmt > 0) {
          const rmaNum = data.rma_number || settlePayload.header?.rma_number || 'RMA'
          await recordOrderPayment({
            businessId: settlePayload.business_id,
            orderId: targetOrd.id,
            amount: cutAmt,
            paymentMethod: 'Saldo Kredit Pelanggan',
            paymentMethodAccountId: alloc.store_credit_account_id || null,
            referenceNumber: rmaNum,
            notes: `Potong tagihan dari Saldo Kredit RMA ${rmaNum}`,
            cashierName: alloc.cashier_name || 'Sistem RMA',
            actorId: settlePayload.actor_id,
            supabase: admin
          })
          data = {
            ...data,
            allocated_amount: cutAmt,
            allocated_target_order_id: targetOrd.id,
            allocated_target_order_number: targetOrd.order_number
          }
        }
      }
    }
  }

  return { data, error }
}

async function executeExpressViaStagedRpcCompat(rpcPayload: any, admin: SupabaseClient) {
  // 1. Create ticket (v_rma not evaluated in 'create')
  const createRes = await admin.rpc('process_rma_transition_v1', {
    payload: {
      mode: 'create',
      business_id: rpcPayload.business_id,
      actor_id: rpcPayload.actor_id,
      order_id: rpcPayload.order_id,
      idempotency_key: rpcPayload.idempotency_key,
      header: {
        ...rpcPayload.header,
        fulfillment_stage: 'approved',
        settlement_method: null
      },
      items: rpcPayload.items
    }
  })
  if (createRes.error || !createRes.data?.rma_id) {
    return createRes
  }

  const createdRmaId: string = createRes.data.rma_id
  if (createRes.data.idempotent) {
    const { data: existingRma } = await admin
      .from('rma_requests')
      .select('fulfillment_stage, settlement_stage')
      .eq('id', createdRmaId)
      .eq('business_id', rpcPayload.business_id)
      .maybeSingle()

    if (existingRma?.settlement_stage === 'settled') {
      return createRes
    }
  }
  const { data: createdItems } = await admin
    .from('rma_items')
    .select('id, order_item_ref, product_id, variant_id, qty, unit_cost, track_stock')
    .eq('rma_id', createdRmaId)
    .eq('business_id', rpcPayload.business_id)

  const dispByRef = new Map<string, string>(
    (rpcPayload.items || []).map((it: any) => [String(it.order_item_ref), it.disposition || 'restock'])
  )

  // 2. Inspect physical items & post inventory journal (v_rma IS assigned in 'inspect')
  const inspectRes = await admin.rpc('process_rma_transition_v1', {
    payload: {
      mode: 'inspect',
      business_id: rpcPayload.business_id,
      actor_id: rpcPayload.actor_id,
      order_id: rpcPayload.order_id,
      rma_id: createdRmaId,
      header: {
        fulfillment_stage: rpcPayload.header?.fulfillment_stage || 'inspected',
        return_courier: rpcPayload.header?.return_courier || null,
        return_tracking_number: rpcPayload.header?.return_tracking_number || null
      },
      items: (createdItems || []).map((ci: any) => ({
        rma_item_id: ci.id,
        product_id: ci.product_id,
        variant_id: ci.variant_id,
        qty: Number(ci.qty || 0),
        unit_cost: Number(ci.unit_cost || 0),
        track_stock: Boolean(ci.track_stock),
        disposition: dispByRef.get(String(ci.order_item_ref)) || 'restock'
      })),
      inventory_journal: rpcPayload.inventory_journal
    }
  })
  if (inspectRes.error) {
    return inspectRes
  }

  // 3. Settle financial journal, AR cut / Store Credit / Cross-Invoice allocation (v_rma IS assigned in 'settle')
  return runSettleWithSchemaCompat(
    {
      mode: 'settle',
      business_id: rpcPayload.business_id,
      actor_id: rpcPayload.actor_id,
      order_id: rpcPayload.order_id,
      rma_id: createdRmaId,
      expected_grand_total: rpcPayload.expected_grand_total,
      expected_amount_paid: rpcPayload.expected_amount_paid,
      header: rpcPayload.header,
      settlement_journal: rpcPayload.settlement_journal,
      deposit_transfer_journal: rpcPayload.deposit_transfer_journal,
      order_update: rpcPayload.order_update,
      payments: rpcPayload.payments,
      store_credit: rpcPayload.store_credit,
      cross_invoice_allocation: rpcPayload.cross_invoice_allocation
    },
    admin
  )
}

export interface CreateRmaItemInput {
  ref: string
  qty: number
  disposition?: Exclude<RmaDisposition, 'pending'>
}

export interface CreateRmaParams {
  businessId: string
  actorId: string
  actorName: string
  orderId: string
  items: CreateRmaItemInput[]
  reasonCode: string
  reasonNote?: string
  returnCourier?: string
  returnTrackingNumber?: string
  restockingFeeOverride?: number
  idempotencyKey?: string
  /** If true, runs Gatekeeping + Warehouse QC + Settlement in 1 single atomic step (~55ms) */
  expressComplete?: boolean
  settlementMethod?: RmaSettlementMethod
  refundAccountId?: string | null
  refundMethodLabel?: string | null
  targetOrderId?: string | null
}

export interface InspectRmaParams {
  businessId: string
  actorId: string
  rmaId: string
  items: Array<{
    rmaItemId: string
    disposition: Exclude<RmaDisposition, 'pending'>
  }>
  returnCourier?: string
  returnTrackingNumber?: string
}

export interface SettleRmaParams {
  businessId: string
  actorId: string
  actorName: string
  rmaId: string
  settlementMethod: RmaSettlementMethod
  refundAccountId?: string | null
  refundMethodLabel?: string | null
  restockingFeeOverride?: number
  shiftId?: string | null
  targetOrderId?: string | null
}

/**
 * Fetches returnable lines for an Order or Invoice in 1 parallel RTT,
 * accounting for both previous POS returns and active Omnichannel RMAs.
 */
export async function getOrderRmaPreview(
  businessId: string,
  orderId: string,
  supabase: SupabaseClient
) {
  if (!isUuid(orderId)) {
    throw new ReturnError('ID pesanan/invoice tidak valid.', 'INVALID_ORDER_ID', 400)
  }

  const [orderRes, paymentsRes, policy, posItemsRes, rmaReqsRes, paymentAccounts] = await Promise.all([
    supabase.from('orders').select('*, customers(id, name, phone, email)').eq('id', orderId).eq('business_id', businessId).single(),
    supabase.from('order_payments').select('*').eq('order_id', orderId).eq('business_id', businessId),
    getReturnPolicy(businessId, supabase),
    Promise.resolve(
      supabase
        .from('pos_return_items')
        .select('order_item_ref, qty, line_refund')
        .eq('order_id', orderId)
        .eq('business_id', businessId)
    ).catch(() => ({ data: null, error: null })),
    Promise.resolve(
      supabase
        .from('rma_requests')
        .select('id, rma_number, fulfillment_stage, settlement_stage, rma_items(order_item_ref, qty, line_refund)')
        .eq('order_id', orderId)
        .eq('business_id', businessId)
        .not('fulfillment_stage', 'in', '("rejected","cancelled")')
    ).catch(() => ({ data: null, error: null })),
    getActivePaymentAccounts(businessId, supabase)
  ])

  const order = orderRes.data
  if (orderRes.error || !order) {
    throw new ReturnError('Pesanan atau Invoice tidak ditemukan.', 'ORDER_NOT_FOUND', 404)
  }

  const prevItems: PreviousReturnItem[] = []
  if (!posItemsRes.error && Array.isArray(posItemsRes.data)) {
    for (const r of posItemsRes.data) {
      prevItems.push({
        order_item_ref: r.order_item_ref,
        qty: Number(r.qty || 0),
        line_refund: Number(r.line_refund || 0)
      })
    }
  }
  if (!rmaReqsRes.error && Array.isArray(rmaReqsRes.data)) {
    for (const req of rmaReqsRes.data) {
      for (const item of req.rma_items || []) {
        prevItems.push({
          order_item_ref: item.order_item_ref,
          qty: Number(item.qty || 0),
          line_refund: Number(item.line_refund || 0)
        })
      }
    }
  }

  const { lines: returnableLines } = computeReturnableLines(order, prevItems)

  // Fast parallel fetch of customer's other open unpaid/partial invoices & current Store Credit balance
  let otherUnpaidOrders: Array<{
    id: string
    order_number: string
    grand_total: number
    amount_paid: number
    remaining_balance: number
    payment_status: string
    status: string
    order_date: string
  }> = []
  let customerStoreCreditBalance = 0

  if (isUuid(order.customer_id)) {
    const [unpaidRes, scRes] = await Promise.all([
      Promise.resolve(
        supabase
          .from('orders')
          .select('id, order_number, grand_total, amount_paid, payment_status, status, order_date')
          .eq('business_id', businessId)
          .eq('customer_id', order.customer_id)
          .neq('id', orderId)
          .not('status', 'in', '("cancelled","pending")')
          .in('payment_status', ['unpaid', 'partial'])
          .order('created_at', { ascending: false })
          .limit(20)
      ).catch(() => ({ data: null })),
      Promise.resolve(
        supabase
          .from('customer_store_credits')
          .select('balance')
          .eq('business_id', businessId)
          .eq('customer_id', order.customer_id)
          .maybeSingle()
      ).catch(() => ({ data: null }))
    ])

    if (Array.isArray(unpaidRes?.data)) {
      otherUnpaidOrders = unpaidRes.data
        .map((o: any) => {
          const grand = Math.max(0, round(Number(o.grand_total || 0)))
          const paid = Math.max(0, round(Number(o.amount_paid || 0)))
          const rem = Math.max(0, grand - paid)
          return {
            id: o.id,
            order_number: o.order_number || o.id,
            grand_total: grand,
            amount_paid: paid,
            remaining_balance: rem,
            payment_status: o.payment_status || 'unpaid',
            status: o.status || 'processing',
            order_date: o.order_date
          }
        })
        .filter((o) => o.remaining_balance > 0)
    }

    customerStoreCreditBalance = Math.max(0, round(Number((scRes as any)?.data?.balance || 0)))
  }

  return {
    order,
    returnableLines,
    policy,
    paymentAccounts,
    existingRmas: rmaReqsRes.data || [],
    payments: paymentsRes.data || [],
    otherUnpaidOrders,
    customerStoreCreditBalance
  }
}

function buildInventoryDispositionJournal(params: {
  items: Array<{ qty: number; unitCost: number; trackStock: boolean; disposition: RmaDisposition }>
  accountMap: Record<string, string>
}) {
  const { items, accountMap } = params
  return buildDispositionInventoryLines({
    items: items
      .filter((it) => it.trackStock && it.unitCost > 0 && it.qty > 0)
      .map((it) => ({
        qty: it.qty,
        unitCost: it.unitCost,
        disposition: it.disposition
      })),
    accounts: {
      inventory: accountMap['102000'],
      quarantineInventory: accountMap['102100'] || accountMap['102000'],
      returnLoss: accountMap['502100'] || accountMap['502000'],
      payable: accountMap['201000'],
      cogs: accountMap['501000']
    },
    exchangeCost: 0
  })
}

function computeSettlementAccounting(params: {
  order: any
  grossReturn: number
  restockingFee: number
  settlementMethod: RmaSettlementMethod
  refundAccountId?: string | null
  refundMethodLabel?: string | null
  accountMap: Record<string, string>
  paymentAccounts: any[]
}) {
  const {
    order,
    grossReturn,
    restockingFee,
    settlementMethod,
    refundAccountId,
    refundMethodLabel,
    accountMap,
    paymentAccounts
  } = params

  const netCredit = Math.max(0, round(grossReturn - restockingFee))
  const currentGrand = Math.max(0, round(Number(order.grand_total || 0)))
  const paidBefore = Math.max(0, round(Number(order.amount_paid || 0)))
  const newGrandTotal = Math.max(0, currentGrand - netCredit)

  // Settlement Identity (Engine Rule):
  // Debt / Accounts Receivable (103000) is ALWAYS reduced first before any cash/store-credit leaves!
  const refundEligible = Math.max(0, paidBefore - newGrandTotal)
  const arCutAmount = Math.max(0, netCredit - refundEligible)

  const salesRetAcc = accountMap['401100'] || accountMap['401000']
  const otherIncAcc = accountMap['403000'] || accountMap['402000'] || accountMap['401000']
  const arAcc = accountMap['103000']
  const storeCreditAcc = accountMap['202000'] || accountMap['201000']

  const lines: Array<{ account_id: string; debit: number; credit: number }> = []
  const payments: Array<{
    amount: number
    method: string
    account_id: string | null
    kind: 'refund' | 'payment'
    notes: string
    shift_id?: string | null
  }> = []

  if (grossReturn > 0) {
    lines.push({ account_id: salesRetAcc, debit: round(grossReturn), credit: 0 })
  }
  if (restockingFee > 0) {
    lines.push({ account_id: otherIncAcc, debit: 0, credit: round(restockingFee) })
  }
  if (arCutAmount > 0) {
    lines.push({ account_id: arAcc, debit: 0, credit: arCutAmount })
  }

  let refundPaidAmount = 0
  let storeCreditIssued = 0
  const depositTransferLines: Array<{ account_id: string; debit: number; credit: number }> = []

  if (refundEligible > 0) {
    if (settlementMethod === 'store_credit' || settlementMethod === 'apply_other_invoice') {
      if (!isUuid(order.customer_id)) {
        throw new ReturnError(
          'Saldo Kredit Pelanggan & Potong Piutang Nota Lain hanya tersedia untuk pelanggan terdaftar (bukan tamu).',
          'STORE_CREDIT_NEEDS_CUSTOMER',
          400
        )
      }
      storeCreditIssued = refundEligible
      // 2-Journal Bridge for 100% Accrual + Cash-Basis P&L + AP/AR Summary reconciliation:
      // 1) Settlement Return Journal (has "Retur" in description) credits 103000 Receivable
      // 2) Deposit Transfer Journal (no "Retur" in description) debits 103000 Receivable & credits 202000 Store Credit
      //    -> Accrual 103000 nets to 0 on source order, while Cash-Basis RPC reverses source order cash revenue (-refundEligible)
      lines.push({ account_id: arAcc, debit: 0, credit: refundEligible })
      depositTransferLines.push(
        { account_id: arAcc, debit: refundEligible, credit: 0 },
        { account_id: storeCreditAcc, debit: 0, credit: refundEligible }
      )
      payments.push({
        amount: refundEligible,
        method: 'Saldo Kredit Pelanggan',
        account_id: storeCreditAcc,
        kind: 'refund',
        notes: `Alokasi Kelebihan Bayar ke Saldo Kredit Pelanggan (#${order.order_number})`
      })
    } else if (settlementMethod === 'credit_memo' && refundEligible > 0 && !refundAccountId) {
      // If user explicitly chose Credit Memo on an overpaid invoice and has a named customer, park excess in Store Credit; otherwise credit AR
      if (isUuid(order.customer_id)) {
        storeCreditIssued = refundEligible
        lines.push({ account_id: arAcc, debit: 0, credit: refundEligible })
        depositTransferLines.push(
          { account_id: arAcc, debit: refundEligible, credit: 0 },
          { account_id: storeCreditAcc, debit: 0, credit: refundEligible }
        )
        payments.push({
          amount: refundEligible,
          method: 'Saldo Kredit Pelanggan',
          account_id: storeCreditAcc,
          kind: 'refund',
          notes: `Alokasi Kelebihan Bayar ke Saldo Kredit Pelanggan (#${order.order_number})`
        })
      } else {
        lines.push({ account_id: arAcc, debit: 0, credit: refundEligible })
      }
    } else {
      // Cash / Bank Refund (Also routed via 2-Journal Bridge so partial-DP + cash-refund works in both Accrual & Cash Basis!)
      const resolvedBank = resolvePaymentAccountFromCOA(
        paymentAccounts,
        refundMethodLabel || order.payment_method,
        isUuid(refundAccountId) ? refundAccountId : order.payment_method_account_id
      )
      const payoutAccId = resolvedBank?.id || accountMap['101100'] || accountMap['101200'] || accountMap['101000']
      const payoutLabel = refundMethodLabel || resolvedBank?.name || 'Transfer Refund'

      refundPaidAmount = refundEligible
      lines.push({ account_id: arAcc, debit: 0, credit: refundEligible })
      depositTransferLines.push(
        { account_id: arAcc, debit: refundEligible, credit: 0 },
        { account_id: payoutAccId, debit: 0, credit: refundEligible }
      )
      payments.push({
        amount: refundEligible,
        method: payoutLabel,
        account_id: payoutAccId,
        kind: 'refund',
        notes: `Pengembalian Dana Pesanan #${order.order_number}`
      })
    }
  }

  // Ensure exact Debit == Credit balance
  const drSum = lines.reduce((s, l) => s + l.debit, 0)
  const crSum = lines.reduce((s, l) => s + l.credit, 0)
  const diff = drSum - crSum
  if (diff > 0) lines.push({ account_id: arAcc, debit: 0, credit: diff })
  else if (diff < 0) lines.push({ account_id: arAcc, debit: -diff, credit: 0 })

  return {
    netCredit,
    newGrandTotal,
    arCutAmount,
    refundPaidAmount,
    storeCreditIssued,
    journalLines: lines,
    depositTransferLines,
    storeCreditAcc,
    arAcc,
    payments
  }
}

/**
 * Creates a new RMA Ticket (Gatekeeping Stage 1) OR completes an Express 1-Click RMA.
 */
export async function createRmaService(
  params: CreateRmaParams,
  supabase: SupabaseClient,
  supabaseAdmin?: SupabaseClient
) {
  const admin = supabaseAdmin || supabase
  const {
    businessId,
    actorId,
    actorName,
    orderId,
    items,
    reasonCode,
    reasonNote = '',
    returnCourier = '',
    returnTrackingNumber = '',
    restockingFeeOverride,
    idempotencyKey = crypto.randomUUID(),
    expressComplete = false,
    settlementMethod = 'credit_memo',
    refundAccountId = null,
    refundMethodLabel = null,
    targetOrderId = null
  } = params

  if (!items || items.length === 0) {
    throw new ReturnError('Pilih minimal 1 item untuk diajukan RMA / Retur.', 'NO_ITEMS', 400)
  }

  const preview = await getOrderRmaPreview(businessId, orderId, admin)
  const { order, returnableLines, policy, paymentAccounts } = preview

  // Fetch tracked products & variants cost in 1 parallel batch
  const pIds = returnableLines.map((l) => l.productId).filter(isUuid)
  const vIds = returnableLines.map((l) => l.variantId).filter(isUuid)

  const [prodsRes, varsRes, accountMap] = await Promise.all([
    pIds.length > 0
      ? admin.from('products').select('id, sku, stock_type, cost_price').eq('business_id', businessId).in('id', pIds)
      : { data: [] },
    vIds.length > 0
      ? admin.from('product_variants').select('id, sku, cost_price').in('id', vIds)
      : { data: [] },
    getOrCreateDefaultAccounts(businessId, admin)
  ])

  const pMap = new Map((prodsRes.data || []).map((p: any) => [p.id, p]))
  const vMap = new Map((varsRes.data || []).map((v: any) => [v.id, v]))
  const trackedSet = new Set(
    (prodsRes.data || []).filter((p: any) => p.stock_type === 'tracked').map((p: any) => p.id)
  )

  const enrichedLines = returnableLines.map((l) => {
    const p = l.productId ? pMap.get(l.productId) : null
    const v = l.variantId ? vMap.get(l.variantId) : null
    const resolvedCost =
      Number(l.unitCost || 0) > 0
        ? Number(l.unitCost)
        : Number(v?.cost_price || p?.cost_price || 0)
    return {
      ...l,
      unitCost: resolvedCost,
      sku: v?.sku || p?.sku || null
    }
  })

  const quote = quoteReturn({
    lines: enrichedLines,
    request: items.map((i) => ({
      ref: i.ref,
      qty: Number(i.qty || 0),
      disposition:
        i.disposition === 'writeoff'
          ? 'writeoff'
          : i.disposition === 'quarantine'
          ? 'quarantine'
          : 'restock'
    })),
    reasonCode,
    policy,
    order: {
      grand_total: Number(order.grand_total || 0),
      amount_paid: Number(order.amount_paid || 0)
    },
    trackedProductIds: trackedSet
  })

  const finalRestockingFee =
    restockingFeeOverride !== undefined && Number.isFinite(Number(restockingFeeOverride))
      ? Math.max(0, Math.min(quote.grossRefund, round(Number(restockingFeeOverride))))
      : quote.restockingFee
  const netCredit = Math.max(0, quote.grossRefund - finalRestockingFee)
  const rmaNumber = generateRmaNumber()

  const reqDispMap = new Map(items.map((i) => [i.ref, i.disposition || 'restock']))
  const lineSkuMap = new Map(enrichedLines.map((l) => [l.ref, l.sku]))

  const preparedItems = quote.items.map((qi) => {
    const chosenDisp: Exclude<RmaDisposition, 'pending'> =
      reqDispMap.get(qi.ref) || RMA_REASON_MAP[reasonCode]?.suggestedDisposition || 'quarantine'
    const trackStock = Boolean(qi.productId && trackedSet.has(qi.productId))
    return {
      order_item_ref: qi.ref,
      product_id: qi.productId,
      variant_id: qi.variantId,
      name: qi.name,
      variant_name: qi.variantName,
      sku: lineSkuMap.get(qi.ref) || null,
      qty: qi.qty,
      unit_net_price: qi.unitNetPrice,
      line_refund: qi.lineRefund,
      unit_cost: qi.unitCost,
      track_stock: trackStock,
      disposition: expressComplete ? chosenDisp : 'pending'
    }
  })

  let invJournalPayload: any = null
  let finJournalPayload: any = null
  let depositTransferJournalPayload: any = null
  let crossInvoiceAllocationPayload: any = null
  let orderUpdatePayload: any = null
  let paymentsPayload: any[] = []
  let storeCreditPayload: any = null
  let settlementMeta = {
    refund_paid_amount: 0,
    credit_memo_amount: 0,
    store_credit_issued: 0,
    fulfillment_stage: 'approved' as string
  }

  if (expressComplete) {
    const allQuarantine = preparedItems.every((i) => i.disposition === 'quarantine')
    settlementMeta.fulfillment_stage = allQuarantine ? 'received_quarantine' : 'inspected'

    const invLines = buildInventoryDispositionJournal({
      items: preparedItems.map((i) => ({
        qty: i.qty,
        unitCost: i.unit_cost,
        trackStock: i.track_stock,
        disposition: i.disposition as RmaDisposition
      })),
      accountMap
    })

    if (invLines.length > 0) {
      invJournalPayload = {
        date: new Date().toISOString(),
        description: `Penerimaan Fisik Retur RMA #${rmaNumber} (Pesanan #${order.order_number})`,
        lines: invLines
      }
    }

    const fin = computeSettlementAccounting({
      order,
      grossReturn: quote.grossRefund,
      restockingFee: finalRestockingFee,
      settlementMethod,
      refundAccountId,
      refundMethodLabel,
      accountMap,
      paymentAccounts
    })

    settlementMeta.refund_paid_amount = fin.refundPaidAmount
    settlementMeta.credit_memo_amount = fin.arCutAmount
    settlementMeta.store_credit_issued = fin.storeCreditIssued

    // IMPORTANT: Keep word "Retur" in description for Cash-Basis RPC & orderLedger compatibility!
    finJournalPayload = {
      date: new Date().toISOString(),
      description:
        fin.arCutAmount > 0 && fin.refundPaidAmount === 0
          ? `Nota Kredit Retur Penjualan #${order.order_number} (${rmaNumber})`
          : `Penyelesaian Retur Penjualan #${order.order_number} (${rmaNumber})`,
      lines: fin.journalLines
    }

    if (fin.depositTransferLines.length > 0) {
      // IMPORTANT: Must NOT contain "Retur", "Refund", or "Pembayaran" so Cash-Basis Case 2 reverses source order cash revenue!
      depositTransferJournalPayload = {
        date: new Date().toISOString(),
        description:
          fin.refundPaidAmount > 0
            ? `Pencairan Kelebihan Bayar #${order.order_number} (${rmaNumber})`
            : `Alokasi Deposit Saldo Kredit #${order.order_number} (${rmaNumber})`,
        lines: fin.depositTransferLines
      }
    }

    orderUpdatePayload = {
      grand_total: fin.newGrandTotal,
      return_status: quote.returnStatus,
      returned_total_delta: quote.grossRefund,
      exchanged_in_total_delta: 0
    }

    paymentsPayload = fin.payments
    if (fin.storeCreditIssued > 0 && isUuid(order.customer_id)) {
      storeCreditPayload = {
        customer_id: order.customer_id,
        amount: fin.storeCreditIssued,
        description: `Saldo kredit dari retur ${rmaNumber} (#${order.order_number})`
      }

      if (settlementMethod === 'apply_other_invoice' && isUuid(targetOrderId)) {
        crossInvoiceAllocationPayload = {
          target_order_id: targetOrderId,
          customer_id: order.customer_id,
          amount: fin.storeCreditIssued,
          store_credit_account_id: fin.storeCreditAcc,
          receivable_account_id: fin.arAcc,
          cashier_name: actorName
        }
      }
    }
  }

  const channel =
    order.raw_source_data?.source_order?.channel || order.source_platform || 'Manual'

  const rpcPayload = {
    mode: expressComplete ? 'express' : 'create',
    business_id: businessId,
    actor_id: actorId,
    order_id: orderId,
    idempotency_key: idempotencyKey,
    expected_grand_total: Number(order.grand_total || 0),
    expected_amount_paid: Number(order.amount_paid || 0),
    header: {
      customer_id: order.customer_id || null,
      rma_number: rmaNumber,
      channel,
      fulfillment_stage: settlementMeta.fulfillment_stage,
      settlement_method: expressComplete ? settlementMethod : null,
      reason_code: reasonCode,
      reason_note: reasonNote || null,
      return_courier: returnCourier || null,
      return_tracking_number: returnTrackingNumber || null,
      gross_return_amount: quote.grossRefund,
      restocking_fee: finalRestockingFee,
      net_credit_amount: netCredit,
      refund_paid_amount: settlementMeta.refund_paid_amount,
      credit_memo_amount: settlementMeta.credit_memo_amount,
      store_credit_issued: settlementMeta.store_credit_issued,
      settlement_json: expressComplete
        ? {
            requested_method: settlementMethod,
            target_order_id: isUuid(targetOrderId) ? targetOrderId : null,
            ar_cut_amount: settlementMeta.credit_memo_amount,
            refund_paid_amount: settlementMeta.refund_paid_amount,
            store_credit_issued: settlementMeta.store_credit_issued
          }
        : {},
      created_by_name: actorName
    },
    items: preparedItems,
    inventory_journal: invJournalPayload,
    settlement_journal: finJournalPayload,
    deposit_transfer_journal: depositTransferJournalPayload,
    order_update: orderUpdatePayload,
    payments: paymentsPayload,
    store_credit: storeCreditPayload,
    cross_invoice_allocation: crossInvoiceAllocationPayload
  }

  let { data: rpcRes, error: rpcErr } = await admin.rpc('process_rma_transition_v1', {
    payload: rpcPayload
  })

  // Zero-Downtime Defense: if live DB table still has old CHECK constraint without 'apply_other_invoice',
  // retry atomically with header.settlement_method = 'store_credit' while preserving cross_invoice_allocation!
  if (
    rpcErr &&
    settlementMethod === 'apply_other_invoice' &&
    (rpcErr.code === '23514' || rpcErr.message?.includes('rma_requests_settlement_method_check'))
  ) {
    const compatPayload = {
      ...rpcPayload,
      header: {
        ...rpcPayload.header,
        settlement_method: 'store_credit'
      }
    }
    const retryRes = await admin.rpc('process_rma_transition_v1', {
      payload: compatPayload
    })
    rpcRes = retryRes.data
    rpcErr = retryRes.error
  }

  // Zero-Downtime Defense #2: if live Supabase DB still has pre-patch v_rma express bug or missing lifetime_issued column,
  // seamlessly execute via staged create -> inspect -> settle RPCs without failing the user's request!
  if (rpcErr && expressComplete && (isUnassignedVRmaError(rpcErr) || isMissingLifetimeColError(rpcErr))) {
    const stagedRes = await executeExpressViaStagedRpcCompat(rpcPayload, admin)
    rpcRes = stagedRes.data
    rpcErr = stagedRes.error
  }

  if (!rpcErr && rpcRes?.success) {
    invalidateInvoicesCache(businessId)
    if (expressComplete && quote.isFull && isUuid(order.customer_id)) {
      reversePointsForOrder(admin, {
        businessId,
        customerId: order.customer_id,
        orderId,
        orderNumber: order.order_number || orderId,
        reverseType: 'reversed'
      }).catch(() => {})
    }
    return {
      success: true,
      rmaId: rpcRes.rma_id,
      rmaNumber: rpcRes.rma_number,
      newGrandTotal: rpcRes.new_grand_total ?? Number(order.grand_total || 0),
      paymentStatus: rpcRes.payment_status ?? order.payment_status,
      allocatedAmount: Number(rpcRes.allocated_amount || 0),
      allocatedTargetOrderId: rpcRes.allocated_target_order_id || null,
      expressComplete,
      message: expressComplete
        ? Number(rpcRes.allocated_amount || 0) > 0
          ? `RMA ${rpcRes.rma_number} selesai: stok & jurnal diperbarui, dan kredit Rp ${Number(rpcRes.allocated_amount).toLocaleString('id-ID')} otomatis memotong piutang nota tujuan.`
          : `RMA ${rpcRes.rma_number} selesai diproses: stok gudang, jurnal akuntansi, dan saldo pesanan/invoice telah diperbarui otomatis.`
        : `Tiket ${rpcRes.rma_number} berhasil diterbitkan. Stok & jurnal keuangan aman tertahan hingga paket tiba di gudang.`
    }
  }

  if (rpcErr && rpcErr.code !== 'PGRST202') {
    throw new ReturnError(rpcErr.message || 'Gagal memproses transaksi RMA.', 'RMA_RPC_ERROR', 400)
  }

  // Resilient Node fallback when SQL migration hasn't been applied to Supabase yet
  return executeRmaNodeFallback(rpcPayload, order, admin)
}

/**
 * Warehouse Step 2 & 3: Confirms physical arrival and executes QC Disposition per item.
 */
export async function inspectRmaService(
  params: InspectRmaParams,
  supabase: SupabaseClient,
  supabaseAdmin?: SupabaseClient
) {
  const admin = supabaseAdmin || supabase
  const { businessId, actorId, rmaId, items, returnCourier, returnTrackingNumber } = params

  if (!isUuid(rmaId)) {
    throw new ReturnError('ID RMA tidak valid.', 'INVALID_RMA_ID', 400)
  }

  const [rmaRes, accountMap] = await Promise.all([
    admin
      .from('rma_requests')
      .select('*, rma_items(*), orders(id, order_number)')
      .eq('id', rmaId)
      .eq('business_id', businessId)
      .single(),
    getOrCreateDefaultAccounts(businessId, admin)
  ])

  const rma = rmaRes.data
  if (rmaRes.error || !rma) {
    throw new ReturnError('Dokumen RMA tidak ditemukan.', 'RMA_NOT_FOUND', 404)
  }

  const dispByItemId = new Map(items.map((i) => [i.rmaItemId, i.disposition]))
  const dbItems: any[] = rma.rma_items || []

  const mappedItems = dbItems.map((it) => ({
    rma_item_id: it.id,
    product_id: it.product_id,
    variant_id: it.variant_id,
    qty: Number(it.qty || 0),
    unit_cost: Number(it.unit_cost || 0),
    track_stock: Boolean(it.track_stock),
    disposition: dispByItemId.get(it.id) || 'restock'
  }))

  const allQuarantine = mappedItems.every((i) => i.disposition === 'quarantine')
  const invLines = buildInventoryDispositionJournal({
    items: mappedItems.map((i) => ({
      qty: i.qty,
      unitCost: i.unit_cost,
      trackStock: i.track_stock,
      disposition: i.disposition as RmaDisposition
    })),
    accountMap
  })

  const rpcPayload = {
    mode: 'inspect',
    business_id: businessId,
    actor_id: actorId,
    order_id: rma.order_id,
    rma_id: rmaId,
    header: {
      fulfillment_stage: allQuarantine ? 'received_quarantine' : 'inspected',
      return_courier: returnCourier || null,
      return_tracking_number: returnTrackingNumber || null
    },
    items: mappedItems,
    inventory_journal:
      invLines.length > 0
        ? {
            date: new Date().toISOString(),
            description: `Penerimaan & QC Gudang Retur RMA #${rma.rma_number} (Pesanan #${rma.orders?.order_number || ''})`,
            lines: invLines
          }
        : null
  }

  const { data: rpcRes, error: rpcErr } = await admin.rpc('process_rma_transition_v1', {
    payload: rpcPayload
  })

  if (rpcErr) {
    throw new ReturnError(rpcErr.message || 'Gagal menyimpan hasil QC gudang.', 'INSPECT_ERROR', 400)
  }

  return {
    success: true,
    rmaId,
    rmaNumber: rma.rma_number,
    transactionId: rpcRes?.inventory_transaction_id || null,
    message: `Pemeriksaan fisik RMA ${rma.rma_number} berhasil disimpan dan mutasi stok serta jurnal persediaan telah diperbarui.`
  }
}

/**
 * Finance Step 4: Settles customer credit via Credit Memo (cuts Invoice AR),
 * Store Credit, or Cash/Bank Refund.
 */
export async function settleRmaService(
  params: SettleRmaParams,
  supabase: SupabaseClient,
  supabaseAdmin?: SupabaseClient
) {
  const admin = supabaseAdmin || supabase
  const {
    businessId,
    actorId,
    actorName,
    rmaId,
    settlementMethod,
    refundAccountId,
    refundMethodLabel,
    restockingFeeOverride,
    shiftId,
    targetOrderId = null
  } = params

  if (!isUuid(rmaId)) {
    throw new ReturnError('ID RMA tidak valid.', 'INVALID_RMA_ID', 400)
  }

  const [rmaRes, accountMap, paymentAccounts] = await Promise.all([
    admin
      .from('rma_requests')
      .select('*, orders(*)')
      .eq('id', rmaId)
      .eq('business_id', businessId)
      .single(),
    getOrCreateDefaultAccounts(businessId, admin),
    getActivePaymentAccounts(businessId, admin)
  ])

  const rma = rmaRes.data
  if (rmaRes.error || !rma || !rma.orders) {
    throw new ReturnError('Dokumen RMA atau Pesanan asal tidak ditemukan.', 'RMA_NOT_FOUND', 404)
  }

  const order = rma.orders
  const grossReturn = Number(rma.gross_return_amount || 0)
  const finalFee =
    restockingFeeOverride !== undefined && Number.isFinite(Number(restockingFeeOverride))
      ? Math.max(0, Math.min(grossReturn, round(Number(restockingFeeOverride))))
      : Number(rma.restocking_fee || 0)

  const fin = computeSettlementAccounting({
    order,
    grossReturn,
    restockingFee: finalFee,
    settlementMethod,
    refundAccountId,
    refundMethodLabel,
    accountMap,
    paymentAccounts
  })

  const paymentsWithShift = fin.payments.map((p) => ({
    ...p,
    shift_id: isUuid(shiftId) ? shiftId : null
  }))

  const rpcPayload = {
    mode: 'settle',
    business_id: businessId,
    actor_id: actorId,
    order_id: order.id,
    rma_id: rmaId,
    expected_grand_total: Number(order.grand_total || 0),
    expected_amount_paid: Number(order.amount_paid || 0),
    header: {
      settlement_method: settlementMethod,
      restocking_fee: finalFee,
      net_credit_amount: fin.netCredit,
      refund_paid_amount: fin.refundPaidAmount,
      credit_memo_amount: fin.arCutAmount,
      store_credit_issued: fin.storeCreditIssued,
      settlement_json: {
        requested_method: settlementMethod,
        target_order_id: isUuid(targetOrderId) ? targetOrderId : null,
        ar_cut_amount: fin.arCutAmount,
        refund_paid_amount: fin.refundPaidAmount,
        store_credit_issued: fin.storeCreditIssued
      }
    },
    settlement_journal: {
      date: new Date().toISOString(),
      description:
        fin.arCutAmount > 0 && fin.refundPaidAmount === 0
          ? `Nota Kredit Retur Penjualan #${order.order_number} (${rma.rma_number})`
          : `Penyelesaian Retur Penjualan #${order.order_number} (${rma.rma_number})`,
      lines: fin.journalLines
    },
    deposit_transfer_journal:
      fin.depositTransferLines.length > 0
        ? {
            date: new Date().toISOString(),
            description:
              fin.refundPaidAmount > 0
                ? `Pencairan Kelebihan Bayar #${order.order_number} (${rma.rma_number})`
                : `Alokasi Deposit Saldo Kredit #${order.order_number} (${rma.rma_number})`,
            lines: fin.depositTransferLines
          }
        : null,
    order_update: {
      grand_total: fin.newGrandTotal,
      return_status:
        fin.newGrandTotal <= 0.01 ? 'full' : 'partial',
      returned_total_delta: grossReturn,
      exchanged_in_total_delta: 0
    },
    payments: paymentsWithShift,
    store_credit:
      fin.storeCreditIssued > 0 && isUuid(order.customer_id)
        ? {
            customer_id: order.customer_id,
            amount: fin.storeCreditIssued,
            description: `Saldo kredit dari RMA ${rma.rma_number} (#${order.order_number})`
          }
        : null,
    cross_invoice_allocation:
      settlementMethod === 'apply_other_invoice' &&
      fin.storeCreditIssued > 0 &&
      isUuid(order.customer_id) &&
      isUuid(targetOrderId)
        ? {
            target_order_id: targetOrderId,
            customer_id: order.customer_id,
            amount: fin.storeCreditIssued,
            store_credit_account_id: fin.storeCreditAcc,
            receivable_account_id: fin.arAcc,
            cashier_name: actorName
          }
        : null
  }

  const { data: rpcRes, error: rpcErr } = await runSettleWithSchemaCompat(rpcPayload, admin)

  if (rpcErr) {
    throw new ReturnError(rpcErr.message || 'Gagal menyelesaikan pembayaran/kredit RMA.', 'SETTLE_ERROR', 400)
  }

  invalidateInvoicesCache(businessId)
  if (fin.newGrandTotal <= 0.01 && isUuid(order.customer_id)) {
    reversePointsForOrder(admin, {
      businessId,
      customerId: order.customer_id,
      orderId: order.id,
      orderNumber: order.order_number || order.id,
      reverseType: 'reversed'
    }).catch(() => {})
  }

  return {
    success: true,
    rmaId,
    rmaNumber: rma.rma_number,
    newGrandTotal: rpcRes?.new_grand_total ?? fin.newGrandTotal,
    paymentStatus: rpcRes?.payment_status,
    arCutAmount: fin.arCutAmount,
    refundPaidAmount: fin.refundPaidAmount,
    storeCreditIssued: fin.storeCreditIssued,
    allocatedAmount: Number(rpcRes?.allocated_amount || 0),
    allocatedTargetOrderId: rpcRes?.allocated_target_order_id || null,
    message:
      Number(rpcRes?.allocated_amount || 0) > 0
        ? `Penyelesaian RMA ${rma.rma_number} berhasil: kredit Rp ${Number(rpcRes.allocated_amount).toLocaleString('id-ID')} otomatis memotong piutang nota tujuan.`
        : fin.arCutAmount > 0 && fin.refundPaidAmount === 0
        ? `Nota Kredit ${rma.rma_number} berhasil memotong tagihan #${order.order_number} sebesar Rp ${fin.arCutAmount.toLocaleString('id-ID')}.`
        : `Penyelesaian RMA ${rma.rma_number} berhasil diposting ke Buku Besar.`
  }
}

async function executeRmaNodeFallback(
  rpcPayload: any,
  order: any,
  admin: SupabaseClient
) {
  const businessId = rpcPayload.business_id
  const orderId = rpcPayload.order_id
  const hdr = rpcPayload.header
  const rmaId = crypto.randomUUID()
  const nowIso = new Date().toISOString()

  if (rpcPayload.inventory_journal?.lines?.length > 0) {
    await postJournalTransaction(
      businessId,
      orderId,
      nowIso,
      rpcPayload.inventory_journal.description,
      rpcPayload.inventory_journal.lines,
      admin,
      true
    )
  }

  if (rpcPayload.mode === 'express') {
    const moves: StockMoveInput[] = []
    for (const it of rpcPayload.items || []) {
      if (it.track_stock && isUuid(it.product_id) && (it.disposition === 'restock' || it.disposition === 'quarantine')) {
        moves.push({
          businessId,
          productId: it.product_id,
          variantId: it.variant_id || null,
          reference: hdr.rma_number,
          qty: it.qty,
          unitCost: it.unit_cost,
          type: 'receipt',
          sourceType: it.disposition === 'quarantine' ? 'rma_receipt' : 'rma_receive',
          sourceId: rmaId,
          status: 'done',
          bucket: it.disposition === 'quarantine' ? 'quarantine' : 'main',
          createdAt: nowIso
        })
      }
    }
    if (moves.length > 0) {
      await recordStockMovements(moves, admin)
    }
  }

  if (rpcPayload.settlement_journal?.lines?.length > 0) {
    await postJournalTransaction(
      businessId,
      orderId,
      nowIso,
      rpcPayload.settlement_journal.description,
      rpcPayload.settlement_journal.lines,
      admin,
      true
    )
  }

  if (rpcPayload.deposit_transfer_journal?.lines?.length > 0) {
    await postJournalTransaction(
      businessId,
      orderId,
      nowIso,
      rpcPayload.deposit_transfer_journal.description,
      rpcPayload.deposit_transfer_journal.lines,
      admin,
      true
    )
  }

  if (rpcPayload.store_credit?.amount > 0 && isUuid(rpcPayload.store_credit.customer_id)) {
    const sc = rpcPayload.store_credit
    await applyLegacyStoreCreditCompat(admin, {
      businessId,
      customerId: sc.customer_id,
      issuedAmount: Number(sc.amount || 0),
      redeemedAmount: 0,
      rmaId,
      rmaNumber: hdr.rma_number,
      sourceOrderId: orderId,
      actorId: rpcPayload.actor_id,
      description: sc.description
    })

    if (rpcPayload.cross_invoice_allocation?.target_order_id) {
      const alloc = rpcPayload.cross_invoice_allocation
      await recordOrderPayment({
        businessId,
        orderId: alloc.target_order_id,
        amount: Number(alloc.amount || 0),
        paymentMethod: 'Saldo Kredit Pelanggan',
        paymentMethodAccountId: alloc.store_credit_account_id || null,
        notes: `Alokasi Otomatis Saldo Kredit dari RMA ${hdr.rma_number}`,
        cashierName: alloc.cashier_name || hdr.created_by_name || 'Sistem RMA',
        actorId: rpcPayload.actor_id,
        supabase: admin
      }).catch(() => {})
    }
  }

  if (rpcPayload.order_update) {
    const ou = rpcPayload.order_update
    const payOut = (rpcPayload.payments || []).reduce(
      (s: number, p: any) => s + (p.kind === 'refund' ? Number(p.amount || 0) : 0),
      0
    )
    const newPaid = Math.max(0, Number(order.amount_paid || 0) - payOut)
    const newPayStatus =
      newPaid >= ou.grand_total - 0.01 ? 'paid' : newPaid > 0 ? 'partial' : 'unpaid'

    await admin
      .from('orders')
      .update({
        grand_total: ou.grand_total,
        amount_paid: newPaid,
        payment_status: newPayStatus,
        return_status: ou.return_status,
        returned_total: Number(order.returned_total || 0) + Number(ou.returned_total_delta || 0),
        updated_at: nowIso
      })
      .eq('id', orderId)
  }

  invalidateInvoicesCache(businessId)
  return {
    success: true,
    rmaId,
    rmaNumber: hdr.rma_number,
    expressComplete: rpcPayload.mode === 'express',
    message: `Transaksi RMA ${hdr.rma_number} berhasil diproses.`
  }
}

