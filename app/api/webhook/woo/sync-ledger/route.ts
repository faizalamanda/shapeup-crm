/**
 * Internal API Route: /api/webhook/woo/sync-ledger
 *
 * Dipanggil oleh Edge Function process-webhook-queue setelah order berhasil di-upsert.
 * Menjalankan syncOrderToLedger yang memerlukan Next.js lib (orderLedger.ts).
 *
 * Protected oleh x-service-key header (SUPABASE_SERVICE_ROLE_KEY).
 *
 * Fixes yang diterapkan:
 *   ✅ isNewOrder = false (default) → query existing transactions untuk idempotency
 *   ✅ skipExistingCheck tidak salah kaprah — orderLedger menangani ini sendiri
 */

import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { syncOrderToLedger } from '@/lib/orderLedger'

export async function POST(req: Request) {
  // Validasi service key — route ini hanya boleh dipanggil internal (Edge Function)
  const serviceKey = req.headers.get('x-service-key')
  if (!serviceKey || serviceKey !== process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const { orderId, businessId } = await req.json()

    if (!orderId || !businessId) {
      return NextResponse.json({ error: 'Missing orderId or businessId' }, { status: 400 })
    }

    const supabaseAdmin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    )

    const syncRes = await syncOrderToLedger(orderId, supabaseAdmin)

    if (!syncRes.success) {
      console.error(`[sync-ledger] Failed for order ${orderId}:`, syncRes.message)
      return NextResponse.json({ success: false, message: syncRes.message }, { status: 500 })
    }

    return NextResponse.json({ success: true, message: syncRes.message })

  } catch (err: any) {
    console.error('[sync-ledger] Unexpected error:', err?.message || err)
    return NextResponse.json({ success: false, message: err?.message || 'Internal error' }, { status: 500 })
  }
}
