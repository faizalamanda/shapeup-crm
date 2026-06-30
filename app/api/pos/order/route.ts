import { createClient } from '@/lib/supabaseServer'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'

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
      return NextResponse.json({ error: 'Active business not found for user profile' }, { status: 400 })
    }

    const businessId = profile.active_business_id
    const body = await req.json()
    const { customer_id, items, payment_method, discount_amount = 0, grand_total, subtotal } = body

    if (!items || !Array.isArray(items) || items.length === 0) {
      return NextResponse.json({ error: 'Keranjang belanja tidak boleh kosong' }, { status: 400 })
    }

    // 2. Validate products & check stock
    const productIds = items.filter((i: any) => !String(i.id).startsWith('custom-')).map((i: any) => i.id)
    const { data: dbProducts, error: prodErr } = await supabase
      .from('products')
      .select('id, name, type, price, cost_price, stock_type, stock_quantity')
      .in('id', productIds)

    if (prodErr || !dbProducts) {
      return NextResponse.json({ error: 'Gagal mengambil data produk' }, { status: 500 })
    }

    const productMap = new Map<string, any>()
    dbProducts.forEach(p => productMap.set(p.id, p))

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

    // 3. Resolve or create accounts (Tunai, Bank, Pendapatan, HPP, Persediaan)
    const defaultAccounts = [
      { code: '101000', name: 'Kas POS (Tunai)', type: 'ASSET', business_id: businessId },
      { code: '101200', name: 'Bank / QRIS POS', type: 'ASSET', business_id: businessId },
      { code: '401000', name: 'Pendapatan Penjualan POS', type: 'REVENUE', business_id: businessId },
      { code: '501000', name: 'Harga Pokok Penjualan (HPP)', type: 'EXPENSE', business_id: businessId },
      { code: '102000', name: 'Persediaan Barang', type: 'ASSET', business_id: businessId }
    ]

    const { data: existingAccounts, error: accErr } = await supabase
      .from('accounts')
      .select('id, code')
      .eq('business_id', businessId)

    if (accErr) {
      return NextResponse.json({ error: 'Gagal memverifikasi akun ledger: ' + accErr.message }, { status: 500 })
    }

    const existingCodes = existingAccounts ? existingAccounts.map(a => a.code) : []
    const accountsToCreate = defaultAccounts.filter(a => !existingCodes.includes(a.code))

    if (accountsToCreate.length > 0) {
      const { error: insAccErr } = await supabase.from('accounts').insert(accountsToCreate)
      if (insAccErr) {
        return NextResponse.json({ error: 'Gagal membuat akun ledger default: ' + insAccErr.message }, { status: 500 })
      }
    }

    // Refetch all accounts to get mapping
    const { data: allAccounts, error: refetchAccErr } = await supabase
      .from('accounts')
      .select('id, code')
      .eq('business_id', businessId)

    if (refetchAccErr || !allAccounts) {
      return NextResponse.json({ error: 'Gagal mengambil pemetaan akun ledger' }, { status: 500 })
    }

    const accountMap: Record<string, string> = {}
    allAccounts.forEach(a => {
      accountMap[a.code] = a.id
    })

    // 4. Resolve Guest Customer if needed
    let resolvedCustomerId = customer_id
    if (!resolvedCustomerId || resolvedCustomerId === 'guest' || resolvedCustomerId === '0') {
      const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
      if (!serviceRoleKey) {
        return NextResponse.json({ 
          error: 'Kunci admin (SUPABASE_SERVICE_ROLE_KEY) tidak ditemukan di file .env.local Anda. Silakan tambahkan kunci tersebut dari dashboard Supabase -> Settings -> API -> service_role.' 
        }, { status: 500 })
      }

      const supabaseAdmin = createAdminClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        serviceRoleKey
      )

      const { data: guestCust } = await supabaseAdmin
          .from('customers')
          .select('id')
          .eq('business_id', businessId)
          .eq('phone', '0')
          .maybeSingle()

      if (guestCust) {
        resolvedCustomerId = guestCust.id
      } else {
        const { data: newGuest, error: guestErr } = await supabaseAdmin
          .from('customers')
          .insert({
            business_id: businessId,
            phone: '0',
            name: 'Customer Tamu',
            email: 'guest@business.com'
          })
          .select('id')
          .single()

        if (guestErr) {
          return NextResponse.json({ error: 'Gagal membuat akun Customer Tamu: ' + guestErr.message }, { status: 500 })
        }
        resolvedCustomerId = newGuest.id
      }
    }

    // 5. Format to WooCommerce compatibility
    const orderNumber = 'POS-' + Date.now().toString().slice(-8)
    
    const lineItems = items.map((item: any, idx: number) => {
      const isCustom = String(item.id).startsWith('custom-')
      const name = isCustom ? (item.name || 'Biaya Kustom') : productMap.get(item.id).name
      const sku = isCustom ? 'CUSTOM' : (productMap.get(item.id).sku || '')
      return {
        id: idx + 1,
        name: name,
        product_id: item.id,
        variation_id: 0,
        quantity: item.quantity,
        tax_class: '',
        subtotal: String(item.price * item.quantity),
        subtotal_tax: '0.00',
        total: String((item.price - (item.discount || 0)) * item.quantity),
        total_tax: '0.00',
        taxes: [],
        meta_data: item.discount > 0 ? [{ key: 'Discount', value: String(item.discount) }] : [],
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

    // 6. Insert Order
    const { data: order, error: orderInsertErr } = await supabase
      .from('orders')
      .insert({
        business_id: businessId,
        customer_id: resolvedCustomerId,
        order_number: orderNumber,
        source_platform: 'POS',
        order_date: new Date().toISOString(),
        order_date_utc: new Date().toISOString(),
        total_qty: items.reduce((acc, item) => acc + item.quantity, 0),
        subtotal: subtotal || grand_total + discount_amount,
        shipping_cost: 0,
        discount_amount: discount_amount,
        other_fees: 0,
        grand_total: grand_total,
        payment_method: payment_method === 'cash' ? 'Cash' : 'Bank/QRIS',
        status: 'completed',
        items_json: lineItems,
        raw_source_data: rawSourceData
      })
      .select('id')
      .single()

    if (orderInsertErr) {
      return NextResponse.json({ error: 'Gagal membuat pesanan: ' + orderInsertErr.message }, { status: 500 })
    }

    // 7. Update Stock for tracked items
    for (const item of items) {
      if (String(item.id).startsWith('custom-')) continue
      const dbProd = productMap.get(item.id)
      if (dbProd && dbProd.stock_type === 'tracked') {
        const { error: stockUpdErr } = await supabase
          .from('products')
          .update({ stock_quantity: dbProd.stock_quantity - item.quantity })
          .eq('id', item.id)

        if (stockUpdErr) {
          console.error(`Gagal update stok produk ${item.id}:`, stockUpdErr.message)
        }
      }
    }

    // 8. Record Ledger transaction & journal lines
    const { data: tx, error: txErr } = await supabase
      .from('transactions')
      .insert({
        business_id: businessId,
        order_id: order.id,
        date: new Date().toISOString(),
        description: `Penjualan POS #${orderNumber}`
      })
      .select('id')
      .single()

    if (txErr) {
      return NextResponse.json({ error: 'Gagal mencatat transaksi akuntansi: ' + txErr.message }, { status: 500 })
    }

    const debitAccountCode = payment_method === 'cash' ? '101000' : '101200'
    const debitAccountId = accountMap[debitAccountCode]
    const creditAccountId = accountMap['401000']

    const journalLines = [
      {
        transaction_id: tx.id,
        account_id: debitAccountId,
        debit: grand_total,
        credit: 0
      },
      {
        transaction_id: tx.id,
        account_id: creditAccountId,
        debit: 0,
        credit: grand_total
      }
    ]

    if (totalCogs > 0) {
      journalLines.push(
        {
          transaction_id: tx.id,
          account_id: accountMap['501000'],
          debit: totalCogs,
          credit: 0
        },
        {
          transaction_id: tx.id,
          account_id: accountMap['102000'],
          debit: 0,
          credit: totalCogs
        }
      )
    }

    const { error: jlErr } = await supabase
      .from('journal_lines')
      .insert(journalLines)

    if (jlErr) {
      return NextResponse.json({ error: 'Gagal mencatat jurnal akuntansi (double-entry): ' + jlErr.message }, { status: 500 })
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
