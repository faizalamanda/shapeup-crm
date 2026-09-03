/**
 * Fetch batch of pending marketing queue items
 */
export async function fetchQueueBatch(supabase: any, batchSize = 20) {
  const { data, error } = await supabase.rpc("fetch_marketing_queue_batch", {
    batch_size: batchSize,
  })

  if (error) throw error
  return data || []
}

/**
 * Mark queue item as successfully sent
 */
export async function markAsSent(supabase: any, id: string, response: any) {
  await supabase
    .from("marketing_queue")
    .update({
      status: "sent",
      sent_at: new Date().toISOString(),
      provider_response: response,
      processing_at: null,
      error_log: null,
    })
    .eq("id", id)

  // Record history in marketing_logs
  try {
    const { data: queueItem } = await supabase
      .from("marketing_queue")
      .select("scenario_id, order_id, customer_id, recipient, payload")
      .eq("id", id)
      .single()

    if (queueItem) {
      await supabase.from("marketing_logs").insert({
        scenario_id: queueItem.scenario_id,
        order_id: queueItem.order_id,
        customer_id: queueItem.customer_id,
        recipient_phone: queueItem.recipient,
        template_name: queueItem.payload?.template_name || '',
        status: 'sent',
        log_type: 'whatsapp',
        sent_at: new Date().toISOString(),
      })
    }
  } catch (err) {
    console.error(`Failed to insert marketing_logs for queue ${id}:`, err)
  }
}

/**
 * Retry queue item with backoff
 */
export async function retryQueue(supabase: any, queue: any, err: any) {
  await supabase
    .from("marketing_queue")
    .update({
      status: "pending",
      retry_count: queue.retry_count + 1,
      last_retry_at: new Date().toISOString(),
      scheduled_at: nextRetryTime(queue.retry_count),
      processing_at: null,
      error_log: String(err),
    })
    .eq("id", queue.id)
}

/**
 * Mark queue item as dead (permanent failure)
 */
export async function markAsDead(supabase: any, id: string, err: any) {
  await supabase
    .from("marketing_queue")
    .update({
      status: "dead",
      processing_at: null,
      error_log: String(err),
    })
    .eq("id", id)
}

/**
 * Recover stuck processing items (timed out > 15 mins)
 */
export async function recoverStuckQueue(supabase: any) {
  const timeout = new Date(Date.now() - 15 * 60 * 1000).toISOString()

  await supabase
    .from("marketing_queue")
    .update({
      status: "pending",
      processing_at: null,
    })
    .eq("status", "processing")
    .lt("processing_at", timeout)
}

/**
 * Fast check if any stuck items exist using index scan
 */
export async function hasStuckItems(supabase: any) {
  const timeout = new Date(Date.now() - 15 * 60 * 1000).toISOString()
  const { data } = await supabase
    .from("marketing_queue")
    .select("id")
    .eq("status", "processing")
    .lt("processing_at", timeout)
    .limit(1)

  return Boolean(data && data.length > 0)
}

/**
 * Calculate backoff time for retry
 */
export function nextRetryTime(retryCount: number) {
  const retryMinutes = [1, 5, 30]
  const delay = retryMinutes[retryCount] || 60
  return new Date(Date.now() + delay * 60 * 1000).toISOString()
}

/**
 * Classify if an error is temporary / retryable
 */
export function isRetryableError(err: any) {
  const retryableErrors = [
    "TIMEOUT",
    "NETWORK_ERROR",
    "RATE_LIMIT",
    "502",
    "503",
    "504",
    "ETIMEDOUT",
    "ECONNRESET",
  ]

  return retryableErrors.some((code) =>
    String(err).toUpperCase().includes(code)
  )
}
