import { createClient } from '@/lib/supabaseServer'
import { NextResponse } from 'next/server'
import { ensureExpenseAccounts } from '@/lib/expenseLedger'

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = await createClient()

  try {
    const { id } = await params
    const { data: { user }, error: authErr } = await supabase.auth.getUser()
    if (authErr || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { data: profile, error: profErr } = await supabase
      .from('profiles')
      .select('active_business_id')
      .eq('id', user.id)
      .single()

    if (profErr || !profile?.active_business_id) {
      return NextResponse.json({ error: 'Active business not found' }, { status: 400 })
    }

    const businessId = profile.active_business_id
    const body = await req.json()
    const {
      amount,
      payment_method_account_id,
      date,
      notes
    } = body

    if (amount === undefined || !payment_method_account_id || !date) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
    }

    const numAmount = parseFloat(amount)
    if (isNaN(numAmount) || numAmount <= 0) {
      return NextResponse.json({ error: 'Invalid payment amount' }, { status: 400 })
    }

    // Resolve Account Mapping for Hutang Usaha
    const accountMap = await ensureExpenseAccounts(businessId, supabase)
    const accHutang = accountMap['201000'] // Hutang Usaha

    if (!accHutang) {
      return NextResponse.json({ error: 'Required accounts payable could not be resolved' }, { status: 500 })
    }

    // Fetch the expense
    const { data: expense, error: getErr } = await supabase
      .from('expenses')
      .select('*')
      .eq('id', id)
      .eq('business_id', businessId)
      .single()

    if (getErr || !expense) {
      return NextResponse.json({ error: 'Expense not found' }, { status: 404 })
    }

    const currentOutstanding = parseFloat(expense.outstanding_amount || 0)
    if (currentOutstanding <= 0) {
      return NextResponse.json({ error: 'Expense is already fully paid' }, { status: 400 })
    }

    // Ensure we do not overpay
    if (numAmount > currentOutstanding + 0.01) {
      return NextResponse.json({ error: `Payment exceeds outstanding balance. Outstanding: ${currentOutstanding}` }, { status: 400 })
    }

    const newOutstanding = Math.max(0, currentOutstanding - numAmount)
    const newAmountPaid = parseFloat(expense.amount_paid || 0) + numAmount
    const newPaymentStatus = newOutstanding <= 0.01 ? 'paid' : 'partial'

    // 1. Create Payment Transaction
    const { data: payTx, error: txErr } = await supabase
      .from('transactions')
      .insert({
        business_id: businessId,
        date: date,
        description: `Pembayaran Pengeluaran: ${expense.description || 'Operasional'}`
      })
      .select('*')
      .single()

    if (txErr || !payTx) {
      return NextResponse.json({ error: `Failed to create payment transaction: ${txErr?.message}` }, { status: 500 })
    }

    // 2. Post Journal Lines
    const journalLines = [
      {
        transaction_id: payTx.id,
        account_id: accHutang, // Debit Hutang Usaha to decrease liability
        debit: numAmount,
        credit: 0
      },
      {
        transaction_id: payTx.id,
        account_id: payment_method_account_id, // Credit Cash/Bank
        debit: 0,
        credit: numAmount
      }
    ]

    const { error: jlErr } = await supabase.from('journal_lines').insert(journalLines)
    if (jlErr) {
      await supabase.from('transactions').delete().eq('id', payTx.id)
      return NextResponse.json({ error: `Failed to create journal lines: ${jlErr.message}` }, { status: 500 })
    }

    // 3. Create Payment Log Record
    const { data: paymentLog, error: payLogErr } = await supabase
      .from('expense_payments')
      .insert({
        business_id: businessId,
        expense_id: id,
        transaction_id: payTx.id,
        date,
        amount: numAmount,
        payment_method_account_id,
        notes
      })
      .select('*')
      .single()

    if (payLogErr) {
      await supabase.from('transactions').delete().eq('id', payTx.id)
      return NextResponse.json({ error: `Failed to record payment log: ${payLogErr.message}` }, { status: 500 })
    }

    // 4. Update parent Expense
    const { error: updErr } = await supabase
      .from('expenses')
      .update({
        amount_paid: newAmountPaid,
        outstanding_amount: newOutstanding,
        payment_status: newPaymentStatus
      })
      .eq('id', id)

    if (updErr) {
      await supabase.from('transactions').delete().eq('id', payTx.id)
      return NextResponse.json({ error: `Failed to update expense details: ${updErr.message}` }, { status: 500 })
    }

    return NextResponse.json(paymentLog)
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
