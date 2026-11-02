import { getApiContext } from '@/lib/apiContext'
import { recordOrderPayment } from '@/lib/paymentLedger'
import { syncOrderToLedger } from '@/lib/orderLedger'
import { isUuid } from '@/lib/utils'
import { invalidateInvoicesCache } from '../../route'
import { NextResponse } from 'next/server'

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    if (!isUuid(id)) {
      return NextResponse.json({ error: 'ID invoice tidak valid' }, { status: 400 })
    }

    const ctx = await getApiContext()
    if (ctx.error) return ctx.error
    const { user, businessId, supabaseAdmin } = ctx

    const body = await req.json().catch(() => ({}))
    const { payment_method, notes, amount } = body

    if (!payment_method || !['Cash', 'Bank/QRIS', 'Bank Transfer', 'QRIS'].includes(payment_method)) {
      return NextResponse.json({ 
        error: 'Metode pembayaran wajib disertakan dan harus valid (Cash, Bank Transfer, atau QRIS)' 
      }, { status: 400 })
    }

    // 1. Fetch invoice to verify remaining balance
    const { data: invoice, error: fetchErr } = await supabaseAdmin
      .from('orders')
      .select('id, order_number, grand_total, amount_paid, payment_status, status')
      .eq('id', id)
      .eq('business_id', businessId)
      .or('source_platform.eq.Invoice,raw_source_data->>is_invoice.eq.true,order_number.ilike.INV-%')
      .single()

    if (fetchErr || !invoice) {
      return NextResponse.json({ error: 'Invoice tidak ditemukan' }, { status: 404 })
    }

    if (invoice.status === 'cancelled') {
      return NextResponse.json({ error: 'Tidak dapat mencatat pembayaran untuk invoice yang telah dibatalkan' }, { status: 400 })
    }

    const grandTotal = Number(invoice.grand_total) || 0
    const currentPaid = Number(invoice.amount_paid) || 0
    const remainingBalance = Math.max(0, grandTotal - currentPaid)

    if (remainingBalance <= 0 || invoice.payment_status === 'paid') {
      return NextResponse.json({ error: 'Invoice ini sudah lunas' }, { status: 400 })
    }

    const paymentAmount = amount !== undefined ? Math.min(remainingBalance, Math.max(0, Number(amount))) : remainingBalance
    if (paymentAmount <= 0) {
      return NextResponse.json({ error: 'Nominal pembayaran harus lebih besar dari 0' }, { status: 400 })
    }

    // 2. Delegate to Universal payment recording engine (Single Source of Truth)
    const result = await recordOrderPayment({
      businessId,
      orderId: id,
      amount: paymentAmount,
      paymentMethod: payment_method === 'Cash' ? 'cash' : 'bank',
      notes: notes || `Pembayaran Invoice #${invoice.order_number}`,
      cashierName: user.user_metadata?.full_name || 'Staff',
      supabase: supabaseAdmin
    })

    // 3. If fully paid and currently processing, update order status to completed
    let finalStatus = invoice.status
    if (result.payment_status === 'paid' && invoice.status === 'processing') {
      finalStatus = 'completed'
      await supabaseAdmin
        .from('orders')
        .update({ status: finalStatus, updated_at: new Date().toISOString() })
        .eq('id', id)
    }

    // 4. Ensure stock and any remaining triggers are synchronized
    await syncOrderToLedger(id, supabaseAdmin)

    invalidateInvoicesCache(businessId)

    return NextResponse.json({
      success: true,
      message: result.payment_status === 'paid'
        ? 'Pembayaran lunas berhasil dicatat'
        : `Pembayaran sebagian sebesar Rp ${paymentAmount.toLocaleString('id-ID')} berhasil dicatat`,
      payment_status: result.payment_status,
      status: finalStatus,
      amount_paid: result.amount_paid,
      remaining_balance: result.outstanding,
      payment: result.payment
    })
  } catch (err: any) {
    console.error('Record Invoice Payment Error:', err)
    return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500 })
  }
}
