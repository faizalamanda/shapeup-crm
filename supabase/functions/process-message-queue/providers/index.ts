import { QueueItem, SendResult } from "./types.ts"
import { sendYcloud } from "./ycloud.ts"

/**
 * Dispatch message queue item to appropriate provider driver based on payload.platform
 */
export async function dispatchMessage(queue: QueueItem, supabase: any): Promise<SendResult> {
  const payload = queue.payload || {}
  const platform = String(payload.platform || 'YCLOUD').toUpperCase().trim()

  switch (platform) {
    case "YCLOUD":
      return await sendYcloud(queue, supabase)
    default:
      throw new Error(`UNSUPPORTED_PLATFORM_${platform}`)
  }
}
