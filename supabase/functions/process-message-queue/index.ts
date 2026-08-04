import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient } from "jsr:@supabase/supabase-js@2"
import pLimit from "npm:p-limit"
import { dispatchMessage } from "./providers/index.ts"
import {
  fetchQueueBatch,
  markAsSent,
  markAsDead,
  retryQueue,
  recoverStuckQueue,
  isRetryableError,
} from "./queue-manager.ts"

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
)

const limit = pLimit(5)

Deno.serve(async () => {
  try {
    console.log("PROCESS MARKETING QUEUE START")

    // 1. Recover stuck items
    await recoverStuckQueue(supabase)

    // 2. Fetch batch
    const queues = await fetchQueueBatch(supabase, 20)

    if (!queues || queues.length === 0) {
      return Response.json({
        success: true,
        message: "No queue to process",
      })
    }

    console.log(`PROCESSING ${queues.length} QUEUES`)

    // 3. Process items concurrently using provider dispatcher
    await Promise.all(
      queues.map((queue: any) => limit(() => processQueue(queue)))
    )

    return Response.json({
      success: true,
      processed: queues.length,
    })
  } catch (err) {
    console.error("Queue Worker Failure:", err)
    return Response.json(
      {
        success: false,
        error: String(err),
      },
      { status: 500 }
    )
  }
})

async function processQueue(queue: any) {
  try {
    console.log(`PROCESS QUEUE ${queue.id}`)

    // Send message via provider dispatcher (e.g. YCLOUD)
    const response = await dispatchMessage(queue, supabase)

    // Mark as sent on success
    await markAsSent(supabase, queue.id, response)

    console.log(`QUEUE SENT ${queue.id}`)
  } catch (err) {
    console.error(`QUEUE FAILED ${queue.id}`, err)

    const retryable = isRetryableError(err)

    if (!retryable || queue.retry_count + 1 >= 3) {
      await markAsDead(supabase, queue.id, err)
      return
    }

    await retryQueue(supabase, queue, err)
  }
}
