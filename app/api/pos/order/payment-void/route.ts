import { getApiContext } from '@/lib/apiContext'
import { voidOrderPayment } from '@/lib/paymentLedger'
import { NextResponse } from 'next/server'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const isUuid = (v: unknown): v is string => typeof v === 'string' && UUID_RE.test(v)

// POST /api/pos/order/payment-void - Void a specific payment line item
export async function POST(req: Request) {
  try {
    const ctx = await getApiContext()
    if (ctx.error) return ctx.error
    const { user, businessId, supabase } = ctx

    // 1. Session Gating: Enforce active shift
    const { data: activeShift, error: shiftErr } = await supabase
      .from('pos_shifts')
      .select('id, register_id, cashier_name')
      .eq('business_id', businessId)
      .eq('user_id', user.id)
      .eq('status', 'open')
      .order('opened_at', { ascending: false })
      .maybeSingle()

    if (shiftErr || !activeShift) {
      return NextResponse.json({
        error: 'Sesi kasir belum dibuka. Anda harus memiliki shift aktif untuk melakukan pembatalan (void) pembayaran.'
      }, { status: 403 })
    }

    const body = await req.json().catch(() => null)
    if (!body) {
      return NextResponse.json({ error: 'Body permintaan tidak valid' }, { status: 400 })
    }

    const { payment_id, void_reason } = body
    if (!isUuid(payment_id)) {
      return NextResponse.json({ error: 'payment_id tidak valid' }, { status: 400 })
    }

    // 2. Delegate to reusable Payment Ledger Engine
    const result = await voidOrderPayment({
      businessId,
      paymentId: payment_id,
      voidReason: void_reason || 'Koreksi Kasir',
      shiftId: activeShift.id,
      cashierName: activeShift.cashier_name,
      supabase
    })

    return NextResponse.json(result, { status: 200 })
  } catch (err: any) {
    console.error('POS Payment Void Error:', err)
    return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500 })
  }
}
