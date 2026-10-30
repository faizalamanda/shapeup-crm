import { NextResponse } from 'next/server'
import { getApiContext } from '@/lib/apiContext'
import { resolveGuestCustomerId } from '@/lib/guestCustomer'
import { formatPhoneNumberSmart, isUuid } from '@/lib/utils'
import { syncOrderToLedger } from '@/lib/orderLedger'

interface OrderItemInput {
  name: string
  sku?: string | null
  variant_name?: string | null
  quantity: number
  price: number
  total?: number
}

interface OrderCustomerInput {
  name?: string | null
  phone?: string | null
  email?: string | null
  address?: string | null
  city?: string | null
}

interface OrderInput {
  order_number: string
  order_date?: string | null
  source_platform?: string | null
  status?: string | null
  payment_status?: string | null
  payment_method?: string | null
  discount_amount?: number
  shipping_cost?: number
  grand_total?: number
  created_by?: string | null
  customer?: OrderCustomerInput | null
  items: OrderItemInput[]
  _sourceRowNumbers?: number[]
}

interface BulkOrdersRequestBody {
  orders: OrderInput[]
  duplicateAction?: 'skip' | 'update'
  autoJournal?: boolean
  customerWithoutPhone?: 'guest' | 'create'
}

export async function POST(req: Request) {
  // 1. Auth & Business Context (Zero-RLS-Failure Admin Client)
  const ctx = await getApiContext()
  if (ctx.error) return ctx.error

  const { user, businessId, supabaseAdmin } = ctx

  try {
    // 2. Parse request body safely
    const body: BulkOrdersRequestBody = await req.json().catch(() => null)
    if (!body || !Array.isArray(body.orders) || body.orders.length === 0) {
      return NextResponse.json({ error: 'Data pesanan tidak boleh kosong.' }, { status: 400 })
    }

    const {
      orders,
      duplicateAction = 'skip',
      autoJournal = true,
      customerWithoutPhone = 'guest'
    } = body

    const failedItems: Array<{
      order_number: string
      rowNumbers?: number[]
      reason: string
    }> = []

    let insertedCount = 0
    let updatedCount = 0
    let skippedCount = 0

    // ── Pre-validate orders in batch ─────────────────────────────────────────
    const validOrders: OrderInput[] = []
    orders.forEach((ord) => {
      const cleanOrderNumber = String(ord.order_number || '').trim()
      if (!cleanOrderNumber) {
        failedItems.push({
          order_number: '-',
          rowNumbers: ord._sourceRowNumbers,
          reason: 'Nomor pesanan kosong'
        })
        return
      }

      const validItems = Array.isArray(ord.items) ? ord.items.filter(i => i && String(i.name || '').trim() !== '') : []
      if (validItems.length === 0) {
        failedItems.push({
          order_number: cleanOrderNumber,
          rowNumbers: ord._sourceRowNumbers,
          reason: 'Pesanan tidak memiliki rincian produk yang valid'
        })
        return
      }

      validOrders.push({
        ...ord,
        order_number: cleanOrderNumber,
        items: validItems
      })
    })

    if (validOrders.length === 0) {
      return NextResponse.json({
        success: true,
        insertedCount: 0,
        updatedCount: 0,
        skippedCount: 0,
        failedItems
      })
    }

    // ── 3. Customer Resolution & Upsert in Batch ─────────────────────────────
    // Resolve Guest Customer ID once per batch (uses in-memory cache)
    const guestCustomerId = await resolveGuestCustomerId(businessId, supabaseAdmin)

    // Collect phones & emails from incoming orders
    const rawPhonesToMatch: string[] = []
    const rawEmailsToMatch: string[] = []

    validOrders.forEach(ord => {
      const rawPhone = ord.customer?.phone ? String(ord.customer.phone).trim() : ''
      if (rawPhone && rawPhone !== '-' && rawPhone !== '0') {
        const cleaned = formatPhoneNumberSmart(rawPhone)
        if (cleaned && cleaned !== '0') {
          rawPhonesToMatch.push(cleaned)
        }
      }
      const rawEmail = ord.customer?.email ? String(ord.customer.email).trim().toLowerCase() : ''
      if (rawEmail && rawEmail.includes('@')) {
        rawEmailsToMatch.push(rawEmail)
      }
    })

    const distinctPhones = Array.from(new Set(rawPhonesToMatch))
    const distinctEmails = Array.from(new Set(rawEmailsToMatch))

    // Map: phone -> customer_id, email -> customer_id
    const customerMapByPhone = new Map<string, string>()
    const customerMapByEmail = new Map<string, string>()

    if (distinctPhones.length > 0) {
      const { data: existingByPhone, error: phoneErr } = await supabaseAdmin
        .from('customers')
        .select('id, phone')
        .eq('business_id', businessId)
        .in('phone', distinctPhones)

      if (!phoneErr && existingByPhone) {
        existingByPhone.forEach(c => {
          if (c.phone) customerMapByPhone.set(c.phone, c.id)
        })
      }
    }

    if (distinctEmails.length > 0) {
      const { data: existingByEmail, error: emailErr } = await supabaseAdmin
        .from('customers')
        .select('id, email')
        .eq('business_id', businessId)
        .in('email', distinctEmails)

      if (!emailErr && existingByEmail) {
        existingByEmail.forEach(c => {
          if (c.email) customerMapByEmail.set(c.email.toLowerCase(), c.id)
        })
      }
    }

    // Identify new customers that need to be created
    const newCustomersToInsert: any[] = []
    const pendingPhoneSet = new Set<string>()

    for (const ord of validOrders) {
      const c = ord.customer
      if (!c) continue

      const rawPhone = c.phone ? String(c.phone).trim() : ''
      const cleanPhone = (rawPhone && rawPhone !== '-' && rawPhone !== '0')
        ? formatPhoneNumberSmart(rawPhone)
        : null

      const rawEmail = c.email ? String(c.email).trim().toLowerCase() : null

      if (cleanPhone && cleanPhone !== '0') {
        if (!customerMapByPhone.has(cleanPhone) && !pendingPhoneSet.has(cleanPhone)) {
          pendingPhoneSet.add(cleanPhone)
          newCustomersToInsert.push({
            business_id: businessId,
            name: c.name || 'Pelanggan ' + cleanPhone.slice(-4),
            phone: cleanPhone,
            email: rawEmail || null,
            address_data: c.address ? { address: c.address, city: c.city || '' } : null
          })
        }
      } else if (customerWithoutPhone === 'create' && c.name && c.name.trim() !== '') {
        // Option to create unique placeholder customer for marketplace usernames
        const syntheticPhone = `MP-${Date.now().toString().slice(-6)}-${Math.floor(Math.random() * 1000)}`
        newCustomersToInsert.push({
          business_id: businessId,
          name: c.name.trim(),
          phone: syntheticPhone,
          email: rawEmail || null,
          address_data: c.address ? { address: c.address, city: c.city || '' } : null
        })
      }
    }

    if (newCustomersToInsert.length > 0) {
      const { data: createdCustomers, error: custInsertErr } = await supabaseAdmin
        .from('customers')
        .insert(newCustomersToInsert)
        .select('id, phone, email')

      if (!custInsertErr && createdCustomers) {
        createdCustomers.forEach(c => {
          if (c.phone) customerMapByPhone.set(c.phone, c.id)
          if (c.email) customerMapByEmail.set(c.email.toLowerCase(), c.id)
        })
      } else if (custInsertErr) {
        console.warn('[OrdersBulk] Warning inserting customers:', custInsertErr.message)
      }
    }

    // ── 4. Check Existing Orders (Anti-Duplication Engine) ────────────────────
    const incomingOrderNumbers = validOrders.map(o => o.order_number)
    const existingOrdersMap = new Map<string, { id: string; status: string; payment_status: string }>()

    const { data: existingOrders, error: orderFetchErr } = await supabaseAdmin
      .from('orders')
      .select('id, order_number, status, payment_status')
      .eq('business_id', businessId)
      .in('order_number', incomingOrderNumbers)

    if (!orderFetchErr && existingOrders) {
      existingOrders.forEach(o => {
        if (o.order_number) {
          existingOrdersMap.set(o.order_number.trim().toLowerCase(), o)
        }
      })
    }

    // ── 5. Prepare Order Payloads (Inserts & Updates) ─────────────────────────
    const ordersToInsert: any[] = []
    const ordersToUpdate: { id: string; payload: any }[] = []
    const syncedOrderIds: string[] = []

    for (const ord of validOrders) {
      const ordKey = ord.order_number.trim().toLowerCase()
      const existing = existingOrdersMap.get(ordKey)

      if (existing) {
        if (duplicateAction === 'skip') {
          skippedCount++
          continue
        } else if (duplicateAction === 'update') {
          // Prepare update payload
          const updatedPayload: any = {
            updated_at: new Date().toISOString()
          }
          if (ord.status) updatedPayload.status = normalizeOrderStatus(ord.status)
          if (ord.payment_status) updatedPayload.payment_status = normalizePaymentStatus(ord.payment_status)
          if (ord.payment_method) updatedPayload.payment_method = ord.payment_method

          ordersToUpdate.push({
            id: existing.id,
            payload: updatedPayload
          })
          syncedOrderIds.push(existing.id)
          continue
        }
      }

      // Resolve Customer ID
      let resolvedCustId = guestCustomerId
      const rawPhone = ord.customer?.phone ? String(ord.customer.phone).trim() : ''
      const cleanPhone = (rawPhone && rawPhone !== '-' && rawPhone !== '0')
        ? formatPhoneNumberSmart(rawPhone)
        : null

      if (cleanPhone && customerMapByPhone.has(cleanPhone)) {
        resolvedCustId = customerMapByPhone.get(cleanPhone)!
      } else if (ord.customer?.email && customerMapByEmail.has(ord.customer.email.toLowerCase())) {
        resolvedCustId = customerMapByEmail.get(ord.customer.email.toLowerCase())!
      }

      // Calculate totals
      const totalQty = ord.items.reduce((sum, it) => sum + (Number(it.quantity) || 1), 0)
      const subtotal = ord.items.reduce((sum, it) => {
        const q = Number(it.quantity) || 1
        const p = Number(it.price) || 0
        return sum + (it.total ? Number(it.total) : q * p)
      }, 0)

      const discountAmount = Number(ord.discount_amount) || 0
      const shippingCost = Number(ord.shipping_cost) || 0
      const grandTotal = ord.grand_total !== undefined && ord.grand_total !== null
        ? Number(ord.grand_total)
        : Math.max(0, subtotal - discountAmount + shippingCost)

      const normStatus = normalizeOrderStatus(ord.status || 'completed')
      const normPayStatus = normalizePaymentStatus(ord.payment_status || (normStatus === 'completed' ? 'paid' : 'unpaid'))
      const amountPaid = normPayStatus === 'paid' ? grandTotal : 0

      // Format ISO Date safely
      let parsedDate = new Date().toISOString()
      if (ord.order_date) {
        const d = new Date(ord.order_date)
        if (!isNaN(d.getTime())) {
          parsedDate = d.toISOString()
        }
      }

      // Build items_json
      const lineItems = ord.items.map((it, idx) => {
        const qty = Number(it.quantity) || 1
        const price = Number(it.price) || 0
        const total = it.total !== undefined ? Number(it.total) : qty * price
        return {
          id: idx + 1,
          name: it.name.trim(),
          sku: it.sku ? it.sku.trim() : null,
          variant_name: it.variant_name ? it.variant_name.trim() : null,
          quantity: qty,
          price: price,
          subtotal: String(qty * price),
          total: String(total),
          meta_data: it.variant_name ? [{ key: 'Varian', value: it.variant_name.trim() }] : []
        }
      })

      const rawSourceData = {
        order_number: ord.order_number,
        source_platform: ord.source_platform || 'Manual',
        created_by: ord.created_by || null,
        buyer_name: ord.customer?.name || null,
        shipping: {
          name: ord.customer?.name || null,
          phone: ord.customer?.phone || null,
          address_1: ord.customer?.address || null,
          city: ord.customer?.city || null
        },
        line_items: lineItems
      }

      ordersToInsert.push({
        business_id: businessId,
        user_id: user.id,
        customer_id: resolvedCustId,
        order_number: ord.order_number,
        source_platform: ord.source_platform || 'Manual',
        status: normStatus,
        payment_status: normPayStatus,
        payment_method: ord.payment_method || 'Cash',
        amount_paid: amountPaid,
        subtotal: subtotal,
        discount_amount: discountAmount,
        shipping_cost: shippingCost,
        grand_total: grandTotal,
        total_qty: totalQty,
        items_json: lineItems,
        raw_source_data: rawSourceData,
        order_date: parsedDate,
        order_date_utc: parsedDate,
        created_at: parsedDate,
        updated_at: new Date().toISOString()
      })
    }

    // ── 6. Execute Inserts in Batch ──────────────────────────────────────────
    if (ordersToInsert.length > 0) {
      const { data: insertedOrders, error: insertErr } = await supabaseAdmin
        .from('orders')
        .insert(ordersToInsert)
        .select('id, order_number')

      if (insertErr) {
        console.error('[OrdersBulk] Error inserting orders:', insertErr)
        // If whole batch insert failed, mark these orders as failed
        ordersToInsert.forEach(o => {
          failedItems.push({
            order_number: o.order_number,
            reason: `Gagal menyimpan pesanan: ${insertErr.message}`
          })
        })
      } else if (insertedOrders) {
        insertedCount += insertedOrders.length
        insertedOrders.forEach(o => syncedOrderIds.push(o.id))
      }
    }

    // ── 7. Execute Updates if applicable ─────────────────────────────────────
    if (ordersToUpdate.length > 0) {
      for (const upd of ordersToUpdate) {
        const { error: updErr } = await supabaseAdmin
          .from('orders')
          .update(upd.payload)
          .eq('id', upd.id)

        if (!updErr) {
          updatedCount++
        } else {
          console.error('[OrdersBulk] Error updating order:', updErr)
        }
      }
    }

    // ── 8. Auto Journal & Stock Movements (Ledger Integration) ───────────────
    if (autoJournal && syncedOrderIds.length > 0) {
      // Sync each order to ledger with resilient fault containment
      // We process concurrently in small chunks to avoid database connection exhaustion
      const LEDGER_CHUNK_SIZE = 10
      for (let i = 0; i < syncedOrderIds.length; i += LEDGER_CHUNK_SIZE) {
        const chunk = syncedOrderIds.slice(i, i + LEDGER_CHUNK_SIZE)
        await Promise.allSettled(
          chunk.map(orderId => syncOrderToLedger(orderId, supabaseAdmin).catch(err => {
            console.warn(`[OrdersBulk] Ledger sync notice for order ${orderId}:`, err?.message || err)
          }))
        )
      }
    }

    return NextResponse.json({
      success: true,
      insertedCount,
      updatedCount,
      skippedCount,
      failedItems
    })

  } catch (err: any) {
    console.error('[OrdersBulk] Unhandled server error:', err)
    return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500 })
  }
}

// ── Helper Status Normalizers ───────────────────────────────────────────────
function normalizeOrderStatus(raw: string): string {
  const lower = raw.trim().toLowerCase()
  if (lower.includes('selesai') || lower.includes('complete') || lower.includes('delivered') || lower.includes('sukses')) {
    return 'completed'
  }
  if (lower.includes('proses') || lower.includes('processing') || lower.includes('kirim') || lower.includes('shipped')) {
    return 'processing'
  }
  if (lower.includes('batal') || lower.includes('cancel') || lower.includes('refund') || lower.includes('void')) {
    return 'cancelled'
  }
  return 'pending'
}

function normalizePaymentStatus(raw: string): string {
  const lower = raw.trim().toLowerCase()
  if (lower.includes('lunas') || lower.includes('paid') || lower.includes('berhasil') || lower.includes('success')) {
    return 'paid'
  }
  if (lower.includes('sebagian') || lower.includes('partial') || lower.includes('dp')) {
    return 'partial'
  }
  return 'unpaid'
}
