import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { formatTransactionDate, sortTransactionsNewestFirst } from '@/lib/timeUtils'

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )
}

export async function GET(request: NextRequest) {
  try {
    const supabase = getSupabase()
    const { searchParams } = new URL(request.url)
    const businessId = searchParams.get('business_id')
    const startDate = searchParams.get('start_date')
    const endDate = searchParams.get('end_date')
    const accountId = searchParams.get('account_id')
    const search = searchParams.get('search')
    const page = parseInt(searchParams.get('page') || '1', 10)
    const limit = parseInt(searchParams.get('limit') || '50', 10)
    const offset = (page - 1) * limit

    if (!businessId) {
      return NextResponse.json({ error: 'business_id parameters is required' }, { status: 400 })
    }

    // Base query for transactions
    let query = supabase
      .from('transactions')
      .select(`
        id,
        date,
        description,
        order_id,
        business_id,
        journal_lines (
          id,
          account_id,
          debit,
          credit,
          accounts (
            id,
            code,
            name,
            type,
            sub_type
          )
        )
      `, { count: 'exact' })
      .eq('business_id', businessId)

    if (startDate) {
      query = query.gte('date', `${startDate}T00:00:00.000Z`)
    }
    if (endDate) {
      query = query.lte('date', `${endDate}T23:59:59.999Z`)
    }

    if (search) {
      query = query.ilike('description', `%${search}%`)
    }

    query = query.order('date', { ascending: false }).range(offset, offset + limit - 1)

    const { data: transactions, count, error } = await query

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    // Filter by account_id client-side or post-query if requested
    let resultTransactions = transactions || []
    if (accountId) {
      resultTransactions = resultTransactions.filter((tx: any) =>
        tx.journal_lines?.some((jl: any) => jl.account_id === accountId)
      )
    }

    // Sort transactions strictly newest first
    resultTransactions = sortTransactionsNewestFirst(resultTransactions)

    // Calculate aggregated metrics for the list
    let totalDebitSum = 0
    let totalCreditSum = 0
    let totalIncome = 0
    let totalExpense = 0

    resultTransactions.forEach((tx: any) => {
      (tx.journal_lines || []).forEach((jl: any) => {
        const d = parseFloat(jl.debit || 0)
        const c = parseFloat(jl.credit || 0)
        totalDebitSum += d
        totalCreditSum += c

        const accType = jl.accounts?.type
        if (accType === 'REVENUE') {
          totalIncome += (c - d)
        } else if (accType === 'EXPENSE') {
          totalExpense += (d - c)
        }
      })
    })

    return NextResponse.json({
      data: resultTransactions,
      pagination: {
        total: count || 0,
        page,
        limit,
        totalPages: Math.ceil((count || 0) / limit)
      },
      summary: {
        totalTransactions: count || 0,
        totalDebit: totalDebitSum,
        totalCredit: totalCreditSum,
        totalIncome,
        totalExpense
      }
    })
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Server error' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const supabase = getSupabase()
    const body = await request.json()

    const { business_id, date, description, journal_lines, order_id } = body

    if (!business_id) {
      return NextResponse.json({ error: 'business_id is required' }, { status: 400 })
    }
    if (!date) {
      return NextResponse.json({ error: 'date is required' }, { status: 400 })
    }
    if (!description || !description.trim()) {
      return NextResponse.json({ error: 'Keterangan/Deskripsi transaksi tidak boleh kosong' }, { status: 400 })
    }
    if (!Array.isArray(journal_lines) || journal_lines.length < 2) {
      return NextResponse.json({ error: 'Transaksi harus memiliki minimal 2 baris jurnal (Debet & Kredit)' }, { status: 400 })
    }

    // Validate double-entry balance (Total Debit MUST equal Total Credit)
    let totalDebit = 0
    let totalCredit = 0

    for (const line of journal_lines) {
      if (!line.account_id) {
        return NextResponse.json({ error: 'Setiap baris jurnal harus memilih akun' }, { status: 400 })
      }
      const d = Math.abs(parseFloat(line.debit || 0))
      const c = Math.abs(parseFloat(line.credit || 0))

      if (d === 0 && c === 0) {
        return NextResponse.json({ error: 'Baris jurnal harus mengisi nominal Debet atau Kredit' }, { status: 400 })
      }
      if (d > 0 && c > 0) {
        return NextResponse.json({ error: 'Satu baris jurnal tidak boleh memilih Debet dan Kredit sekaligus' }, { status: 400 })
      }

      totalDebit += d
      totalCredit += c
    }

    const diff = Math.abs(totalDebit - totalCredit)
    if (diff > 0.01) {
      return NextResponse.json({
        error: `Jurnal tidak seimbang (Unbalanced Entry)! Total Debet (Rp ${totalDebit.toLocaleString('id-ID')}) ≠ Total Kredit (Rp ${totalCredit.toLocaleString('id-ID')}). Selisih: Rp ${diff.toLocaleString('id-ID')}`
      }, { status: 400 })
    }

    // Ensure transaction date format is ISO with time precision
    let txDate = formatTransactionDate(date)

    // 1. Insert Transaction record
    const { data: newTx, error: txErr } = await supabase
      .from('transactions')
      .insert({
        business_id,
        date: txDate,
        description: description.trim(),
        order_id: order_id || null
      })
      .select('*')
      .single()

    if (txErr || !newTx) {
      return NextResponse.json({ error: `Gagal membuat header transaksi: ${txErr?.message || 'Unknown error'}` }, { status: 500 })
    }

    // 2. Prepare & Insert Journal Lines
    const linesToInsert = journal_lines.map((line: any) => ({
      transaction_id: newTx.id,
      account_id: line.account_id,
      debit: Math.abs(parseFloat(line.debit || 0)),
      credit: Math.abs(parseFloat(line.credit || 0))
    }))

    const { data: createdLines, error: linesErr } = await supabase
      .from('journal_lines')
      .insert(linesToInsert)
      .select(`
        id,
        transaction_id,
        account_id,
        debit,
        credit,
        accounts (
          id,
          code,
          name,
          type,
          sub_type
        )
      `)

    if (linesErr) {
      // Rollback header if journal lines fail
      await supabase.from('transactions').delete().eq('id', newTx.id)
      return NextResponse.json({ error: `Gagal membuat detail rincian jurnal: ${linesErr.message}` }, { status: 500 })
    }

    return NextResponse.json({
      message: 'Transaksi jurnal berhasil disimpan',
      data: {
        ...newTx,
        journal_lines: createdLines
      }
    }, { status: 201 })
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Server error' }, { status: 500 })
  }
}
