import { createClient } from '@/lib/supabaseServer'
import { ensureExpenseAccounts } from '@/lib/expenseLedger'
import { NextResponse } from 'next/server'
import { randomUUID } from 'crypto'

export async function POST(req: Request) {
  const supabase = await createClient()

  try {
    // 1. Authenticate user
    const { data: { user }, error: authErr } = await supabase.auth.getUser()
    if (authErr || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // 2. Fetch active business ID
    const { data: profile, error: profErr } = await supabase
      .from('profiles')
      .select('active_business_id')
      .eq('id', user.id)
      .single()

    if (profErr || !profile?.active_business_id) {
      return NextResponse.json({ error: 'Active business not found' }, { status: 400 })
    }

    const businessId = profile.active_business_id

    // 3. Parse request body
    const body = await req.json()
    const { expenseIds, paymentMethodAccountId, date, notes } = body

    if (!Array.isArray(expenseIds) || expenseIds.length === 0) {
      return NextResponse.json({ error: 'ID pengeluaran harus berupa array dan tidak boleh kosong' }, { status: 400 })
    }

    if (!paymentMethodAccountId || !date) {
      return NextResponse.json({ error: 'Kolom Cara Bayar dan Tanggal Pembayaran wajib diisi' }, { status: 400 })
    }

    // 4. Resolve Account Mapping for Hutang Usaha
    const accountMap = await ensureExpenseAccounts(businessId, supabase)
    const accHutang = accountMap['201000'] // Hutang Usaha

    if (!accHutang) {
      return NextResponse.json({ error: 'Akun Hutang Usaha (201000) belum terkonfigurasi untuk bisnis ini.' }, { status: 500 })
    }

    // 5. Fetch all selected expenses
    const { data: expenses, error: fetchErr } = await supabase
      .from('expenses')
      .select('*')
      .eq('business_id', businessId)
      .in('id', expenseIds)

    if (fetchErr || !expenses) {
      return NextResponse.json({ error: `Gagal mengambil data pengeluaran: ${fetchErr?.message}` }, { status: 500 })
    }

    // Filter only those with outstanding amount > 0 (skip already fully paid ones)
    const expensesToPay = expenses.filter(e => parseFloat(e.outstanding_amount || 0) > 0.01)

    if (expensesToPay.length === 0) {
      return NextResponse.json({
        success: true,
        message: 'Tidak ada pengeluaran bertempo/belum lunas yang perlu dibayar dari pilihan Anda.',
        count: 0
      })
    }

    // Prepare arrays for insertion/updating
    const transactionsToInsert: any[] = []
    const journalLinesToInsert: any[] = []
    const paymentsToInsert: any[] = []
    const txIds: string[] = []

    // 6. Record original states for possible rollback
    const originalExpensesState = expensesToPay.map(e => ({
      id: e.id,
      amount_paid: e.amount_paid,
      outstanding_amount: e.outstanding_amount,
      payment_status: e.payment_status
    }))

    for (const exp of expensesToPay) {
      const txId = randomUUID()
      txIds.push(txId)
      const outstandingAmount = parseFloat(exp.outstanding_amount)

      // A. Create ledger transaction
      transactionsToInsert.push({
        id: txId,
        business_id: businessId,
        date: date,
        description: `Pembayaran Pengeluaran: ${exp.description || 'Operasional'}`
      })

      // B. Create balancing journal lines
      // Debit: Hutang Usaha (reduce liability)
      journalLinesToInsert.push({
        transaction_id: txId,
        account_id: accHutang,
        debit: outstandingAmount,
        credit: 0
      })

      // Credit: Cash/Bank Account
      journalLinesToInsert.push({
        transaction_id: txId,
        account_id: paymentMethodAccountId,
        debit: 0,
        credit: outstandingAmount
      })

      // C. Create payment log
      paymentsToInsert.push({
        business_id: businessId,
        expense_id: exp.id,
        transaction_id: txId,
        date,
        amount: outstandingAmount,
        payment_method_account_id: paymentMethodAccountId,
        notes: notes || null
      })
    }

    // 7. Execute updates & inserts with self-cleaning rollback on failure
    // A. Update parent expenses first
    const updatePromises = expensesToPay.map(exp => {
      const currentAmountPaid = parseFloat(exp.amount_paid || 0)
      const outstanding = parseFloat(exp.outstanding_amount)
      return supabase
        .from('expenses')
        .update({
          amount_paid: currentAmountPaid + outstanding,
          outstanding_amount: 0,
          payment_status: 'paid'
        })
        .eq('id', exp.id)
    })

    const updateResults = await Promise.all(updatePromises)
    const failedUpdate = updateResults.find(r => r.error)
    if (failedUpdate) {
      throw new Error(`Gagal mengupdate status pengeluaran: ${failedUpdate.error.message}`)
    }

    // B. Bulk insert transactions
    const { error: txErr } = await supabase.from('transactions').insert(transactionsToInsert)
    if (txErr) {
      // Revert expenses updates
      await Promise.all(originalExpensesState.map(oe => 
        supabase
          .from('expenses')
          .update({
            amount_paid: oe.amount_paid,
            outstanding_amount: oe.outstanding_amount,
            payment_status: oe.payment_status
          })
          .eq('id', oe.id)
      ))
      throw new Error(`Gagal menyimpan transaksi pembayaran: ${txErr.message}`)
    }

    // C. Bulk insert journal lines
    const { error: jlErr } = await supabase.from('journal_lines').insert(journalLinesToInsert)
    if (jlErr) {
      // Rollback transactions
      await supabase.from('transactions').delete().in('id', txIds)
      // Revert expenses updates
      await Promise.all(originalExpensesState.map(oe => 
        supabase
          .from('expenses')
          .update({
            amount_paid: oe.amount_paid,
            outstanding_amount: oe.outstanding_amount,
            payment_status: oe.payment_status
          })
          .eq('id', oe.id)
      ))
      throw new Error(`Gagal menyimpan baris jurnal pembayaran: ${jlErr.message}`)
    }

    // D. Bulk insert expense payments logs
    const { error: payErr } = await supabase.from('expense_payments').insert(paymentsToInsert)
    if (payErr) {
      // Rollback transactions
      await supabase.from('transactions').delete().in('id', txIds)
      // Revert expenses updates
      await Promise.all(originalExpensesState.map(oe => 
        supabase
          .from('expenses')
          .update({
            amount_paid: oe.amount_paid,
            outstanding_amount: oe.outstanding_amount,
            payment_status: oe.payment_status
          })
          .eq('id', oe.id)
      ))
      throw new Error(`Gagal mencatat log pembayaran: ${payErr.message}`)
    }

    return NextResponse.json({
      success: true,
      message: `Berhasil melunasi ${expensesToPay.length} pengeluaran`,
      count: expensesToPay.length
    })

  } catch (err: any) {
    console.error('Error during bulk-pay expenses:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
