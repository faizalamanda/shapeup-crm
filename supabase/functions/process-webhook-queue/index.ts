/**
 * Supabase Edge Function: process-webhook-queue
 *
 * Berjalan setiap 1 menit via Supabase Cron (pg_cron).
 * Mengambil batch dari webhook_ingest_queue dan memprosesnya:
 *   1. Cek integrasi aktif (business_integrations, indexed query)
 *   2. Upsert customer (onConflict: business_id, phone)
 *   3. Upsert order (onConflict: source_platform, external_id)
 *   4. Sync ledger (transaksi akuntansi + stok)
 *   5. Loyalty hooks
 *
 * Keunggulan vs after() di Next.js:
 *   - Co-located dengan Supabase DB → round-trip ~10–30ms (vs ~100–150ms dari Vercel)
 *   - Retry otomatis hingga 3x dengan backoff (1m, 5m, 30m)
 *   - Stuck recovery: item yang >15 menit di 'processing' di-reset ke 'pending'
 *   - Tidak bergantung pada runtime Next.js / Vercel lifecycle
 */

import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient } from "jsr:@supabase/supabase-js@2"
import pLimit from "npm:p-limit"
import {
  fetchWebhookQueueBatch,
  markAsDone,
  markAsDead,
  retryWebhookQueue,
  recoverStuckWebhookQueue,
  isRetryableError,
} from "./queue-manager.ts"
import { processWooOrder } from "./processor.ts"

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
)

// Proses max 5 item secara concurrent (sesuai dengan process-message-queue)
const limit = pLimit(5)

Deno.serve(async () => {
  try {
    console.log("[process-webhook-queue] START")

    // Stuck recovery terlebih dahulu (item processing > 15 menit → reset ke pending)
    await recoverStuckWebhookQueue(supabase)

    // Ambil batch pending secara atomic (fetch + set 'processing' dalam 1 query)
    const items = await fetchWebhookQueueBatch(supabase, 20)

    if (!items || items.length === 0) {
      console.log("[process-webhook-queue] No items to process")
      return Response.json({ success: true, message: "No items to process" })
    }

    console.log(`[process-webhook-queue] Processing ${items.length} items`)

    // Proses secara concurrent dengan concurrency limit
    await Promise.all(
      items.map((item: any) => limit(() => processItem(item)))
    )

    return Response.json({
      success: true,
      processed: items.length,
    })

  } catch (err) {
    console.error("[process-webhook-queue] Worker failure:", err)
    return Response.json(
      { success: false, error: String(err) },
      { status: 500 }
    )
  }
})

async function processItem(item: any) {
  const { id, business_id, payload, retry_count } = item

  try {
    console.log(`[process-webhook-queue] Processing item ${id} (order #${payload?.number || payload?.id})`)

    await processWooOrder(supabase, business_id, payload)

    await markAsDone(supabase, id)
    console.log(`[process-webhook-queue] Done: item ${id}`)

  } catch (err) {
    console.error(`[process-webhook-queue] Failed: item ${id}`, err)

    const retryable = isRetryableError(err)
    const maxRetries = 3

    if (!retryable || retry_count + 1 >= maxRetries) {
      await markAsDead(supabase, id, err)
      console.error(`[process-webhook-queue] Dead letter: item ${id} after ${retry_count + 1} attempts`)
      return
    }

    await retryWebhookQueue(supabase, item, err)
    console.log(`[process-webhook-queue] Retrying: item ${id} (attempt ${retry_count + 1}/${maxRetries})`)
  }
}
