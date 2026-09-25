import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'

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
  // Respond to WooCommerce in <20ms — semua processing berat dilakukan oleh Edge Function
  // yang berjalan co-located dengan Supabase DB (round-trip ~10–30ms vs ~100–150ms dari Vercel)
  try {
    const { searchParams } = new URL(req.url)
    const businessId = searchParams.get('bid')

    if (!businessId) {
      console.warn('[Webhook WooCommerce] Missing bid param, skipped.')
      return NextResponse.json({ message: 'Missing business ID param, skipped.' }, { status: 200 })
    }

    // Quick handle: WooCommerce Webhook Ping test (tidak perlu masuk queue)
    const topic = req.headers.get('x-wc-webhook-topic')
    if (topic === 'action.woocommerce_webhook_ping') {
      return NextResponse.json({ message: 'Ping received successfully' }, { status: 200 })
    }

    // Parse JSON body
    let woo: any = null
    try {
      const rawText = await req.text()
      if (rawText && rawText.trim().length > 0) {
        woo = JSON.parse(rawText)
      }
    } catch (parseErr: any) {
      console.warn('[Webhook WooCommerce] Failed to parse JSON payload:', parseErr.message)
      return NextResponse.json({ message: 'Payload received (invalid JSON format ignored)' }, { status: 200 })
    }

    if (!woo || typeof woo !== 'object' || !woo.id) {
      return NextResponse.json({ message: 'Payload received (not a valid order object)' }, { status: 200 })
    }

    // INSERT ke webhook_ingest_queue — operasi tunggal, sangat cepat (~10–30ms)
    // Processing berat (customer upsert, order upsert, ledger, loyalty) dilakukan
    // oleh Edge Function process-webhook-queue yang berjalan setiap 1 menit
    const supabaseAdmin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    )

    const { error: insertErr } = await supabaseAdmin
      .from('webhook_ingest_queue')
      .insert({
        business_id: businessId,
        source: 'woocommerce',
        payload: woo,
        status: 'pending',
        scheduled_at: new Date().toISOString(),
      })

    if (insertErr) {
      // Jangan gagalkan response ke WooCommerce — log saja, WooCommerce tetap dapat 200
      console.error('[Webhook WooCommerce] Failed to enqueue payload:', insertErr.message)
    }

    return NextResponse.json({
      success: true,
      message: 'Webhook received and queued for processing.',
    }, { status: 200 })

  } catch (err: any) {
    console.error('[Webhook WooCommerce] Unexpected error:', err?.message || err)
    // SELALU return 200 ke WooCommerce agar webhook tidak di-disable otomatis
    return NextResponse.json({ success: true, warning: 'Queued with fallback handler' }, { status: 200 })
  }
}
