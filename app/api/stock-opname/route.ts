import { createClient } from '@/lib/supabaseServer'
import { recordStockMovements, StockMoveInput } from '@/lib/stockLedger'
import { NextResponse } from 'next/server'
import { ensureExpenseAccounts } from '@/lib/expenseLedger'
import { getApiContext } from '@/lib/apiContext'

export async function GET(req: Request) {
  try {
    const ctx = await getApiContext()
    if (ctx.error) return ctx.error
    const { businessId, supabase } = ctx

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
  try {
    const ctx = await getApiContext()
    if (ctx.error) return ctx.error
    const { businessId, supabase } = ctx

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

    // Fetch all products in batch for cost price
    const productIds = items.map((i: any) => i.product_id)
    const { data: products, error: prodErr } = await supabase
      .from('products')
      .select('id, cost_price')
      .in('id', productIds)
      .eq('business_id', businessId)

    if (prodErr) {
      return NextResponse.json({ error: `Failed to fetch products: ${prodErr.message}` }, { status: 500 })
    }

    const productMap = new Map(products?.map(p => [p.id, p.cost_price || 0]) || [])

    // 1. Create Stock Opname Transaction in Ledger
    const { data: tx, error: txErr } = await supabase
      .from('transactions')
      .insert({
        business_id: businessId,
        date: date,
        description: `Stock Opname: ${opname_number}`
      })
      .select('id')
      .single()

    if (txErr || !tx) {
      return NextResponse.json({ error: `Failed to create ledger transaction: ${txErr?.message}` }, { status: 500 })
    }

    const journalLines: any[] = []
    const updatePromises: any[] = []

    // Fetch true system stock directly from ledger to prevent out-of-sync discrepancies
    const { data: ledgerBalances } = await supabase
      .from('v_stock_moves_ledger')
      .select('product_id, system_stock')
      .in('product_id', productIds)
      .order('created_at', { ascending: false })

    const balanceMap = new Map()
    if (ledgerBalances) {
      for (const row of ledgerBalances) {
        if (!balanceMap.has(row.product_id)) {
          balanceMap.set(row.product_id, row.system_stock)
        }
      }
    }

    // 2. Loop items to update quantities and construct journal lines
    for (const item of items) {
      const { product_id, actual_quantity } = item
      
      // Override client's recorded_quantity with the Absolute Truth from Ledger
      const recQty = balanceMap.get(product_id) || 0
      item.recorded_quantity = recQty // Mutate item so it gets saved correctly in items_json
      
      const actQty = parseFloat(actual_quantity) || 0
      const diff = actQty - recQty

      if (diff === 0) continue

      const costPrice = productMap.get(product_id) || 0
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
        }
      }

      // Prepare physical quantity update in DB
      updatePromises.push(
        supabase.from('products').update({ stock_quantity: actQty }).eq('id', product_id)
      )
    }

    // Execute physical stock updates in parallel
    if (updatePromises.length > 0) {
      await Promise.all(updatePromises)
    }

    // Insert journal lines IF ANY
    if (journalLines.length > 0) {
      const { error: jlErr } = await supabase.from('journal_lines').insert(journalLines)
      if (jlErr) {
        await supabase.from('transactions').delete().eq('id', tx.id)
        return NextResponse.json({ error: `Failed to insert journal lines: ${jlErr.message}` }, { status: 500 })
      }
    } else {
      await supabase.from('transactions').delete().eq('id', tx.id)
    }

    // 3. Create stock opname entry
    const { data: stockOpname, error: soErr } = await supabase
      .from('stock_opname')
      .insert({
        business_id: businessId,
        transaction_id: journalLines.length > 0 ? tx.id : null,
        opname_number,
        date,
        notes,
        items_json: items
      })
      .select('*')
      .single()

    if (soErr) {
      if (journalLines.length > 0) {
        await supabase.from('transactions').delete().eq('id', tx.id)
      }
      return NextResponse.json({ error: `Failed to record stock opname: ${soErr.message}` }, { status: 500 })
    }

    // Determine precise timestamp for stock_moves
    let moveCreatedAt = new Date().toISOString()
    if (date && !date.includes('T')) {
      const todayStr = new Date().toISOString().split('T')[0]
      if (date !== todayStr) {
        // Backdated opname: Set to end of day (23:59:59 WIB = 16:59:59 UTC)
        moveCreatedAt = `${date}T16:59:59.000Z`
      }
      // If date is today, moveCreatedAt remains the exact current time (new Date().toISOString())
    } else if (date && date.includes('T')) {
      moveCreatedAt = date
    }

    // Record SaaS Stock Movement Ledger for Opname Adjustments
    const stockMoveInputs: StockMoveInput[] = items
      .map((item: any) => {
        const diff = (parseFloat(item.actual_quantity) || 0) - (parseFloat(item.recorded_quantity) || 0)
        return {
          businessId,
          productId: item.product_id,
          reference: opname_number || `OPN-${stockOpname.id.slice(0, 6)}`,
          qty: Math.abs(diff),
          unitCost: productMap.get(item.product_id) || 0,
          type: 'adjustment' as const,
          sourceType: 'stock_opname' as const,
          sourceId: stockOpname.id,
          status: 'done' as const,
          createdAt: moveCreatedAt,
          // diff < 0 means shrinkage (negative adjustment), so we use a dummy origin_location_id
          originLocationId: diff < 0 ? '00000000-0000-0000-0000-000000000000' : null,
          destinationLocationId: null
        }
      })
      .filter((m: any) => m.qty > 0)

    if (stockMoveInputs.length > 0) {
      await recordStockMovements(stockMoveInputs, supabase)
    }

    return NextResponse.json(stockOpname)
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
