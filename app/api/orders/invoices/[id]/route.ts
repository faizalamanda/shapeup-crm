import { getApiContext } from '@/lib/apiContext'
import { getActivePaymentAccounts, resolvePaymentAccountFromCOA } from '@/lib/accountHelper'
import { resolveOrCreateCustomer } from '@/lib/customerHelper'
import { syncOrderToLedger } from '@/lib/orderLedger'
import { isUuid } from '@/lib/utils'
import { invalidateInvoicesCache } from '../route'
import { NextResponse } from 'next/server'

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    if (!isUuid(id)) {
      return NextResponse.json({ error: 'ID invoice tidak valid' }, { status: 400 })
    }

    const ctx = await getApiContext()
    if (ctx.error) return ctx.error
    const { businessId, supabaseAdmin } = ctx

    const { data: invoice, error: fetchErr } = await supabaseAdmin
      .from('orders')
      .select('*, customers(*)')
      .eq('id', id)
      .eq('business_id', businessId)
      .or('source_platform.eq.Invoice,raw_source_data->>is_invoice.eq.true,order_number.ilike.INV-%')
      .single()

    if (fetchErr || !invoice) {
      return NextResponse.json({ error: 'Invoice tidak ditemukan' }, { status: 404 })
    }

    // Fetch active Cash/Bank COA accounts of this business & order_payments in parallel
    const [{ data: allOrderPays }, paymentAccounts] = await Promise.all([
      supabaseAdmin
        .from('order_payments')
        .select('*')
        .eq('order_id', id)
        .order('created_at', { ascending: true }),
      getActivePaymentAccounts(businessId, supabaseAdmin)
    ])

    const reversedPayIds = new Set(
      (allOrderPays || [])
        .filter((p: any) => p.payment_kind === 'void' || p.payment_kind === 'refund')
        .map((p: any) => p.voided_payment_id)
        .filter(Boolean)
    )
    const activePayments = (allOrderPays || []).filter(
      (p: any) => p.payment_kind === 'payment' && !reversedPayIds.has(p.id)
    )

    const enrichedPayments = activePayments.map((p: any) => {
      const resolvedAcc = resolvePaymentAccountFromCOA(
        paymentAccounts,
        p.payment_method,
        p.payment_method_account_id
      )
      return {
        ...p,
        payment_method_account_id: p.payment_method_account_id || resolvedAcc?.id || null,
        payment_account: resolvedAcc
      }
    })

    // Normalize legacy invoice payment_status & amount_paid if missing
    const grandTotalNum = Number(invoice.grand_total || 0)
    const normalizedPaymentStatus = invoice.payment_status
      || (invoice.status === 'completed' ? 'paid' : (Number(invoice.amount_paid || 0) >= grandTotalNum - 0.01 && grandTotalNum > 0 ? 'paid' : (Number(invoice.amount_paid || 0) > 0 ? 'partial' : 'unpaid')))
    const normalizedAmountPaid = normalizedPaymentStatus === 'paid' && !Number(invoice.amount_paid)
      ? grandTotalNum
      : Number(invoice.amount_paid || 0)

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
      payment_accounts: paymentAccounts,
      invoice: {
        ...invoice,
        payment_status: normalizedPaymentStatus,
        amount_paid: normalizedAmountPaid,
        creator,
        payments: enrichedPayments
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
  try {
    const { id } = await params
    if (!isUuid(id)) {
      return NextResponse.json({ error: 'ID invoice tidak valid' }, { status: 400 })
    }

    const ctx = await getApiContext()
    if (ctx.error) return ctx.error
    const { user, businessId, supabaseAdmin } = ctx

    // Fetch user profile role
    const { data: profile } = await supabaseAdmin
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .maybeSingle()

    // Fetch existing invoice
    const { data: existing, error: existErr } = await supabaseAdmin
      .from('orders')
      .select('*')
      .eq('id', id)
      .eq('business_id', businessId)
      .or('source_platform.eq.Invoice,raw_source_data->>is_invoice.eq.true,order_number.ilike.INV-%')
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
      customer_address, // AddressData JSONB - from QuickAddCustomerForm
      marketplace_profiles,
      order_date,
      due_date,
      payment_terms,
      items,
      discount_amount,
      shipping_cost,
      other_fees,
      grand_total,
      status, // 'pending', 'processing', 'shipped', 'completed', 'cancelled'
      payment_status, // 'unpaid', 'partial', 'paid'
      amount_paid,
      source_platform, // 'Invoice', 'WhatsApp', 'Instagram', 'Shopee', 'Tokopedia', 'TikTok', 'Manual', etc.
      source_order_ref, // Reference / PO number
      utm_source,
      utm_campaign,
      payment_method,
      payment_method_account_id,
      payment_date,
      notes,
      // Customization settings
      custom_title,
      custom_subtitle,
      custom_notes,
      accent_color,
      layout_style,
      show_sku,
      show_description,
      show_notes,
      courier,
      tracking_number,
      show_address,
      show_shipping
    } = body

    // If it's a cancellation request
    if (status === 'cancelled' && existing.status !== 'cancelled') {
      // 1. Update status
      const { data: cancelledOrder, error: cancelErr } = await supabaseAdmin
        .from('orders')
        .update({ status: 'cancelled' })
        .eq('id', id)
        .select('*')
        .single()

      if (cancelErr) throw cancelErr

      // 2. Delegate Reversal to unified orderLedger service
      // This automatically restores stock safely via stock_moves and reverses financial journals
      await syncOrderToLedger(id, supabaseAdmin, cancelledOrder)

      invalidateInvoicesCache(businessId)
      return NextResponse.json({ success: true, message: 'Invoice berhasil dibatalkan' })
    }

    // Check if it's purely a design/customization update on an already completed & paid invoice
    const isPaymentUpdateRequested =
      payment_status !== undefined ||
      amount_paid !== undefined ||
      payment_method !== undefined ||
      payment_method_account_id !== undefined ||
      payment_date !== undefined

    const isStatusOrItemsUpdateRequested =
      (status !== undefined && status !== existing.status) ||
      (items !== undefined && Array.isArray(items))

    if (existing.status === 'completed' && existing.payment_status === 'paid' && !isPaymentUpdateRequested && !isStatusOrItemsUpdateRequested) {
      // Fast-path for pure design/customization updates on completed & paid invoices
      const currentRaw = (existing.raw_source_data || {}) as Record<string, any>
      const updatedRaw = {
        ...currentRaw,
        is_invoice: true,
        custom_title: custom_title !== undefined ? custom_title : currentRaw.custom_title,
        custom_subtitle: custom_subtitle !== undefined ? custom_subtitle : currentRaw.custom_subtitle,
        custom_notes: custom_notes !== undefined ? custom_notes : currentRaw.custom_notes,
        accent_color: accent_color !== undefined ? accent_color : currentRaw.accent_color,
        layout_style: layout_style !== undefined ? layout_style : currentRaw.layout_style,
        show_sku: show_sku !== undefined ? show_sku : currentRaw.show_sku,
        show_description: show_description !== undefined ? show_description : currentRaw.show_description,
        show_notes: show_notes !== undefined ? show_notes : currentRaw.show_notes,
        show_address: show_address !== undefined ? show_address : (currentRaw.show_address !== undefined ? currentRaw.show_address : true),
        show_shipping: show_shipping !== undefined ? show_shipping : (currentRaw.show_shipping !== undefined ? currentRaw.show_shipping : true),
        source_order: {
          channel: source_platform !== undefined ? source_platform : (currentRaw.source_order?.channel || existing.source_platform || 'Invoice'),
          reference_no: source_order_ref !== undefined ? source_order_ref : (currentRaw.source_order?.reference_no || ''),
          utm_source: utm_source !== undefined ? utm_source : (currentRaw.source_order?.utm_source || ''),
          utm_campaign: utm_campaign !== undefined ? utm_campaign : (currentRaw.source_order?.utm_campaign || '')
        },
        meta_data: [
          { key: 'shapeup_kurir_awb', value: courier !== undefined ? courier : (currentRaw.meta_data?.find((m: any) => m.key === 'shapeup_kurir_awb')?.value || '') },
          { key: 'shapeup_resi_awb', value: tracking_number !== undefined ? tracking_number : (currentRaw.meta_data?.find((m: any) => m.key === 'shapeup_resi_awb')?.value || '') }
        ]
      }

      const updateData: Record<string, any> = { raw_source_data: updatedRaw }
      if (source_platform !== undefined) {
        updateData.source_platform = source_platform
      }

      const { data: updated, error: updErr } = await supabaseAdmin
        .from('orders')
        .update(updateData)
        .eq('id', id)
        .select('*')
        .single()

      if (updErr) throw updErr
      invalidateInvoicesCache(businessId)
      return NextResponse.json({ success: true, message: 'Desain, Pengiriman, & Sumber Invoice diperbarui', order: updated })
    }

    // For all other updates (including updating payment on a completed invoice, or editing draft/processing/shipped invoices)
    const isItemsLocked = existing.status === 'completed' && existing.payment_status === 'paid' && (payment_status === undefined || payment_status === 'paid')

    let resolvedCustomerId = existing.customer_id
    if (!isItemsLocked) {
      if (customer_name && String(customer_name).trim()) {
        const { customer: resolvedCust } = await resolveOrCreateCustomer(
          {
            businessId,
            name: customer_name,
            phone: customer_phone || null,
            email: customer_email || null,
            address_data: customer_address ?? null,
            marketplace_profiles: marketplace_profiles || null,
            reuseExistingOnPhoneMatch: true
          },
          supabaseAdmin
        )
        resolvedCustomerId = resolvedCust.id
      } else if (isUuid(customer_id)) {
        resolvedCustomerId = customer_id
      }
    }

    const currentRaw = (existing.raw_source_data || {}) as Record<string, any>
    const nextRaw = {
      ...currentRaw,
      is_invoice: true,
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
      show_notes: show_notes !== undefined ? show_notes : currentRaw.show_notes,
      show_address: show_address !== undefined ? show_address : (currentRaw.show_address !== undefined ? currentRaw.show_address : true),
      show_shipping: show_shipping !== undefined ? show_shipping : (currentRaw.show_shipping !== undefined ? currentRaw.show_shipping : true),
      source_order: {
        channel: source_platform !== undefined ? source_platform : (currentRaw.source_order?.channel || existing.source_platform || 'Invoice'),
        reference_no: source_order_ref !== undefined ? source_order_ref : (currentRaw.source_order?.reference_no || ''),
        utm_source: utm_source !== undefined ? utm_source : (currentRaw.source_order?.utm_source || ''),
        utm_campaign: utm_campaign !== undefined ? utm_campaign : (currentRaw.source_order?.utm_campaign || '')
      },
      meta_data: [
        { key: 'shapeup_kurir_awb', value: courier !== undefined ? courier : (currentRaw.meta_data?.find((m: any) => m.key === 'shapeup_kurir_awb')?.value || '') },
        { key: 'shapeup_resi_awb', value: tracking_number !== undefined ? tracking_number : (currentRaw.meta_data?.find((m: any) => m.key === 'shapeup_resi_awb')?.value || '') }
      ]
    }

    let finalItems = existing.items_json
    let totalQty = existing.total_qty
    let subtotal = existing.subtotal
    let finalGrandTotal = Number(existing.grand_total || 0)

    if (!isItemsLocked && items && Array.isArray(items)) {
      totalQty = items.reduce((sum: number, item: any) => sum + Number(item.quantity || 1), 0)
      subtotal = items.reduce((sum: number, item: any) => sum + (Number(item.price || 0) * Number(item.quantity || 1)), 0)
      const calculatedDiscountAmount = items.reduce((sum: number, item: any) => sum + (Number(item.discount || 0) * Number(item.quantity || 1)), 0)
      finalGrandTotal = grand_total !== undefined ? Number(grand_total) : (subtotal - calculatedDiscountAmount + Number(shipping_cost || 0) + Number(other_fees || 0))

      finalItems = items.map((item: any, idx: number) => {
        const price = Number(item.price || 0)
        const qty = Number(item.quantity || 1)
        const discount = Number(item.discount || 0)
        const discountedPrice = Math.max(0, price - discount)
        const prodId = isUuid(item.product_id) ? item.product_id : null
        const varId = isUuid(item.variant_id) ? item.variant_id : (isUuid(item.variation_id) ? item.variation_id : null)
        const costPrice = item.cost_price !== undefined && item.cost_price !== null ? Number(item.cost_price) : undefined
        return {
          id: prodId || idx,
          name: item.name,
          description: item.description || '',
          price: price,
          quantity: qty,
          discount: discount,
          sku: item.sku || '',
          total: String(discountedPrice * qty),
          subtotal: String(price * qty),
          product_id: prodId,
          variant_id: varId,
          ...(item.dimension_spec ? { dimension_spec: item.dimension_spec } : {}),
          ...(costPrice !== undefined ? { cost_price: costPrice } : {})
        }
      })
    } else if (!isItemsLocked && grand_total !== undefined) {
      finalGrandTotal = Number(grand_total)
    }

    const nextStatus = status || existing.status

    const calculatedDiscountAmount = !isItemsLocked && items && Array.isArray(items)
      ? items.reduce((sum: number, item: any) => sum + (Number(item.discount || 0) * Number(item.quantity || 1)), 0)
      : (!isItemsLocked && discount_amount !== undefined ? Number(discount_amount) : existing.discount_amount)

    const updatePayload: Record<string, any> = {
      customer_id: resolvedCustomerId,
      source_platform: source_platform !== undefined ? source_platform : existing.source_platform,
      order_date: !isItemsLocked && order_date ? new Date(order_date).toISOString() : existing.order_date,
      order_date_utc: !isItemsLocked && order_date ? new Date(order_date).toISOString() : existing.order_date_utc,
      total_qty: totalQty,
      subtotal: subtotal,
      shipping_cost: !isItemsLocked && shipping_cost !== undefined ? Number(shipping_cost) : existing.shipping_cost,
      discount_amount: calculatedDiscountAmount,
      other_fees: !isItemsLocked && other_fees !== undefined ? Number(other_fees) : existing.other_fees,
      grand_total: finalGrandTotal,
      status: nextStatus,
      items_json: finalItems,
      raw_source_data: nextRaw
    }

    if (payment_status !== undefined) {
      updatePayload.payment_status = payment_status
      if (payment_status === 'paid') {
        updatePayload.amount_paid = finalGrandTotal
      } else if (payment_status === 'unpaid') {
        updatePayload.amount_paid = 0
      } else if (payment_status === 'partial') {
        const requestedPartial = amount_paid !== undefined ? Number(amount_paid) : Number(existing.amount_paid || 0)
        const clampedPartial = Math.min(finalGrandTotal, Math.max(0, requestedPartial))
        updatePayload.amount_paid = clampedPartial
        updatePayload.payment_status = clampedPartial >= finalGrandTotal - 0.01 ? 'paid' : (clampedPartial > 0 ? 'partial' : 'unpaid')
      }
    } else if (amount_paid !== undefined) {
      const numPaid = Math.min(finalGrandTotal, Math.max(0, Number(amount_paid)))
      updatePayload.amount_paid = numPaid
      updatePayload.payment_status = numPaid >= finalGrandTotal - 0.01 ? 'paid' : (numPaid > 0 ? 'partial' : 'unpaid')
    }

    let resolvedPayAccId: string | null = isUuid(payment_method_account_id) ? payment_method_account_id : null
    let resolvedPayMethodName: string | null = payment_method !== undefined ? payment_method : existing.payment_method

    if (isPaymentUpdateRequested) {
      const paymentAccounts = await getActivePaymentAccounts(businessId, supabaseAdmin)
      const matchedAcc = resolvePaymentAccountFromCOA(
        paymentAccounts,
        payment_method || existing.payment_method,
        resolvedPayAccId
      )
      resolvedPayAccId = matchedAcc?.id || resolvedPayAccId
      resolvedPayMethodName = matchedAcc?.name || payment_method || existing.payment_method || 'Bank Transfer'
      if (updatePayload.payment_status === 'unpaid') {
        updatePayload.payment_method = null
      } else if (resolvedPayMethodName) {
        updatePayload.payment_method = resolvedPayMethodName
      }
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

    // 3.4. Synchronize order_payments if payment details were updated in Edit Invoice
    if (isPaymentUpdateRequested) {
      const targetAmountPaid = Number(updated.amount_paid || 0)
      const { data: allPays } = await supabaseAdmin
        .from('order_payments')
        .select('*')
        .eq('order_id', id)
        .order('created_at', { ascending: true })

      const reversedIds = new Set(
        (allPays || [])
          .filter((p: any) => p.payment_kind === 'void' || p.payment_kind === 'refund')
          .map((p: any) => p.voided_payment_id)
          .filter(Boolean)
      )
      const existingPays = (allPays || []).filter(
        (p: any) => p.payment_kind === 'payment' && !reversedIds.has(p.id)
      )

      const payDateObj = payment_date ? new Date(payment_date) : (order_date ? new Date(order_date) : new Date())
      const effectiveMethodName = resolvedPayMethodName || updated.payment_method || 'Bank Transfer'

      // Helper to remove existing non-reversal payment transactions for this order when re-building payment ledger
      const removeExistingPaymentTransactions = async (specificTxIds?: string[]) => {
        if (specificTxIds && specificTxIds.length > 0) {
          await supabaseAdmin.from('transactions').delete().in('id', specificTxIds)
        }
        const { data: legacyPayTxs } = await supabaseAdmin
          .from('transactions')
          .select('id, description')
          .eq('order_id', id)
        const toRemove = (legacyPayTxs || []).filter((tx: any) =>
          (tx.description?.includes('Pembayaran') || tx.description?.includes('Pelunasan') || tx.description?.includes('Payment')) &&
          !tx.description?.includes('Pembatalan') && !tx.description?.includes('Retur') && !tx.description?.includes('Refund') && !tx.description?.includes('Void') && !tx.description?.includes('Reversal')
        )
        if (toRemove.length > 0) {
          await supabaseAdmin.from('transactions').delete().in('id', toRemove.map((t: any) => t.id))
        }
      }

      if (targetAmountPaid > 0) {
        if (existingPays.length === 0) {
          await removeExistingPaymentTransactions()
          const { error: insPayErr } = await supabaseAdmin.from('order_payments').insert({
            payment_kind: 'payment',
            business_id: businessId,
            order_id: id,
            date: payDateObj.toISOString().split('T')[0],
            amount: targetAmountPaid,
            payment_method: effectiveMethodName,
            payment_method_account_id: resolvedPayAccId,
            notes: `Pembayaran ${updated.source_platform || 'Invoice'} #${updated.order_number}`,
            created_at: payDateObj.toISOString()
          })
          if (insPayErr) {
            console.warn('[EditInvoice] Failed to insert order_payments:', insPayErr.message)
          }
        } else if (existingPays.length === 1) {
          const singlePay = existingPays[0]
          const nextAccId = resolvedPayAccId || singlePay.payment_method_account_id
          const nextDateStr = payment_date ? payDateObj.toISOString().split('T')[0] : singlePay.date
          const hasChanged =
            Math.abs(Number(singlePay.amount) - targetAmountPaid) > 0.01 ||
            singlePay.payment_method_account_id !== nextAccId ||
            singlePay.payment_method !== effectiveMethodName ||
            (payment_date && singlePay.date !== nextDateStr) ||
            !singlePay.transaction_id

          if (hasChanged) {
            await removeExistingPaymentTransactions(singlePay.transaction_id ? [singlePay.transaction_id] : [])
            await supabaseAdmin
              .from('order_payments')
              .update({
                amount: targetAmountPaid,
                payment_method: effectiveMethodName,
                payment_method_account_id: nextAccId,
                transaction_id: null,
                ...(payment_date ? { date: nextDateStr, created_at: payDateObj.toISOString() } : {})
              })
              .eq('id', singlePay.id)
          }
        } else {
          // Multiple active payments exist (e.g., previous DP + new settlement in Edit Invoice)
          const currentSum = existingPays.reduce((s: number, p: any) => s + (Number(p.amount) || 0), 0)
          const diff = targetAmountPaid - currentSum

          if (diff > 0.01) {
            // Add the delta as a new installment payment row so history of previous DP is preserved
            await supabaseAdmin.from('order_payments').insert({
              payment_kind: 'payment',
              business_id: businessId,
              order_id: id,
              date: payDateObj.toISOString().split('T')[0],
              amount: diff,
              payment_method: effectiveMethodName,
              payment_method_account_id: resolvedPayAccId,
              notes: `${updated.payment_status === 'paid' ? 'Pelunasan' : 'Pembayaran Lanjutan'} ${updated.source_platform || 'Invoice'} #${updated.order_number}`,
              created_at: payDateObj.toISOString()
            })
          } else if (diff < -0.01) {
            // Total paid was reduced below previous multi-payment sum: consolidate into single updated payment record
            const oldTxIds = existingPays.map((p: any) => p.transaction_id).filter(Boolean)
            await removeExistingPaymentTransactions(oldTxIds)
            await supabaseAdmin.from('order_payments').delete().in('id', existingPays.map((p: any) => p.id))
            await supabaseAdmin.from('order_payments').insert({
              payment_kind: 'payment',
              business_id: businessId,
              order_id: id,
              date: payDateObj.toISOString().split('T')[0],
              amount: targetAmountPaid,
              payment_method: effectiveMethodName,
              payment_method_account_id: resolvedPayAccId,
              notes: `Pembayaran ${updated.source_platform || 'Invoice'} #${updated.order_number}`,
              created_at: payDateObj.toISOString()
            })
          }
        }
      } else if (updated.payment_status === 'unpaid' || targetAmountPaid <= 0) {
        const oldTxIds = existingPays.map((p: any) => p.transaction_id).filter(Boolean)
        await removeExistingPaymentTransactions(oldTxIds)
        if (existingPays.length > 0) {
          await supabaseAdmin.from('order_payments').delete().in('id', existingPays.map((p: any) => p.id))
        }
      }
    }

    // 3.5. If items/totals were edited or status reverted to pending, refresh active sales journal before re-syncing
    const financialsChanged =
      Number(existing.subtotal) !== Number(updated.subtotal) ||
      Number(existing.grand_total) !== Number(updated.grand_total) ||
      Number(existing.discount_amount) !== Number(updated.discount_amount) ||
      Number(existing.shipping_cost) !== Number(updated.shipping_cost) ||
      Number(existing.other_fees) !== Number(updated.other_fees)

    if ((financialsChanged && Array.isArray(items)) || nextStatus === 'pending') {
      const { data: existingTxs } = await supabaseAdmin
        .from('transactions')
        .select('id, description')
        .eq('order_id', id)
      const salesTxsToDelete = (existingTxs || []).filter((tx: any) =>
        (tx.description?.includes('Penjualan') || tx.description?.includes('Penerbitan') || tx.description?.includes('Sales')) &&
        !tx.description?.includes('Pembatalan') && !tx.description?.includes('Retur') && !tx.description?.includes('Refund')
      )
      if (salesTxsToDelete.length > 0) {
        await supabaseAdmin.from('transactions').delete().in('id', salesTxsToDelete.map((t: any) => t.id))
      }
    }

    // Always sync status change or invoice details to ledger via unified orderLedger service (pass preloaded updated order)
    const syncRes = await syncOrderToLedger(id, supabaseAdmin, {
      ...updated,
      payment_method_account_id: resolvedPayAccId
    })
    if (!syncRes.success) {
      throw new Error(syncRes.message)
    }

    invalidateInvoicesCache(businessId)
    return NextResponse.json({
      success: true,
      message: updated.payment_status === 'paid'
        ? 'Perubahan invoice & pelunasan pembayaran berhasil disimpan dan dijurnal ke Buku Besar'
        : updated.payment_status === 'partial'
        ? 'Perubahan invoice & pembayaran DP berhasil disimpan dan dijurnal ke Buku Besar'
        : 'Perubahan invoice berhasil disimpan',
      order: updated
    })
  } catch (err: any) {
    console.error('Update Invoice Error:', err)
    return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500 })
  }
}

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    if (!isUuid(id)) {
      return NextResponse.json({ error: 'ID invoice tidak valid' }, { status: 400 })
    }

    const ctx = await getApiContext()
    if (ctx.error) return ctx.error
    const { user, businessId, supabaseAdmin } = ctx

    const { data: profile } = await supabaseAdmin
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .maybeSingle()

    // Fetch existing
    const { data: existing, error: existErr } = await supabaseAdmin
      .from('orders')
      .select('id, status, user_id')
      .eq('id', id)
      .eq('business_id', businessId)
      .or('source_platform.eq.Invoice,raw_source_data->>is_invoice.eq.true,order_number.ilike.INV-%')
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

    const { error: delErr } = await supabaseAdmin
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
