import { createClient } from '@/lib/supabaseServer'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { syncOrderToLedger } from '@/lib/orderLedger'

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
  const supabase = await createClient()

  try {
    // 1. Get logged-in user and active business ID
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
    const { searchParams } = new URL(req.url)
    const status = searchParams.get('status')

    // Check Server-Side Cache
    const cacheKey = `${businessId}:${status || 'all'}`
    const cachedData = getInvoicesCache(cacheKey)
    if (cachedData) {
      return NextResponse.json({ success: true, invoices: cachedData })
    }

    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
    if (!serviceRoleKey) {
      return NextResponse.json({ error: 'Admin service key not found' }, { status: 500 })
    }
    const supabaseAdmin = createAdminClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      serviceRoleKey
    )

    // 2. Query invoices using supabaseAdmin to bypass RLS for customers
    let query = supabaseAdmin
      .from('orders')
      .select('*, customers(id, name, phone, email)')
      .eq('business_id', businessId)
      .eq('source_platform', 'Invoice')
      .order('created_at', { ascending: false })

    if (status && status !== 'all') {
      query = query.eq('status', status)
    }

    const { data: invoices, error: queryErr } = await query

    if (queryErr) throw queryErr

    // Fetch creators (profiles)
    let invoicesWithCreator = invoices
    const userIds = Array.from(new Set(invoices.map(inv => inv.user_id).filter(Boolean)))
    if (userIds.length > 0) {
      const { data: staffMembers, error: staffErr } = await supabaseAdmin
        .from('profiles')
        .select('id, full_name, email')
        .in('id', userIds)

      if (!staffErr && staffMembers) {
        const profileMap = new Map(staffMembers.map(p => [p.id, p]))
        invoicesWithCreator = invoices.map(inv => ({
          ...inv,
          creator: inv.user_id ? (profileMap.get(inv.user_id) || null) : null
        }))
      }
    }

    // Set Server-Side Cache
    setInvoicesCache(cacheKey, invoicesWithCreator)

    return NextResponse.json({ success: true, invoices: invoicesWithCreator })
  } catch (err: any) {
    console.error('Fetch Invoices Error:', err)
    return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500 })
  }
}

export async function POST(req: Request) {
  const supabase = await createClient()

  try {
    // 1. Get logged-in user and active business ID
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
      status, // 'pending' = draft, 'processing' = unpaid/sent, 'completed' = paid
      payment_method, // 'Cash' or 'Bank/QRIS' (required if status is 'completed')
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

    if (!status || !['pending', 'processing', 'completed'].includes(status)) {
      return NextResponse.json({ error: 'Status invoice tidak valid' }, { status: 400 })
    }

    // 2. Resolve Customer ID
    let resolvedCustomerId = customer_id

    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
    if (!serviceRoleKey) {
      return NextResponse.json({ error: 'Admin service key not found' }, { status: 500 })
    }
    const supabaseAdmin = createAdminClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      serviceRoleKey
    )

    if (!resolvedCustomerId && customer_name && customer_phone) {
      // Clean phone number
      let cleanPhone = customer_phone.replace(/\D/g, '')
      if (cleanPhone.startsWith('0')) {
        cleanPhone = '62' + cleanPhone.substring(1)
      } else if (cleanPhone.startsWith('8')) {
        cleanPhone = '62' + cleanPhone
      }

      // Check if phone already exists
      const { data: existingCust } = await supabaseAdmin
        .from('customers')
        .select('id')
        .eq('business_id', businessId)
        .eq('phone', cleanPhone)
        .maybeSingle()

      if (existingCust) {
        resolvedCustomerId = existingCust.id
      } else {
        // Create new customer
        const { data: newCust, error: newCustErr } = await supabaseAdmin
          .from('customers')
          .insert({
            business_id: businessId,
            name: customer_name.trim(),
            phone: cleanPhone,
            email: customer_email ? customer_email.trim() : null,
            address_data: customer_address ?? null
          })
          .select('id')
          .single()

        if (newCustErr) throw newCustErr
        resolvedCustomerId = newCust.id
      }
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
        .eq('source_platform', 'Invoice')
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

    // 4. Save Invoice in orders table
    const rawSourceData = {
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
      meta_data: [
        { key: 'shapeup_kurir_awb', value: courier || '' },
        { key: 'shapeup_resi_awb', value: tracking_number || '' }
      ]
    }

    // Map client items to order line_items structure
    const lineItems = items.map((item: any, idx: number) => ({
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

    const { data: order, error: insertErr } = await supabaseAdmin
      .from('orders')
      .insert({
        business_id: businessId,
        user_id: user.id, // Save creator ID!
        customer_id: resolvedCustomerId,
        order_number: finalInvoiceNumber,
        source_platform: 'Invoice',
        order_date: dateObj.toISOString(),
        order_date_utc: dateObj.toISOString(),
        total_qty: totalQty,
        subtotal: subtotal,
        shipping_cost: Number(shipping_cost),
        discount_amount: Number(discount_amount),
        other_fees: Number(other_fees),
        grand_total: Number(grand_total),
        payment_method: status === 'completed' ? (payment_method || 'Bank Transfer') : null,
        status: status,
        items_json: lineItems,
        raw_source_data: rawSourceData
      })
      .select('id, order_number, grand_total, status, payment_method, order_date')
      .single()

    if (insertErr) throw insertErr

    // 5. Accounting Ledger Integration
    if (status === 'processing' || status === 'completed') {
      // Adjust stock if tracked
      const productIds = items.map((i: any) => i.product_id).filter(Boolean)
      if (productIds.length > 0) {
        const { data: dbProducts } = await supabaseAdmin
          .from('products')
          .select('id, stock_type, stock_quantity')
          .in('id', productIds)

        if (dbProducts) {
          for (const item of items) {
            const dbProd = dbProducts.find((p: any) => p.id === item.product_id)
            if (dbProd && dbProd.stock_type === 'tracked') {
              await supabaseAdmin
                .from('products')
                .update({ stock_quantity: Math.max(0, dbProd.stock_quantity - Number(item.quantity)) })
                .eq('id', dbProd.id)
            }
          }
        }
      }

      const syncRes = await syncOrderToLedger(order.id, supabaseAdmin)
      if (!syncRes.success) {
        throw new Error(syncRes.message)
      }
    }

    invalidateInvoicesCache(businessId)

    return NextResponse.json({ success: true, order })

  } catch (err: any) {
    console.error('Create Invoice Error:', err)
    return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500 })
  }
}
