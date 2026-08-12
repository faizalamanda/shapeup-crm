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

    // Fetch purchases and their linked suppliers
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

    // For each purchase, fetch payments to ensure client has detail
    const { data: payments, error: payErr } = await supabase
      .from('purchase_payments')
      .select('*')
      .eq('business_id', businessId)

    const paymentsByPurchase: Record<string, any[]> = {}
    if (payments) {
      payments.forEach(p => {
        if (!paymentsByPurchase[p.purchase_id]) {
          paymentsByPurchase[p.purchase_id] = []
        }
        paymentsByPurchase[p.purchase_id].push(p)
      })
    }

    const purchasesWithPayments = purchases.map(p => ({
      ...p,
      payments: paymentsByPurchase[p.id] || []
    }))

    return NextResponse.json(purchasesWithPayments)
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

    // Resolve Account Mapping
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

    // 1. Create Purchase Transaction (inventory receipt & accounts payable entry)
    const { data: purchaseTx, error: txErr } = await supabase
      .from('transactions')
      .insert({
        business_id: businessId,
        date: date,
        description: `Pembelian: ${purchase_number}`
      })
      .select('*')
      .single()

    if (txErr || !purchaseTx) {
      return NextResponse.json({ error: `Failed to create ledger transaction: ${txErr?.message}` }, { status: 500 })
    }

    // Create journal lines for this transaction
    const journalLines = []

    // Debit Physical Inventory
    if (netPhysicalDebit > 0) {
      journalLines.push({
        transaction_id: purchaseTx.id,
        account_id: accPersediaan,
        debit: netPhysicalDebit,
        credit: 0
      })
    }

    // Debit Service/Operational Expense
    if (netServiceDebit > 0) {
      journalLines.push({
        transaction_id: purchaseTx.id,
        account_id: accBeban,
        debit: netServiceDebit,
        credit: 0
      })
    }

    // Credit Accounts Payable (Hutang Usaha)
    journalLines.push({
      transaction_id: purchaseTx.id,
      account_id: accHutang,
      debit: 0,
      credit: grandTotal
    })

    const { error: jlErr } = await supabase.from('journal_lines').insert(journalLines)
    if (jlErr) {
      await supabase.from('transactions').delete().eq('id', purchaseTx.id)
      return NextResponse.json({ error: `Failed to create journal lines: ${jlErr.message}` }, { status: 500 })
    }

    // 2. Update stock & WAC cost for physical products
    for (const item of items) {
      if (item.is_physical && item.product_id) {
        // Fetch current product details
        const { data: product, error: prodErr } = await supabase
          .from('products')
          .select('id, cost_price, stock_quantity')
          .eq('id', item.product_id)
          .single()

        if (prodErr || !product) {
          console.error(`Failed to fetch product for stock update: ${item.product_id}`)
          continue
        }

        const currentQty = Number(product.stock_quantity) || 0
        const currentCost = Number(product.cost_price) || 0
        const purchaseQty = parseFloat(item.quantity) || 0
        const netPurchasePrice = (parseFloat(item.price) || 0) * ratio // Net cost net of discount/fees allocation

        const newQty = currentQty + purchaseQty
        let newCost = netPurchasePrice

        if (newQty > 0 && currentQty > 0) {
          newCost = ((currentQty * currentCost) + (purchaseQty * netPurchasePrice)) / newQty
        }

        const { error: updErr } = await supabase
          .from('products')
          .update({
            stock_quantity: newQty,
            cost_price: newCost
          })
          .eq('id', item.product_id)

        if (updErr) {
          console.error(`Failed to update product stock: ${updErr.message}`)
        }
      }
    }

    // 3. Create the purchase record
    const { data: purchase, error: purErr } = await supabase
      .from('purchases')
      .insert({
        business_id: businessId,
        transaction_id: purchaseTx.id,
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
      // Clean up transaction
      await supabase.from('transactions').delete().eq('id', purchaseTx.id)
      return NextResponse.json({ error: `Failed to create purchase entry: ${purErr.message}` }, { status: 500 })
    }

    // 4. Handle initial/DP payment if paidAmt > 0
    if (paidAmt > 0) {
      const { data: payTx, error: payTxErr } = await supabase
        .from('transactions')
        .insert({
          business_id: businessId,
          date: date,
          description: `Pembayaran Awal Pembelian: ${purchase_number}`
        })
        .select('*')
        .single()

      if (payTxErr || !payTx) {
        console.error(`Failed to create payment transaction: ${payTxErr?.message}`)
      } else {
        const payJournalLines = [
          {
            transaction_id: payTx.id,
            account_id: accHutang, // Debit Hutang Usaha to decrease liability
            debit: paidAmt,
            credit: 0
          },
          {
            transaction_id: payTx.id,
            account_id: payment_method_account_id, // Credit Cash/Bank
            debit: 0,
            credit: paidAmt
          }
        ]

        const { error: pjlErr } = await supabase.from('journal_lines').insert(payJournalLines)
        if (pjlErr) {
          console.error(`Failed to create payment journal lines: ${pjlErr.message}`)
          await supabase.from('transactions').delete().eq('id', payTx.id)
        } else {
          // Record payment details
          const { error: insPayErr } = await supabase
            .from('purchase_payments')
            .insert({
              business_id: businessId,
              purchase_id: purchase.id,
              transaction_id: payTx.id,
              date: date,
              amount: paidAmt,
              payment_method_account_id,
              notes: 'Uang Muka / Pembayaran Awal',
              attachment_url
            })

          if (insPayErr) {
            console.error(`Failed to record purchase payment log: ${insPayErr.message}`)
          }
        }
      }
    }

    return NextResponse.json(purchase)
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
      return NextResponse.json({ error: 'Missing purchase ID' }, { status: 400 })
    }

    // Fetch the purchase first
    const { data: purchase, error: getErr } = await supabase
      .from('purchases')
      .select('*')
      .eq('id', id)
      .single()

    if (getErr || !purchase) {
      return NextResponse.json({ error: 'Purchase not found' }, { status: 404 })
    }

    // Revert inventory quantities (WAC is not fully reverted historically, but we reduce stock_quantity!)
    const items = Array.isArray(purchase.items_json) ? purchase.items_json : []
    for (const item of items) {
      if (item.is_physical && item.product_id) {
        const { data: product } = await supabase
          .from('products')
          .select('stock_quantity')
          .eq('id', item.product_id)
          .single()

        if (product) {
          const newQty = (product.stock_quantity || 0) - (parseInt(item.quantity) || 0)
          await supabase
            .from('products')
            .update({ stock_quantity: newQty })
            .eq('id', item.product_id)
        }
      }
    }

    // Delete purchase payments first (cascades transaction deletions)
    const { data: payments } = await supabase
      .from('purchase_payments')
      .select('transaction_id')
      .eq('purchase_id', id)

    if (payments) {
      for (const p of payments) {
        await supabase.from('transactions').delete().eq('id', p.transaction_id)
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
