import { createClient } from '@supabase/supabase-js'
import { NextResponse, after } from 'next/server'

export async function GET() {
  return NextResponse.json({ status: 'ok', message: 'WooCommerce webhook endpoint is active.' }, { status: 200 })
}

export async function HEAD() {
  return new Response(null, { status: 200 })
}

export async function OPTIONS() {
  return new Response(null, { status: 200 })
}

export async function POST(req: Request) {
  const supabaseAdmin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  try {
    const { searchParams } = new URL(req.url)
    const businessId = searchParams.get('bid')

    if (!businessId) {
      console.warn('[Webhook WooCommerce Warning] Received webhook without bid param.')
      return NextResponse.json({ message: 'Missing business ID param, skipped.' }, { status: 200 })
    }

    // Quick handle for WooCommerce Webhook Ping test
    const topic = req.headers.get('x-wc-webhook-topic')
    if (topic === 'action.woocommerce_webhook_ping') {
      return NextResponse.json({ message: 'Ping received successfully' }, { status: 200 })
    }

    // Safely parse JSON body
    let woo: any = null
    try {
      const rawText = await req.text()
      if (rawText && rawText.trim().length > 0) {
        woo = JSON.parse(rawText)
      }
    } catch (parseErr: any) {
      console.warn('[Webhook WooCommerce Warning] Failed to parse JSON payload:', parseErr.message)
      return NextResponse.json({ message: 'Payload received (invalid JSON format ignored)' }, { status: 200 })
    }

    if (!woo || typeof woo !== 'object' || !woo.id) {
      return NextResponse.json({ message: 'Payload received (not a valid order object)' }, { status: 200 })
    }

    // Check if integration is paused/disabled for this business
    try {
      const { data: integConfig } = await supabaseAdmin
        .from('integrations')
        .select('is_active')
        .eq('platform_name', 'woocommerce')
        .filter('api_credentials->>business_id', 'eq', businessId)
        .maybeSingle()

      if (integConfig && integConfig.is_active === false) {
        console.log(`[Webhook WooCommerce] Integrasi dinonaktifkan untuk bisnis ${businessId}. Pesanan diabaikan.`)
        return NextResponse.json({ message: 'Integrasi WooCommerce dinonaktifkan untuk unit bisnis ini.' }, { status: 200 })
      }
    } catch (configErr: any) {
      console.warn('[Webhook WooCommerce Warning] Failed to check integration config status:', configErr.message)
    }

    // Use Next.js after() to process heavy database tasks (Customer upsert, Order upsert, Ledger sync)
    // in the background. This responds to WooCommerce in ~50ms so WooCommerce webhooks never time out or disable!
    after(async () => {
      try {
        const toNum = (val: any) => {
          const parsed = parseFloat(val);
          return isNaN(parsed) ? 0 : parsed;
        };

        // 1. MEMBERSIHKAN TEKS (Clean newline/tabs)
        const cleanText = (text: string, replacement: string = ", ") => {
          if (!text) return "";
          return text.toString()
            .replace(/[\n\r\t]+/g, replacement)
            .replace(/\s\s+/g, ' ')
            .trim();
        };

        // 2. LOGIKA TELEPON (International Format 62)
        let rawPhone = woo.billing?.phone || '0';
        let cleanPhone = rawPhone.replace(/\D/g, ''); 
        if (cleanPhone.startsWith('0')) {
          cleanPhone = '62' + cleanPhone.substring(1);
        } else if (cleanPhone.startsWith('8')) {
          cleanPhone = '62' + cleanPhone;
        }
        const billingPhone = cleanPhone;

        const fullName = `${woo.billing?.first_name || ''} ${woo.billing?.last_name || ''}`.trim() || 'No Name';
        const orderDateUtc = woo.date_created_gmt ? `${woo.date_created_gmt}Z` : null;

        // 3. KALKULASI BIAYA & ITEM
        const other_fees = woo.fee_lines 
          ? woo.fee_lines.reduce((acc: number, fee: any) => acc + toNum(fee.total), 0) 
          : 0;

        const calculatedSubtotal = woo.line_items
          ? woo.line_items.reduce((acc: number, item: any) => acc + toNum(item.subtotal), 0)
          : 0;

        // 4. UPSERT CUSTOMER
        const countryCode = (woo.billing?.country || '').toUpperCase()
        const countryPreset =
          countryCode === 'ID' ? 'indonesia' :
          countryCode === 'MY' ? 'malaysia'  :
          countryCode === 'US' ? 'usa'       : 'custom'

        const countryName =
          countryCode === 'ID' ? 'Indonesia'     :
          countryCode === 'MY' ? 'Malaysia'      :
          countryCode === 'US' ? 'United States' :
          woo.billing?.country || ''

        const metaData: any[] = woo.meta_data || []
        const kecamatan = metaData.find((i: any) => i.key === 'shipping_kecamatan')?.value ||
                          metaData.find((i: any) => i.key === 'billing_kecamatan')?.value || ''

        const addressData = {
          country_preset: countryPreset,
          country:        countryName,
          address_line1:  cleanText(woo.billing?.address_1 || ''),
          address_line2:  cleanText(woo.billing?.address_2 || ''),
          subdistrict:    kecamatan,
          city:           woo.billing?.city    || '',
          state:          woo.billing?.state   || '',
          postcode:       woo.billing?.postcode || '',
        }

        const { data: customer, error: custError } = await supabaseAdmin
          .from('customers')
          .upsert({ 
            business_id:  businessId,
            phone:        billingPhone,
            name:         fullName,
            email:        woo.billing?.email || '',
            address_data: addressData,
          }, { onConflict: 'business_id, phone' })
          .select('id')
          .single()

        if (custError) {
          console.error(`[WooCommerce Webhook Background Error] Customer error for order #${woo.number}:`, custError.message)
          return
        }

        // 5. UPSERT ORDER KE SUPABASE
        const { data: orderData, error: orderError } = await supabaseAdmin
          .from('orders')
          .upsert({
            business_id: businessId,
            customer_id: customer.id,
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
            updated_at: new Date().toISOString()
          }, { onConflict: 'source_platform, external_id' })
          .select('id')
          .single()

        if (orderError || !orderData) {
          console.error(`[WooCommerce Webhook Background Error] Order error for order #${woo.number}:`, orderError?.message)
          return
        }

        // 6. INTEGRATE ACCOUNTING LEDGER
        const { syncOrderToLedger } = await import('@/lib/orderLedger')
        const syncRes = await syncOrderToLedger(orderData.id, supabaseAdmin)
        if (!syncRes.success) {
          console.error(`[WooCommerce Webhook Background Error] Sync ledger error for order #${orderData.id}:`, syncRes.message)
        } else {
          console.log(`[WooCommerce Webhook Background Success] Processed order #${woo.number} (ID: ${orderData.id}) successfully.`)
        }
      } catch (backgroundErr: any) {
        console.error('[WooCommerce Webhook Background Exception]:', backgroundErr?.message || backgroundErr)
      }
    })

    // Return 200 OK immediately so WooCommerce receives HTTP response in <100ms
    return NextResponse.json({ success: true, message: 'Webhook queued and processing in background.' }, { status: 200 })

  } catch (err: any) {
    console.error("Webhook Unexpected Error:", err?.message || err);
    // CRITICAL: Always return 200 OK to WooCommerce so WooCommerce never auto-disables the webhook!
    return NextResponse.json({ success: true, warning: 'Processed with unhandled exception' }, { status: 200 })
  }
}
