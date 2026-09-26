import { getApiContext } from '@/lib/apiContext'
import { resolveGuestCustomerId } from '@/lib/guestCustomer'
import { syncOrderToLedger } from '@/lib/orderLedger'
import { NextResponse } from 'next/server'

export async function POST(req: Request) {
  try {
    // 1. Auth + Business ID — uses JWT fast-path + cached profile
    const ctx = await getApiContext()
    if (ctx.error) return ctx.error
    const { user, businessId, supabase } = ctx

    const body = await req.json()
    const { customer_id, items, payment_method, discount_amount = 0, grand_total, subtotal } = body

    if (!items || !Array.isArray(items) || items.length === 0) {
      return NextResponse.json({ error: 'Keranjang belanja tidak boleh kosong' }, { status: 400 })
    }

    // 2. Validate products & check stock
    const productIds = items.filter((i: any) => !String(i.id).startsWith('custom-')).map((i: any) => i.id)

    const productMap = new Map<string, any>()
    if (productIds.length > 0) {
      const { data: dbProducts, error: prodErr } = await supabase
        .from('products')
        .select('id, name, type, price, cost_price, stock_type, stock_quantity')
        .in('id', productIds)

      if (prodErr || !dbProducts) {
        return NextResponse.json({ error: 'Gagal mengambil data produk' }, { status: 500 })
      }
      dbProducts.forEach(p => productMap.set(p.id, p))
    }


    let totalCogs = 0

    for (const item of items) {
      const isCustom = String(item.id).startsWith('custom-')
      if (isCustom) continue

      const dbProd = productMap.get(item.id)
      if (!dbProd) {
        return NextResponse.json({ error: `Produk dengan ID ${item.id} tidak ditemukan` }, { status: 404 })
      }

      if (dbProd.stock_type === 'unavailable') {
        return NextResponse.json({ error: `Produk "${dbProd.name}" sedang tidak tersedia untuk dijual.` }, { status: 400 })
      }

      if (dbProd.stock_type === 'tracked') {
        if (dbProd.stock_quantity < item.quantity) {
          return NextResponse.json({
            error: `Stok untuk "${dbProd.name}" tidak mencukupi. (Tersedia: ${dbProd.stock_quantity}, Diminta: ${item.quantity})`
          }, { status: 400 })
        }
      }

      // Calculate COGS if product is physical and has cost_price
      if (dbProd.type === 'physical' && dbProd.cost_price > 0) {
        totalCogs += dbProd.cost_price * item.quantity
      }
    }

    // 3. Resolve Guest Customer — uses cached guest ID per business
    let resolvedCustomerId = customer_id
    if (!resolvedCustomerId || resolvedCustomerId === 'guest' || resolvedCustomerId === '0') {
      resolvedCustomerId = await resolveGuestCustomerId(businessId, ctx.supabaseAdmin)
    }

    // 4. Format to WooCommerce compatibility
    const orderNumber = 'POS-' + Date.now().toString().slice(-8)
    
    const lineItems = items.map((item: any, idx: number) => {
      const isCustom = String(item.id).startsWith('custom-')
      const name = isCustom ? (item.name || 'Biaya Kustom') : productMap.get(item.id).name
      const sku = isCustom ? 'CUSTOM' : (productMap.get(item.id).sku || '')
      
      const metaData: any[] = []
      if (item.discount > 0) {
        metaData.push({ key: 'Discount', value: String(item.discount) })
      }
      if (item.variantName) {
        metaData.push({ key: 'Variant', value: String(item.variantName) })
      }
      if (item.modifiers && Array.isArray(item.modifiers) && item.modifiers.length > 0) {
        metaData.push({ key: 'Modifiers', value: item.modifiers.map((m: any) => `${m.group}: ${m.name}`).join(', ') })
      }
      if (item.note) {
        metaData.push({ key: 'Note', value: String(item.note) })
      }

      return {
        id: idx + 1,
        name: name,
        product_id: item.id,
        variation_id: item.variantId || 0,
        variant_name: item.variantName || null,
        modifiers: item.modifiers || [],
        note: item.note || '',
        quantity: item.quantity,
        tax_class: '',
        subtotal: String(item.price * item.quantity),
        subtotal_tax: '0.00',
        total: String((item.price - (item.discount || 0)) * item.quantity),
        total_tax: '0.00',
        taxes: [],
        meta_data: metaData,
        sku: sku,
        price: item.price
      }
    })

    const rawSourceData = {
      id: orderNumber,
      status: 'completed',
      currency: 'IDR',
      total: String(grand_total),
      discount_total: String(discount_amount),
      shipping_total: '0.00',
      payment_method: payment_method === 'cash' ? 'cod' : 'bacs',
      payment_method_title: payment_method === 'cash' ? 'Cash (Tunai)' : 'Bank Card / QRIS',
      billing: {
        first_name: 'POS',
        last_name: 'Order',
        phone: '0'
      },
      shipping: {
        first_name: 'POS',
        last_name: 'Order'
      },
      line_items: lineItems
    }

    const orderPayload = {
      business_id: businessId,
      customer_id: resolvedCustomerId,
      order_number: orderNumber,
      source_platform: 'POS',
      order_date: new Date().toISOString(),
      order_date_utc: new Date().toISOString(),
      total_qty: items.reduce((acc: number, item: any) => acc + item.quantity, 0),
      subtotal: subtotal || grand_total + discount_amount,
      shipping_cost: 0,
      discount_amount: discount_amount,
      other_fees: 0,
      grand_total: grand_total,
      payment_method: payment_method === 'cash' ? 'Cash' : 'Bank/QRIS',
      status: 'completed',
      items_json: lineItems,
      raw_source_data: rawSourceData
    }

    const { data: order, error: orderInsertErr } = await supabase
      .from('orders')
      .insert(orderPayload)
      .select('id')
      .single()

    if (orderInsertErr) {
      return NextResponse.json({ error: 'Gagal membuat pesanan: ' + orderInsertErr.message }, { status: 500 })
    }

    const fullOrder = { id: order.id, ...orderPayload }

    // 5. Record Ledger transaction, stock reduction & journal lines using unified service
    const syncRes = await syncOrderToLedger(order.id, supabase, fullOrder)
    if (!syncRes.success) {
      return NextResponse.json({ error: 'Gagal mencatat transaksi akuntansi: ' + syncRes.message }, { status: 500 })
    }

    return NextResponse.json({
      success: true,
      order_id: order.id,
      order_number: orderNumber
    }, { status: 200 })

  } catch (err: any) {
    console.error('POS Checkout Error:', err)
    return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500 })
  }
}
