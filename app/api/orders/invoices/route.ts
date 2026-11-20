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

export const STANDARD_INVOICE_CHANNELS = [
  'Invoice',
  'WhatsApp',
  'Instagram',
  'Manual',
  'Shopee',
  'Tokopedia',
  'TikTok',
  'WooCommerce'
]

export const STANDARD_INVOICE_COURIERS = [
  'JNE',
  'J&T',
  'Sicepat',
  'POS',
  'Tiki',
  'Anteraja',
  'Wahana',
  'SPX'
]

export type BusinessCustomInvoiceOptions = {
  custom_channels: string[]
  custom_couriers: string[]
  custom_utm_sources: string[]
  custom_utm_campaigns: string[]
}

export function canonicalizeOption(input: string | null | undefined, standardList: string[], customList: string[] = []): string {
  const trimmed = String(input || '').trim()
  if (!trimmed) return ''
  const lower = trimmed.toLowerCase()
  const stdMatch = standardList.find(s => s.toLowerCase() === lower)
  if (stdMatch) return stdMatch
  const custMatch = customList.find(c => c.toLowerCase() === lower)
  if (custMatch) return custMatch
  return trimmed
}

export async function getBusinessCustomInvoiceOptions(
  businessId: string,
  supabaseAdmin: any
): Promise<BusinessCustomInvoiceOptions> {
  const cacheKey = `${businessId}:__custom_options__`
  const cached = globalCache.get(cacheKey)
  if (cached && Date.now() - cached.timestamp < 30000) {
    return cached.data as BusinessCustomInvoiceOptions
  }

  const [{ data: ordersData }, { data: customersData }] = await Promise.all([
    supabaseAdmin
      .from('orders')
      .select('source_platform, raw_source_data')
      .eq('business_id', businessId)
      .order('created_at', { ascending: false })
      .limit(500),
    supabaseAdmin
      .from('customers')
      .select('metadata')
      .eq('business_id', businessId)
      .not('metadata', 'is', null)
      .limit(300)
  ])

  const stdChannelLower = new Set([...STANDARD_INVOICE_CHANNELS.map(c => c.toLowerCase()), 'pos', 'lainnya'])
  const stdCourierLower = new Set([...STANDARD_INVOICE_COURIERS.map(c => c.toLowerCase()), 'lainnya'])

  const channelMap = new Map<string, string>()
  const courierMap = new Map<string, string>()
  const utmSourceMap = new Map<string, string>()
  const utmCampaignMap = new Map<string, string>()

  const addUnique = (map: Map<string, string>, val: any, excludedLowerSet?: Set<string>) => {
    const str = String(val || '').trim()
    if (!str) return
    const lower = str.toLowerCase()
    if (excludedLowerSet && excludedLowerSet.has(lower)) return
    if (!map.has(lower)) {
      map.set(lower, str)
    }
  }

  if (Array.isArray(ordersData)) {
    for (const row of ordersData) {
      const raw = row.raw_source_data || {}
      const ch = raw.source_order?.channel || row.source_platform
      addUnique(channelMap, ch, stdChannelLower)

      addUnique(utmSourceMap, raw.source_order?.utm_source)
      addUnique(utmCampaignMap, raw.source_order?.utm_campaign)

      if (Array.isArray(raw.meta_data)) {
        const kurir =
          raw.meta_data.find((m: any) => m?.key === 'shapeup_kurir_awb')?.value ||
          raw.meta_data.find((m: any) => m?.key === '_kurir_awb')?.value
        addUnique(courierMap, kurir, stdCourierLower)
      }
    }
  }

  if (Array.isArray(customersData)) {
    for (const c of customersData) {
      const mk = c.metadata?.marketplace_profiles
      if (mk && typeof mk === 'object') {
        addUnique(channelMap, mk.other_platform, stdChannelLower)
        for (const key of Object.keys(mk)) {
          if (key !== 'other_platform' && key !== 'other_handle' && mk[key]) {
            addUnique(channelMap, key, stdChannelLower)
          }
        }
      }
      addUnique(channelMap, c.metadata?.lead_source, stdChannelLower)
      addUnique(channelMap, c.metadata?.custom_channel, stdChannelLower)
    }
  }

  const result: BusinessCustomInvoiceOptions = {
    custom_channels: Array.from(channelMap.values()).sort((a, b) => a.localeCompare(b, 'id')),
    custom_couriers: Array.from(courierMap.values()).sort((a, b) => a.localeCompare(b, 'id')),
    custom_utm_sources: Array.from(utmSourceMap.values()).sort((a, b) => a.localeCompare(b, 'id')),
    custom_utm_campaigns: Array.from(utmCampaignMap.values()).sort((a, b) => a.localeCompare(b, 'id'))
  }

  globalCache.set(cacheKey, { data: result, timestamp: Date.now() })
  return result
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
      const [paymentAccounts, customOptions] = await Promise.all([
        getActivePaymentAccounts(businessId, supabaseAdmin),
        getBusinessCustomInvoiceOptions(businessId, supabaseAdmin)
      ])
      return NextResponse.json({
        success: true,
        payment_accounts: paymentAccounts,
        custom_options: customOptions
      })
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
      marketplace_profiles, // Marketplace profiles JSONB: { shopee: '...', tiktok: '...', ... }
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

    if (!resolvedCustomerId && customer_name && String(customer_name).trim()) {
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
    }

    if (!resolvedCustomerId) {
      return NextResponse.json({ error: 'Customer ID atau Nama Customer baru wajib disertakan' }, { status: 400 })
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

    // 4. Normalize Channel & Courier against Business Custom Options (Case-Insensitive Canonicalization)
    const existingCustomOpts = await getBusinessCustomInvoiceOptions(businessId, supabaseAdmin)
    const canonicalChannel = canonicalizeOption(
      source_platform || 'Invoice',
      STANDARD_INVOICE_CHANNELS,
      existingCustomOpts.custom_channels
    ) || 'Invoice'
    const canonicalCourier = canonicalizeOption(
      courier || '',
      STANDARD_INVOICE_COURIERS,
      existingCustomOpts.custom_couriers
    )

    // Save Invoice in orders table
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
        channel: canonicalChannel,
        reference_no: source_order_ref || '',
        utm_source: utm_source || '',
        utm_campaign: utm_campaign || '',
        ...(marketplace_profiles ? { marketplace_profiles } : {})
      },
      meta_data: [
        { key: 'shapeup_kurir_awb', value: canonicalCourier },
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
        ...(item.dimension_spec ? { dimension_spec: item.dimension_spec } : {}),
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
        source_platform: canonicalChannel,
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
      .select('*')
      .single()

    if (insertErr) throw insertErr

    // If there is an upfront payment (Lunas or DP), record unified order_payments entry
    let resolvedPayAccId: string | null = null
    if (finalAmountPaid > 0) {
      const paymentAccounts = await getActivePaymentAccounts(businessId, supabaseAdmin)
      const matchedAcc = resolvePaymentAccountFromCOA(
        paymentAccounts,
        payment_method,
        isUuid(payment_method_account_id) ? payment_method_account_id : null
      )
      resolvedPayAccId = matchedAcc?.id || (isUuid(payment_method_account_id) ? payment_method_account_id : null)
      const resolvedPayMethodName = matchedAcc?.name || payment_method || 'Bank Transfer'

      const payDateObj = payment_date ? new Date(payment_date) : dateObj
      const { error: payInsErr } = await supabaseAdmin.from('order_payments').insert({
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
      if (payInsErr) {
        console.warn('Failed to insert initial payment to order_payments:', payInsErr.message)
      }
      if (resolvedPayMethodName !== order.payment_method) {
        await supabaseAdmin
          .from('orders')
          .update({ payment_method: resolvedPayMethodName })
          .eq('id', order.id)
        order.payment_method = resolvedPayMethodName
      }
    }

    // 5. Accounting Ledger Integration & Stock Reduction (Pass preloaded order with resolved payment_method_account_id)
    const syncRes = await syncOrderToLedger(order.id, supabaseAdmin, {
      ...order,
      payment_method_account_id: resolvedPayAccId
    })
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
