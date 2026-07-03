import { createClient } from '@/lib/supabaseServer'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const supabase = await createClient()

  try {
    // 1. Get logged-in user and active business ID
    const { data: { user }, error: authErr } = await supabase.auth.getUser()
    if (authErr || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { data: profile } = await supabase
      .from('profiles')
      .select('active_business_id')
      .eq('id', user.id)
      .single()

    if (!profile?.active_business_id) {
      return NextResponse.json({ error: 'Active business not found' }, { status: 400 })
    }

    const businessId = profile.active_business_id
    const body = await req.json()
    const { payment_method, payment_date = new Date().toISOString() } = body

    if (!payment_method || !['Cash', 'Bank/QRIS', 'Bank Transfer', 'QRIS'].includes(payment_method)) {
      return NextResponse.json({ error: 'Metode pembayaran wajib disertakan dan harus valid (Cash atau Bank/QRIS)' }, { status: 400 })
    }

    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
    if (!serviceRoleKey) {
      return NextResponse.json({ error: 'Admin service key not found' }, { status: 500 })
    }
    const supabaseAdmin = createAdminClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      serviceRoleKey
    )

    // 2. Fetch the outstanding invoice
    const { data: invoice, error: fetchErr } = await supabaseAdmin
      .from('orders')
      .select('*')
      .eq('id', id)
      .eq('business_id', businessId)
      .eq('source_platform', 'Invoice')
      .single()

    if (fetchErr || !invoice) {
      return NextResponse.json({ error: 'Invoice tidak ditemukan' }, { status: 404 })
    }

    if (invoice.status === 'completed') {
      return NextResponse.json({ error: 'Invoice sudah lunas' }, { status: 400 })
    }

    if (invoice.status !== 'processing') {
      return NextResponse.json({ error: 'Pembayaran hanya dapat dicatat untuk Invoice yang sudah diterbitkan (Sent/Unpaid)' }, { status: 400 })
    }

    // Normalized payment method for ledger mapping
    const normalizedMethod = (payment_method === 'Cash') ? 'Cash' : 'Bank/QRIS'

    // 3. Update invoice status to completed
    const { error: updErr } = await supabaseAdmin
      .from('orders')
      .update({
        status: 'completed',
        payment_method: payment_method,
        updated_at: new Date().toISOString()
      })
      .eq('id', id)

    if (updErr) throw updErr

    // 4. Record Payment Ledger Jurnal
    // Fetch Accounts
    const { data: allAccounts } = await supabaseAdmin
      .from('accounts')
      .select('id, code')
      .eq('business_id', businessId)

    const accountMap: Record<string, string> = {}
    if (allAccounts) {
      allAccounts.forEach(a => {
        accountMap[a.code] = a.id
      })
    }

    // Determine Kas or Bank account
    const debitAccountCode = normalizedMethod === 'Cash' ? '101000' : '101200'
    const debitAccountId = accountMap[debitAccountCode]
    const creditAccountId = accountMap['103000'] // Piutang Usaha

    if (!debitAccountId || !creditAccountId) {
      throw new Error('Akun Kas/Bank atau Piutang Usaha tidak ditemukan di ledger bisnis Anda.')
    }

    // Write Ledger Transaction
    const { data: tx, error: txErr } = await supabaseAdmin
      .from('transactions')
      .insert({
        business_id: businessId,
        order_id: invoice.id,
        date: payment_date,
        description: `Pelunasan Invoice #${invoice.order_number}`
      })
      .select('id')
      .single()

    if (txErr) throw txErr

    // Debit Kas/Bank, Credit Piutang Usaha
    const paymentLines = [
      {
        transaction_id: tx.id,
        account_id: debitAccountId,
        debit: Number(invoice.grand_total),
        credit: 0
      },
      {
        transaction_id: tx.id,
        account_id: creditAccountId,
        debit: 0,
        credit: Number(invoice.grand_total)
      }
    ]

    const { error: jlErr } = await supabaseAdmin
      .from('journal_lines')
      .insert(paymentLines)

    if (jlErr) throw jlErr

    return NextResponse.json({
      success: true,
      message: 'Pembayaran berhasil dicatat',
      status: 'completed'
    })

  } catch (err: any) {
    console.error('Record Invoice Payment Error:', err)
    return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500 })
  }
}
