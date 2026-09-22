import { NextResponse } from 'next/server'
import { createClient, getAdminSupabase, getAuthUser } from '@/lib/supabaseServer'
import { sendKirimDevTextMessage } from '@/lib/integrations/kirimdev'

async function getAuthenticatedUser() {
  const supabase = await createClient()
  const { user, error } = await getAuthUser(supabase)
  if (error || !user) return { user: null, profile: null, supabase }

  const { data: profile } = await supabase
    .from('profiles')
    .select('active_business_id')
    .eq('id', user.id)
    .single()

  return { user, profile, supabase }
}

// ============================================================
// GET /api/plugin/kirimdev/messages?conversation_id={id}
// Returns message thread for a conversation.
// Also resets unread count to 0.
// ============================================================
export async function GET(req: Request) {
  try {
    const { user, profile } = await getAuthenticatedUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if (!profile?.active_business_id) {
      return NextResponse.json({ error: 'Unit bisnis aktif tidak terdeteksi.' }, { status: 400 })
    }

    const { searchParams } = new URL(req.url)
    const conversationId = searchParams.get('conversation_id')
    if (!conversationId) {
      return NextResponse.json({ error: 'conversation_id wajib disertakan.' }, { status: 400 })
    }

    const admin = getAdminSupabase()
    const businessId = profile.active_business_id

    // Verify conversation belongs to this business
    const { data: conv, error: convErr } = await admin
      .from('kirimdev_conversations')
      .select('id, business_id, wa_id, contact_name, customer_id, status, unread_count, customers(id, name, phone, email, category)')
      .eq('id', conversationId)
      .eq('business_id', businessId)
      .single()

    if (convErr || !conv) {
      return NextResponse.json({ error: 'Percakapan tidak ditemukan.' }, { status: 404 })
    }

    // Fetch messages
    const { data: messages, error: msgErr } = await admin
      .from('kirimdev_messages')
      .select('*')
      .eq('conversation_id', conversationId)
      .order('created_at', { ascending: true })
      .limit(200)

    if (msgErr) throw msgErr

    // Reset unread count
    if ((conv.unread_count ?? 0) > 0) {
      await admin
        .from('kirimdev_conversations')
        .update({ unread_count: 0, updated_at: new Date().toISOString() })
        .eq('id', conversationId)
    }

    return NextResponse.json({
      success: true,
      conversation: conv,
      messages: messages ?? [],
    })
  } catch (err: any) {
    console.error('[kirimdev] Fetch Messages Error:', err)
    return NextResponse.json({ error: err.message ?? 'Server error' }, { status: 500 })
  }
}

// ============================================================
// POST /api/plugin/kirimdev/messages
// Send a message in a conversation.
// Body: { conversation_id, to, text }
// ============================================================
export async function POST(req: Request) {
  try {
    const { user, profile } = await getAuthenticatedUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if (!profile?.active_business_id) {
      return NextResponse.json({ error: 'Unit bisnis aktif tidak terdeteksi.' }, { status: 400 })
    }

    const body = await req.json()
    const { conversation_id, to, text } = body

    if (!to || !text?.trim()) {
      return NextResponse.json({ error: 'Field "to" dan "text" wajib diisi.' }, { status: 400 })
    }

    const result = await sendKirimDevTextMessage({
      businessId: profile.active_business_id,
      to,
      text: text.trim(),
      conversationId: conversation_id ?? undefined,
    })

    return NextResponse.json({ success: result.success, wamid: result.wamid, conversation_id: result.conversation_id, recipient_phone: result.recipient_phone })
  } catch (err: any) {
    console.error('[kirimdev] Send Message Error:', err)
    return NextResponse.json({ error: err.message ?? 'Gagal mengirim pesan.' }, { status: 500 })
  }
}
