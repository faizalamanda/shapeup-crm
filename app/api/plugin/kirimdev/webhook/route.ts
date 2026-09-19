import { NextResponse } from 'next/server'
import { getAdminSupabase } from '@/lib/supabaseServer'
import {
  getKirimDevConfig,
  verifyKirimDevWebhookSignature,
  formatPhoneNumber,
} from '@/lib/integrations/kirimdev'
import type { KirimDevWebhookPayload } from '@/plugins/kirim-dev/types'

// ============================================================
// GET /api/plugin/kirimdev/webhook?bid={businessId}
// Health check — returns 200 OK (kirim.dev doesn't require GET verification)
// ============================================================
export async function GET() {
  return NextResponse.json({ ok: true, plugin: 'kirimdev' })
}

// ============================================================
// POST /api/plugin/kirimdev/webhook?bid={businessId}
// Receive webhook events from kirim.dev (Standard Webhooks spec)
// ============================================================
export async function POST(req: Request) {
  const { searchParams } = new URL(req.url)
  const businessId = searchParams.get('bid')

  if (!businessId) {
    return NextResponse.json({ error: 'Missing bid parameter' }, { status: 400 })
  }

  // Read raw body for signature verification
  const rawBody = await req.text()

  // Fetch plugin config to get webhook secret
  const config = await getKirimDevConfig(businessId)

  // Verify signature if webhook_secret is configured
  if (config?.webhook_secret) {
    const webhookId = req.headers.get('webhook-id') ?? ''
    const webhookTimestamp = req.headers.get('webhook-timestamp') ?? ''
    const webhookSignature = req.headers.get('webhook-signature') ?? ''

    if (!webhookId || !webhookTimestamp || !webhookSignature) {
      return NextResponse.json({ error: 'Missing webhook signature headers' }, { status: 401 })
    }

    try {
      const valid = await verifyKirimDevWebhookSignature({
        rawBody,
        webhookId,
        webhookTimestamp,
        webhookSignature,
        secret: config.webhook_secret,
      })

      if (!valid) {
        console.warn(`[kirimdev webhook] Invalid signature for business ${businessId}`)
        return NextResponse.json({ error: 'Invalid webhook signature' }, { status: 401 })
      }
    } catch (err) {
      console.error('[kirimdev webhook] Signature verification error:', err)
      return NextResponse.json({ error: 'Signature verification failed' }, { status: 401 })
    }
  }

  let payload: KirimDevWebhookPayload
  try {
    payload = JSON.parse(rawBody)
  } catch {
    return NextResponse.json({ error: 'Invalid JSON payload' }, { status: 400 })
  }

  // Acknowledge quickly (kirim.dev retries on non-2xx)
  const processPromise = processWebhookPayload(businessId, payload)

  // We don't await to keep response fast, but for Next.js edge/serverless
  // we need to finish. Use a non-blocking approach with error logging.
  try {
    await processPromise
  } catch (err) {
    console.error('[kirimdev webhook] Processing error:', err)
    // Still return 200 to prevent unnecessary retries on data errors
  }

  return NextResponse.json({ ok: true })
}

// ============================================================
// Webhook Processing Logic
// ============================================================
async function processWebhookPayload(businessId: string, payload: KirimDevWebhookPayload) {
  if (payload.object !== 'whatsapp_business_account') return

  const admin = getAdminSupabase()

  for (const entry of payload.entry ?? []) {
    for (const change of entry.changes ?? []) {
      if (change.field !== 'messages') continue

      const value = change.value

      // ---- Handle incoming messages ----
      for (const msg of value.messages ?? []) {
        const senderPhone = formatPhoneNumber(msg.from)
        const contactName =
          value.contacts?.find(c => c.wa_id === msg.from)?.profile?.name ?? senderPhone

        // Extract message body
        const textBody = extractTextBody(msg)

        // Upsert conversation
        const { data: conv, error: convErr } = await admin
          .from('kirimdev_conversations')
          .upsert(
            {
              business_id: businessId,
              wa_id: senderPhone,
              contact_name: contactName,
              last_message_text: textBody || `[${msg.type}]`,
              last_message_at: new Date(parseInt(msg.timestamp, 10) * 1000).toISOString(),
              updated_at: new Date().toISOString(),
            },
            { onConflict: 'business_id,wa_id' }
          )
          .select('id, unread_count, customer_id')
          .single()

        if (convErr || !conv) {
          console.error('[kirimdev webhook] Upsert conversation error:', convErr)
          continue
        }

        // Check for duplicate message (idempotency)
        const { data: existing } = await admin
          .from('kirimdev_messages')
          .select('id')
          .eq('wamid', msg.id)
          .maybeSingle()

        if (!existing) {
          await admin.from('kirimdev_messages').insert({
            business_id: businessId,
            conversation_id: conv.id,
            wamid: msg.id,
            direction: 'incoming',
            sender_phone: senderPhone,
            recipient_phone: value.metadata?.phone_number_id ?? null,
            message_type: msg.type,
            text_body: textBody,
            raw_payload: msg,
            status: 'received',
          })
        }

        // Update conversation last message + increment unread
        await admin
          .from('kirimdev_conversations')
          .update({
            last_message_text: textBody || `[${msg.type}]`,
            last_message_at: new Date(parseInt(msg.timestamp, 10) * 1000).toISOString(),
            unread_count: (conv.unread_count ?? 0) + 1,
            updated_at: new Date().toISOString(),
          })
          .eq('id', conv.id)

        // Try to link customer if not yet linked
        if (!conv.customer_id) {
          const { data: cust } = await admin
            .from('customers')
            .select('id')
            .eq('business_id', businessId)
            .eq('phone', senderPhone)
            .maybeSingle()

          if (cust) {
            await admin
              .from('kirimdev_conversations')
              .update({ customer_id: cust.id })
              .eq('id', conv.id)
          }
        }
      }

      // ---- Handle status updates (delivered, read) ----
      for (const status of value.statuses ?? []) {
        await admin
          .from('kirimdev_messages')
          .update({ status: status.status })
          .eq('wamid', status.id)
      }
    }
  }
}

function extractTextBody(msg: any): string | null {
  switch (msg.type) {
    case 'text':
      return msg.text?.body ?? null
    case 'image':
      return msg.image?.caption ?? '[Foto]'
    case 'document':
      return msg.document?.caption ?? msg.document?.filename ?? '[Dokumen]'
    case 'audio':
      return msg.audio?.voice ? '[Pesan Suara]' : '[Audio]'
    case 'video':
      return msg.video?.caption ?? '[Video]'
    case 'sticker':
      return '[Stiker]'
    case 'location':
      return `[Lokasi: ${msg.location?.name ?? `${msg.location?.latitude}, ${msg.location?.longitude}`}]`
    case 'interactive':
      return (
        msg.interactive?.button_reply?.title ??
        msg.interactive?.list_reply?.title ??
        '[Pesan Interaktif]'
      )
    default:
      return null
  }
}
