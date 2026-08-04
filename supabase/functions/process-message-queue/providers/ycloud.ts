import { QueueItem, SendResult } from "./types.ts"

/**
 * Fetch YCloud configuration for a specific business
 */
export async function getBusinessYcloudConfig(supabase: any, businessId?: string) {
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

/**
 * Safely extract string media URL from various potential payload shapes
 */

function extractMediaUrl(candidates: any[]): string {
  for (const item of candidates) {
    if (!item) continue
    if (typeof item === 'string' && item.trim()) {
      return item.trim()
    }
    if (typeof item === 'object') {
      const link = item.link || item.url || item.media_url || item.header_media_url || item.header_url || item.header_image_url || item.value
      if (typeof link === 'string' && link.trim()) {
        return link.trim()
      }
    }
  }
  return ''
}

/**
 * Format recipient and sender phone numbers in E.164 format (+62...)
 */
function formatE164(phone: string): string {
  let cleaned = String(phone || '').replace(/[^\d+]/g, '')
  if (cleaned.startsWith('0')) {
    cleaned = '62' + cleaned.slice(1)
  }
  if (!cleaned.startsWith('+') && cleaned.length > 0) {
    cleaned = '+' + cleaned
  }
  return cleaned
}

/**
 * Driver implementation for YCloud WhatsApp sending
 */
export async function sendYcloud(queue: QueueItem, supabase: any): Promise<SendResult> {
  const payload = queue.payload || {}

  if (!queue.business_id) {
    throw new Error("YCLOUD_BUSINESS_ID_MISSING_IN_QUEUE_ITEM")
  }

  // Strictly fetch YCloud credentials belonging to this queue item's business_id
  const bizConfig = await getBusinessYcloudConfig(supabase, queue.business_id)

  if (!bizConfig || !bizConfig.apiKey || !bizConfig.apiKey.trim()) {
    throw new Error(`YCLOUD_INTEGRATION_NOT_CONFIGURED_FOR_BUSINESS_${queue.business_id}`)
  }

  const apiKey = bizConfig.apiKey.trim()
  const channelId = bizConfig.whatsappNumber ? bizConfig.whatsappNumber.trim() : ""

  // Fallback / Supplementary: Fetch scenario config if queue payload lacks details
  let scenarioConfig: any = null
  if (queue.scenario_id) {
    try {
      const { data: scData } = await supabase
        .from("marketing_scenarios")
        .select("trigger_config, template_vars, template_name")
        .eq("id", queue.scenario_id)
        .maybeSingle()
      if (scData) {
        scenarioConfig = {
          ...(scData.trigger_config || {}),
          ...(typeof scData.template_vars === 'object' && scData.template_vars !== null && !Array.isArray(scData.template_vars) ? scData.template_vars : {}),
          template_name: scData.template_name
        }
      }
    } catch (err) {
      console.error(`Failed to fetch scenario config for queue ${queue.id}:`, err)
    }
  }

  const templateObj = (typeof payload.template_vars === 'object' && payload.template_vars !== null && !Array.isArray(payload.template_vars))
    ? payload.template_vars
    : (scenarioConfig || {})

  // 1. Resolve raw header format
  const rawHeaderFormat = 
    payload.header_format ||
    payload.headerFormat ||
    payload.header_type ||
    payload.headerType ||
    (payload.header && (payload.header.format || payload.header.type)) ||
    (payload.trigger_config && payload.trigger_config.header_format) ||
    templateObj.header_format ||
    (scenarioConfig && scenarioConfig.header_format) ||
    (scenarioConfig && scenarioConfig.trigger_config && scenarioConfig.trigger_config.header_format) ||
    ''

  let headerFormat = String(rawHeaderFormat).toUpperCase().trim()

  // 2. Resolve media URL
  const mediaUrl = extractMediaUrl([
    payload.header_media_url,
    payload.header_url,
    payload.header_image_url,
    payload.media_url,
    payload.header && (payload.header.media_url || payload.header.url || payload.header.link),
    payload.trigger_config && payload.trigger_config.header_media_url,
    templateObj.header_media_url,
    templateObj.header_url,
    scenarioConfig && scenarioConfig.header_media_url,
    scenarioConfig && scenarioConfig.header_url,
    scenarioConfig && scenarioConfig.trigger_config && scenarioConfig.trigger_config.header_media_url
  ])

  // If headerFormat is empty or NONE but mediaUrl exists, infer IMAGE header
  if ((!headerFormat || headerFormat === 'NONE') && mediaUrl) {
    headerFormat = 'IMAGE'
  }

  const components: any[] = []

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
      if (!mediaUrl) {
        throw new Error(`HEADER_IMAGE_URL_MISSING: Template expects IMAGE header but image URL is missing in queue ${queue.id}`)
      }
      components.push({
        type: "header",
        parameters: [
          {
            type: "image",
            image: {
              link: mediaUrl,
            },
          },
        ],
      })
    } else if (headerFormat === 'DOCUMENT') {
      if (!mediaUrl) {
        throw new Error(`HEADER_DOCUMENT_URL_MISSING: Template expects DOCUMENT header but document URL is missing in queue ${queue.id}`)
      }
      const docObj: Record<string, string> = { link: mediaUrl }
      const filename = payload.header_filename || templateObj.header_filename || (scenarioConfig && scenarioConfig.header_filename)
      if (filename && typeof filename === 'string' && filename.trim()) {
        docObj.filename = filename.trim()
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
    } else if (headerFormat === 'VIDEO') {
      if (!mediaUrl) {
        throw new Error(`HEADER_VIDEO_URL_MISSING: Template expects VIDEO header but video URL is missing in queue ${queue.id}`)
      }
      components.push({
        type: "header",
        parameters: [
          {
            type: "video",
            video: {
              link: mediaUrl,
            },
          },
        ],
      })
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

  const recipientPhone = formatE164(queue.recipient)
  const templateName = payload.template_name || (scenarioConfig && scenarioConfig.template_name)

  if (!templateName) {
    throw new Error("TEMPLATE_NAME_MISSING_IN_QUEUE_ITEM")
  }

  const reqBody: Record<string, any> = {
    to: recipientPhone,
    type: "template",
    template: {
      name: templateName,
      language: {
        code: payload.language_code || "id",
      },
      components: components,
    },
  }

  if (channelId) {
    reqBody.from = formatE164(channelId)
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
      (result?.error ? JSON.stringify(result.error) : `YCLOUD_ERROR_${response.status}`)

    throw new Error(errorMessage)
  }

  return result
}
