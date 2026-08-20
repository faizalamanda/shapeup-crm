import { createClient } from '@/lib/supabaseServer'
import { NextResponse } from 'next/server'
import { ensureExpenseAccounts } from '@/lib/expenseLedger'

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

    const { data: opnames, error: fetchErr } = await supabase
      .from('stock_opname')
      .select(`
        *,
        transactions (
          id,
          date,
          description,
          journal_lines (
            id,
            account_id,
            debit,
            credit,
            accounts (
              id,
              code,
              name,
              type
            )
          )
        )
      `)
      .eq('business_id', businessId)
      .order('date', { ascending: false })
      .order('created_at', { ascending: false })

    if (fetchErr) {
      return NextResponse.json({ error: fetchErr.message }, { status: 500 })
    }

    return NextResponse.json(opnames)
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
      opname_number,
      date,
      notes,
      items // array: { product_id: string, name: string, recorded_quantity: number, actual_quantity: number }
    } = body

    if (!opname_number || !date || !items || !Array.isArray(items) || items.length === 0) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
    }

    // Resolve accounts
    const accountMap = await ensureExpenseAccounts(businessId, supabase)
    const accPersediaan = accountMap['102000']
    const accPenyesuaian = accountMap['502000']

    if (!accPersediaan || !accPenyesuaian) {
      return NextResponse.json({ error: 'Required accounting accounts could not be resolved' }, { status: 500 })
    }

    // 1. Create Stock Opname Transaction in Ledger
    const { data: tx, error: txErr } = await supabase
      .from('transactions')
      .insert({
        business_id: businessId,
        date: date,
        description: `Stock Opname: ${opname_number}`
      })
      .select('*')
      .single()

    if (txErr || !tx) {
      return NextResponse.json({ error: `Failed to create ledger transaction: ${txErr?.message}` }, { status: 500 })
    }

    const journalLines: any[] = []
    let totalDebit = 0
    let totalCredit = 0

    // 2. Loop items to update quantities and construct journal lines
    for (const item of items) {
      const { product_id, recorded_quantity, actual_quantity } = item
      const recQty = parseFloat(recorded_quantity) || 0
      const actQty = parseFloat(actual_quantity) || 0
      const diff = actQty - recQty

      if (diff === 0) continue

      // Fetch product to get its cost price
      const { data: product, error: prodErr } = await supabase
        .from('products')
        .select('cost_price')
        .eq('id', product_id)
        .single()

      if (prodErr || !product) {
        console.error(`Failed to fetch product details for ${product_id}: ${prodErr?.message}`)
        continue
      }

      const costPrice = product.cost_price || 0
      const adjValue = Math.abs(diff) * costPrice

      if (adjValue > 0) {
        if (diff < 0) {
          // Shrinkage/Susut: Debit Penyesuaian Persediaan (Expense), Credit Persediaan (Asset)
          journalLines.push({
            transaction_id: tx.id,
            account_id: accPenyesuaian,
            debit: adjValue,
            credit: 0
          })
          journalLines.push({
            transaction_id: tx.id,
            account_id: accPersediaan,
            debit: 0,
            credit: adjValue
          })
          totalDebit += adjValue
          totalCredit += adjValue
        } else {
          // Excess/Lebih: Debit Persediaan (Asset), Credit Penyesuaian Persediaan (Expense/contra)
          journalLines.push({
            transaction_id: tx.id,
            account_id: accPersediaan,
            debit: adjValue,
            credit: 0
          })
          journalLines.push({
            transaction_id: tx.id,
            account_id: accPenyesuaian,
            debit: 0,
            credit: adjValue
          })
          totalDebit += adjValue
          totalCredit += adjValue
        }
      }

      // Update physical quantity in DB
      const { error: updErr } = await supabase
        .from('products')
        .update({ stock_quantity: actQty })
        .eq('id', product_id)

      if (updErr) {
        console.error(`Failed to update product stock: ${updErr.message}`)
      }
    }

    // If journalLines is empty (no stock was changed), we create a dummy balancing entry or delete the transaction.
    if (journalLines.length === 0) {
      await supabase.from('transactions').delete().eq('id', tx.id)
      
      // Still record the stock opname itself with null transaction_id since no ledger updates were needed
      const { data: stockOpname, error: soErr } = await supabase
        .from('stock_opname')
        .insert({
          business_id: businessId,
          transaction_id: null,
          opname_number,
          date,
          notes,
          items_json: items
        })
        .select('*')
        .single()

      if (soErr) {
        return NextResponse.json({ error: `Failed to record stock opname: ${soErr.message}` }, { status: 500 })
      }
      return NextResponse.json(stockOpname)
    }

    // Insert journal lines
    const { error: jlErr } = await supabase.from('journal_lines').insert(journalLines)
    if (jlErr) {
      await supabase.from('transactions').delete().eq('id', tx.id)
      return NextResponse.json({ error: `Failed to insert journal lines: ${jlErr.message}` }, { status: 500 })
    }

    // 3. Create stock opname entry
    const { data: stockOpname, error: soErr } = await supabase
      .from('stock_opname')
      .insert({
        business_id: businessId,
        transaction_id: tx.id,
        opname_number,
        date,
        notes,
        items_json: items
      })
      .select('*')
      .single()

    if (soErr) {
      // clean up cascades
      await supabase.from('transactions').delete().eq('id', tx.id)
      return NextResponse.json({ error: `Failed to record stock opname: ${soErr.message}` }, { status: 500 })
    }

    return NextResponse.json(stockOpname)
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
