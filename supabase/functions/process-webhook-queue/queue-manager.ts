/**
 * Queue Manager untuk process-webhook-queue Edge Function
 * Mengikuti pattern yang sama dengan process-message-queue/queue-manager.ts
 */

/**
 * Fetch batch pending items + set status 'processing' secara atomic via RPC.
 * Menggunakan FOR UPDATE SKIP LOCKED untuk mencegah double-processing.
 */
export async function fetchWebhookQueueBatch(supabase: any, batchSize = 20) {
  const { data, error } = await supabase.rpc("fetch_webhook_queue_batch", {
    batch_size: batchSize,
  })

  if (error) throw error
  return data || []
}

/**
 * Mark item sebagai 'done' setelah berhasil diproses
 */
export async function markAsDone(supabase: any, id: string) {
  const { error } = await supabase
    .from("webhook_ingest_queue")
    .update({
      status: "done",
      done_at: new Date().toISOString(),
      processing_at: null,
      error_log: null,
    })
    .eq("id", id)

  if (error) throw error
}

/**
 * Mark item sebagai 'dead' (permanent failure, tidak akan di-retry)
 */
export async function markAsDead(supabase: any, id: string, err: any) {
  await supabase
    .from("webhook_ingest_queue")
    .update({
      status: "dead",
      processing_at: null,
      error_log: String(err),
    })
    .eq("id", id)
}

/**
 * Retry item dengan exponential backoff: 1 menit, 5 menit, 30 menit
 */
export async function retryWebhookQueue(supabase: any, item: any, err: any) {
  await supabase
    .from("webhook_ingest_queue")
    .update({
      status: "pending",
      retry_count: item.retry_count + 1,
      scheduled_at: nextRetryTime(item.retry_count),
      processing_at: null,
      error_log: String(err),
    })
    .eq("id", item.id)
}

/**
 * Recover item yang stuck di 'processing' lebih dari 15 menit.
 * Reset ke 'pending' agar bisa di-retry di run berikutnya.
 */
export async function recoverStuckWebhookQueue(supabase: any) {
  const timeout = new Date(Date.now() - 15 * 60 * 1000).toISOString()

  const { data: stuckItems } = await supabase
    .from("webhook_ingest_queue")
    .select("id")
    .eq("status", "processing")
    .lt("processing_at", timeout)
    .limit(1)

  if (!stuckItems || stuckItems.length === 0) return

  await supabase
    .from("webhook_ingest_queue")
    .update({
      status: "pending",
      processing_at: null,
      error_log: "Recovered from stuck processing state (timeout > 15 min)",
    })
    .eq("status", "processing")
    .lt("processing_at", timeout)
}

/**
 * Hitung waktu retry berikutnya dengan backoff:
 * attempt 0 → 1 menit, attempt 1 → 5 menit, attempt 2 → 30 menit
 */
export function nextRetryTime(retryCount: number): string {
  const retryMinutes = [1, 5, 30]
  const delay = retryMinutes[retryCount] ?? 60
  return new Date(Date.now() + delay * 60 * 1000).toISOString()
}

/**
 * Klasifikasi error yang bisa di-retry (transient) vs permanent
 */
export function isRetryableError(err: any): boolean {
  const retryablePatterns = [
    "TIMEOUT", "NETWORK_ERROR", "RATE_LIMIT",
    "502", "503", "504",
    "ETIMEDOUT", "ECONNRESET", "ECONNREFUSED",
    "fetch failed", "connection refused",
  ]

  const msg = String(err).toUpperCase()
  return retryablePatterns.some((pattern) => msg.includes(pattern.toUpperCase()))
}
