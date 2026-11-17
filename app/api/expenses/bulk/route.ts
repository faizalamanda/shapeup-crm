import { getApiContext } from '@/lib/apiContext'
import { ensureExpenseAccounts, prepareExpenseLedgerData } from '@/lib/expenseLedger'
import { NextResponse } from 'next/server'
import { randomUUID } from 'crypto'

export async function POST(req: Request) {
  let body: any
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Payload JSON tidak valid atau kosong' }, { status: 400 })
  }

  try {
    const reqBizId = typeof body?.business_id === 'string' ? body.business_id : undefined
    const ctx = await getApiContext({ req, requestedBusinessId: reqBizId })
    if (ctx.error) return ctx.error
    const { businessId, supabaseAdmin } = ctx

    // Ensure ledger accounts are seeded once (cached in-memory)
    const accountMap = await ensureExpenseAccounts(businessId, supabaseAdmin)
    const hutangAccountId = accountMap['201000']

    const { expenses } = body
    if (!Array.isArray(expenses) || expenses.length === 0) {
      return NextResponse.json({ error: 'Data pengeluaran harus berupa array dan tidak boleh kosong' }, { status: 400 })
    }

    const transactionsToInsert: any[] = []
    const journalLinesToInsert: any[] = []
    const expensesToInsert: any[] = []

    // Validate all rows and prepare bulk arrays using centralized expenseLedger helper
    for (let i = 0; i < expenses.length; i++) {
      const prepared = await prepareExpenseLedgerData(
        expenses[i],
        businessId,
        supabaseAdmin,
        hutangAccountId
      )

      if (!prepared.ok) {
        return NextResponse.json(
          { error: `Baris ${i + 1}: ${prepared.error}` },
          { status: prepared.status }
        )
      }

      const p = prepared.data
      const txId = randomUUID()

      transactionsToInsert.push({
        id: txId,
        business_id: businessId,
        date: p.tx_date,
        description: p.tx_description
      })

      for (const jl of p.journal_lines) {
        journalLinesToInsert.push({
          transaction_id: txId,
          account_id: jl.account_id,
          debit: jl.debit,
          credit: jl.credit
        })
      }

      expensesToInsert.push({
        business_id: businessId,
        transaction_id: txId,
        category_account_id: p.category_account_id,
        payment_account_id: p.payment_account_id,
        amount: p.amount,
        date: p.date,
        description: p.description,
        vendor_name: p.vendor_name,
        attachment_url: p.attachment_url,
        payment_status: p.payment_status,
        due_date: p.due_date,
        amount_paid: p.amount_paid,
        outstanding_amount: p.outstanding_amount
      })
    }

    // Execute bulk insertions with self-cleaning rollback on failure
    const { error: txErr } = await supabaseAdmin.from('transactions').insert(transactionsToInsert)
    if (txErr) {
      throw new Error(`Gagal menyimpan transaksi jurnal: ${txErr.message}`)
    }

    const { error: jlErr } = await supabaseAdmin.from('journal_lines').insert(journalLinesToInsert)
    if (jlErr) {
      const txIds = transactionsToInsert.map(t => t.id)
      await supabaseAdmin.from('transactions').delete().in('id', txIds)
      throw new Error(`Gagal menyimpan baris jurnal: ${jlErr.message}`)
    }

    const { error: expErr } = await supabaseAdmin.from('expenses').insert(expensesToInsert)
    if (expErr) {
      const txIds = transactionsToInsert.map(t => t.id)
      await supabaseAdmin.from('transactions').delete().in('id', txIds)
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
