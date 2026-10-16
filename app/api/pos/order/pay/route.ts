import { getApiContext } from '@/lib/apiContext'
import { recordOrderPayment } from '@/lib/paymentLedger'
import { NextResponse } from 'next/server'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const isUuid = (v: unknown): v is string => typeof v === 'string' && UUID_RE.test(v)

// POST /api/pos/order/pay - Record an installment / additional payment for an order
export async function POST(req: Request) {
  try {
    const ctx = await getApiContext()
    if (ctx.error) return ctx.error
    const { user, businessId, supabase } = ctx

    const body = await req.json().catch(() => null)
    if (!body) {
      return NextResponse.json({ error: 'Body permintaan tidak valid' }, { status: 400 })
    }

    const {
      order_id,
      amount,
      payment_method = 'cash',
      payment_method_account_id = null,
      cash_received = 0,
      change_amount = 0,
      notes = '',
      reference_number = null
    } = body

    if (!isUuid(order_id)) {
      return NextResponse.json({ error: 'order_id tidak valid' }, { status: 400 })
    }

    // 1. Session Gating: Enforce active shift for Cash (Floating Drawer)
    const { data: activeShift, error: shiftErr } = await supabase
      .from('pos_shifts')
      .select('id, register_id, cashier_name')
      .eq('business_id', businessId)
      .eq('user_id', user.id)
      .eq('status', 'open')
      .order('opened_at', { ascending: false })
      .maybeSingle()

    const isCash = String(payment_method).toLowerCase() === 'cash'
    if (isCash && (shiftErr || !activeShift)) {
      return NextResponse.json({
        error: 'Sesi kasir belum dibuka. Anda harus membuka shift kasir aktif di POS untuk menerima pembayaran tunai.'
      }, { status: 403 })
    }

    // 2. Delegate to reusable Payment Ledger Engine
    const result = await recordOrderPayment({
      businessId,
      orderId: order_id,
      amount: parseFloat(amount),
      paymentMethod: payment_method,
      paymentMethodAccountId: isUuid(payment_method_account_id) ? payment_method_account_id : null,
      cashReceived: Number(cash_received),
      changeAmount: Number(change_amount),
      referenceNumber: reference_number,
      notes,
      shiftId: activeShift ? activeShift.id : null,
      cashierName: activeShift ? activeShift.cashier_name : (user.user_metadata?.full_name || 'Staff'),
      supabase
    })

    return NextResponse.json(result, { status: 200 })
  } catch (err: any) {
    console.error('POS Installment Pay Error:', err)
    return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500 })
  }
}
