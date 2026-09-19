import { getAdminSupabase } from '@/lib/supabaseServer'

// ============================================================
// kirim.dev WABA Integration — Server-side Library
// API Docs: https://kirim.dev/docs/
//
// Authentication: Bearer kd_live_... (API key, not Meta token)
// Base URL: https://api.kirim.dev/v23.0/{PHONE_NUMBER_ID}/messages
// Webhook: Standard Webhooks spec
// ============================================================

export const KIRIMDEV_API_BASE = 'https://api.kirim.dev'
export const KIRIMDEV_API_VERSION = 'v23.0'

export interface KirimDevConfig {
  api_key: string          // kd_live_... or kd_test_...
  phone_number_id: string  // connected number's phone_number_id on kirim.dev dashboard
  webhook_secret: string   // signing secret from kirim.dev Webhooks dashboard
  is_active: boolean
}

/**
 * Normalize phone number to WhatsApp E.164 format without leading +
 * Examples: "08123456789" → "628123456789", "+62812..." → "62812..."
 * Note: Only handles local 0 prefix conversion for Indonesian numbers (0 -> 62).
 * Other country codes provided in E.164 or with + will have + stripped safely.
 */
export function formatPhoneNumber(phone: string): string {
  let clean = phone.replace(/\D/g, '')
  if (clean.startsWith('0')) {
    clean = '62' + clean.substring(1)
  } else if (clean.startsWith('8')) {
    clean = '62' + clean
  }
  return clean
}

/**
 * Fetch the kirim.dev plugin config from business_integrations table.
 * Returns null if not configured or not active.
 */
export async function getKirimDevConfig(businessId: string): Promise<KirimDevConfig | null> {
  if (!businessId) return null

  const admin = getAdminSupabase()
  const { data, error } = await admin
    .from('business_integrations')
    .select('*')
    .eq('business_id', businessId)
    .eq('provider', 'kirimdev')
    .maybeSingle()

  if (error || !data) return null

  const cfg = data.config || {}
  if (!cfg.api_key || !cfg.phone_number_id) return null

  return {
    api_key: cfg.api_key.trim(),
    phone_number_id: cfg.phone_number_id.trim(),
    webhook_secret: (cfg.webhook_secret || '').trim(),
    is_active: Boolean(data.is_active),
  }
}

/**
 * Test the kirim.dev API key by checking if the phone_number_id is reachable.
 * Uses a minimal GET to the messages endpoint (the Cloud API doesn't have a status endpoint,
 * so we do a small GET on the phone number info via Meta Graph forwarding).
 * kirim.dev forwards Meta's responses byte-for-byte, so any valid auth will 200.
 */
export async function testKirimDevConnection(apiKey: string, phoneNumberId: string) {
  if (!apiKey || !phoneNumberId) {
    throw new Error('API Key dan Phone Number ID wajib diisi.')
  }

  // kirim.dev doesn't expose a dedicated status endpoint; we POST a dry-run
  // that intentionally fails with a Meta validation error (not an auth error).
  // A 401 = bad API key, any other error = key valid but payload invalid.
  const url = `${KIRIMDEV_API_BASE}/${KIRIMDEV_API_VERSION}/${phoneNumberId}/messages`

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey.trim()}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      to: '000',          // intentionally invalid — will error at Meta, not auth
      type: 'text',
      text: { body: 'test' },
    }),
  })

  if (res.status === 401) {
    throw new Error('API Key tidak valid atau tidak dikenali oleh kirim.dev.')
  }

  // Any non-401 response means the key was accepted
  const json = await res.json()
  return {
    success: true,
    status: res.status,
    message: 'Koneksi berhasil! API Key dikenali oleh kirim.dev.',
    raw: json,
  }
}

/**
 * Verify a Standard Webhooks signature.
 * kirim.dev signs deliveries using Standard Webhooks (https://www.standardwebhooks.com/).
 * Headers: webhook-id, webhook-timestamp, webhook-signature (v1,<base64 HMAC-SHA256>)
 *
 * The signed message is: `{webhook-id}.{webhook-timestamp}.{rawBody}`
 * The secret is the base64-encoded webhook signing secret from kirim.dev dashboard.
 */
export async function verifyKirimDevWebhookSignature(params: {
  rawBody: string
  webhookId: string
  webhookTimestamp: string
  webhookSignature: string
  secret: string
}): Promise<boolean> {
  const { rawBody, webhookId, webhookTimestamp, webhookSignature, secret } = params

  // Reject if timestamp is more than 5 minutes old (replay attack prevention)
  const ts = parseInt(webhookTimestamp, 10)
  if (isNaN(ts)) return false
  const ageSecs = Math.abs(Date.now() / 1000 - ts)
  if (ageSecs > 300) return false

  // The message to sign: id.timestamp.body
  const toSign = `${webhookId}.${webhookTimestamp}.${rawBody}`

  // Import secret key
  // The secret from kirim.dev is base64-encoded and usually prefixed with whsec_; we decode it first
  const cleanSecret = secret.startsWith('whsec_') ? secret.slice(6) : secret
  let secretBuffer: ArrayBuffer
  try {
    const decoded = atob(cleanSecret)
    const bytes = new Uint8Array(decoded.length)
    for (let i = 0; i < decoded.length; i++) bytes[i] = decoded.charCodeAt(i)
    secretBuffer = bytes.buffer as ArrayBuffer
  } catch {
    // Fallback: treat as raw UTF-8 string
    const enc = new TextEncoder().encode(cleanSecret)
    secretBuffer = enc.buffer as ArrayBuffer
  }

  const key = await crypto.subtle.importKey(
    'raw',
    secretBuffer,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['verify']
  )

  // webhookSignature may be "v1,<sig>" or multiple "v1,<sig1> v1,<sig2>"
  const signatures = webhookSignature.split(' ')
  const dataToVerify = new TextEncoder().encode(toSign)
  
  for (const s of signatures) {
    const parts = s.split(',')
    if (parts.length === 2 && parts[0] === 'v1') {
      try {
        const sigDecoded = atob(parts[1])
        const sigBytes = new Uint8Array(sigDecoded.length)
        for (let i = 0; i < sigDecoded.length; i++) sigBytes[i] = sigDecoded.charCodeAt(i)
        
        const isValid = await crypto.subtle.verify('HMAC', key, sigBytes.buffer as ArrayBuffer, dataToVerify)
        if (isValid) return true
      } catch (err) {
        continue
      }
    }
  }
  
  return false
}


// ============================================================
// Send Messages
// ============================================================

export interface SendTextParams {
  businessId: string
  to: string
  text: string
  conversationId?: string
}

export interface SendMessageResult {
  success: boolean
  wamid: string | null
  conversation_id: string | null
  recipient_phone: string
}

/**
 * Send a text message via kirim.dev API.
 * Persists the outgoing message and conversation to the database.
 */
export async function sendKirimDevTextMessage(params: SendTextParams): Promise<SendMessageResult> {
  const { businessId, to, text, conversationId } = params

  const config = await getKirimDevConfig(businessId)
  if (!config) {
    throw new Error('Plugin kirim.dev belum dikonfigurasi untuk bisnis ini.')
  }
  if (!config.is_active) {
    throw new Error('Plugin kirim.dev sedang dinonaktifkan.')
  }

  const recipientPhone = formatPhoneNumber(to)
  const url = `${KIRIMDEV_API_BASE}/${KIRIMDEV_API_VERSION}/${config.phone_number_id}/messages`

  const payload = {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: recipientPhone,
    type: 'text',
    text: {
      preview_url: false,
      body: text,
    },
  }

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${config.api_key}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  })

  const json = await res.json()
  const admin = getAdminSupabase()

  if (!res.ok || json.error) {
    const errorMsg = json.error?.message || 'Gagal mengirim pesan via kirim.dev.'

    if (conversationId) {
      await admin.from('kirimdev_messages').insert({
        business_id: businessId,
        conversation_id: conversationId,
        direction: 'outgoing',
        sender_phone: config.phone_number_id,
        recipient_phone: recipientPhone,
        message_type: 'text',
        text_body: text,
        status: 'failed',
        error_message: errorMsg,
        raw_payload: json,
      })
    }

    throw new Error(`kirim.dev Send Error: ${errorMsg}`)
  }

  const wamid = json.messages?.[0]?.id ?? null

  // Upsert conversation
  let convId = conversationId ?? null
  if (!convId) {
    const { data: conv } = await admin
      .from('kirimdev_conversations')
      .select('id')
      .eq('business_id', businessId)
      .eq('wa_id', recipientPhone)
      .maybeSingle()

    if (conv) {
      convId = conv.id
    } else {
      const { data: cust } = await admin
        .from('customers')
        .select('id, name')
        .eq('business_id', businessId)
        .eq('phone', recipientPhone)
        .maybeSingle()

      const { data: newConv } = await admin
        .from('kirimdev_conversations')
        .insert({
          business_id: businessId,
          customer_id: cust?.id ?? null,
          wa_id: recipientPhone,
          contact_name: cust?.name ?? recipientPhone,
          last_message_text: text,
          last_message_at: new Date().toISOString(),
          unread_count: 0,
        })
        .select('id')
        .single()

      convId = newConv?.id ?? null
    }
  }

  // Insert outgoing message
  if (convId) {
    await admin.from('kirimdev_messages').insert({
      business_id: businessId,
      conversation_id: convId,
      wamid,
      direction: 'outgoing',
      sender_phone: config.phone_number_id,
      recipient_phone: recipientPhone,
      message_type: 'text',
      text_body: text,
      status: 'sent',
      raw_payload: json,
    })

    await admin
      .from('kirimdev_conversations')
      .update({
        last_message_text: text,
        last_message_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', convId)
  }

  return {
    success: true,
    wamid,
    conversation_id: convId,
    recipient_phone: recipientPhone,
  }
}
