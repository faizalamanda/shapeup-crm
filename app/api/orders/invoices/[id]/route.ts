import { createClient } from '@/lib/supabaseServer'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { invalidateInvoicesCache } from '../route'

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const supabase = await createClient()

  try {
    const { data: { user }, error: authErr } = await supabase.auth.getUser()
    if (authErr || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { data: profile } = await supabase
      .from('profiles')
      .select('active_business_id')
      .eq('id', user.id)
      .single()

    if (!profile?.active_business_id) {
      return NextResponse.json({ error: 'Active business not found' }, { status: 400 })
    }

    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
    if (!serviceRoleKey) {
      return NextResponse.json({ error: 'Admin service key not found' }, { status: 500 })
    }
    const supabaseAdmin = createAdminClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      serviceRoleKey
    )

    const { data: invoice, error: fetchErr } = await supabaseAdmin
      .from('orders')
      .select('*, customers(*)')
      .eq('id', id)
      .eq('business_id', profile.active_business_id)
      .eq('source_platform', 'Invoice')
      .single()

    if (fetchErr || !invoice) {
      return NextResponse.json({ error: 'Invoice tidak ditemukan' }, { status: 404 })
    }

    let creator = null
    if (invoice.user_id) {
      const { data: creatorProfile } = await supabaseAdmin
        .from('profiles')
        .select('id, full_name, email')
        .eq('id', invoice.user_id)
        .maybeSingle()
      if (creatorProfile) {
        creator = creatorProfile
      }
    }

    return NextResponse.json({
      success: true,
      invoice: {
        ...invoice,
        creator
      }
    })
  } catch (err: any) {
    console.error('Get Invoice Detail Error:', err)
    return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500 })
  }
}

export async function PUT(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const supabase = await createClient()

  try {
    const { data: { user }, error: authErr } = await supabase.auth.getUser()
    if (authErr || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { data: profile } = await supabase
      .from('profiles')
      .select('active_business_id, role')
      .eq('id', user.id)
      .single()

    if (!profile?.active_business_id) {
      return NextResponse.json({ error: 'Active business not found' }, { status: 400 })
    }

    const businessId = profile.active_business_id

    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
    if (!serviceRoleKey) {
      return NextResponse.json({ error: 'Admin service key not found' }, { status: 500 })
    }
    const supabaseAdmin = createAdminClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      serviceRoleKey
    )

    // Fetch existing invoice
    const { data: existing, error: existErr } = await supabaseAdmin
      .from('orders')
      .select('*')
      .eq('id', id)
      .eq('business_id', businessId)
      .eq('source_platform', 'Invoice')
      .single()

    if (existErr || !existing) {
      return NextResponse.json({ error: 'Invoice tidak ditemukan' }, { status: 404 })
    }

    // Permission check: only admin, or invoice creator, or legacy (null user_id)
    if (profile?.role !== 'admin' && existing.user_id && existing.user_id !== user.id) {
      return NextResponse.json({
        error: 'Anda tidak memiliki akses untuk mengubah invoice ini. Hanya pembuat invoice atau Admin yang dapat mengubahnya.'
      }, { status: 403 })
    }

    const body = await req.json()
    const {
      customer_id,
      customer_name,
      customer_phone,
      customer_email,
      order_date,
      due_date,
      payment_terms,
      items,
      discount_amount,
      shipping_cost,
      other_fees,
      grand_total,
      status, // 'pending', 'processing', 'completed', 'cancelled'
      payment_method,
      notes,
      // Customization settings
      custom_title,
      custom_subtitle,
      custom_notes,
      accent_color,
      layout_style,
      show_sku,
      show_description,
      show_notes
    } = body

    // If it's a cancellation request
    if (status === 'cancelled' && existing.status !== 'cancelled') {
      // 1. Update status
      const { error: cancelErr } = await supabaseAdmin
        .from('orders')
        .update({ status: 'cancelled' })
        .eq('id', id)

      if (cancelErr) throw cancelErr

      // 2. Reverse stock & ledger transaction if it was posted (processing or completed)
      if (existing.status === 'processing' || existing.status === 'completed') {
        const orderItems = Array.isArray(existing.items_json) ? existing.items_json : []
        const productIds = orderItems.map((i: any) => i.product_id).filter(Boolean)
        let totalCogs = 0

        // Restock
        if (productIds.length > 0) {
          const { data: dbProducts } = await supabaseAdmin
            .from('products')
            .select('id, stock_type, stock_quantity, type, cost_price')
            .in('id', productIds)

          if (dbProducts) {
            const productMap = new Map<string, any>()
            dbProducts.forEach(p => productMap.set(p.id, p))

            for (const item of orderItems) {
              const dbProd = productMap.get(item.product_id)
              if (dbProd) {
                if (dbProd.stock_type === 'tracked') {
                  await supabaseAdmin
                    .from('products')
                    .update({ stock_quantity: dbProd.stock_quantity + Number(item.quantity) })
                    .eq('id', dbProd.id)
                }
                if (dbProd.type === 'physical' && dbProd.cost_price > 0) {
                  totalCogs += dbProd.cost_price * Number(item.quantity)
                }
              }
            }
          }
        }

        // Fetch Accounts
        const { data: allAccounts } = await supabaseAdmin
          .from('accounts')
          .select('id, code')
          .eq('business_id', businessId)

        const accountMap: Record<string, string> = {}
        if (allAccounts) {
          allAccounts.forEach(a => {
            accountMap[a.code] = a.id
          })
        }

        // Write Reversal Transaction
        const { data: tx, error: txErr } = await supabaseAdmin
          .from('transactions')
          .insert({
            business_id: businessId,
            order_id: existing.id,
            date: new Date().toISOString(),
            description: `Pembatalan Invoice #${existing.order_number}`
          })
          .select('id')
          .single()

        if (txErr) throw txErr

        const reversalLines = [
          {
            transaction_id: tx.id,
            account_id: accountMap['401000'], // Debit Pendapatan
            debit: Number(existing.grand_total),
            credit: 0
          },
          {
            transaction_id: tx.id,
            account_id: accountMap['103000'], // Kredit Piutang Usaha
            debit: 0,
            credit: Number(existing.grand_total)
          }
        ]

        if (totalCogs > 0) {
          reversalLines.push(
            {
              transaction_id: tx.id,
              account_id: accountMap['102000'], // Debit Persediaan
              debit: totalCogs,
              credit: 0
            },
            {
              transaction_id: tx.id,
              account_id: accountMap['501000'], // Kredit HPP
              debit: 0,
              credit: totalCogs
            }
          )
        }

        // If it was already completed (Paid), reverse the cash/bank as well!
        if (existing.status === 'completed') {
          const payAccountCode = existing.payment_method === 'Cash' ? '101000' : '101200'
          reversalLines.push(
            {
              transaction_id: tx.id,
              account_id: accountMap['103000'], // Debit Piutang Usaha (balancing payment)
              debit: Number(existing.grand_total),
              credit: 0
            },
            {
              transaction_id: tx.id,
              account_id: accountMap[payAccountCode], // Kredit Kas/Bank
              debit: 0,
              credit: Number(existing.grand_total)
            }
          )
        }

        const { error: jlErr } = await supabaseAdmin
          .from('journal_lines')
          .insert(reversalLines)

        if (jlErr) throw jlErr
      }

      invalidateInvoicesCache(businessId)
      return NextResponse.json({ success: true, message: 'Invoice berhasil dibatalkan' })
    }

    // Lock financials if already Paid (completed)
    if (existing.status === 'completed') {
      // Paid invoices can only update customization/appearance
      const currentRaw = (existing.raw_source_data || {}) as Record<string, any>
      const updatedRaw = {
        ...currentRaw,
        custom_title: custom_title !== undefined ? custom_title : currentRaw.custom_title,
        custom_subtitle: custom_subtitle !== undefined ? custom_subtitle : currentRaw.custom_subtitle,
        custom_notes: custom_notes !== undefined ? custom_notes : currentRaw.custom_notes,
        accent_color: accent_color !== undefined ? accent_color : currentRaw.accent_color,
        layout_style: layout_style !== undefined ? layout_style : currentRaw.layout_style,
        show_sku: show_sku !== undefined ? show_sku : currentRaw.show_sku,
        show_description: show_description !== undefined ? show_description : currentRaw.show_description,
        show_notes: show_notes !== undefined ? show_notes : currentRaw.show_notes
      }

      const { data: updated, error: updErr } = await supabaseAdmin
        .from('orders')
        .update({ raw_source_data: updatedRaw })
        .eq('id', id)
        .select('*')
        .single()

      if (updErr) throw updErr
      invalidateInvoicesCache(businessId)
      return NextResponse.json({ success: true, message: 'Desain Invoice diperbarui', order: updated })
    }

    // For Draft or Unpaid (pending/processing), we can edit details
    // If client provided new values, calculate or use them
    let resolvedCustomerId = existing.customer_id
    if (customer_name && customer_phone) {
      let cleanPhone = customer_phone.replace(/\D/g, '')
      if (cleanPhone.startsWith('0')) {
        cleanPhone = '62' + cleanPhone.substring(1)
      } else if (cleanPhone.startsWith('8')) {
        cleanPhone = '62' + cleanPhone
      }

      const { data: existingCust } = await supabaseAdmin
        .from('customers')
        .select('id')
        .eq('business_id', businessId)
        .eq('phone', cleanPhone)
        .maybeSingle()

      if (existingCust) {
        resolvedCustomerId = existingCust.id
      } else {
        const { data: newCust, error: newCustErr } = await supabaseAdmin
          .from('customers')
          .insert({
            business_id: businessId,
            name: customer_name.trim(),
            phone: cleanPhone,
            email: customer_email ? customer_email.trim() : null
          })
          .select('id')
          .single()

        if (newCustErr) throw newCustErr
        resolvedCustomerId = newCust.id
      }
    } else if (customer_id) {
      resolvedCustomerId = customer_id
    }

    const currentRaw = (existing.raw_source_data || {}) as Record<string, any>
    const nextRaw = {
      ...currentRaw,
      due_date: due_date !== undefined ? due_date : currentRaw.due_date,
      payment_terms: payment_terms !== undefined ? payment_terms : currentRaw.payment_terms,
      notes: notes !== undefined ? notes : currentRaw.notes,
      custom_title: custom_title !== undefined ? custom_title : currentRaw.custom_title,
      custom_subtitle: custom_subtitle !== undefined ? custom_subtitle : currentRaw.custom_subtitle,
      custom_notes: custom_notes !== undefined ? custom_notes : currentRaw.custom_notes,
      accent_color: accent_color !== undefined ? accent_color : currentRaw.accent_color,
      layout_style: layout_style !== undefined ? layout_style : currentRaw.layout_style,
      show_sku: show_sku !== undefined ? show_sku : currentRaw.show_sku,
      show_description: show_description !== undefined ? show_description : currentRaw.show_description,
      show_notes: show_notes !== undefined ? show_notes : currentRaw.show_notes
    }

    let finalItems = existing.items_json
    let totalQty = existing.total_qty
    let subtotal = existing.subtotal
    let finalGrandTotal = existing.grand_total

    if (items && Array.isArray(items)) {
      totalQty = items.reduce((sum: number, item: any) => sum + Number(item.quantity || 1), 0)
      subtotal = items.reduce((sum: number, item: any) => sum + (Number(item.price || 0) * Number(item.quantity || 1)), 0)
      finalGrandTotal = grand_total !== undefined ? grand_total : (subtotal - Number(discount_amount || 0) + Number(shipping_cost || 0) + Number(other_fees || 0))

      finalItems = items.map((item: any, idx: number) => ({
        id: item.product_id || idx,
        name: item.name,
        description: item.description || '',
        price: Number(item.price),
        quantity: Number(item.quantity),
        sku: item.sku || '',
        total: String(Number(item.price) * Number(item.quantity)),
        subtotal: String(Number(item.price) * Number(item.quantity)),
        product_id: item.product_id || null
      }))
    } else {
      if (grand_total !== undefined) {
        finalGrandTotal = grand_total
      }
    }

    const nextStatus = status || existing.status

    const updatePayload: Record<string, any> = {
      customer_id: resolvedCustomerId,
      order_date: order_date ? new Date(order_date).toISOString() : existing.order_date,
      order_date_utc: order_date ? new Date(order_date).toISOString() : existing.order_date_utc,
      total_qty: totalQty,
      subtotal: subtotal,
      shipping_cost: shipping_cost !== undefined ? Number(shipping_cost) : existing.shipping_cost,
      discount_amount: discount_amount !== undefined ? Number(discount_amount) : existing.discount_amount,
      other_fees: other_fees !== undefined ? Number(other_fees) : existing.other_fees,
      grand_total: finalGrandTotal,
      status: nextStatus,
      items_json: finalItems,
      raw_source_data: nextRaw
    }

    if (nextStatus === 'completed' && payment_method) {
      updatePayload.payment_method = payment_method
    }

    if (!existing.user_id) {
      updatePayload.user_id = user.id
    }

    // 3. Save Invoice details
    const { data: updated, error: updErr } = await supabaseAdmin
      .from('orders')
      .update(updatePayload)
      .eq('id', id)
      .select('*')
      .single()

    if (updErr) throw updErr

    // 3.5. If the invoice was already processing (outstanding) and its items/prices were edited
    if (existing.status === 'processing' && items && Array.isArray(items)) {
      // Fetch Accounts
      const { data: refetchedAccounts } = await supabaseAdmin
        .from('accounts')
        .select('id, code')
        .eq('business_id', businessId)

      const accountMap: Record<string, string> = {}
      if (refetchedAccounts) {
        refetchedAccounts.forEach(a => {
          accountMap[a.code] = a.id
        })
      }

      // Restore stock for old items
      const oldItems = Array.isArray(existing.items_json) ? existing.items_json : []
      const oldProductIds = oldItems.map((i: any) => i.product_id).filter(Boolean)
      if (oldProductIds.length > 0) {
        const { data: dbOldProducts } = await supabaseAdmin
          .from('products')
          .select('id, stock_type, stock_quantity')
          .in('id', oldProductIds)
        if (dbOldProducts) {
          const oldProdMap = new Map<string, any>()
          dbOldProducts.forEach(p => oldProdMap.set(p.id, p))
          for (const item of oldItems) {
            const dbProd = oldProdMap.get(item.product_id)
            if (dbProd && dbProd.stock_type === 'tracked') {
              await supabaseAdmin
                .from('products')
                .update({ stock_quantity: dbProd.stock_quantity + Number(item.quantity) })
                .eq('id', dbProd.id)
            }
          }
        }
      }

      // Deduct stock for new items and calculate COGS
      let totalCogs = 0
      const newItems = Array.isArray(finalItems) ? finalItems : []
      const newProductIds = newItems.map((i: any) => i.product_id).filter(Boolean)
      if (newProductIds.length > 0) {
        const { data: dbNewProducts } = await supabaseAdmin
          .from('products')
          .select('id, cost_price, stock_type, stock_quantity, type')
          .in('id', newProductIds)
        if (dbNewProducts) {
          const newProdMap = new Map<string, any>()
          dbNewProducts.forEach(p => newProdMap.set(p.id, p))
          for (const item of newItems) {
            const dbProd = newProdMap.get(item.product_id)
            if (dbProd) {
              if (dbProd.stock_type === 'tracked') {
                await supabaseAdmin
                  .from('products')
                  .update({ stock_quantity: Math.max(0, dbProd.stock_quantity - Number(item.quantity)) })
                  .eq('id', dbProd.id)
              }
              if (dbProd.type === 'physical' && dbProd.cost_price > 0) {
                totalCogs += dbProd.cost_price * Number(item.quantity)
              }
            }
          }
        }
      }

      // Update the ledger publishing transaction
      let { data: tx } = await supabaseAdmin
        .from('transactions')
        .select('id')
        .eq('order_id', id)
        .like('description', 'Penerbitan Invoice%')
        .maybeSingle()

      if (!tx) {
        // If the transaction didn't exist for some reason, create it
        const { data: newTx, error: txErr } = await supabaseAdmin
          .from('transactions')
          .insert({
            business_id: businessId,
            order_id: id,
            date: updated.order_date,
            description: `Penerbitan Invoice #${updated.order_number}`
          })
          .select('id')
          .single()
        if (txErr) throw txErr
        tx = newTx
      }

      if (tx) {
        // Delete old journal lines
        await supabaseAdmin
          .from('journal_lines')
          .delete()
          .eq('transaction_id', tx.id)

        // Insert new journal lines
        const journalLines = [
          {
            transaction_id: tx.id,
            account_id: accountMap['103000'], // Piutang Usaha
            debit: Number(updated.grand_total),
            credit: 0
          },
          {
            transaction_id: tx.id,
            account_id: accountMap['401000'], // Pendapatan
            debit: 0,
            credit: Number(updated.grand_total)
          }
        ]

        if (totalCogs > 0) {
          journalLines.push(
            {
              transaction_id: tx.id,
              account_id: accountMap['501000'], // HPP
              debit: totalCogs,
              credit: 0
            },
            {
              transaction_id: tx.id,
              account_id: accountMap['102000'], // Persediaan
              debit: 0,
              credit: totalCogs
            }
          )
        }

        const { error: jlErr } = await supabaseAdmin
          .from('journal_lines')
          .insert(journalLines)

        if (jlErr) throw jlErr
      }
    }

    // 4. If status changed from Draft ('pending') to Sent ('processing')
    if (existing.status === 'pending' && nextStatus === 'processing') {
      // Generate accounts if missing
      const defaultAccounts = [
        { code: '101000', name: 'Kas POS (Tunai)', type: 'ASSET', business_id: businessId },
        { code: '101200', name: 'Bank / QRIS POS', type: 'ASSET', business_id: businessId },
        { code: '103000', name: 'Piutang Usaha', type: 'ASSET', business_id: businessId },
        { code: '401000', name: 'Pendapatan Penjualan POS', type: 'REVENUE', business_id: businessId },
        { code: '501000', name: 'Harga Pokok Penjualan (HPP)', type: 'EXPENSE', business_id: businessId },
        { code: '102000', name: 'Persediaan Barang', type: 'ASSET', business_id: businessId }
      ]

      const { data: allAccounts } = await supabaseAdmin
        .from('accounts')
        .select('id, code')
        .eq('business_id', businessId)

      const existingCodes = allAccounts ? allAccounts.map(a => a.code) : []
      const accountsToCreate = defaultAccounts.filter(a => !existingCodes.includes(a.code))

      if (accountsToCreate.length > 0) {
        await supabaseAdmin.from('accounts').insert(accountsToCreate)
      }

      const { data: refetchedAccounts } = await supabaseAdmin
        .from('accounts')
        .select('id, code')
        .eq('business_id', businessId)

      const accountMap: Record<string, string> = {}
      if (refetchedAccounts) {
        refetchedAccounts.forEach(a => {
          accountMap[a.code] = a.id
        })
      }

      // Deduct stock and calculate COGS if physical
      let totalCogs = 0
      const orderItems = Array.isArray(finalItems) ? finalItems : []
      const productIds = orderItems.map((i: any) => i.product_id).filter(Boolean)

      if (productIds.length > 0) {
        const { data: dbProducts } = await supabaseAdmin
          .from('products')
          .select('id, cost_price, stock_type, stock_quantity, type')
          .in('id', productIds)

        if (dbProducts) {
          const productMap = new Map<string, any>()
          dbProducts.forEach(p => productMap.set(p.id, p))

          for (const item of orderItems) {
            const dbProd = productMap.get(item.product_id)
            if (dbProd) {
              if (dbProd.stock_type === 'tracked') {
                await supabaseAdmin
                  .from('products')
                  .update({ stock_quantity: Math.max(0, dbProd.stock_quantity - Number(item.quantity)) })
                  .eq('id', dbProd.id)
              }
              if (dbProd.type === 'physical' && dbProd.cost_price > 0) {
                totalCogs += dbProd.cost_price * Number(item.quantity)
              }
            }
          }
        }
      }

      // Log transaction
      const { data: tx, error: txErr } = await supabaseAdmin
        .from('transactions')
        .insert({
          business_id: businessId,
          order_id: id,
          date: updated.order_date,
          description: `Penerbitan Invoice #${updated.order_number}`
        })
        .select('id')
        .single()

      if (txErr) throw txErr

      const journalLines = [
        {
          transaction_id: tx.id,
          account_id: accountMap['103000'], // Piutang Usaha
          debit: Number(updated.grand_total),
          credit: 0
        },
        {
          transaction_id: tx.id,
          account_id: accountMap['401000'], // Pendapatan
          debit: 0,
          credit: Number(updated.grand_total)
        }
      ]

      if (totalCogs > 0) {
        journalLines.push(
          {
            transaction_id: tx.id,
            account_id: accountMap['501000'], // HPP
            debit: totalCogs,
            credit: 0
          },
          {
            transaction_id: tx.id,
            account_id: accountMap['102000'], // Persediaan
            debit: 0,
            credit: totalCogs
          }
        )
      }

      const { error: jlErr } = await supabaseAdmin
        .from('journal_lines')
        .insert(journalLines)

      if (jlErr) throw jlErr
    }

    invalidateInvoicesCache(businessId)
    return NextResponse.json({ success: true, order: updated })
  } catch (err: any) {
    console.error('Update Invoice Error:', err)
    return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500 })
  }
}

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const supabase = await createClient()

  try {
    const { data: { user }, error: authErr } = await supabase.auth.getUser()
    if (authErr || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { data: profile } = await supabase
      .from('profiles')
      .select('active_business_id, role')
      .eq('id', user.id)
      .single()

    if (!profile?.active_business_id) {
      return NextResponse.json({ error: 'Active business not found' }, { status: 400 })
    }

    const businessId = profile.active_business_id

    // Fetch existing
    const { data: existing, error: existErr } = await supabase
      .from('orders')
      .select('id, status, user_id')
      .eq('id', id)
      .eq('business_id', businessId)
      .eq('source_platform', 'Invoice')
      .single()

    if (existErr || !existing) {
      return NextResponse.json({ error: 'Invoice tidak ditemukan' }, { status: 404 })
    }

    // Permission check: only admin, or invoice creator, or legacy (null user_id)
    if (profile?.role !== 'admin' && existing.user_id && existing.user_id !== user.id) {
      return NextResponse.json({
        error: 'Anda tidak memiliki akses untuk menghapus invoice ini. Hanya pembuat invoice atau Admin yang dapat menghapusnya.'
      }, { status: 403 })
    }

    // Only allow deleting Drafts ('pending')
    if (existing.status !== 'pending') {
      return NextResponse.json({ 
        error: 'Hanya invoice Draft yang dapat dihapus. Untuk membatalkan invoice terbit, silakan gunakan fitur Batalkan Invoice.' 
      }, { status: 400 })
    }

    const { error: delErr } = await supabase
      .from('orders')
      .delete()
      .eq('id', id)

    if (delErr) throw delErr

    invalidateInvoicesCache(businessId)
    return NextResponse.json({ success: true, message: 'Invoice berhasil dihapus' })
  } catch (err: any) {
    console.error('Delete Invoice Error:', err)
    return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500 })
  }
}
