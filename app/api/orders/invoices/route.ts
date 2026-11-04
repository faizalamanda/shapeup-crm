import { getApiContext } from '@/lib/apiContext'
import { getActivePaymentAccounts, resolvePaymentAccountFromCOA } from '@/lib/accountHelper'
import { resolveOrCreateCustomer } from '@/lib/customerHelper'
import { syncOrderToLedger } from '@/lib/orderLedger'
import { isUuid } from '@/lib/utils'
import { NextResponse } from 'next/server'

// Global in-memory cache for invoices
const globalCache = (global as any).invoicesCache || new Map<string, { data: any, timestamp: number }>();
if (!(global as any).invoicesCache) {
  (global as any).invoicesCache = globalCache;
}

export function getInvoicesCache(cacheKey: string) {
  const cached = globalCache.get(cacheKey)
  if (cached && Date.now() - cached.timestamp < 10000) { // 10 seconds cache
    return cached.data
  }
  return null
}

export function setInvoicesCache(cacheKey: string, data: any) {
  globalCache.set(cacheKey, { data, timestamp: Date.now() })
}

export function invalidateInvoicesCache(businessId: string) {
  for (const key of globalCache.keys()) {
    if (key.startsWith(`${businessId}:`)) {
      globalCache.delete(key)
    }
  }
}

// Helper to format Date to DDMMYYYY
function formatDDMMYYYY(date: Date): string {
  const day = String(date.getDate()).padStart(2, '0')
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const year = date.getFullYear()
  return `${day}${month}${year}`
}

export async function GET(req: Request) {
  try {
    const ctx = await getApiContext()
    if (ctx.error) return ctx.error
    const { businessId, supabaseAdmin } = ctx

    const { searchParams } = new URL(req.url)
    const status = searchParams.get('status')
    const paymentStatus = searchParams.get('payment_status')
    const onlyAccounts = searchParams.get('only_accounts') === 'true'

    if (onlyAccounts) {
      const paymentAccounts = await getActivePaymentAccounts(businessId, supabaseAdmin)
      return NextResponse.json({ success: true, payment_accounts: paymentAccounts })
    }

    // Check Server-Side Cache
    const cacheKey = `${businessId}:${status || 'all'}:${paymentStatus || 'all'}`
    const cachedData = getInvoicesCache(cacheKey)
    if (cachedData) {
      return NextResponse.json({ success: true, invoices: cachedData })
    }

    // 2. Query invoices using supabaseAdmin to bypass RLS for customers
    // Resilient filter: source_platform = 'Invoice' OR raw_source_data->>is_invoice = 'true' OR order_number starts with INV-
    let query = supabaseAdmin
      .from('orders')
      .select('*, customers(id, name, phone, email)')
      .eq('business_id', businessId)
      .or('source_platform.eq.Invoice,raw_source_data->>is_invoice.eq.true,order_number.ilike.INV-%')
      .order('created_at', { ascending: false })

    if (status && status !== 'all') {
      query = query.eq('status', status)
    }

    if (paymentStatus && paymentStatus !== 'all') {
      query = query.eq('payment_status', paymentStatus)
    }

    const { data: invoices, error: queryErr } = await query

    if (queryErr) throw queryErr

    // Fetch creators (profiles) & normalize legacy payment_status/amount_paid
    let profileMap = new Map<string, any>()
    const userIds = Array.from(new Set(invoices.map(inv => inv.user_id).filter(Boolean)))
    if (userIds.length > 0) {
      const { data: staffMembers, error: staffErr } = await supabaseAdmin
        .from('profiles')
        .select('id, full_name, email')
        .in('id', userIds)

      if (!staffErr && staffMembers) {
        profileMap = new Map(staffMembers.map(p => [p.id, p]))
      }
    }

    const invoicesWithCreator = invoices.map(inv => {
      const grandTotalNum = Number(inv.grand_total || 0)
      const normalizedPayStatus = inv.payment_status
        || (inv.status === 'completed' ? 'paid' : (Number(inv.amount_paid || 0) >= grandTotalNum - 0.01 && grandTotalNum > 0 ? 'paid' : (Number(inv.amount_paid || 0) > 0 ? 'partial' : 'unpaid')))
      const normalizedAmtPaid = normalizedPayStatus === 'paid' && !Number(inv.amount_paid)
        ? grandTotalNum
        : Number(inv.amount_paid || 0)
      return {
        ...inv,
        payment_status: normalizedPayStatus,
        amount_paid: normalizedAmtPaid,
        creator: inv.user_id ? (profileMap.get(inv.user_id) || null) : null
      }
    })

    // Set Server-Side Cache
    setInvoicesCache(cacheKey, invoicesWithCreator)

    return NextResponse.json({ success: true, invoices: invoicesWithCreator })
  } catch (err: any) {
    console.error('Fetch Invoices Error:', err)
    return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500 })
  }
}

export async function POST(req: Request) {
  try {
    const ctx = await getApiContext()
    if (ctx.error) return ctx.error
    const { user, businessId, supabaseAdmin } = ctx

    const body = await req.json().catch(() => ({}))
    const {
      customer_id,
      customer_name,
      customer_phone,
      customer_email,
      customer_address,     // AddressData JSONB — null if existing customer selected
      order_number, // invoice number from user
      order_date,
      due_date,
      payment_terms,
      items,
      discount_amount = 0,
      shipping_cost = 0,
      other_fees = 0,
      grand_total,
      status = 'processing', // 'pending' = draft, 'processing' = issued, 'shipped' = shipped, 'completed' = completed, 'cancelled' = cancelled
      payment_status, // 'unpaid', 'partial', 'paid'
      amount_paid = 0,
      payment_method, // COA account name or 'Cash', 'Bank Transfer', 'QRIS', etc.
      payment_method_account_id, // COA account UUID (101xxx)
      payment_date,
      source_platform = 'Invoice', // Channel: 'Invoice', 'WhatsApp', 'Instagram', 'Shopee', 'Tokopedia', 'TikTok', 'Manual', etc.
      source_order_ref, // Reference / PO number
      utm_source,
      utm_campaign,
      notes,
      // Customization settings
      custom_title,
      custom_subtitle,
      custom_notes,
      accent_color = 'slate',
      layout_style = 'modern',
      show_sku = true,
      show_description = true,
      show_notes = true,
      courier,
      tracking_number,
      show_address = true,
      show_shipping = true
    } = body

    if (!items || !Array.isArray(items) || items.length === 0) {
      return NextResponse.json({ error: 'Invoice harus memiliki minimal 1 item' }, { status: 400 })
    }

    if (!status || !['pending', 'processing', 'shipped', 'completed', 'cancelled'].includes(status)) {
      return NextResponse.json({ error: 'Status invoice tidak valid' }, { status: 400 })
    }

    // 2. Resolve Customer ID (via Unified Customer Helper + Server Cache Upsert)
    let resolvedCustomerId = isUuid(customer_id) ? customer_id : null

    if (!resolvedCustomerId && customer_name && customer_phone) {
      const { customer: resolvedCust } = await resolveOrCreateCustomer(
        {
          businessId,
          name: customer_name,
          phone: customer_phone,
          email: customer_email,
          address_data: customer_address ?? null,
          reuseExistingOnPhoneMatch: true
        },
        supabaseAdmin
      )
      resolvedCustomerId = resolvedCust.id
    }

    if (!resolvedCustomerId) {
      return NextResponse.json({ error: 'Customer ID atau data Customer baru wajib disertakan' }, { status: 400 })
    }

    // 3. Auto-generate Invoice Number if not provided
    let finalInvoiceNumber = order_number
    const dateObj = order_date ? new Date(order_date) : new Date()

    if (!finalInvoiceNumber) {
      const dateStr = formatDDMMYYYY(dateObj) // e.g. "02072026"
      const prefix = `INV-${dateStr}-`

      // Query database for invoice numbers matching this prefix
      const { data: matches, error: matchErr } = await supabaseAdmin
        .from('orders')
        .select('order_number')
        .eq('business_id', businessId)
        .or('source_platform.eq.Invoice,raw_source_data->>is_invoice.eq.true,order_number.ilike.INV-%')
        .like('order_number', `${prefix}%`)

      let maxCounter = 0
      if (matches) {
        matches.forEach(m => {
          const suffix = m.order_number.replace(prefix, '')
          const counter = parseInt(suffix, 10)
          if (!isNaN(counter) && counter > maxCounter) {
            maxCounter = counter
          }
        })
      }

      const nextCounter = String(maxCounter + 1).padStart(3, '0')
      finalInvoiceNumber = `${prefix}${nextCounter}`
    } else {
      // Check if provided number already exists for this business
      const { data: exists } = await supabaseAdmin
        .from('orders')
        .select('id')
        .eq('business_id', businessId)
        .eq('order_number', finalInvoiceNumber)
        .maybeSingle()

      if (exists) {
        return NextResponse.json({ error: `Nomor Invoice "${finalInvoiceNumber}" sudah digunakan.` }, { status: 400 })
      }
    }

    // Calculate details
    const totalQty = items.reduce((sum: number, item: any) => sum + Number(item.quantity || 1), 0)
    const subtotal = items.reduce((sum: number, item: any) => sum + (Number(item.price || 0) * Number(item.quantity || 1)), 0)
    const calculatedDiscountAmount = items.reduce((sum: number, item: any) => sum + (Number(item.discount || 0) * Number(item.quantity || 1)), 0)
    const numGrandTotal = Number(grand_total) || 0

    // Resolve payment status and amount paid
    let finalPaymentStatus: 'unpaid' | 'partial' | 'paid' = 'unpaid'
    let finalAmountPaid = 0

    if (payment_status) {
      if (payment_status === 'paid') {
        finalPaymentStatus = 'paid'
        finalAmountPaid = numGrandTotal
      } else if (payment_status === 'partial') {
        finalAmountPaid = Math.min(numGrandTotal, Math.max(0, Number(amount_paid) || 0))
        finalPaymentStatus = finalAmountPaid >= numGrandTotal - 0.01 ? 'paid' : (finalAmountPaid > 0 ? 'partial' : 'unpaid')
      } else {
        finalPaymentStatus = 'unpaid'
        finalAmountPaid = 0
      }
    } else {
      // Legacy fallback
      if (status === 'completed') {
        finalPaymentStatus = 'paid'
        finalAmountPaid = numGrandTotal
      } else {
        finalPaymentStatus = 'unpaid'
        finalAmountPaid = 0
      }
    }

    // 4. Save Invoice in orders table
    const rawSourceData = {
      is_invoice: true,
      due_date: due_date || null,
      payment_terms: payment_terms || 'due-on-receipt',
      notes: notes || '',
      custom_title: custom_title || 'INVOICE',
      custom_subtitle: custom_subtitle || '',
      custom_notes: custom_notes || '',
      accent_color,
      layout_style,
      show_sku,
      show_description,
      show_notes,
      show_address,
      show_shipping,
      source_order: {
        channel: source_platform || 'Invoice',
        reference_no: source_order_ref || '',
        utm_source: utm_source || '',
        utm_campaign: utm_campaign || ''
      },
      meta_data: [
        { key: 'shapeup_kurir_awb', value: courier || '' },
        { key: 'shapeup_resi_awb', value: tracking_number || '' }
      ]
    }

    // Map client items to order line_items structure
    const lineItems = items.map((item: any, idx: number) => {
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
        ...(costPrice !== undefined ? { cost_price: costPrice } : {})
      }
    })

    const { data: order, error: insertErr } = await supabaseAdmin
      .from('orders')
      .insert({
        business_id: businessId,
        user_id: user.id, // Save creator ID!
        customer_id: resolvedCustomerId,
        order_number: finalInvoiceNumber,
        source_platform: source_platform || 'Invoice',
        order_date: dateObj.toISOString(),
        order_date_utc: dateObj.toISOString(),
        total_qty: totalQty,
        subtotal: subtotal,
        shipping_cost: Number(shipping_cost),
        discount_amount: calculatedDiscountAmount,
        other_fees: Number(other_fees),
        grand_total: numGrandTotal,
        payment_method: finalAmountPaid > 0 ? (payment_method || 'Bank Transfer') : null,
        status: status,
        payment_status: finalPaymentStatus,
        amount_paid: finalAmountPaid,
        items_json: lineItems,
        raw_source_data: rawSourceData
      })
      .select('id, order_number, grand_total, status, payment_status, amount_paid, payment_method, order_date')
      .single()

    if (insertErr) throw insertErr

    // If there is an upfront payment (Lunas or DP), record unified order_payments entry
    if (finalAmountPaid > 0) {
      try {
        const paymentAccounts = await getActivePaymentAccounts(businessId, supabaseAdmin)
        const matchedAcc = resolvePaymentAccountFromCOA(
          paymentAccounts,
          payment_method,
          isUuid(payment_method_account_id) ? payment_method_account_id : null
        )
        const resolvedPayAccId = matchedAcc?.id || (isUuid(payment_method_account_id) ? payment_method_account_id : null)
        const resolvedPayMethodName = matchedAcc?.name || payment_method || 'Bank Transfer'

        const payDateObj = payment_date ? new Date(payment_date) : dateObj
        await supabaseAdmin.from('order_payments').insert({
          payment_kind: 'payment',
          business_id: businessId,
          order_id: order.id,
          date: payDateObj.toISOString().split('T')[0],
          amount: finalAmountPaid,
          payment_method: resolvedPayMethodName,
          payment_method_account_id: resolvedPayAccId,
          notes: `Pembayaran ${source_platform || 'Invoice'} #${finalInvoiceNumber}`,
          created_at: payDateObj.toISOString()
        })
      } catch (payErr) {
        console.warn('Failed to insert initial payment to order_payments:', payErr)
      }
    }

    // 5. Accounting Ledger Integration & Stock Reduction
    const syncRes = await syncOrderToLedger(order.id, supabaseAdmin)
    if (!syncRes.success) {
      throw new Error(syncRes.message)
    }

    invalidateInvoicesCache(businessId)

    return NextResponse.json({ success: true, order })

  } catch (err: any) {
    console.error('Create Invoice Error:', err)
    return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500 })
  }
}
