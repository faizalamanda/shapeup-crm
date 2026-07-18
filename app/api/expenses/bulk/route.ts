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

    // 3. Ensure ledger accounts are seeded
    const accountMap = await ensureExpenseAccounts(businessId, supabase)
    const hutangAccountId = accountMap['201000']

    // 4. Parse request body
    const body = await req.json()
    const { expenses } = body

    if (!Array.isArray(expenses) || expenses.length === 0) {
      return NextResponse.json({ error: 'Data pengeluaran harus berupa array dan tidak boleh kosong' }, { status: 400 })
    }

    const transactionsToInsert: any[] = []
    const journalLinesToInsert: any[] = []
    const expensesToInsert: any[] = []

    // 5. Validate all rows and prepare bulk arrays
    for (let i = 0; i < expenses.length; i++) {
      const exp = expenses[i]
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
      } = exp

      if (!category_account_id || amount === undefined || !date) {
        return NextResponse.json({
          error: `Baris ${i + 1}: Kategori, Nominal, dan Tanggal wajib diisi.`
        }, { status: 400 })
      }

      const numAmount = parseFloat(amount)
      if (isNaN(numAmount) || numAmount < 0) {
        return NextResponse.json({
          error: `Baris ${i + 1}: Nominal "${amount}" tidak valid.`
        }, { status: 400 })
      }

      const status = payment_status || 'paid'
      if (status !== 'unpaid' && !payment_account_id) {
        return NextResponse.json({
          error: `Baris ${i + 1}: Akun Kas/Bank wajib diisi untuk status Lunas atau DP.`
        }, { status: 400 })
      }

      const numAmountPaid = status === 'paid'
        ? numAmount
        : (status === 'unpaid' ? 0 : parseFloat(amount_paid || 0))

      if (isNaN(numAmountPaid) || numAmountPaid < 0 || numAmountPaid > numAmount) {
        return NextResponse.json({
          error: `Baris ${i + 1}: Nominal dibayar tidak valid.`
        }, { status: 400 })
      }

      const numOutstanding = numAmount - numAmountPaid
      if (numOutstanding > 0 && !hutangAccountId) {
        return NextResponse.json({
          error: `Baris ${i + 1}: Akun Hutang Usaha (201000) belum terkonfigurasi untuk bisnis ini.`
        }, { status: 400 })
      }

      // Pre-generate UUID for transaction to match with journal lines and expenses
      const txId = randomUUID()

      // A. Create ledger transaction
      transactionsToInsert.push({
        id: txId,
        business_id: businessId,
        date: date,
        description: `Pengeluaran: ${description || 'Operasional'}`
      })

      // B. Create balancing journal lines
      // Debit: Category Account (expense/asset)
      journalLinesToInsert.push({
        transaction_id: txId,
        account_id: category_account_id,
        debit: numAmount,
        credit: 0
      })

      // Credit: Cash/Bank Account for paid portion
      if (numAmountPaid > 0) {
        journalLinesToInsert.push({
          transaction_id: txId,
          account_id: payment_account_id,
          debit: 0,
          credit: numAmountPaid
        })
      }

      // Credit: Hutang Usaha Account for unpaid/outstanding portion
      if (numOutstanding > 0) {
        journalLinesToInsert.push({
          transaction_id: txId,
          account_id: hutangAccountId,
          debit: 0,
          credit: numOutstanding
        })
      }

      // C. Create Expense record
      expensesToInsert.push({
        business_id: businessId,
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
    }

    // 6. Execute bulk insertions with self-cleaning rollback on failure
    // A. Bulk insert transactions
    const { error: txErr } = await supabase.from('transactions').insert(transactionsToInsert)
    if (txErr) {
      throw new Error(`Gagal menyimpan transaksi jurnal: ${txErr.message}`)
    }

    // B. Bulk insert journal lines
    const { error: jlErr } = await supabase.from('journal_lines').insert(journalLinesToInsert)
    if (jlErr) {
      // Rollback: delete created transactions
      const txIds = transactionsToInsert.map(t => t.id)
      await supabase.from('transactions').delete().in('id', txIds)
      throw new Error(`Gagal menyimpan baris jurnal: ${jlErr.message}`)
    }

    // C. Bulk insert expenses
    const { error: expErr } = await supabase.from('expenses').insert(expensesToInsert)
    if (expErr) {
      // Rollback: delete created transactions (cascades and deletes journal lines as well)
      const txIds = transactionsToInsert.map(t => t.id)
      await supabase.from('transactions').delete().in('id', txIds)
      throw new Error(`Gagal menyimpan data pengeluaran: ${expErr.message}`)
    }

    return NextResponse.json({
      success: true,
      message: `Berhasil mengimpor ${expensesToInsert.length} data pengeluaran`,
      count: expensesToInsert.length
    })

  } catch (err: any) {
    console.error('Error during bulk expense import:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
