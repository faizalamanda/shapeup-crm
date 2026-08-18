import { createClient as createAdminClient } from '@supabase/supabase-js'

export const META_GRAPH_API_VERSION = 'v20.0'

export interface WabaConfig {
  access_token: string
  phone_number_id: string
  waba_id?: string
  webhook_verify_token?: string
  is_active: boolean
}

function getAdminSupabase() {
  return createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

/**
 * Format phone number to WhatsApp E.164 format without plus sign (e.g. 628123456789)
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
 * Fetch business WABA configuration from database
 */
export async function getWabaConfig(businessId: string): Promise<WabaConfig | null> {
  if (!businessId) return null

  const admin = getAdminSupabase()
  const { data: rows, error } = await admin
    .from('integrations')
    .select('*')
    .eq('platform_name', 'waba_official')
    .filter('api_credentials->>business_id', 'eq', businessId)

  if (error || !rows || rows.length === 0) {
    return null
  }

  const integration = rows[0]
  const creds = integration.api_credentials || {}

  return {
    access_token: (creds.access_token || '').replace(/\r?\n|\r/g, '').trim(),
    phone_number_id: (creds.phone_number_id || '').trim(),
    waba_id: (creds.waba_id || '').trim(),
    webhook_verify_token: (creds.webhook_verify_token || '').trim(),
    is_active: Boolean(integration.is_active),
  }
}

/**
 * Test Meta Graph API WABA credentials
 */
export async function testWabaConnection(accessToken: string, phoneNumberId: string) {
  if (!accessToken || !phoneNumberId) {
    throw new Error('Access Token dan Phone Number ID wajib diisi.')
  }

  const url = `https://graph.facebook.com/${META_GRAPH_API_VERSION}/${phoneNumberId}`

  const res = await fetch(url, {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${accessToken.trim()}`,
      'Content-Type': 'application/json',
    },
  })

  const json = await res.json()

  if (!res.ok || json.error) {
    const errorMsg = json.error?.message || 'Gagal terhubung ke Meta Graph API.'
    throw new Error(`Meta API Error (${res.status}): ${errorMsg}`)
  }

  return {
    success: true,
    display_phone_number: json.display_phone_number || json.id || phoneNumberId,
    verified_name: json.verified_name || json.name || 'WABA Account',
  }
}

/**
 * Send outbound WhatsApp text message via WABA Official Graph API
 */
export async function sendWabaTextMessage(params: {
  businessId: string
  to: string
  text: string
  conversationId?: string
}) {
  const { businessId, to, text, conversationId } = params

  const config = await getWabaConfig(businessId)
  if (!config) {
    throw new Error('Integrasi WABA Official belum dikonfigurasi untuk bisnis ini.')
  }

  if (!config.is_active) {
    throw new Error('Integrasi WABA Official sedang dinonaktifkan dalam Pengaturan.')
  }

  if (!config.access_token || !config.phone_number_id) {
    throw new Error('Access Token atau Phone Number ID WABA belum diisi.')
  }

  const recipientPhone = formatPhoneNumber(to)
  const url = `https://graph.facebook.com/${META_GRAPH_API_VERSION}/${config.phone_number_id}/messages`

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
      'Authorization': `Bearer ${config.access_token.trim()}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  })

  const json = await res.json()

  if (!res.ok || json.error) {
    const errorMsg = json.error?.message || 'Gagal mengirim pesan WhatsApp.'
    
    // Log failed message in DB if conversation ID exists
    if (conversationId) {
      const admin = getAdminSupabase()
      await admin.from('waba_messages').insert({
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

    throw new Error(`Meta Send Error: ${errorMsg}`)
  }

  const wamid = json.messages?.[0]?.id || null

  const admin = getAdminSupabase()

  // Find or create conversation if conversationId not passed
  let convId = conversationId
  if (!convId) {
    // Check existing conversation by wa_id
    const { data: conv } = await admin
      .from('waba_conversations')
      .select('id')
      .eq('business_id', businessId)
      .eq('wa_id', recipientPhone)
      .maybeSingle()

    if (conv) {
      convId = conv.id
    } else {
      // Find or create customer
      const { data: cust } = await admin
        .from('customers')
        .select('id, name')
        .eq('business_id', businessId)
        .eq('phone', recipientPhone)
        .maybeSingle()

      const { data: newConv } = await admin
        .from('waba_conversations')
        .insert({
          business_id: businessId,
          customer_id: cust?.id || null,
          wa_id: recipientPhone,
          contact_name: cust?.name || recipientPhone,
          last_message_text: text,
          last_message_at: new Date().toISOString(),
          unread_count: 0,
        })
        .select('id')
        .single()

      if (newConv) convId = newConv.id
    }
  }

  // Insert message into waba_messages
  if (convId) {
    await admin.from('waba_messages').insert({
      business_id: businessId,
      conversation_id: convId,
      wamid: wamid,
      direction: 'outgoing',
      sender_phone: config.phone_number_id,
      recipient_phone: recipientPhone,
      message_type: 'text',
      text_body: text,
      status: 'sent',
      raw_payload: json,
    })

    // Update conversation last message
    await admin.from('waba_conversations').update({
      last_message_text: text,
      last_message_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }).eq('id', convId)
  }

  return {
    success: true,
    wamid: wamid,
    conversation_id: convId,
    recipient_phone: recipientPhone,
  }
}
