import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient } from "jsr:@supabase/supabase-js@2"
import pLimit from "npm:p-limit"

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
)

const limit = pLimit(5)

Deno.serve(async () => {
  try {
    console.log("PROCESS MARKETING QUEUE START")

    // ====================================
    // RECOVER STUCK PROCESSING
    // ====================================
    await recoverStuckQueue()

    // ====================================
    // FETCH BATCH
    // ====================================
    const { data: queues, error } = await supabase.rpc(
      "fetch_marketing_queue_batch",
      {
        batch_size: 20,
      }
    )

    if (error) {
      throw error
    }

    if (!queues || queues.length === 0) {
      return Response.json({
        success: true,
        message: "No queue to process",
      })
    }

    console.log(`PROCESSING ${queues.length} QUEUES`)

    // ====================================
    // PROCESS CONCURRENTLY
    // ====================================
    await Promise.all(
      queues.map((queue: any) =>
        limit(() => processQueue(queue))
      )
    )

    return Response.json({
      success: true,
      processed: queues.length,
    })
  } catch (err) {
    console.error(err)
    return Response.json(
      {
        success: false,
        error: String(err),
      },
      {
        status: 500,
      }
    )
  }
})

// ====================================
// PROCESS SINGLE QUEUE
// ====================================
async function processQueue(queue: any) {
  try {
    console.log(`PROCESS QUEUE ${queue.id}`)

    // ====================================
    // SEND WHATSAPP
    // ====================================
    const response = await sendWhatsapp(queue)

    // ====================================
    // MARK SENT
    // ====================================
    await markAsSent(queue.id, response)

    console.log(`QUEUE SENT ${queue.id}`)
  } catch (err) {
    console.error(`QUEUE FAILED ${queue.id}`, err)

    const retryable = isRetryableError(err)

    // ====================================
    // DEAD
    // ====================================
    if (!retryable) {
      await markAsDead(queue.id, err)
      return
    }

    // ====================================
    // MAX RETRY
    // ====================================
    if (queue.retry_count + 1 >= 3) {
      await markAsDead(queue.id, err)
      return
    }

    // ====================================
    // RETRY
    // ====================================
    await retryQueue(queue, err)
  }
}

// ====================================
// SEND WHATSAPP ROUTER
// ====================================
async function sendWhatsapp(queue: any) {
  const payload = queue.payload
  const platform = payload.platform

  switch (platform) {
    case "YCLOUD":
      return await sendYcloud(queue)
    default:
      throw new Error(`UNSUPPORTED_PLATFORM_${platform}`)
  }
}

// ====================================
// FETCH STRICT BUSINESS YCLOUD CONFIG
// ====================================
async function getBusinessYcloudConfig(businessId?: string) {
  if (!businessId) return null
  try {
    const { data, error } = await supabase
      .from("integrations")
      .select("api_credentials, is_active")
      .eq("platform_name", "ycloud")
      .filter("api_credentials->>business_id", "eq", businessId)
      .maybeSingle()

    if (error || !data || !data.is_active) return null

    return {
      apiKey: data.api_credentials?.api_key || "",
      whatsappNumber: data.api_credentials?.whatsapp_number || "",
    }
  } catch (err) {
    console.error(`Failed to fetch YCloud config for business ${businessId}:`, err)
    return null
  }
}

// ====================================
// YCLOUD SEND TEMPLATE (STRICT MULTI-TENANT)
// ====================================
async function sendYcloud(queue: any) {
  const payload = queue.payload

  if (!queue.business_id) {
    throw new Error("YCLOUD_BUSINESS_ID_MISSING_IN_QUEUE_ITEM")
  }

  // Strictly fetch YCloud credentials belonging to this queue item's business_id
  const bizConfig = await getBusinessYcloudConfig(queue.business_id)

  if (!bizConfig || !bizConfig.apiKey || !bizConfig.apiKey.trim()) {
    throw new Error(`YCLOUD_INTEGRATION_NOT_CONFIGURED_FOR_BUSINESS_${queue.business_id}`)
  }

  const apiKey = bizConfig.apiKey.trim()
  const channelId = bizConfig.whatsappNumber ? bizConfig.whatsappNumber.trim() : ""

  // Fallback: Fetch scenario config if queue payload lacks header format
  let scenarioConfig: any = null
  if (queue.scenario_id) {
    try {
      const { data: scData } = await supabase
        .from("marketing_scenarios")
        .select("trigger_config, template_vars")
        .eq("id", queue.scenario_id)
        .maybeSingle()
      if (scData) {
        scenarioConfig = {
          ...(scData.trigger_config || {}),
          ...(typeof scData.template_vars === 'object' && scData.template_vars !== null && !Array.isArray(scData.template_vars) ? scData.template_vars : {})
        }
      }
    } catch (err) {
      console.error(`Failed to fetch scenario config for queue ${queue.id}:`, err)
    }
  }

  const templateObj = (typeof payload.template_vars === 'object' && payload.template_vars !== null && !Array.isArray(payload.template_vars))
    ? payload.template_vars
    : (scenarioConfig || {})

  const components: any[] = []

  // Check header format from payload, template_vars object, or scenarioConfig
  const rawHeaderFormat = payload.header_format || templateObj.header_format || (scenarioConfig && scenarioConfig.header_format) || ''
  const headerFormat = String(rawHeaderFormat).toUpperCase()

  if (headerFormat && headerFormat !== 'NONE') {
    if (headerFormat === 'TEXT') {
      const headerParams = payload.header_params || payload.header_vars || templateObj.header_vars || (scenarioConfig && scenarioConfig.header_vars) || []
      if (Array.isArray(headerParams) && headerParams.length > 0) {
        components.push({
          type: "header",
          parameters: headerParams.map((value: any) => ({
            type: "text",
            text: String(typeof value === 'object' && value !== null ? value.value || '' : value),
          })),
        })
      } else if (payload.header_text || templateObj.header_text || (scenarioConfig && scenarioConfig.header_text)) {
        components.push({
          type: "header",
          parameters: [
            {
              type: "text",
              text: String(payload.header_text || templateObj.header_text || scenarioConfig.header_text),
            },
          ],
        })
      }
    } else if (headerFormat === 'IMAGE') {
      const mediaUrl = payload.header_media_url || payload.header_url || payload.header_image_url || templateObj.header_media_url || templateObj.header_url || (scenarioConfig && scenarioConfig.header_media_url)
      if (mediaUrl) {
        components.push({
          type: "header",
          parameters: [
            {
              type: "image",
              image: {
                link: String(mediaUrl).trim(),
              },
            },
          ],
        })
      }
    } else if (headerFormat === 'DOCUMENT') {
      const mediaUrl = payload.header_media_url || payload.header_url || payload.header_document_url || templateObj.header_media_url || templateObj.header_url || (scenarioConfig && scenarioConfig.header_media_url)
      const filename = payload.header_filename || templateObj.header_filename || (scenarioConfig && scenarioConfig.header_filename)
      if (mediaUrl) {
        const docObj: Record<string, string> = {
          link: String(mediaUrl).trim(),
        }
        if (filename) {
          docObj.filename = String(filename).trim()
        }
        components.push({
          type: "header",
          parameters: [
            {
              type: "document",
              document: docObj,
            },
          ],
        })
      }
    } else if (headerFormat === 'VIDEO') {
      const mediaUrl = payload.header_media_url || payload.header_url || payload.header_video_url || templateObj.header_media_url || templateObj.header_url || (scenarioConfig && scenarioConfig.header_media_url)
      if (mediaUrl) {
        components.push({
          type: "header",
          parameters: [
            {
              type: "video",
              video: {
                link: String(mediaUrl).trim(),
              },
            },
          ],
        })
      }
    }
  }

  // Extract body parameters
  const rawBodyParams = payload.template_params || (Array.isArray(payload.template_vars) ? payload.template_vars : templateObj.body_vars || templateObj.vars) || []
  const bodyParams = Array.isArray(rawBodyParams) ? rawBodyParams : []

  // Always include body component
  components.push({
    type: "body",
    parameters: bodyParams.map((value: any) => ({
      type: "text",
      text: String(typeof value === 'object' && value !== null ? value.value || '' : value),
    })),
  })

  const reqBody: Record<string, any> = {
    to: queue.recipient,
    type: "template",
    template: {
      name: payload.template_name,
      language: {
        code: payload.language_code || "id",
      },
      components: components,
    },
  }

  // Gunakan nomor WhatsApp pengirim yang disetting di pengaturann integrasi unit bisnis tersebut
  if (channelId) {
    reqBody.from = channelId
  }

  const response = await fetch("https://api.ycloud.com/v2/whatsapp/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-API-Key": apiKey,
    },
    body: JSON.stringify(reqBody),
  })

  const result = await response.json()

  if (!response.ok) {
    const errorMessage =
      result?.error?.message ||
      result?.message ||
      `YCLOUD_ERROR_${response.status}`

    throw new Error(errorMessage)
  }

  return result
}

// ====================================
// MARK AS SENT
// ====================================
async function markAsSent(id: string, response: any) {
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

  // Catat riwayat pengiriman ke marketing_logs
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

// ====================================
// RETRY QUEUE
// ====================================
async function retryQueue(queue: any, err: any) {
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

// ====================================
// MARK DEAD
// ====================================
async function markAsDead(id: string, err: any) {
  await supabase
    .from("marketing_queue")
    .update({
      status: "dead",
      processing_at: null,
      error_log: String(err),
    })
    .eq("id", id)
}

// ====================================
// RECOVER STUCK QUEUE
// ====================================
async function recoverStuckQueue() {
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

// ====================================
// RETRY BACKOFF
// ====================================
function nextRetryTime(retryCount: number) {
  const retryMinutes = [1, 5, 30]

  const delay = retryMinutes[retryCount] || 60

  return new Date(Date.now() + delay * 60 * 1000).toISOString()
}

// ====================================
// ERROR CLASSIFICATION
// ====================================
function isRetryableError(err: any) {
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
