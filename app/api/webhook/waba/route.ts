import { NextResponse } from 'next/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { getWabaConfig, formatPhoneNumber } from '@/lib/integrations/waba'

function getAdminSupabase() {
  return createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

/**
 * GET Handler for Meta Webhook Verification
 */
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)

  const businessId = searchParams.get('bid')
  const mode = searchParams.get('hub.mode')
  const verifyToken = searchParams.get('hub.verify_token')
  const challenge = searchParams.get('hub.challenge')

  if (!businessId) {
    return new NextResponse('Business ID required', { status: 400 })
  }

  if (mode === 'subscribe' && verifyToken) {
    const config = await getWabaConfig(businessId)

    if (config && config.webhook_verify_token && config.webhook_verify_token === verifyToken) {
      console.log(`[WABA Webhook] Verified successfully for business: ${businessId}`)
      return new NextResponse(challenge || '', { status: 200 })
    }

    console.warn(`[WABA Webhook] Verification failed for business ${businessId}. Token mismatch.`)
    return new NextResponse('Verification token mismatch', { status: 403 })
  }

  return new NextResponse('Invalid verification request', { status: 400 })
}

/**
 * POST Handler for Meta Webhook Incoming Events (Messages & Statuses)
 */
export async function POST(req: Request) {
  const { searchParams } = new URL(req.url)
  const businessId = searchParams.get('bid')

  if (!businessId) {
    return NextResponse.json({ error: 'Business ID required' }, { status: 400 })
  }

  try {
    const body = await req.json()

    const config = await getWabaConfig(businessId)
    if (!config || !config.is_active) {
      // Return 200 OK so Meta doesn't keep retrying, but log warning
      console.warn(`[WABA Webhook] Integration inactive or missing for business: ${businessId}`)
      return NextResponse.json({ status: 'ignored_inactive' }, { status: 200 })
    }

    const admin = getAdminSupabase()

    if (body.object === 'whatsapp_business_account' && Array.isArray(body.entry)) {
      for (const entry of body.entry) {
        if (!Array.isArray(entry.changes)) continue

        for (const change of entry.changes) {
          const value = change.value
          if (!value) continue

          const contactsMap: Record<string, string> = {}
          if (Array.isArray(value.contacts)) {
            for (const c of value.contacts) {
              if (c.wa_id) {
                contactsMap[c.wa_id] = c.profile?.name || c.wa_id
              }
            }
          }

          // 1. Process Incoming Messages
          if (Array.isArray(value.messages)) {
            for (const msg of value.messages) {
              const fromPhone = formatPhoneNumber(msg.from || '')
              if (!fromPhone) continue

              const wamid = msg.id || null
              const timestampSec = parseInt(msg.timestamp || '0', 10)
              const msgDate = timestampSec > 0 ? new Date(timestampSec * 1000).toISOString() : new Date().toISOString()
              const senderName = contactsMap[msg.from] || contactsMap[fromPhone] || fromPhone

              let textBody = ''
              let msgType = msg.type || 'text'

              if (msg.type === 'text' && msg.text?.body) {
                textBody = msg.text.body
              } else if (msg.type === 'image') {
                textBody = msg.image?.caption || '[Gambar]'
              } else if (msg.type === 'document') {
                textBody = msg.document?.filename || '[Dokumen]'
              } else if (msg.type === 'audio' || msg.type === 'voice') {
                textBody = '[Pesan Suara]'
              } else if (msg.type === 'video') {
                textBody = '[Video]'
              } else if (msg.type === 'location') {
                textBody = '[Lokasi]'
              } else if (msg.type === 'interactive') {
                textBody = msg.interactive?.button_reply?.title || msg.interactive?.list_reply?.title || '[Respon Interaktif]'
              } else if (msg.type === 'button') {
                textBody = msg.button?.text || '[Tombol]'
              } else {
                textBody = `[Pesan ${msg.type || 'Media'}]`
              }

              // Check if customer exists in DB
              let customerId: string | null = null
              const { data: existingCustomer } = await admin
                .from('customers')
                .select('id, name')
                .eq('business_id', businessId)
                .eq('phone', fromPhone)
                .maybeSingle()

              if (existingCustomer) {
                customerId = existingCustomer.id
              } else {
                // Auto create new customer record
                const { data: newCustomer } = await admin
                  .from('customers')
                  .insert({
                    business_id: businessId,
                    name: senderName,
                    phone: fromPhone,
                    category: 'General',
                  })
                  .select('id')
                  .single()

                if (newCustomer) customerId = newCustomer.id
              }

              // Upsert Conversation
              const { data: existingConv } = await admin
                .from('waba_conversations')
                .select('id, unread_count')
                .eq('business_id', businessId)
                .eq('wa_id', fromPhone)
                .maybeSingle()

              let convId: string

              if (existingConv) {
                convId = existingConv.id
                await admin
                  .from('waba_conversations')
                  .update({
                    customer_id: customerId || undefined,
                    contact_name: senderName,
                    last_message_text: textBody,
                    last_message_at: msgDate,
                    unread_count: (existingConv.unread_count || 0) + 1,
                    updated_at: new Date().toISOString(),
                  })
                  .eq('id', convId)
              } else {
                const { data: newConv } = await admin
                  .from('waba_conversations')
                  .insert({
                    business_id: businessId,
                    customer_id: customerId,
                    wa_id: fromPhone,
                    contact_name: senderName,
                    last_message_text: textBody,
                    last_message_at: msgDate,
                    unread_count: 1,
                  })
                  .select('id')
                  .single()

                if (!newConv) continue
                convId = newConv.id
              }

              // Check duplicate wamid before inserting message
              if (wamid) {
                const { data: dup } = await admin
                  .from('waba_messages')
                  .select('id')
                  .eq('business_id', businessId)
                  .eq('wamid', wamid)
                  .maybeSingle()

                if (dup) continue
              }

              // Insert Message
              await admin.from('waba_messages').insert({
                business_id: businessId,
                conversation_id: convId,
                wamid: wamid,
                direction: 'incoming',
                sender_phone: fromPhone,
                recipient_phone: config.phone_number_id,
                message_type: msgType,
                text_body: textBody,
                status: 'received',
                raw_payload: msg,
                created_at: msgDate,
              })
            }
          }

          // 2. Process Status Updates
          if (Array.isArray(value.statuses)) {
            for (const statusObj of value.statuses) {
              const wamid = statusObj.id
              const newStatus = statusObj.status // sent, delivered, read, failed

              if (wamid && newStatus) {
                let errorMsg: string | null = null
                if (statusObj.errors && statusObj.errors.length > 0) {
                  errorMsg = statusObj.errors[0].title || statusObj.errors[0].message || 'WABA Error'
                }

                await admin
                  .from('waba_messages')
                  .update({
                    status: newStatus,
                    error_message: errorMsg || undefined,
                  })
                  .eq('business_id', businessId)
                  .eq('wamid', wamid)
              }
            }
          }

        }
      }
    }

    return NextResponse.json({ status: 'ok' }, { status: 200 })

  } catch (err: any) {
    console.error('[WABA Webhook Error]:', err)
    return NextResponse.json({ error: err.message || 'Internal Server Error' }, { status: 500 })
  }
}
