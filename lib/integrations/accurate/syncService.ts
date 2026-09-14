import { createClient as createAdminClient } from '@supabase/supabase-js'
import crypto from 'crypto'

// Helper to delay execution (rate limiting)
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

const toNum = (val: any) => {
  const parsed = parseFloat(val)
  return isNaN(parsed) ? 0 : parsed
}

const pad = (n: number) => n.toString().padStart(2, '0')

export async function executeAccurateSync(businessId: string, page = 1, specificIds?: { invoiceIds: number[], receiptIds: number[] }): Promise<{ success: boolean; hasNextPage?: boolean; error?: string; processedOrders?: number; newProducts?: number; message?: string }> {
  try {
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
    if (!serviceRoleKey) {
      throw new Error('SUPABASE_SERVICE_ROLE_KEY is not defined in env')
    }
    const supabaseAdmin = createAdminClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      serviceRoleKey
    )

    // Get Accurate Integration Config
    const { data: integration, error: intError } = await supabaseAdmin
      .from('business_integrations')
      .select('config, is_active')
      .eq('business_id', businessId)
      .eq('provider', 'accurate')
      .single()

    if (intError || !integration || !integration.is_active) {
      return { success: false, error: 'Integrasi Accurate tidak aktif atau belum dikonfigurasi.' }
    }

    const config = integration.config as { access_token?: string; db_id?: string; host?: string; last_sync_date?: string; client_secret?: string }
    
    if (!config.access_token) {
      return { success: false, error: 'Access Token Accurate wajib diisi.' }
    }
    
    const activeSecret = process.env.ACCURATE_CLIENT_SECRET || config.client_secret
    
    if (!activeSecret && !config.db_id) {
      return { success: false, error: 'Database ID wajib diisi jika tidak menggunakan metode API Token.' }
    }

    const generateAccurateHeaders = () => {
      const headers: Record<string, string> = {
        'Authorization': `Bearer ${config.access_token}`
      }
      
      const activeSecret = process.env.ACCURATE_CLIENT_SECRET || config.client_secret

      if (activeSecret) {
        // API Token Method requires Signature
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
          return { success: false, error: `Gagal mendapatkan host Accurate: ${JSON.stringify(tokenData.d || tokenData)}` }
        }
      } else {
        const testRes = await fetch(`https://account.accurate.id/api/db-list.do`, { headers })
        const testData = await testRes.json()
        if (testRes.ok && testData.s) {
          const db = testData.d.find((d: any) => d.id.toString() === config.db_id)
          if (db) {
            accurateHost = db.hostUrl || db.host
          } else {
            return { success: false, error: 'Database ID tidak ditemukan pada akun Accurate' }
          }
        } else {
          return { success: false, error: 'Gagal mendapatkan host dari API Token' }
        }
      }
    }
    
    if (!accurateHost) accurateHost = 'https://account.accurate.id'

    let orders = []
    let hasNextPage = false

    if (specificIds && (specificIds.invoiceIds.length > 0 || specificIds.receiptIds.length > 0)) {
      const finalInvoiceIds = new Set<number>(specificIds.invoiceIds)
      
      // If there are receipt IDs, fetch them to find which invoice they pay
      for (const receiptId of specificIds.receiptIds) {
        try {
          const receiptRes = await fetch(`${accurateHost}/accurate/api/sales-receipt/detail.do?id=${receiptId}`, { headers })
          if (receiptRes.ok) {
            const receiptData = await receiptRes.json()
            if (receiptData.s && receiptData.d && receiptData.d.detailItem) {
              for (const item of receiptData.d.detailItem) {
                if (item.salesInvoiceId) finalInvoiceIds.add(item.salesInvoiceId)
              }
            }
          }
        } catch (e) {
          console.error('[Accurate Webhook] Failed to fetch sales-receipt details for id', receiptId, e)
        }
      }

      // Map IDs to the same format as list.do
      orders = Array.from(finalInvoiceIds).map(id => ({ id }))
      hasNextPage = false
    } else {
      let listUrl = `${accurateHost}/accurate/api/sales-invoice/list.do?sp.page=${page}&sp.pageSize=100`
      
      // Add date filter if it's the second sync onwards
      if (config.last_sync_date) {
        // To catch late updates (e.g. an order from 5 days ago just paid today),
        // we don't just query from last_sync_date. We query from 14 days BEFORE last_sync_date.
        const parts = String(config.last_sync_date).split('/')
        if (parts.length === 3) {
          const syncDate = new Date(`${parts[2]}-${parts[1]}-${parts[0]}T00:00:00+07:00`)
          syncDate.setDate(syncDate.getDate() - 14) // Rollback 14 days
          
          const filterDateStr = `${pad(syncDate.getDate())}/${pad(syncDate.getMonth() + 1)}/${syncDate.getFullYear()}`
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
        return { success: false, error: `Gagal mengambil data dari Accurate: ${listRes.status}` }
      }

      const listData = await listRes.json()
      orders = listData.d || []
      const sp = listData.sp || {}
      hasNextPage = sp.pageCount > page
    }

    let processedOrders = 0
    let newProducts = 0
    
    const uniqueItemsMap = new Map()
    const uniqueCustomersMap = new Map()
    const allOrdersToProcess: any[] = []

    // 1. FILTER EXISTING ORDERS
    const orderIds = orders.map((o: any) => String(o.id))
    let ordersToFetch = orders

    if (orderIds.length > 0 && !(specificIds && (specificIds.invoiceIds.length > 0 || specificIds.receiptIds.length > 0))) {
      // Hanya cek ke DB jika ini sinkronisasi manual (bukan webhook)
      const { data: existingOrders } = await supabaseAdmin
        .from('orders')
        .select('external_id')
        .eq('business_id', businessId)
        .in('external_id', orderIds)
        
      const existingIds = new Set(existingOrders?.map(o => o.external_id) || [])
      ordersToFetch = orders.filter((o: any) => !existingIds.has(String(o.id)))
    }

    // 2. CHUNKING
    const chunkArray = (arr: any[], size: number) => Array.from({ length: Math.ceil(arr.length / size) }, (v, i) => arr.slice(i * size, i * size + size))
    const chunks = chunkArray(ordersToFetch, 5)

    for (const chunk of chunks) {
      const promises = chunk.map(async (orderSummary: any) => {
        try {
          const detailRes = await fetch(`${accurateHost}/accurate/api/sales-invoice/detail.do?id=${orderSummary.id}`, {
            headers: generateAccurateHeaders()
          })
          if (!detailRes.ok) return null
          const detailData = await detailRes.json()
          return { order: detailData.d, orderSummary }
        } catch (err) {
          console.error('[Accurate Sync] Error fetching detail for', orderSummary.id, err)
          return null
        }
      })

      const results = await Promise.all(promises)

      for (const res of results) {
        if (!res || !res.order) continue
        const { order, orderSummary } = res

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

      if (chunks.length > 1) {
        await delay(1000)
      }
    }

    // 1. UPSERT CUSTOMERS
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
      const formattedToday = `${pad(today.getDate())}/${pad(today.getMonth() + 1)}/${today.getFullYear()}`
      
      const newConfig = {
        ...config,
        last_sync_date: formattedToday,
        last_sync_time_str: `${pad(today.getHours())}:${pad(today.getMinutes())}:${pad(today.getSeconds())} WIB`
      }
      
      await supabaseAdmin
        .from('business_integrations')
        .update({ config: newConfig })
        .eq('business_id', businessId)
        .eq('provider', 'accurate')
    }

    return { 
      success: true, 
      processedOrders,
      newProducts,
      hasNextPage,
      message: `Batch ${page} selesai. ${processedOrders} pesanan diproses.` 
    }

  } catch (err: any) {
    console.error('Accurate Sync Error:', err)
    return { success: false, error: err.message || 'Internal Server Error' }
  }
}
