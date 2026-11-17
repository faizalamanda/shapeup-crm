import { getApiContext } from '@/lib/apiContext'
import {
  ensureExpenseAccounts,
  createExpenseWithLedger,
  updateExpenseWithLedger
} from '@/lib/expenseLedger'
import { isUuid } from '@/lib/utils'
import { NextResponse } from 'next/server'

export async function GET(req: Request) {
  try {
    const ctx = await getApiContext({ req })
    if (ctx.error) return ctx.error
    const { businessId, supabaseAdmin } = ctx

    const url = new URL(req.url)
    const id = url.searchParams.get('id')
    const pageParam = url.searchParams.get('page')
    const limitParam = url.searchParams.get('limit')

    if (id) {
      if (!isUuid(id)) {
        return NextResponse.json({ error: 'Invalid expense ID' }, { status: 400 })
      }

      const { data: expense, error: fetchErr } = await supabaseAdmin
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

    // Ensure default & standard expense/CAPEX accounts are seeded for the business (cached in-memory)
    await ensureExpenseAccounts(businessId, supabaseAdmin)

    if (pageParam || limitParam) {
      const rawPage = parseInt(pageParam || '1', 10)
      const page = Number.isFinite(rawPage) && rawPage > 0 ? rawPage : 1
      const rawLimit = parseInt(limitParam || '25', 10)
      const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(500, rawLimit) : 25
      const from = (page - 1) * limit
      const to = from + limit - 1

      const { data: expenses, count, error: fetchErr } = await supabaseAdmin
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

    const { data: expenses, error: fetchErr } = await supabaseAdmin
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

    const result = await createExpenseWithLedger(businessId, body, supabaseAdmin)
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.status })
    }

    return NextResponse.json(result.data)
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

export async function PUT(req: Request) {
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

    const url = new URL(req.url)
    const id = url.searchParams.get('id')

    if (!id) {
      return NextResponse.json({ error: 'Missing expense ID' }, { status: 400 })
    }

    const result = await updateExpenseWithLedger(businessId, id, body, supabaseAdmin)
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.status })
    }

    return NextResponse.json(result.data)
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

export async function DELETE(req: Request) {
  try {
    const ctx = await getApiContext({ req })
    if (ctx.error) return ctx.error
    const { businessId, supabaseAdmin } = ctx

    const url = new URL(req.url)
    const id = url.searchParams.get('id')

    if (!id) {
      return NextResponse.json({ error: 'Missing expense ID' }, { status: 400 })
    }
    if (!isUuid(id)) {
      return NextResponse.json({ error: 'Invalid expense ID' }, { status: 400 })
    }

    // Fetch the expense first to get transaction_id
    const { data: expense, error: getErr } = await supabaseAdmin
      .from('expenses')
      .select('id, transaction_id')
      .eq('id', id)
      .eq('business_id', businessId)
      .single()

    if (getErr || !expense) {
      return NextResponse.json({ error: 'Expense not found' }, { status: 404 })
    }

    // Check if there are any payments registered for this expense
    const { count } = await supabaseAdmin
      .from('expense_payments')
      .select('id', { count: 'exact', head: true })
      .eq('expense_id', id)

    if (count && count > 0) {
      return NextResponse.json({ error: 'Pengeluaran tidak dapat dihapus karena sudah memiliki riwayat pembayaran cicilan. Silakan hapus pembayaran cicilan terlebih dahulu.' }, { status: 400 })
    }

    // Delete the transaction (which cascades and deletes journal lines and the expense because of ON DELETE CASCADE)
    if (expense.transaction_id) {
      const { error: delTxErr } = await supabaseAdmin
        .from('transactions')
        .delete()
        .eq('id', expense.transaction_id)
        .eq('business_id', businessId)

      if (delTxErr) {
        return NextResponse.json({ error: `Failed to delete transaction: ${delTxErr.message}` }, { status: 500 })
      }
    } else {
      // Fallback if no transaction is linked
      const { error: delExpErr } = await supabaseAdmin
        .from('expenses')
        .delete()
        .eq('id', id)
        .eq('business_id', businessId)

      if (delExpErr) {
        return NextResponse.json({ error: `Failed to delete expense: ${delExpErr.message}` }, { status: 500 })
      }
    }

    return NextResponse.json({ success: true })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
