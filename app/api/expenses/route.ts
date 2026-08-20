import { createClient } from '@/lib/supabaseServer'
import { ensureExpenseAccounts } from '@/lib/expenseLedger'
import { syncExpenseStatus } from '@/lib/expenseSync'
import { NextResponse } from 'next/server'
import { formatTransactionDate } from '@/lib/timeUtils'

export async function GET(req: Request) {
  const supabase = await createClient()

  try {
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

    // Ensure default & standard expense/CAPEX accounts are seeded for the business
    await ensureExpenseAccounts(businessId, supabase)

    const url = new URL(req.url)
    const id = url.searchParams.get('id')
    const pageParam = url.searchParams.get('page')
    const limitParam = url.searchParams.get('limit')

    // Auto-sync expense payment status to handle voided/reversed transactions
    await syncExpenseStatus(supabase, businessId, id || undefined)

    if (id) {
      const { data: expense, error: fetchErr } = await supabase
        .from('expenses')
        .select(`
          *,
          category_account:accounts!expenses_category_account_id_fkey(id, code, name),
          payment_account:accounts!expenses_payment_account_id_fkey(id, code, name),
          expense_payments(id, amount, date)
        `)
        .eq('business_id', businessId)
        .eq('id', id)
        .single()

      if (fetchErr) {
        return NextResponse.json({ error: fetchErr.message }, { status: 500 })
      }
      return NextResponse.json(expense)
    }

    if (pageParam || limitParam) {
      const page = Math.max(1, parseInt(pageParam || '1', 10))
      const limit = Math.max(1, parseInt(limitParam || '25', 10))
      const from = (page - 1) * limit
      const to = from + limit - 1

      const { data: expenses, count, error: fetchErr } = await supabase
        .from('expenses')
        .select(`
          *,
          category_account:accounts!expenses_category_account_id_fkey(id, code, name),
          payment_account:accounts!expenses_payment_account_id_fkey(id, code, name),
          expense_payments(id)
        `, { count: 'exact' })
        .eq('business_id', businessId)
        .order('date', { ascending: false })
        .order('created_at', { ascending: false })
        .range(from, to)

      if (fetchErr) {
        return NextResponse.json({ error: fetchErr.message }, { status: 500 })
      }

      return NextResponse.json({
        data: expenses || [],
        totalCount: count || 0,
        page,
        limit,
        totalPages: Math.ceil((count || 0) / limit)
      })
    }

    const { data: expenses, error: fetchErr } = await supabase
      .from('expenses')
      .select(`
        *,
        category_account:accounts!expenses_category_account_id_fkey(id, code, name),
        payment_account:accounts!expenses_payment_account_id_fkey(id, code, name),
        expense_payments(id)
      `)
      .eq('business_id', businessId)
      .order('date', { ascending: false })
      .order('created_at', { ascending: false })

    if (fetchErr) {
      return NextResponse.json({ error: fetchErr.message }, { status: 500 })
    }

    return NextResponse.json(expenses)
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

export async function POST(req: Request) {
  const supabase = await createClient()

  try {
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
      category_account_id,
      payment_account_id,
      amount,
      date,
      description,
      vendor_name,
      attachment_url,
      payment_status,
      due_date,
      amount_paid
    } = body

    if (!category_account_id || amount === undefined || !date) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
    }

    const numAmount = parseFloat(amount)
    if (isNaN(numAmount) || numAmount < 0) {
      return NextResponse.json({ error: 'Invalid amount' }, { status: 400 })
    }

    const status = payment_status || 'paid'
    if (status !== 'unpaid' && !payment_account_id) {
      return NextResponse.json({ error: 'Missing payment account for paid/partial expense' }, { status: 400 })
    }

    const numAmountPaid = status === 'paid' 
      ? numAmount 
      : (status === 'unpaid' ? 0 : parseFloat(amount_paid || 0))

    if (isNaN(numAmountPaid) || numAmountPaid < 0 || numAmountPaid > numAmount) {
      return NextResponse.json({ error: 'Invalid amount paid' }, { status: 400 })
    }

    const numOutstanding = numAmount - numAmountPaid

    // Retrieve business standard accounts to get Hutang Usaha ID
    const accountMap = await ensureExpenseAccounts(businessId, supabase)
    const hutangAccountId = accountMap['201000']
    if (numOutstanding > 0 && !hutangAccountId) {
      return NextResponse.json({ error: 'Hutang Usaha account (201000) not found' }, { status: 400 })
    }

    // 1. Create a ledger transaction
    const { data: tx, error: txErr } = await supabase
      .from('transactions')
      .insert({
        business_id: businessId,
        date: formatTransactionDate(date),
        description: `Pengeluaran: ${description || 'Operasional'}`
      })
      .select('*')
      .single()

    if (txErr || !tx) {
      return NextResponse.json({ error: `Failed to create ledger transaction: ${txErr?.message}` }, { status: 500 })
    }

    // 2. Create the balancing journal lines
    const journalLines = []

    // Debit the category (expense/asset) account for the full amount
    journalLines.push({
      transaction_id: tx.id,
      account_id: category_account_id,
      debit: numAmount,
      credit: 0
    })

    // Credit the payment account (Kas/Bank) for the paid portion
    if (numAmountPaid > 0) {
      journalLines.push({
        transaction_id: tx.id,
        account_id: payment_account_id,
        debit: 0,
        credit: numAmountPaid
      })
    }

    // Credit the Hutang Usaha account for the outstanding portion
    if (numOutstanding > 0) {
      journalLines.push({
        transaction_id: tx.id,
        account_id: hutangAccountId,
        debit: 0,
        credit: numOutstanding
      })
    }

    const { error: jlErr } = await supabase.from('journal_lines').insert(journalLines)
    if (jlErr) {
      // Clean up transaction
      await supabase.from('transactions').delete().eq('id', tx.id)
      return NextResponse.json({ error: `Failed to create journal lines: ${jlErr.message}` }, { status: 500 })
    }

    // 3. Create the expense entry
    const { data: expense, error: expErr } = await supabase
      .from('expenses')
      .insert({
        business_id: businessId,
        transaction_id: tx.id,
        category_account_id,
        payment_account_id: status !== 'unpaid' ? payment_account_id : hutangAccountId, // Default to Hutang Usaha if unpaid
        amount: numAmount,
        date,
        description,
        vendor_name,
        attachment_url,
        payment_status: status,
        due_date: status !== 'paid' ? due_date : null,
        amount_paid: numAmountPaid,
        outstanding_amount: numOutstanding
      })
      .select('*')
      .single()

    if (expErr) {
      // Clean up transaction and journal lines (cascades)
      await supabase.from('transactions').delete().eq('id', tx.id)
      return NextResponse.json({ error: `Failed to create expense record: ${expErr.message}` }, { status: 500 })
    }

    // 4. Record initial payment log if numAmountPaid > 0
    if (numAmountPaid > 0) {
      const { error: payLogErr } = await supabase
        .from('expense_payments')
        .insert({
          business_id: businessId,
          expense_id: expense.id,
          transaction_id: tx.id,
          date,
          amount: numAmountPaid,
          payment_method_account_id: payment_account_id,
          notes: status === 'paid' ? 'Pembayaran Lunas Saat Pengeluaran Dibuat' : 'Uang Muka / DP'
        })

      if (payLogErr) {
        console.error('Failed to insert initial expense payment log:', payLogErr)
      }
    }

    return NextResponse.json(expense)
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

export async function PUT(req: Request) {
  const supabase = await createClient()

  try {
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
    const url = new URL(req.url)
    const id = url.searchParams.get('id')

    if (!id) {
      return NextResponse.json({ error: 'Missing expense ID' }, { status: 400 })
    }

    // Fetch existing expense
    const { data: oldExpense, error: getErr } = await supabase
      .from('expenses')
      .select('*')
      .eq('id', id)
      .eq('business_id', businessId)
      .single()

    if (getErr || !oldExpense) {
      return NextResponse.json({ error: 'Expense not found' }, { status: 404 })
    }

    if (oldExpense.payment_status === 'paid') {
      return NextResponse.json({ error: 'Pengeluaran tidak dapat diubah karena statusnya sudah lunas. Silakan batalkan transaksi jika ingin mengubah.' }, { status: 400 })
    }

    // Check if there are any payments registered for this expense
    const { count, error: countErr } = await supabase
      .from('expense_payments')
      .select('id', { count: 'exact', head: true })
      .eq('expense_id', id)

    if (count && count > 0) {
      return NextResponse.json({ error: 'Pengeluaran tidak dapat diubah karena sudah memiliki riwayat pembayaran cicilan. Silakan hapus pembayaran cicilan terlebih dahulu.' }, { status: 400 })
    }

    const body = await req.json()
    const {
      category_account_id,
      payment_account_id,
      amount,
      date,
      description,
      vendor_name,
      attachment_url,
      payment_status,
      due_date,
      amount_paid
    } = body

    if (!category_account_id || amount === undefined || !date) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
    }

    const numAmount = parseFloat(amount)
    if (isNaN(numAmount) || numAmount < 0) {
      return NextResponse.json({ error: 'Invalid amount' }, { status: 400 })
    }

    const status = payment_status || 'paid'
    if (status !== 'unpaid' && !payment_account_id) {
      return NextResponse.json({ error: 'Missing payment account for paid/partial expense' }, { status: 400 })
    }

    const numAmountPaid = status === 'paid' 
      ? numAmount 
      : (status === 'unpaid' ? 0 : parseFloat(amount_paid || 0))

    if (isNaN(numAmountPaid) || numAmountPaid < 0 || numAmountPaid > numAmount) {
      return NextResponse.json({ error: 'Invalid amount paid' }, { status: 400 })
    }

    const numOutstanding = numAmount - numAmountPaid

    // Retrieve business standard accounts to get Hutang Usaha ID
    const accountMap = await ensureExpenseAccounts(businessId, supabase)
    const hutangAccountId = accountMap['201000']
    if (numOutstanding > 0 && !hutangAccountId) {
      return NextResponse.json({ error: 'Hutang Usaha account (201000) not found' }, { status: 400 })
    }

    let txId = oldExpense.transaction_id
    if (!txId) {
      // Create new transaction if none exists
      const { data: newTx, error: txErr } = await supabase
        .from('transactions')
        .insert({
          business_id: businessId,
          date: date,
          description: `Pengeluaran: ${description || 'Operasional'}`
        })
        .select('*')
        .single()

      if (txErr || !newTx) {
        return NextResponse.json({ error: `Failed to create ledger transaction: ${txErr?.message}` }, { status: 500 })
      }
      txId = newTx.id
    } else {
      // Update transaction details
      await supabase
        .from('transactions')
        .update({
          date: date,
          description: `Pengeluaran: ${description || 'Operasional'}`
        })
        .eq('id', txId)

      // Delete old journal lines
      await supabase.from('journal_lines').delete().eq('transaction_id', txId)
    }

    // Create the balancing journal lines
    const journalLines = []

    // Debit the category (expense/asset) account for the full amount
    journalLines.push({
      transaction_id: txId,
      account_id: category_account_id,
      debit: numAmount,
      credit: 0
    })

    // Credit the payment account (Kas/Bank) for the paid portion
    if (numAmountPaid > 0) {
      journalLines.push({
        transaction_id: txId,
        account_id: payment_account_id,
        debit: 0,
        credit: numAmountPaid
      })
    }

    // Credit the Hutang Usaha account for the outstanding portion
    if (numOutstanding > 0) {
      journalLines.push({
        transaction_id: txId,
        account_id: hutangAccountId,
        debit: 0,
        credit: numOutstanding
      })
    }

    const { error: jlErr } = await supabase.from('journal_lines').insert(journalLines)
    if (jlErr) {
      return NextResponse.json({ error: `Failed to rebuild journal lines: ${jlErr.message}` }, { status: 500 })
    }

    // Update expense record
    const { data: updatedExpense, error: expErr } = await supabase
      .from('expenses')
      .update({
        transaction_id: txId,
        category_account_id,
        payment_account_id: status !== 'unpaid' ? payment_account_id : hutangAccountId,
        amount: numAmount,
        date,
        description,
        vendor_name,
        attachment_url,
        payment_status: status,
        due_date: status !== 'paid' ? due_date : null,
        amount_paid: numAmountPaid,
        outstanding_amount: numOutstanding
      })
      .eq('id', id)
      .eq('business_id', businessId)
      .select('*')
      .single()

    if (expErr) {
      return NextResponse.json({ error: `Failed to update expense record: ${expErr.message}` }, { status: 500 })
    }

    return NextResponse.json(updatedExpense)
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

export async function DELETE(req: Request) {
  const supabase = await createClient()

  try {
    const { data: { user }, error: authErr } = await supabase.auth.getUser()
    if (authErr || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const url = new URL(req.url)
    const id = url.searchParams.get('id')

    if (!id) {
      return NextResponse.json({ error: 'Missing expense ID' }, { status: 400 })
    }

    // Fetch the expense first to get transaction_id
    const { data: expense, error: getErr } = await supabase
      .from('expenses')
      .select('*')
      .eq('id', id)
      .single()

    if (getErr || !expense) {
      return NextResponse.json({ error: 'Expense not found' }, { status: 404 })
    }

    // Check if there are any payments registered for this expense
    const { count, error: countErr } = await supabase
      .from('expense_payments')
      .select('id', { count: 'exact', head: true })
      .eq('expense_id', id)

    if (count && count > 0) {
      return NextResponse.json({ error: 'Pengeluaran tidak dapat dihapus karena sudah memiliki riwayat pembayaran cicilan. Silakan hapus pembayaran cicilan terlebih dahulu.' }, { status: 400 })
    }

    // Delete the transaction (which cascades and deletes journal lines and the expense because of ON DELETE CASCADE)
    if (expense.transaction_id) {
      const { error: delTxErr } = await supabase
        .from('transactions')
        .delete()
        .eq('id', expense.transaction_id)

      if (delTxErr) {
        return NextResponse.json({ error: `Failed to delete transaction: ${delTxErr.message}` }, { status: 500 })
      }
    } else {
      // Fallback if no transaction is linked
      const { error: delExpErr } = await supabase
        .from('expenses')
        .delete()
        .eq('id', id)

      if (delExpErr) {
        return NextResponse.json({ error: `Failed to delete expense: ${delExpErr.message}` }, { status: 500 })
      }
    }

    return NextResponse.json({ success: true })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
