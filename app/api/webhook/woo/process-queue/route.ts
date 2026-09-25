/**
 * API Route: /api/webhook/woo/process-queue
 *
 * Di-trigger oleh pg_cron (atau external cron service) setiap 1 menit.
 * Memproses antrean webhook dari tabel `webhook_ingest_queue`.
 * 
 * Keunggulan:
 *   - Berjalan di Node.js (Next.js) sehingga dapat memanggil syncOrderToLedger secara native.
 *   - Tidak memerlukan deployment Edge Function Deno terpisah ke server VPS.
 *   - Proteksi dengan x-service-key / Authorization Bearer token.
 */

import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { syncOrderToLedger } from '@/lib/orderLedger'

function normalizePhone(rawPhone: string): string {
  let clean = rawPhone.replace(/\D/g, "")
  if (clean.startsWith("0")) {
    clean = "62" + clean.substring(1)
  } else if (clean.startsWith("8")) {
    clean = "62" + clean
  }
  return clean
}

const toNum = (val: any): number => {
  const parsed = parseFloat(val)
  return isNaN(parsed) ? 0 : parsed
}

const cleanText = (text: any, replacement = ", "): string => {
  if (!text) return ""
  return String(text)
    .replace(/[\n\r\t]+/g, replacement)
    .replace(/\s\s+/g, " ")
    .trim()
}

export async function POST(req: Request) {
  // 1. Authorization check
  const authHeader = req.headers.get('authorization')
  const serviceKeyHeader = req.headers.get('x-service-key')
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  const token = authHeader ? authHeader.replace(/^Bearer\s+/i, '') : serviceKeyHeader

  if (serviceKey && token !== serviceKey) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabaseAdmin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  try {
    // 2. Recover stuck items (>15 mins processing)
    const fifteenMinsAgo = new Date(Date.now() - 15 * 60 * 1000).toISOString()
    await supabaseAdmin
      .from('webhook_ingest_queue')
      .update({ status: 'pending' })
      .eq('status', 'processing')
      .lt('processed_at', fifteenMinsAgo)

    // 3. Fetch pending batch using RPC
    const { data: batch, error: fetchErr } = await supabaseAdmin.rpc('fetch_webhook_queue_batch', {
      batch_size: 20
    })

    if (fetchErr) {
      console.error('[process-queue] RPC fetch error:', fetchErr.message)
      return NextResponse.json({ success: false, error: fetchErr.message }, { status: 500 })
    }

    if (!batch || batch.length === 0) {
      return NextResponse.json({ success: true, message: 'No items in queue' })
    }

    console.log(`[process-queue] Processing ${batch.length} webhook items...`)

    let processedCount = 0
    let failedCount = 0

    for (const item of batch) {
      try {
        const { id, business_id, payload, retry_count } = item
        const woo = payload

        // 4. Check if integration is active
        const { data: bizInteg } = await supabaseAdmin
          .from('business_integrations')
          .select('is_active')
          .eq('business_id', business_id)
          .eq('provider', 'woocommerce')
          .maybeSingle()

        if (bizInteg && bizInteg.is_active === false) {
          console.log(`[process-queue] WooCommerce disabled for business ${business_id}, skipping order #${woo.number}`)
          await markDone(supabaseAdmin, id)
          processedCount++
          continue
        }

        // 5. Transform & normalize data
        const rawPhone = woo.billing?.phone || '0'
        const cleanPhone = normalizePhone(rawPhone)
        const billingPhone = cleanPhone.length >= 5 ? cleanPhone : `nophone_${woo.id}`

        const fullName = `${woo.billing?.first_name || ''} ${woo.billing?.last_name || ''}`.trim() || 'No Name'
        const orderDateUtc = woo.date_created_gmt ? `${woo.date_created_gmt}Z` : null

        const other_fees = woo.fee_lines
          ? woo.fee_lines.reduce((acc: number, fee: any) => acc + toNum(fee.total), 0)
          : 0

        const calculatedSubtotal = woo.line_items
          ? woo.line_items.reduce((acc: number, item: any) => acc + toNum(item.subtotal), 0)
          : 0

        const countryCode = (woo.billing?.country || '').toUpperCase()
        const countryPreset = countryCode === 'ID' ? 'indonesia' : countryCode === 'MY' ? 'malaysia' : countryCode === 'US' ? 'usa' : 'custom'
        const countryName = countryCode === 'ID' ? 'Indonesia' : countryCode === 'MY' ? 'Malaysia' : countryCode === 'US' ? 'United States' : (woo.billing?.country || '')

        const metaData: any[] = woo.meta_data || []
        const kecamatan = metaData.find((i: any) => i.key === 'shipping_kecamatan')?.value || metaData.find((i: any) => i.key === 'billing_kecamatan')?.value || ''

        const addressData = {
          country_preset: countryPreset,
          country: countryName,
          address_line1: cleanText(woo.billing?.address_1 || ''),
          address_line2: cleanText(woo.billing?.address_2 || ''),
          subdistrict: kecamatan,
          city: woo.billing?.city || '',
          state: woo.billing?.state || '',
          postcode: woo.billing?.postcode || '',
        }

        // 6. Customer Upsert
        const { data: existingCustomer } = await supabaseAdmin
          .from('customers')
          .select('id, address_data')
          .eq('business_id', business_id)
          .eq('phone', billingPhone)
          .maybeSingle()

        let customerId: string

        if (existingCustomer) {
          const updateData: any = {
            name: fullName,
            email: woo.billing?.email || '',
          }
          if (!existingCustomer.address_data || Object.keys(existingCustomer.address_data).length === 0) {
            updateData.address_data = addressData
          }

          const { error: updateErr } = await supabaseAdmin
            .from('customers')
            .update(updateData)
            .eq('id', existingCustomer.id)

          if (updateErr) throw new Error(`Customer update failed: ${updateErr.message}`)
          customerId = existingCustomer.id
        } else {
          const { data: newCustomer, error: insertErr } = await supabaseAdmin
            .from('customers')
            .upsert({
              business_id: business_id,
              phone: billingPhone,
              name: fullName,
              email: woo.billing?.email || '',
              address_data: addressData,
            }, { onConflict: 'business_id, phone' })
            .select('id')
            .single()

          if (insertErr || !newCustomer) throw new Error(`Customer insert failed: ${insertErr?.message}`)
          customerId = newCustomer.id
        }

        // 7. Order Upsert
        const { data: orderData, error: orderError } = await supabaseAdmin
          .from('orders')
          .upsert({
            business_id: business_id,
            customer_id: customerId,
            external_id: woo.id.toString(),
            source_platform: 'WooCommerce',
            order_number: woo.number,
            order_date: woo.date_created,
            order_date_utc: orderDateUtc,
            status: woo.status,
            total_qty: woo.line_items?.reduce((acc: number, item: any) => acc + toNum(item.quantity), 0) || 0,
            subtotal: calculatedSubtotal,
            discount_amount: toNum(woo.discount_total),
            shipping_cost: toNum(woo.shipping_total),
            other_fees: other_fees,
            grand_total: toNum(woo.total),
            payment_method: woo.payment_method_title || 'Manual',
            items_json: woo.line_items || [],
            raw_source_data: woo,
            updated_at: new Date().toISOString(),
          }, { onConflict: 'source_platform, external_id' })
          .select('id')
          .single()

        if (orderError || !orderData) throw new Error(`Order upsert failed: ${orderError?.message}`)

        // 8. Sync Ledger directly
        const syncRes = await syncOrderToLedger(orderData.id, supabaseAdmin)
        if (!syncRes.success) {
          throw new Error(`Ledger sync failed: ${syncRes.message}`)
        }

        // 9. Mark queue item as done
        await markDone(supabaseAdmin, id)
        processedCount++
      } catch (itemErr: any) {
        console.error(`[process-queue] Failed processing item ${item.id}:`, itemErr?.message)
        failedCount++
        await markRetryOrDead(supabaseAdmin, item, itemErr?.message || String(itemErr))
      }
    }

    return NextResponse.json({
      success: true,
      processed: processedCount,
      failed: failedCount
    })

  } catch (err: any) {
    console.error('[process-queue] Internal error:', err)
    return NextResponse.json({ success: false, error: err?.message }, { status: 500 })
  }
}

async function markDone(supabase: any, id: string) {
  await supabase
    .from('webhook_ingest_queue')
    .update({
      status: 'done',
      processed_at: new Date().toISOString(),
      error_message: null
    })
    .eq('id', id)
}

async function markRetryOrDead(supabase: any, item: any, errMsg: string) {
  const newRetryCount = (item.retry_count || 0) + 1
  if (newRetryCount >= 3) {
    await supabase
      .from('webhook_ingest_queue')
      .update({
        status: 'failed',
        retry_count: newRetryCount,
        error_message: `DEAD LETTER: ${errMsg}`
      })
      .eq('id', item.id)
  } else {
    // Backoff minutes: 1, 5, 30
    const delayMins = newRetryCount === 1 ? 1 : newRetryCount === 2 ? 5 : 30
    const nextRetry = new Date(Date.now() + delayMins * 60 * 1000).toISOString()
    await supabase
      .from('webhook_ingest_queue')
      .update({
        status: 'pending',
        retry_count: newRetryCount,
        processed_at: nextRetry,
        error_message: `Retry #${newRetryCount}: ${errMsg}`
      })
      .eq('id', item.id)
  }
}
