import { getApiContext } from '@/lib/apiContext'
import { getActivePaymentAccounts, resolvePaymentAccountFromCOA } from '@/lib/accountHelper'
import { recordOrderPayment, voidOrderPayment } from '@/lib/paymentLedger'
import { syncOrderToLedger } from '@/lib/orderLedger'
import { isUuid } from '@/lib/utils'
import { invalidateInvoicesCache } from '../../route'
import { NextResponse } from 'next/server'

async function verifyInvoiceEditPermission(
  invoiceId: string,
  businessId: string,
  userId: string,
  supabaseAdmin: any
) {
  const [{ data: profile }, { data: invoice, error: fetchErr }] = await Promise.all([
    supabaseAdmin.from('profiles').select('role, full_name').eq('id', userId).maybeSingle(),
    supabaseAdmin
      .from('orders')
      .select('id, order_number, grand_total, amount_paid, payment_status, payment_method, status, user_id, order_date, created_at')
      .eq('id', invoiceId)
      .eq('business_id', businessId)
      .or('source_platform.eq.Invoice,raw_source_data->>is_invoice.eq.true,order_number.ilike.INV-%')
      .single()
  ])

  if (fetchErr || !invoice) {
    return { error: NextResponse.json({ error: 'Invoice tidak ditemukan' }, { status: 404 }) }
  }

  if (profile?.role !== 'admin' && invoice.user_id && invoice.user_id !== userId) {
    return {
      error: NextResponse.json(
        { error: 'Anda tidak memiliki akses untuk mengubah pembayaran invoice ini. Hanya pembuat invoice atau Admin yang dapat mengubahnya.' },
        { status: 403 }
      )
    }
  }

  return { invoice, profile }
}

/**
 * Ensures legacy invoices that were marked paid/partial before order_payments table existed
 * have a baseline order_payments row so they can be properly voided with an append-only reversal.
 */
async function ensureBaselinePaymentRowForLegacyInvoice(
  invoice: any,
  businessId: string,
  paymentAccounts: any[],
  supabaseAdmin: any
): Promise<string | null> {
  const { data: existingPays } = await supabaseAdmin
    .from('order_payments')
    .select('id, payment_kind, voided_payment_id')
    .eq('order_id', invoice.id)
    .order('created_at', { ascending: true })

  const reversedIds = new Set(
    (existingPays || [])
      .filter((p: any) => p.payment_kind === 'void' || p.payment_kind === 'refund')
      .map((p: any) => p.voided_payment_id)
      .filter(Boolean)
  )
  const activePays = (existingPays || []).filter(
    (p: any) => p.payment_kind === 'payment' && !reversedIds.has(p.id)
  )

  if (activePays.length > 0) {
    return activePays[activePays.length - 1].id
  }

  // Legacy paid invoice with 0 active rows in order_payments
  const legacyPaidAmount = Number(invoice.amount_paid || (invoice.payment_status === 'paid' || invoice.status === 'completed' ? invoice.grand_total : 0))
  if (legacyPaidAmount <= 0) return null

  const matchedAcc = resolvePaymentAccountFromCOA(paymentAccounts, invoice.payment_method, null)
  const baseDateIso = invoice.order_date || invoice.created_at || new Date().toISOString()

  // Find existing payment transaction if any
  const { data: txs } = await supabaseAdmin
    .from('transactions')
    .select('id, description')
    .eq('order_id', invoice.id)

  const payTx = (txs || []).find((tx: any) =>
    (tx.description?.includes('Pembayaran') || tx.description?.includes('Pelunasan')) &&
    !tx.description?.includes('Void') && !tx.description?.includes('Pembatalan')
  )

  const { data: insertedLegacyPay } = await supabaseAdmin
    .from('order_payments')
    .insert({
      payment_kind: 'payment',
      business_id: businessId,
      order_id: invoice.id,
      transaction_id: payTx?.id || null,
      date: String(baseDateIso).split('T')[0],
      amount: legacyPaidAmount,
      payment_method: matchedAcc?.name || invoice.payment_method || 'Bank Transfer',
      payment_method_account_id: matchedAcc?.id || null,
      notes: `Pembayaran Invoice #${invoice.order_number} (Data Historis)`,
      created_at: baseDateIso
    })
    .select('id')
    .single()

  return insertedLegacyPay?.id || null
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    if (!isUuid(id)) {
      return NextResponse.json({ error: 'ID invoice tidak valid' }, { status: 400 })
    }

    const ctx = await getApiContext({ req })
    if (ctx.error) return ctx.error
    const { user, businessId, supabaseAdmin } = ctx

    const body = await req.json().catch(() => ({}))
    const {
      action = 'record', // 'record' | 'void' | 'replace'
      payment_id,
      void_reason,
      payment_method,
      payment_method_account_id,
      payment_date,
      notes,
      amount
    } = body

    const perm = await verifyInvoiceEditPermission(id, businessId, user.id, supabaseAdmin)
    if (perm.error) return perm.error
    const { invoice, profile } = perm

    if (invoice.status === 'cancelled') {
      return NextResponse.json(
        { error: 'Tidak dapat memproses atau membatalkan pembayaran untuk invoice yang telah dibatalkan penuh.' },
        { status: 400 }
      )
    }

    const actorName = profile?.full_name || user.user_metadata?.full_name || 'Staff'
    const paymentAccounts = await getActivePaymentAccounts(businessId, supabaseAdmin)

    // ─── ACTION 1: VOID EXISTING PAYMENT (Append-Only Compensating Reversal) ─────
    if (action === 'void') {
      const cleanVoidReason = String(void_reason || '').trim()
      if (cleanVoidReason.length < 5) {
        return NextResponse.json(
          { error: 'Alasan pembatalan (void) wajib diisi minimal 5 karakter untuk jejak audit akuntansi.' },
          { status: 400 }
        )
      }

      let targetPaymentId = isUuid(payment_id) ? payment_id : null
      if (!targetPaymentId) {
        targetPaymentId = await ensureBaselinePaymentRowForLegacyInvoice(
          invoice,
          businessId,
          paymentAccounts,
          supabaseAdmin
        )
      }

      if (!targetPaymentId) {
        return NextResponse.json(
          { error: 'Data pembayaran yang akan di-void tidak ditemukan.' },
          { status: 404 }
        )
      }

      const voidRes = await voidOrderPayment({
        businessId,
        paymentId: targetPaymentId,
        voidReason: cleanVoidReason,
        sourceLabel: `Invoice #${invoice.order_number}`,
        cashierName: actorName,
        supabase: supabaseAdmin
      })

      invalidateInvoicesCache(businessId)

      return NextResponse.json({
        success: true,
        message: voidRes.message,
        payment_status: voidRes.payment_status,
        status: invoice.status,
        amount_paid: voidRes.amount_paid,
        remaining_balance: voidRes.outstanding,
        void_payment: voidRes.payment
      })
    }

    // ─── ACTION 2: REPLACE PAYMENT (Atomic Void Old + Record New Payment) ────────
    if (action === 'replace') {
      const cleanVoidReason = String(void_reason || 'Ganti metode / akun pembayaran').trim()
      if (cleanVoidReason.length < 5) {
        return NextResponse.json(
          { error: 'Alasan penggantian pembayaran wajib diisi minimal 5 karakter untuk jejak audit akuntansi.' },
          { status: 400 }
        )
      }

      const validAccountId = isUuid(payment_method_account_id) ? payment_method_account_id : null
      if (!payment_method && !validAccountId) {
        return NextResponse.json(
          { error: 'Metode pembayaran atau akun Kas/Bank COA pengganti wajib dipilih.' },
          { status: 400 }
        )
      }

      let targetPaymentId = isUuid(payment_id) ? payment_id : null
      if (!targetPaymentId) {
        targetPaymentId = await ensureBaselinePaymentRowForLegacyInvoice(
          invoice,
          businessId,
          paymentAccounts,
          supabaseAdmin
        )
      }

      if (!targetPaymentId) {
        return NextResponse.json(
          { error: 'Data pembayaran asal yang akan diganti tidak ditemukan.' },
          { status: 404 }
        )
      }

      // Fetch old payment to know default amount & date if not overridden
      const { data: oldPay } = await supabaseAdmin
        .from('order_payments')
        .select('id, amount, date, created_at, payment_method')
        .eq('id', targetPaymentId)
        .eq('business_id', businessId)
        .maybeSingle()

      if (!oldPay) {
        return NextResponse.json({ error: 'Baris pembayaran asal tidak ditemukan.' }, { status: 404 })
      }

      const mNormReplace = String(payment_method || '').toLowerCase()
      const isStoreCreditReplace =
        mNormReplace === 'store_credit' ||
        mNormReplace.includes('saldo kredit') ||
        mNormReplace.includes('store credit')
      const matchedAcc = isStoreCreditReplace
        ? null
        : resolvePaymentAccountFromCOA(paymentAccounts, payment_method, validAccountId)
      const resolvedAccountId = isStoreCreditReplace ? validAccountId : (matchedAcc?.id || validAccountId)
      const resolvedPaymentMethod = isStoreCreditReplace
        ? 'Saldo Kredit Pelanggan'
        : (matchedAcc?.name || payment_method || 'Bank Transfer')

      // Step 2A: Void the old payment (reversal journal posted on original payment date)
      const voidRes = await voidOrderPayment({
        businessId,
        paymentId: targetPaymentId,
        voidReason: `${cleanVoidReason} (Diganti ke ${resolvedPaymentMethod})`,
        sourceLabel: `Invoice #${invoice.order_number}`,
        cashierName: actorName,
        supabase: supabaseAdmin
      })

      // Step 2B: Record the replacement payment
      const maxReplaceable = voidRes.outstanding
      const requestedNewAmount = amount !== undefined && Number(amount) > 0 ? Number(amount) : Number(oldPay.amount || maxReplaceable)
      const finalNewAmount = Math.min(maxReplaceable, Math.max(1, requestedNewAmount))
      const effectiveNewDate = payment_date || oldPay.date || oldPay.created_at || new Date().toISOString()

      const recordRes = await recordOrderPayment({
        businessId,
        orderId: id,
        amount: finalNewAmount,
        paymentMethod: resolvedPaymentMethod,
        paymentMethodAccountId: resolvedAccountId,
        paymentDate: effectiveNewDate,
        notes: notes || `Pengganti Pembayaran Invoice #${invoice.order_number} (${cleanVoidReason})`,
        cashierName: actorName,
        supabase: supabaseAdmin
      })

      await syncOrderToLedger(id, supabaseAdmin)
      invalidateInvoicesCache(businessId)

      return NextResponse.json({
        success: true,
        message: `Pembayaran lama (${oldPay.payment_method}) berhasil di-void dan diganti ke ${resolvedPaymentMethod} sebesar Rp ${finalNewAmount.toLocaleString('id-ID')}.`,
        payment_status: recordRes.payment_status,
        status: invoice.status,
        amount_paid: recordRes.amount_paid,
        remaining_balance: recordRes.outstanding,
        payment: recordRes.payment
      })
    }

    // ─── ACTION 3: RECORD NEW PAYMENT / INSTALLMENT (Default) ────────────────────
    const validAccountId = isUuid(payment_method_account_id) ? payment_method_account_id : null
    if (!payment_method && !validAccountId) {
      return NextResponse.json({ 
        error: 'Metode pembayaran atau akun Kas/Bank COA wajib dipilih' 
      }, { status: 400 })
    }

    const mNormRecord = String(payment_method || '').toLowerCase()
    const isStoreCreditRecord =
      mNormRecord === 'store_credit' ||
      mNormRecord.includes('saldo kredit') ||
      mNormRecord.includes('store credit')
    const matchedAcc = isStoreCreditRecord
      ? null
      : resolvePaymentAccountFromCOA(paymentAccounts, payment_method, validAccountId)
    const resolvedAccountId = isStoreCreditRecord ? validAccountId : (matchedAcc?.id || validAccountId)
    const resolvedPaymentMethod = isStoreCreditRecord
      ? 'Saldo Kredit Pelanggan'
      : (matchedAcc?.name || payment_method || 'Bank Transfer')

    const grandTotal = Number(invoice.grand_total) || 0
    const currentPaid = Number(invoice.amount_paid) || 0
    const remainingBalance = Math.max(0, grandTotal - currentPaid)

    if (remainingBalance <= 0 || invoice.payment_status === 'paid') {
      return NextResponse.json({ error: 'Invoice ini sudah lunas. Untuk mengganti akun/metode bayar, gunakan fitur Void atau Ganti Pembayaran pada Riwayat Pembayaran.' }, { status: 400 })
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
      paymentMethod: resolvedPaymentMethod,
      paymentMethodAccountId: resolvedAccountId,
      paymentDate: payment_date || null,
      notes: notes || `Pembayaran Invoice #${invoice.order_number}`,
      cashierName: actorName,
      supabase: supabaseAdmin
    })

    // 3. Ensure stock and any remaining triggers are synchronized
    await syncOrderToLedger(id, supabaseAdmin)

    invalidateInvoicesCache(businessId)

    return NextResponse.json({
      success: true,
      message: result.payment_status === 'paid'
        ? 'Pembayaran lunas berhasil dicatat'
        : `Pembayaran sebagian sebesar Rp ${paymentAmount.toLocaleString('id-ID')} berhasil dicatat`,
      payment_status: result.payment_status,
      status: invoice.status,
      amount_paid: result.amount_paid,
      remaining_balance: result.outstanding,
      payment: result.payment
    })
  } catch (err: any) {
    console.error('Record Invoice Payment Error:', err)
    return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500 })
  }
}
