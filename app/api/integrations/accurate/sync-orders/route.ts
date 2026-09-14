import { NextRequest, NextResponse } from 'next/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabaseServer'
import crypto from 'crypto'

// Helper to delay execution (rate limiting)
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

const toNum = (val: any) => {
  const parsed = parseFloat(val)
  return isNaN(parsed) ? 0 : parsed
}

export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient()

    const { data: userData, error: userError } = await supabase.auth.getUser()
    if (userError || !userData.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { data: profile } = await supabase
      .from('profiles')
      .select('active_business_id')
      .eq('id', userData.user.id)
      .single()

    const businessId = profile?.active_business_id
    if (!businessId) {
      return NextResponse.json({ error: 'No active business' }, { status: 400 })
    }

    // Get body for pagination
    let page = 1
    try {
      const body = await req.json()
      if (body.page) page = parseInt(body.page, 10)
    } catch (e) {
      // ignore JSON parse error if body is empty
    }

    // Get Accurate Integration Config
    const { data: integration, error: intError } = await supabase
      .from('business_integrations')
      .select('config, is_active')
      .eq('business_id', businessId)
      .eq('provider', 'accurate')
      .single()

    if (intError || !integration || !integration.is_active) {
      return NextResponse.json({ error: 'Integrasi Accurate tidak aktif atau belum dikonfigurasi.' }, { status: 400 })
    }

    const config = integration.config as { access_token?: string; db_id?: string; host?: string; last_sync_date?: string; client_secret?: string }
    
    if (!config.access_token) {
      return NextResponse.json({ error: 'Access Token Accurate wajib diisi.' }, { status: 400 })
    }
    
    const activeSecret = process.env.ACCURATE_CLIENT_SECRET || config.client_secret
    
    if (!activeSecret && !config.db_id) {
      return NextResponse.json({ error: 'Database ID wajib diisi jika tidak menggunakan metode API Token.' }, { status: 400 })
    }

    const generateAccurateHeaders = () => {
      const headers: Record<string, string> = {
        'Authorization': `Bearer ${config.access_token}`
      }
      
      const activeSecret = process.env.ACCURATE_CLIENT_SECRET || config.client_secret

      if (activeSecret) {
        // API Token Method requires Signature
        const pad = (n: number) => n.toString().padStart(2, '0')
        // Ensure we get the time in Jakarta timezone (UTC+7) since Vercel runs in UTC
        const now = new Date(new Date().toLocaleString("en-US", {timeZone: "Asia/Jakarta"}))
        const tsStr = `${pad(now.getDate())}/${pad(now.getMonth()+1)}/${now.getFullYear()} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`
        headers['X-Api-Timestamp'] = tsStr
        headers['X-Api-Signature'] = crypto.createHmac('sha256', activeSecret).update(tsStr).digest('base64')
      } else if (config.db_id) {
        // Fallback for OAuth Method
        headers['X-Session-ID'] = config.db_id
      }
      return headers
    }

    let accurateHost = config.host || ''
    const headers = generateAccurateHeaders()
    
    // Fetch dynamic host if not known, or always fetch it to be safe
    if (!accurateHost) {
      if (activeSecret) {
        const tokenRes = await fetch(`https://account.accurate.id/api/api-token.do`, {
          method: 'POST',
          headers
        })
        const tokenData = await tokenRes.json()
        if (tokenRes.ok && tokenData.s) {
          accurateHost = tokenData.d?.database?.hostUrl || tokenData.d?.database?.host || 'https://account.accurate.id'
        } else {
          return NextResponse.json({ error: `Gagal mendapatkan host Accurate: ${JSON.stringify(tokenData.d || tokenData)}` }, { status: 400 })
        }
      } else {
        const testRes = await fetch(`https://account.accurate.id/api/db-list.do`, { headers })
        const testData = await testRes.json()
        if (testRes.ok && testData.s) {
          const db = testData.d.find((d: any) => d.id.toString() === config.db_id)
          if (db) accurateHost = db.hostUrl || db.host
        }
      }
    }
    
    if (!accurateHost) accurateHost = 'https://account.accurate.id'

    let listUrl = `${accurateHost}/accurate/api/sales-invoice/list.do?sp.page=${page}&sp.pageSize=100`
    
    // Add date filter if it's the second sync onwards
    if (config.last_sync_date) {
      // To catch late updates (e.g. an order from 5 days ago just paid today),
      // we don't just query from last_sync_date. We query from 14 days BEFORE last_sync_date.
      const parts = String(config.last_sync_date).split('/')
      if (parts.length === 3) {
        const syncDate = new Date(`${parts[2]}-${parts[1]}-${parts[0]}T00:00:00+07:00`)
        syncDate.setDate(syncDate.getDate() - 14) // Rollback 14 days
        
        const filterDateStr = `${String(syncDate.getDate()).padStart(2, '0')}/${String(syncDate.getMonth() + 1).padStart(2, '0')}/${syncDate.getFullYear()}`
        listUrl += `&filter.transDate.gte=${filterDateStr}`
      } else {
        listUrl += `&filter.transDate.gte=${config.last_sync_date}`
      }
    }

    // Fetch with pagination.
    const listRes = await fetch(listUrl, { headers })

    if (!listRes.ok) {
      const errText = await listRes.text()
      console.error('Accurate API Error:', errText)
      return NextResponse.json({ error: `Gagal mengambil data dari Accurate: ${listRes.status}` }, { status: listRes.status })
    }

    const listData = await listRes.json()
    const orders = listData.d || []
    const sp = listData.sp || {}
    const hasNextPage = sp.pageCount > page

    let processedOrders = 0
    let newProducts = 0
    
    const uniqueItemsMap = new Map()
    const uniqueCustomersMap = new Map()
    const allOrdersToProcess: any[] = []

    // Fetch detail sequentially to avoid hitting 8 requests/sec limit
    for (const orderSummary of orders) {
      const detailRes = await fetch(`${accurateHost}/accurate/api/sales-invoice/detail.do?id=${orderSummary.id}`, {
        headers: generateAccurateHeaders()
      })
      
      // Delay 150ms between requests (max ~6.6 requests per second)
      await delay(150)

      if (!detailRes.ok) continue
      
      const detailData = await detailRes.json()
      const order = detailData.d

      if (!order) continue

      // Customer Processing
      const custId = order.customer?.id || order.customerNo || orderSummary.id
      const custName = order.customer?.name || order.customerName || `Accurate Customer ${custId}`
      const dummyPhone = `000${String(custId).replace(/\D/g, '')}`

      uniqueCustomersMap.set(dummyPhone, {
        business_id: businessId,
        phone: dummyPhone,
        name: custName,
        email: '',
        address_data: {}
      })

      // Items Processing
      let calculatedSubtotal = 0
      let totalQty = 0
      const itemsJson = []

      if (order.detailItem) {
        for (const item of order.detailItem) {
          uniqueItemsMap.set(item.itemNo, item)
          
          const itemTotal = toNum(item.totalPrice || 0)
          const itemQty = toNum(item.quantity || 0)
          
          calculatedSubtotal += itemTotal
          totalQty += itemQty
          
          itemsJson.push({
            name: item.detailName || item.itemNo,
            quantity: itemQty,
            subtotal: itemTotal,
            sku: item.itemNo,
            price: toNum(item.unitPrice || 0)
          })
        }
      }

      allOrdersToProcess.push({
        ...order,
        extractedCustomerPhone: dummyPhone,
        totalQty,
        calculatedSubtotal,
        itemsJson
      })

      processedOrders++
    }

    // 1. UPSERT CUSTOMERS
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
    if (!serviceRoleKey) {
      throw new Error('SUPABASE_SERVICE_ROLE_KEY is not defined in env')
    }
    const supabaseAdmin = createAdminClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      serviceRoleKey
    )

    let customerIdMap = new Map<string, string>() // phone -> id
    const customersArray = Array.from(uniqueCustomersMap.values())
    if (customersArray.length > 0) {
      const { data: upsertedCustomers, error: custErr } = await supabaseAdmin
        .from('customers')
        .upsert(customersArray, { onConflict: 'business_id, phone' })
        .select('id, phone')
        
      if (custErr) throw custErr
      
      upsertedCustomers?.forEach(c => {
        customerIdMap.set(c.phone, c.id)
      })
    }

    // 2. UPSERT PRODUCTS
    if (uniqueItemsMap.size > 0) {
      const uniqueSkus = Array.from(uniqueItemsMap.keys())
      const { data: existingProducts } = await supabaseAdmin
        .from('products')
        .select('sku')
        .eq('business_id', businessId)
        .in('sku', uniqueSkus)

      const existingSkus = new Set(existingProducts?.map(p => p.sku) || [])

      const productsToInsert = []
      for (const item of uniqueItemsMap.values()) {
        if (item.itemNo && !existingSkus.has(item.itemNo)) {
          const detailName = item.detailName || item.itemNo
          const unitPrice = item.unitPrice || 0
          const hpp = item.unitPrice || 0
          
          productsToInsert.push({
            business_id: businessId,
            name: detailName,
            sku: item.itemNo,
            price: unitPrice,
            cost_price: hpp,
            type: 'physical',
            stock_type: 'tracked',
            stock_quantity: 0
          })
        }
      }

      if (productsToInsert.length > 0) {
        const { error: insertError } = await supabaseAdmin.from('products').insert(productsToInsert)
        if (insertError) {
          console.error('Error inserting products:', insertError)
        } else {
          newProducts = productsToInsert.length
        }
      }
    }

    // 3. UPSERT ORDERS
    const ordersToInsert = allOrdersToProcess.map(o => {
      // Parse order_date safely to ISO or use null if missing
      let orderDateUtc = null
      if (o.transDate) {
        // Accurate format is usually DD/MM/YYYY. Let's try to parse it if it is, 
        // else fallback to new Date() if valid.
        const parts = String(o.transDate).split('/')
        if (parts.length === 3) {
          // Accurate returns date only. We assume midnight in Jakarta time (+07:00) 
          // to ensure it stores correctly in UTC without bleeding into the next/previous day.
          orderDateUtc = new Date(`${parts[2]}-${parts[1]}-${parts[0]}T00:00:00+07:00`).toISOString()
        } else {
          // Attempt standard parse
          const d = new Date(o.transDate)
          if (!isNaN(d.getTime())) orderDateUtc = d.toISOString()
        }
      }

      return {
        business_id: businessId,
        customer_id: customerIdMap.get(o.extractedCustomerPhone),
        external_id: o.id.toString(),
        source_platform: 'Accurate Online',
        order_number: o.number || o.id.toString(),
        order_date: orderDateUtc,
        order_date_utc: orderDateUtc,
        status: o.status || 'CLOSED', // Fallback status
        total_qty: o.totalQty,
        subtotal: o.calculatedSubtotal,
        discount_amount: toNum(o.itemDiscountAmount || 0) + toNum(o.discountAmount || 0),
        shipping_cost: toNum(o.freight || 0),
        other_fees: 0,
        grand_total: toNum(o.totalAmount || o.calculatedSubtotal),
        payment_method: 'Accurate API',
        items_json: o.itemsJson,
        raw_source_data: o,
        updated_at: new Date().toISOString()
      }
    })

    if (ordersToInsert.length > 0) {
      const { data: upsertedOrders, error: orderErr } = await supabaseAdmin
        .from('orders')
        .upsert(ordersToInsert, { onConflict: 'source_platform, external_id' })
        .select('id')
        
      if (orderErr) throw orderErr
      
      // 4. SYNC LEDGER (Using dynamic import to match WooCommerce flow)
      try {
        const { syncOrderToLedger } = await import('@/lib/orderLedger')
        for (const uo of upsertedOrders || []) {
          try {
            await syncOrderToLedger(uo.id, supabaseAdmin)
          } catch (ledgerErr) {
            console.error(`Ledger sync failed for order ${uo.id}`, ledgerErr)
          }
        }
      } catch (importErr) {
        console.error('Failed to import orderLedger', importErr)
      }
    }

    // If this is the last page, update last_sync_date to today (Jakarta time)
    if (!hasNextPage) {
      const today = new Date(new Date().toLocaleString("en-US", {timeZone: "Asia/Jakarta"}))
      const formattedToday = `${String(today.getDate()).padStart(2, '0')}/${String(today.getMonth() + 1).padStart(2, '0')}/${today.getFullYear()}`
      
      const timeStr = today.toLocaleString('id-ID', {
        day: '2-digit', month: 'short', year: 'numeric',
        hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Jakarta'
      }) + ' WIB'
      
      const newConfig = { ...config, last_sync_date: formattedToday, last_sync_time_str: timeStr }
      
      await supabase.from('business_integrations')
        .update({ config: newConfig })
        .eq('business_id', businessId)
        .eq('provider', 'accurate')
    }

    return NextResponse.json({ 
      success: true, 
      processedOrders,
      newProducts,
      hasNextPage,
      page,
      message: `Batch ${page} selesai. ${processedOrders} pesanan diproses.` 
    })

  } catch (err: any) {
    console.error('Accurate Sync Error:', err)
    return NextResponse.json({ error: err.message || 'Internal Server Error' }, { status: 500 })
  }
}
