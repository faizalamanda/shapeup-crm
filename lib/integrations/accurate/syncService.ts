import { createClient as createAdminClient } from '@supabase/supabase-js'
import crypto from 'crypto'
import { invalidateCustomerCache } from '@/lib/customerHelper'

// Helper to delay execution (rate limiting)
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

const toNum = (val: any) => {
  const parsed = parseFloat(val)
  return isNaN(parsed) ? 0 : parsed
}

const pad = (n: number) => n.toString().padStart(2, '0')

export function buildAccurateAuthHeaders(accessToken: string, clientSecret?: string, dbId?: string): Record<string, string> {
  const headers: Record<string, string> = {
    'Authorization': `Bearer ${accessToken.trim()}`
  }

  const activeSecret = (process.env.ACCURATE_CLIENT_SECRET || clientSecret || '').trim()

  if (activeSecret) {
    // API Token Method requires Signature in Jakarta timezone (UTC+7)
    const now = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Jakarta" }))
    const tsStr = `${pad(now.getDate())}/${pad(now.getMonth() + 1)}/${now.getFullYear()} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`
    headers['X-Api-Timestamp'] = tsStr
    headers['X-Api-Signature'] = crypto.createHmac('sha256', activeSecret).update(tsStr).digest('base64')
  } else if (dbId) {
    headers['X-Session-ID'] = dbId.trim()
  }

  return headers
}

/**
 * Calls Accurate Online /api/webhook-renew.do to extend webhook delivery validity (+7 days).
 */
export async function renewAccurateWebhookForToken(accessToken: string, clientSecret?: string, dbId?: string): Promise<{ success: boolean; expiryDate?: string; error?: string }> {
  try {
    const headers = buildAccurateAuthHeaders(accessToken, clientSecret, dbId)
    const res = await fetch('https://account.accurate.id/api/webhook-renew.do', {
      method: 'GET',
      headers
    })
    const data = await res.json().catch(() => null)
    if (res.ok && data?.s) {
      return { success: true, expiryDate: typeof data.d === 'string' ? data.d : undefined }
    }
    return { success: false, error: JSON.stringify(data?.d || data || `HTTP ${res.status}`) }
  } catch (err: any) {
    return { success: false, error: err?.message || String(err) }
  }
}

/**
 * Checks all active Accurate integrations and automatically renews their webhooks
 * if they have not been renewed in the last 3 days (72 hours), ensuring the 7-day
 * Accurate webhook lease never expires.
 */
export async function autoRenewAllAccurateWebhooks(supabaseAdmin: any, force = false): Promise<{ renewed: number; skipped: number; failed: number }> {
  let renewed = 0
  let skipped = 0
  let failed = 0

  try {
    const { data: integrations } = await supabaseAdmin
      .from('business_integrations')
      .select('id, business_id, config')
      .eq('provider', 'accurate')
      .eq('is_active', true)

    if (!integrations || integrations.length === 0) {
      return { renewed, skipped, failed }
    }

    const THREE_DAYS_MS = 3 * 24 * 60 * 60 * 1000
    const nowMs = Date.now()

    for (const int of integrations) {
      const conf = (int.config || {}) as Record<string, any>
      if (!conf.access_token) {
        skipped++
        continue
      }

      const lastRenewMs = conf.last_webhook_renew_at ? new Date(conf.last_webhook_renew_at).getTime() : 0
      if (!force && lastRenewMs && !isNaN(lastRenewMs) && (nowMs - lastRenewMs) < THREE_DAYS_MS) {
        skipped++
        continue
      }

      const renewRes = await renewAccurateWebhookForToken(conf.access_token, conf.client_secret, conf.db_id)
      if (renewRes.success) {
        // Backfill db_integer_id from JWT payload if missing on legacy records
        let backfilledDbIntId = conf.db_integer_id
        if (!backfilledDbIntId && typeof conf.access_token === 'string' && conf.access_token.startsWith('aat.')) {
          try {
            const parts = conf.access_token.split('.')
            if (parts.length >= 3) {
              const decoded = JSON.parse(Buffer.from(parts[2], 'base64').toString('utf8'))
              if (decoded?.d) backfilledDbIntId = decoded.d
            }
          } catch (_) {}
        }

        const updatedConfig = {
          ...conf,
          ...(backfilledDbIntId ? { db_integer_id: backfilledDbIntId } : {}),
          webhook_expiry: renewRes.expiryDate || conf.webhook_expiry,
          last_webhook_renew_at: new Date().toISOString()
        }
        await supabaseAdmin
          .from('business_integrations')
          .update({ config: updatedConfig })
          .eq('id', int.id)
        renewed++
        console.log(`[Accurate Auto-Renew] Renewed webhook for business ${int.business_id} until ${renewRes.expiryDate}`)
      } else {
        failed++
        console.warn(`[Accurate Auto-Renew] Failed for business ${int.business_id}:`, renewRes.error)
      }
    }
  } catch (err: any) {
    console.error('[Accurate Auto-Renew] Error:', err?.message || err)
  }

  return { renewed, skipped, failed }
}

/**
 * Extracts specific salesInvoiceId and salesReceiptId from an Accurate webhook payload array
 * and runs executeAccurateSync for that business.
 */
export async function processAccurateWebhookPayload(businessId: string, payload: any): Promise<{ success: boolean; error?: string }> {
  const events = Array.isArray(payload) ? payload : [payload]
  const specificInvoiceIds: number[] = []
  const specificReceiptIds: number[] = []

  events.forEach((event: any) => {
    if (event?.data && Array.isArray(event.data)) {
      event.data.forEach((item: any) => {
        if (item.salesInvoiceId) specificInvoiceIds.push(Number(item.salesInvoiceId))
        if (item.salesReceiptId) specificReceiptIds.push(Number(item.salesReceiptId))

        const typeStr = String(event.type || '').toUpperCase()
        const moduleStr = String(event.module || '').toUpperCase()

        if ((typeStr.includes('INVOICE') || moduleStr.includes('INVOICE')) && item.id) {
          specificInvoiceIds.push(Number(item.id))
        }
        if ((typeStr.includes('RECEIPT') || moduleStr.includes('RECEIPT')) && item.id) {
          specificReceiptIds.push(Number(item.id))
        }
      })
    }
  })

  const uniqueInvoiceIds = Array.from(new Set(specificInvoiceIds.filter(n => Number.isFinite(n) && n > 0)))
  const uniqueReceiptIds = Array.from(new Set(specificReceiptIds.filter(n => Number.isFinite(n) && n > 0)))

  if (uniqueInvoiceIds.length > 0 || uniqueReceiptIds.length > 0) {
    console.log(`[Accurate Webhook Processor] Syncing specific IDs for ${businessId}: Invoices=[${uniqueInvoiceIds.join(',')}], Receipts=[${uniqueReceiptIds.join(',')}]`)
    const res = await executeAccurateSync(businessId, 1, { invoiceIds: uniqueInvoiceIds, receiptIds: uniqueReceiptIds })
    return { success: res.success, error: res.error }
  } else {
    console.log(`[Accurate Webhook Processor] No specific IDs found in payload, running page 1 sync for ${businessId}`)
    const res = await executeAccurateSync(businessId, 1)
    return { success: res.success, error: res.error }
  }
}

export async function executeAccurateSync(businessId: string, page = 1, specificIds?: { invoiceIds: number[], receiptIds: number[] }, forceAll: boolean = false): Promise<{ success: boolean; hasNextPage?: boolean; error?: string; processedOrders?: number; newProducts?: number; message?: string; totalPages?: number }> {
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
    let totalPages = 1

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
      let listUrl = `${accurateHost}/accurate/api/sales-invoice/list.do?sp.page=${page}&sp.pageSize=25`
      
      // Add date filter if it's the second sync onwards, and not forcing full sync
      if (config.last_sync_date && !forceAll) {
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
      totalPages = sp.pageCount || 1
    }

    let processedOrders = 0
    let newProducts = 0
    
    const uniqueItemsMap = new Map()
    const uniqueCustomersMap = new Map()
    const allOrdersToProcess: any[] = []

    // Helper to normalize Accurate Online invoice status to standard CRM status
    const normalizeAccurateStatus = (o: any): string => {
      const statusStr = String(o.status || '').toUpperCase().trim()
      const statusNameStr = String(o.statusName || o.statusOutstanding || '').toLowerCase().trim()
      
      if (
        statusStr === 'CANCELLED' || 
        statusStr === 'VOID' || 
        statusStr === 'REJECTED' ||
        statusNameStr.includes('batal') ||
        statusNameStr.includes('void')
      ) {
        return 'cancelled'
      }
      
      if (
        statusStr === 'UNPAID' || 
        statusNameStr.includes('belum lunas') || 
        (o.outstanding === true && (o.primeReceipt || 0) === 0)
      ) {
        return 'processing'
      }
      
      if (
        statusStr === 'PARTIAL' || 
        statusNameStr.includes('sebagian')
      ) {
        return 'processing'
      }
      
      if (statusStr === 'DRAFT' || o.approvalStatus === 'PENDING') {
        return 'draft'
      }
      
      if (
        statusStr === 'PAID' || 
        statusStr === 'CLOSED' || 
        statusStr === 'CLOSED_MANUAL' || 
        statusNameStr.includes('lunas') || 
        o.outstanding === false
      ) {
        return 'completed'
      }
      
      const rawLower = (o.status || '').toLowerCase()
      if (['completed', 'processing', 'pending', 'cancelled', 'failed', 'shipped'].includes(rawLower)) {
        return rawLower
      }
      
      return 'completed'
    }

    // 1. FETCH ALL ORDERS FOR THIS BATCH
    const ordersToFetch = orders

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
        
        const rawPhone = order.customer?.contactInfo?.mobilePhone || order.customer?.contactInfo?.workPhone || order.customer?.contactInfo?.homePhone
        let cleanPhone = dummyPhone
        if (rawPhone) {
          let cPhone = rawPhone.replace(/\D/g, "")
          if (cPhone.startsWith("0")) {
            cPhone = "62" + cPhone.substring(1)
          } else if (cPhone.startsWith("8")) {
            cPhone = "62" + cPhone
          }
          if (cPhone.length >= 5) cleanPhone = cPhone
        }

        uniqueCustomersMap.set(cleanPhone, {
          business_id: businessId,
          phone: cleanPhone,
          name: custName,
          email: order.customer?.contactInfo?.email || '',
          address_data: {},
          _dummyPhone: dummyPhone
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
          extractedCustomerPhone: cleanPhone,
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
      
      // MIGRATION: Rename dummy phones to real phones if real phone doesn't exist
      for (const c of customersArray) {
        if (c.phone !== c._dummyPhone) {
          const { data: exist } = await supabaseAdmin.from('customers').select('id').eq('business_id', businessId).eq('phone', c.phone).maybeSingle()
          if (!exist) {
            await supabaseAdmin.from('customers').update({ phone: c.phone }).eq('business_id', businessId).eq('phone', c._dummyPhone)
          } else {
            // Delete redundant dummy customer to avoid orphaned records
            await supabaseAdmin.from('customers').delete().eq('business_id', businessId).eq('phone', c._dummyPhone)
          }
        }
      }

      const upsertPayload = customersArray.map(c => {
        const { _dummyPhone, ...rest } = c
        return rest
      })

      const { data: upsertedCustomers, error: custErr } = await supabaseAdmin
        .from('customers')
        .upsert(upsertPayload, { onConflict: 'business_id, phone' })
        .select('id, phone')
        
      if (custErr) throw custErr
      
      upsertedCustomers?.forEach(c => {
        customerIdMap.set(c.phone, c.id)
      })
      invalidateCustomerCache(businessId)
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

      let defaultHppPct = 0
      try {
        const { data: globalInt } = await supabaseAdmin
          .from('integrations')
          .select('api_credentials')
          .eq('platform_name', 'global')
          .filter('api_credentials->>business_id', 'eq', businessId)
          .limit(1)
        if (globalInt && globalInt.length > 0 && typeof globalInt[0].api_credentials?.global_default_hpp_percentage === 'number') {
          defaultHppPct = Math.max(0, Math.min(100, globalInt[0].api_credentials.global_default_hpp_percentage))
        }
      } catch (_) {}

      const productsToInsert = []
      for (const item of uniqueItemsMap.values()) {
        if (item.itemNo && !existingSkus.has(item.itemNo)) {
          const detailName = item.detailName || item.itemNo
          const unitPrice = item.unitPrice || 0
          const hpp = item.costPrice || (unitPrice * (defaultHppPct / 100))
          
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
          const invTime = o.invoiceTime || '00:00:00'
          // Compile Local Time (WIB) into an accurate UTC Date
          orderDateUtc = new Date(`${parts[2]}-${parts[1]}-${parts[0]}T${invTime}+07:00`).toISOString()
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
        status: normalizeAccurateStatus(o),
        total_qty: o.totalQty,
        subtotal: o.calculatedSubtotal,
        discount_amount: toNum(o.itemDiscountAmount || 0) + toNum(o.discountAmount || 0) + toNum(o.cashDiscount || 0),
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

    // If this is the last page, update last_sync_date to today (Jakarta time) and auto-renew webhook if due
    if (!hasNextPage) {
      const today = new Date(new Date().toLocaleString("en-US", {timeZone: "Asia/Jakarta"}))
      const formattedToday = `${pad(today.getDate())}/${pad(today.getMonth() + 1)}/${today.getFullYear()}`
      
      let webhookExpiry = (config as any).webhook_expiry
      let lastWebhookRenewAt = (config as any).last_webhook_renew_at
      const THREE_DAYS_MS = 3 * 24 * 60 * 60 * 1000
      const lastRenewMs = lastWebhookRenewAt ? new Date(lastWebhookRenewAt).getTime() : 0

      if (!lastRenewMs || isNaN(lastRenewMs) || (Date.now() - lastRenewMs) >= THREE_DAYS_MS) {
        const renewRes = await renewAccurateWebhookForToken(config.access_token, config.client_secret, config.db_id)
        if (renewRes.success) {
          webhookExpiry = renewRes.expiryDate || webhookExpiry
          lastWebhookRenewAt = new Date().toISOString()
        }
      }

      const newConfig = {
        ...config,
        last_sync_date: formattedToday,
        last_sync_time_str: `${pad(today.getHours())}:${pad(today.getMinutes())}:${pad(today.getSeconds())} WIB`,
        ...(webhookExpiry ? { webhook_expiry: webhookExpiry } : {}),
        ...(lastWebhookRenewAt ? { last_webhook_renew_at: lastWebhookRenewAt } : {})
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
      totalPages,
      message: `Batch ${page} selesai. ${processedOrders} pesanan diproses.` 
    }

  } catch (err: any) {
    console.error('Accurate Sync Error:', err)
    return { success: false, error: err.message || 'Internal Server Error' }
  }
}
