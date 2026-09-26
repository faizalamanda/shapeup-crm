import { getApiContext } from '@/lib/apiContext'
import { NextResponse } from 'next/server'
import { ensureExpenseAccounts } from '@/lib/expenseLedger'
import { postJournalTransaction } from '@/lib/journalHelper'

export async function GET(req: Request) {
  const ctx = await getApiContext()
  if (ctx.error) return ctx.error
  const { businessId, supabase } = ctx

  try {
    const url = new URL(req.url)
    const id = url.searchParams.get('id')
    const all = url.searchParams.get('all') === 'true'
    const pageParam = url.searchParams.get('page')
    const limitParam = url.searchParams.get('limit')
    const search = url.searchParams.get('search') || ''

    if (id) {
      const { data: purchase, error: fetchErr } = await supabase
        .from('purchases')
        .select(`
          *,
          suppliers(id, name)
        `)
        .eq('business_id', businessId)
        .eq('id', id)
        .single()

      if (fetchErr) {
        return NextResponse.json({ error: fetchErr.message }, { status: 500 })
      }
      return NextResponse.json(purchase)
    }

    if (all) {
      const { data: purchases, error: fetchErr } = await supabase
        .from('purchases')
        .select(`
          *,
          suppliers(id, name)
        `)
        .eq('business_id', businessId)
        .order('date', { ascending: false })
        .order('created_at', { ascending: false })

      if (fetchErr) {
        return NextResponse.json({ error: fetchErr.message }, { status: 500 })
      }
      return NextResponse.json(purchases)
    }

    // Default pagination: 25 items per page
    const page = Math.max(1, parseInt(pageParam || '1', 10))
    const limit = Math.max(1, parseInt(limitParam || '25', 10))
    const from = (page - 1) * limit
    const to = from + limit - 1

    let supplierIds: string[] = []
    if (search.trim()) {
      const { data: matchedSuppliers } = await supabase
        .from('suppliers')
        .select('id')
        .eq('business_id', businessId)
        .ilike('name', `%${search.trim()}%`)
      if (matchedSuppliers && matchedSuppliers.length > 0) {
        supplierIds = matchedSuppliers.map(s => s.id)
      }
    }

    let query = supabase
      .from('purchases')
      .select(`
        *,
        suppliers(id, name)
      `, { count: 'exact' })
      .eq('business_id', businessId)

    if (search.trim()) {
      const trimmed = search.trim()
      if (supplierIds.length > 0) {
        query = query.or(`purchase_number.ilike.%${trimmed}%,supplier_id.in.(${supplierIds.join(',')})`)
      } else {
        query = query.ilike('purchase_number', `%${trimmed}%`)
      }
    }

    const { data: purchases, count, error: fetchErr } = await query
      .order('date', { ascending: false })
      .order('created_at', { ascending: false })
      .range(from, to)

    if (fetchErr) {
      return NextResponse.json({ error: fetchErr.message }, { status: 500 })
    }

    return NextResponse.json({
      data: purchases || [],
      totalCount: count || 0,
      page,
      limit,
      totalPages: Math.ceil((count || 0) / limit)
    })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

export async function POST(req: Request) {
  const ctx = await getApiContext()
  if (ctx.error) return ctx.error
  const { businessId, supabase } = ctx

  try {
    const body = await req.json()
    const {
      supplier_id,
      purchase_number,
      date,
      due_date,
      items, // array: { product_id?: string, name: string, quantity: number, price: number, is_physical: boolean }
      discount_amount = 0,
      other_fees = 0,
      amount_paid = 0,
      payment_method_account_id,
      attachment_url
    } = body

    if (!purchase_number || !date || !items || !Array.isArray(items) || items.length === 0) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
    }

    // Resolve Account Mapping (cached)
    const accountMap = await ensureExpenseAccounts(businessId, supabase)
    const accHutang = accountMap['201000'] // Hutang Usaha
    const accPersediaan = accountMap['102000'] // Persediaan Barang
    const accBeban = accountMap['503000'] // Beban Operasional

    if (!accHutang || !accPersediaan || !accBeban) {
      return NextResponse.json({ error: 'Required accounting accounts could not be resolved' }, { status: 500 })
    }

    // Calculate totals
    let physicalSubtotal = 0
    let serviceSubtotal = 0
    items.forEach((item: any) => {
      const itemPrice = parseFloat(item.price) || 0
      const itemQty = parseInt(item.quantity) || 1
      if (item.is_physical) {
        physicalSubtotal += itemPrice * itemQty
      } else {
        serviceSubtotal += itemPrice * itemQty
      }
    })

    const subtotal = physicalSubtotal + serviceSubtotal
    const discount = parseFloat(discount_amount) || 0
    const fees = parseFloat(other_fees) || 0
    const grandTotal = subtotal - discount + fees

    const paidAmt = parseFloat(amount_paid) || 0
    if (paidAmt > 0 && !payment_method_account_id) {
      return NextResponse.json({ error: 'Payment method is required for initial payment' }, { status: 400 })
    }

    const paymentStatus = paidAmt === 0 ? 'unpaid' : (paidAmt >= grandTotal ? 'paid' : 'partial')

    // Allocation ratio to distribute discounts and fees proportionally
    const ratio = subtotal > 0 ? (grandTotal / subtotal) : 1
    const netPhysicalDebit = physicalSubtotal * ratio
    const netServiceDebit = serviceSubtotal * ratio

    // 1. Create Purchase Journal Transaction via postJournalTransaction helper
    const journalLines: any[] = []
    if (netPhysicalDebit > 0) {
      journalLines.push({ account_id: accPersediaan, debit: netPhysicalDebit, credit: 0 })
    }
    if (netServiceDebit > 0) {
      journalLines.push({ account_id: accBeban, debit: netServiceDebit, credit: 0 })
    }
    journalLines.push({ account_id: accHutang, debit: 0, credit: grandTotal })

    let purchaseTxId: string
    try {
      const postRes = await postJournalTransaction(
        businessId,
        null,
        date,
        `Pembelian: ${purchase_number}`,
        journalLines,
        supabase,
        true
      )
      purchaseTxId = postRes.transactionId
    } catch (txErr: any) {
      return NextResponse.json({ error: `Failed to create ledger transaction: ${txErr?.message}` }, { status: 500 })
    }

    // 2. Batch update stock & WAC cost price for physical products (Aggregated & Optimized Parallel Execution)
    const physicalItems = items.filter((item: any) => item.is_physical && item.product_id)
    if (physicalItems.length > 0) {
      const aggregatedPhysical = new Map<string, { totalQty: number; totalNetCost: number }>()
      for (const item of physicalItems) {
        const pId = item.product_id
        const qty = parseFloat(item.quantity) || 0
        const netPrice = (parseFloat(item.price) || 0) * ratio
        const existing = aggregatedPhysical.get(pId) || { totalQty: 0, totalNetCost: 0 }
        aggregatedPhysical.set(pId, {
          totalQty: existing.totalQty + qty,
          totalNetCost: existing.totalNetCost + (qty * netPrice)
        })
      }

      const productIds = Array.from(aggregatedPhysical.keys())
      const { data: products, error: prodErr } = await supabase
        .from('products')
        .select('id, cost_price, stock_quantity')
        .in('id', productIds)

      if (prodErr) {
        console.error(`Failed to batch fetch products for stock update: ${prodErr.message}`)
      } else if (products) {
        const productMap = new Map<string, { id: string; cost_price: number; stock_quantity: number }>(
          products.map(p => [p.id, p])
        )

        const updatePromises = Array.from(aggregatedPhysical.entries()).map(([productId, agg]) => {
          const product = productMap.get(productId)
          if (!product) return Promise.resolve()

          const currentQty = Number(product.stock_quantity) || 0
          const currentCost = Number(product.cost_price) || 0
          const purchaseQty = agg.totalQty
          const newQty = currentQty + purchaseQty
          let newCost = agg.totalQty > 0 ? (agg.totalNetCost / agg.totalQty) : currentCost

          if (newQty > 0 && currentQty > 0) {
            newCost = ((currentQty * currentCost) + agg.totalNetCost) / newQty
          }

          return supabase
            .from('products')
            .update({
              stock_quantity: newQty,
              cost_price: newCost
            })
            .eq('id', productId)
        })

        await Promise.all(updatePromises)
      }
    }

    // 3. Create the purchase record
    const { data: purchase, error: purErr } = await supabase
      .from('purchases')
      .insert({
        business_id: businessId,
        transaction_id: purchaseTxId,
        supplier_id: supplier_id || null,
        purchase_number,
        date,
        due_date: due_date || null,
        subtotal,
        discount_amount: discount,
        other_fees: fees,
        grand_total: grandTotal,
        amount_paid: paidAmt,
        payment_status: paymentStatus,
        items_json: items,
        attachment_url
      })
      .select('*')
      .single()

    if (purErr) {
      await supabase.from('transactions').delete().eq('id', purchaseTxId)
      return NextResponse.json({ error: `Failed to create purchase entry: ${purErr.message}` }, { status: 500 })
    }

    // 4. Handle initial/DP payment if paidAmt > 0
    if (paidAmt > 0) {
      try {
        const payJournalLines = [
          { account_id: accHutang, debit: paidAmt, credit: 0 },
          { account_id: payment_method_account_id, debit: 0, credit: paidAmt }
        ]
        const payPostRes = await postJournalTransaction(
          businessId,
          null,
          date,
          `Pembayaran Awal Pembelian: ${purchase_number}`,
          payJournalLines,
          supabase,
          true
        )

        const { error: insPayErr } = await supabase
          .from('purchase_payments')
          .insert({
            business_id: businessId,
            purchase_id: purchase.id,
            transaction_id: payPostRes.transactionId,
            date: date,
            amount: paidAmt,
            payment_method_account_id,
            notes: 'Uang Muka / Pembayaran Awal',
            attachment_url
          })

        if (insPayErr) {
          console.error(`Failed to record purchase payment log: ${insPayErr.message}`)
        }
      } catch (payTxErr: any) {
        console.error(`Failed to create payment transaction: ${payTxErr?.message}`)
      }
    }

    return NextResponse.json(purchase)
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

export async function PUT(req: Request) {
  const ctx = await getApiContext()
  if (ctx.error) return ctx.error
  const { businessId, supabase } = ctx

  try {
    const url = new URL(req.url)
    const body = await req.json()
    const id = url.searchParams.get('id') || body.id

    if (!id) {
      return NextResponse.json({ error: 'Missing purchase ID' }, { status: 400 })
    }

    // 1. Fetch existing purchase
    const { data: oldPurchase, error: getErr } = await supabase
      .from('purchases')
      .select('*')
      .eq('id', id)
      .eq('business_id', businessId)
      .single()

    if (getErr || !oldPurchase) {
      return NextResponse.json({ error: 'Purchase not found' }, { status: 404 })
    }

    if (oldPurchase.payment_status !== 'unpaid' || (oldPurchase.amount_paid || 0) > 0) {
      return NextResponse.json({ error: 'Pembelian tidak dapat diubah karena sudah memiliki riwayat pembayaran/cicilan. Edit hanya dapat dilakukan pada pembelian yang belum terbayar.' }, { status: 400 })
    }

    // Check if there are any payment logs in purchase_payments
    const { count: payCount } = await supabase
      .from('purchase_payments')
      .select('id', { count: 'exact', head: true })
      .eq('purchase_id', id)

    if (payCount && payCount > 0) {
      return NextResponse.json({ error: 'Pembelian tidak dapat diubah karena sudah memiliki riwayat pembayaran.' }, { status: 400 })
    }

    const {
      supplier_id,
      purchase_number,
      date,
      due_date,
      items,
      discount_amount = 0,
      other_fees = 0,
      amount_paid = 0,
      payment_method_account_id,
      attachment_url
    } = body

    if (!purchase_number || !date || !items || !Array.isArray(items) || items.length === 0) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
    }

    // Resolve Account Mapping (cached)
    const accountMap = await ensureExpenseAccounts(businessId, supabase)
    const accHutang = accountMap['201000']
    const accPersediaan = accountMap['102000']
    const accBeban = accountMap['503000']

    if (!accHutang || !accPersediaan || !accBeban) {
      return NextResponse.json({ error: 'Required accounting accounts could not be resolved' }, { status: 500 })
    }

    // 2. Revert old physical items stock (Aggregated, Batch & Parallel)
    const oldItems = Array.isArray(oldPurchase.items_json) ? oldPurchase.items_json : []
    const oldPhysicalItems = oldItems.filter((i: any) => i.is_physical && i.product_id)
    if (oldPhysicalItems.length > 0) {
      const aggregatedOldPhysical = new Map<string, number>()
      for (const item of oldPhysicalItems) {
        const pId = item.product_id
        const qty = parseFloat(item.quantity) || 0
        aggregatedOldPhysical.set(pId, (aggregatedOldPhysical.get(pId) || 0) + qty)
      }

      const oldProdIds = Array.from(aggregatedOldPhysical.keys())
      const { data: oldProducts } = await supabase
        .from('products')
        .select('id, stock_quantity')
        .in('id', oldProdIds)

      if (oldProducts) {
        const oldProdMap = new Map(oldProducts.map(p => [p.id, p]))
        const revertPromises = Array.from(aggregatedOldPhysical.entries()).map(([productId, qty]) => {
          const product = oldProdMap.get(productId)
          if (!product) return Promise.resolve()
          const revertedQty = (Number(product.stock_quantity) || 0) - qty
          return supabase
            .from('products')
            .update({ stock_quantity: revertedQty })
            .eq('id', productId)
        })
        await Promise.all(revertPromises)
      }
    }

    // 3. Calculate new totals
    let physicalSubtotal = 0
    let serviceSubtotal = 0
    items.forEach((item: any) => {
      const itemPrice = parseFloat(item.price) || 0
      const itemQty = parseInt(item.quantity) || 1
      if (item.is_physical) {
        physicalSubtotal += itemPrice * itemQty
      } else {
        serviceSubtotal += itemPrice * itemQty
      }
    })

    const subtotal = physicalSubtotal + serviceSubtotal
    const discount = parseFloat(discount_amount) || 0
    const fees = parseFloat(other_fees) || 0
    const grandTotal = subtotal - discount + fees

    const paidAmt = parseFloat(amount_paid) || 0
    if (paidAmt > 0 && !payment_method_account_id) {
      return NextResponse.json({ error: 'Payment method is required for initial payment' }, { status: 400 })
    }

    const paymentStatus = paidAmt === 0 ? 'unpaid' : (paidAmt >= grandTotal ? 'paid' : 'partial')
    const ratio = subtotal > 0 ? (grandTotal / subtotal) : 1
    const netPhysicalDebit = physicalSubtotal * ratio
    const netServiceDebit = serviceSubtotal * ratio

    // 4. Update stock & WAC cost for new physical products (Aggregated, Batch & Parallel)
    const newPhysicalItems = items.filter((i: any) => i.is_physical && i.product_id)
    if (newPhysicalItems.length > 0) {
      const aggregatedNewPhysical = new Map<string, { totalQty: number; totalNetCost: number }>()
      for (const item of newPhysicalItems) {
        const pId = item.product_id
        const qty = parseFloat(item.quantity) || 0
        const netPrice = (parseFloat(item.price) || 0) * ratio
        const existing = aggregatedNewPhysical.get(pId) || { totalQty: 0, totalNetCost: 0 }
        aggregatedNewPhysical.set(pId, {
          totalQty: existing.totalQty + qty,
          totalNetCost: existing.totalNetCost + (qty * netPrice)
        })
      }

      const newProdIds = Array.from(aggregatedNewPhysical.keys())
      const { data: newProducts, error: prodErr } = await supabase
        .from('products')
        .select('id, cost_price, stock_quantity')
        .in('id', newProdIds)

      if (!prodErr && newProducts) {
        const newProdMap = new Map(newProducts.map(p => [p.id, p]))
        const updatePromises = Array.from(aggregatedNewPhysical.entries()).map(([productId, agg]) => {
          const product = newProdMap.get(productId)
          if (!product) return Promise.resolve()

          const currentQty = Number(product.stock_quantity) || 0
          const currentCost = Number(product.cost_price) || 0
          const purchaseQty = agg.totalQty
          const newQty = currentQty + purchaseQty
          let newCost = agg.totalQty > 0 ? (agg.totalNetCost / agg.totalQty) : currentCost

          if (newQty > 0 && currentQty > 0) {
            newCost = ((currentQty * currentCost) + agg.totalNetCost) / newQty
          }

          return supabase
            .from('products')
            .update({
              stock_quantity: newQty,
              cost_price: newCost
            })
            .eq('id', productId)
        })
        await Promise.all(updatePromises)
      }
    }

    // 5. Update main transaction & journal lines
    let mainTxId = oldPurchase.transaction_id
    if (mainTxId) {
      await supabase
        .from('transactions')
        .update({
          date: date,
          description: `Pembelian: ${purchase_number}`
        })
        .eq('id', mainTxId)

      await supabase
        .from('journal_lines')
        .delete()
        .eq('transaction_id', mainTxId)
    } else {
      const { data: newTx, error: txErr } = await supabase
        .from('transactions')
        .insert({
          business_id: businessId,
          date: date,
          description: `Pembelian: ${purchase_number}`
        })
        .select('*')
        .single()

      if (txErr || !newTx) {
        return NextResponse.json({ error: `Failed to create ledger transaction: ${txErr?.message}` }, { status: 500 })
      }
      mainTxId = newTx.id
    }

    // Re-insert journal lines
    const journalLines: any[] = []
    if (netPhysicalDebit > 0) {
      journalLines.push({
        transaction_id: mainTxId,
        account_id: accPersediaan,
        debit: netPhysicalDebit,
        credit: 0
      })
    }
    if (netServiceDebit > 0) {
      journalLines.push({
        transaction_id: mainTxId,
        account_id: accBeban,
        debit: netServiceDebit,
        credit: 0
      })
    }
    journalLines.push({
      transaction_id: mainTxId,
      account_id: accHutang,
      debit: 0,
      credit: grandTotal
    })

    const { error: jlErr } = await supabase.from('journal_lines').insert(journalLines)
    if (jlErr) {
      return NextResponse.json({ error: `Failed to update journal lines: ${jlErr.message}` }, { status: 500 })
    }

    // 6. Update the purchase record
    const { data: updatedPurchase, error: purErr } = await supabase
      .from('purchases')
      .update({
        transaction_id: mainTxId,
        supplier_id: supplier_id || null,
        purchase_number,
        date,
        due_date: due_date || null,
        subtotal,
        discount_amount: discount,
        other_fees: fees,
        grand_total: grandTotal,
        amount_paid: paidAmt,
        payment_status: paymentStatus,
        items_json: items,
        attachment_url
      })
      .eq('id', id)
      .select('*')
      .single()

    if (purErr) {
      return NextResponse.json({ error: `Failed to update purchase entry: ${purErr.message}` }, { status: 500 })
    }

    // 7. Handle initial/DP payment if entered during edit (paidAmt > 0)
    if (paidAmt > 0) {
      try {
        const payJournalLines = [
          { account_id: accHutang, debit: paidAmt, credit: 0 },
          { account_id: payment_method_account_id, debit: 0, credit: paidAmt }
        ]
        const payPostRes = await postJournalTransaction(
          businessId,
          null,
          date,
          `Pembayaran Awal Pembelian: ${purchase_number}`,
          payJournalLines,
          supabase,
          true
        )

        await supabase
          .from('purchase_payments')
          .insert({
            business_id: businessId,
            purchase_id: id,
            transaction_id: payPostRes.transactionId,
            date: date,
            amount: paidAmt,
            payment_method_account_id,
            notes: 'Uang Muka / Pembayaran Awal',
            attachment_url
          })
      } catch (payTxErr: any) {
        console.error(`Failed to record payment in edit: ${payTxErr?.message}`)
      }
    }

    return NextResponse.json(updatedPurchase)
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

export async function DELETE(req: Request) {
  const ctx = await getApiContext()
  if (ctx.error) return ctx.error
  const { businessId, supabase } = ctx

  try {
    const url = new URL(req.url)
    const id = url.searchParams.get('id')

    if (!id) {
      return NextResponse.json({ error: 'Missing purchase ID' }, { status: 400 })
    }

    // Fetch the purchase first
    const { data: purchase, error: getErr } = await supabase
      .from('purchases')
      .select('*')
      .eq('id', id)
      .eq('business_id', businessId)
      .single()

    if (getErr || !purchase) {
      return NextResponse.json({ error: 'Purchase not found' }, { status: 404 })
    }

    // Revert inventory quantities in batch & parallel (Aggregated)
    const items = Array.isArray(purchase.items_json) ? purchase.items_json : []
    const physicalItems = items.filter((i: any) => i.is_physical && i.product_id)
    if (physicalItems.length > 0) {
      const aggregatedPhysical = new Map<string, number>()
      for (const item of physicalItems) {
        const pId = item.product_id
        const qty = parseFloat(item.quantity) || 0
        aggregatedPhysical.set(pId, (aggregatedPhysical.get(pId) || 0) + qty)
      }

      const prodIds = Array.from(aggregatedPhysical.keys())
      const { data: products } = await supabase
        .from('products')
        .select('id, stock_quantity')
        .in('id', prodIds)

      if (products) {
        const prodMap = new Map(products.map(p => [p.id, p]))
        const revertPromises = Array.from(aggregatedPhysical.entries()).map(([productId, qty]) => {
          const product = prodMap.get(productId)
          if (!product) return Promise.resolve()
          const newQty = (Number(product.stock_quantity) || 0) - qty
          return supabase
            .from('products')
            .update({ stock_quantity: newQty })
            .eq('id', productId)
        })
        await Promise.all(revertPromises)
      }
    }

    // Delete purchase payments first
    const { data: payments } = await supabase
      .from('purchase_payments')
      .select('transaction_id')
      .eq('purchase_id', id)

    if (payments && payments.length > 0) {
      const txIds = payments.map(p => p.transaction_id).filter(Boolean)
      if (txIds.length > 0) {
        await supabase.from('transactions').delete().in('id', txIds)
      }
    }

    // Delete main transaction (which cascades to purchase deletion)
    if (purchase.transaction_id) {
      const { error: delTxErr } = await supabase
        .from('transactions')
        .delete()
        .eq('id', purchase.transaction_id)

      if (delTxErr) {
        return NextResponse.json({ error: `Failed to delete purchase transaction: ${delTxErr.message}` }, { status: 500 })
      }
    } else {
      const { error: delPurErr } = await supabase
        .from('purchases')
        .delete()
        .eq('id', id)

      if (delPurErr) {
        return NextResponse.json({ error: `Failed to delete purchase: ${delPurErr.message}` }, { status: 500 })
      }
    }

    return NextResponse.json({ success: true })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
