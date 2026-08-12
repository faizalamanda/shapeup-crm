import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabaseServer'
import { createClient as createAdminClient } from '@supabase/supabase-js'

function getAdminSupabase() {
  return createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

export async function GET(req: Request) {
  try {
    const supabase = await createClient()
    const { data: { user }, error: authErr } = await supabase.auth.getUser()

    if (authErr || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { data: profile } = await supabase
      .from('profiles')
      .select('active_business_id')
      .eq('id', user.id)
      .single()

    if (!profile?.active_business_id) {
      return NextResponse.json({ error: 'Unit bisnis aktif tidak terdeteksi.' }, { status: 400 })
    }

    const { searchParams } = new URL(req.url)
    const conversationId = searchParams.get('conversation_id')

    if (!conversationId) {
      return NextResponse.json({ error: 'ID Percakapan (conversation_id) wajib disertakan.' }, { status: 400 })
    }

    const admin = getAdminSupabase()
    const businessId = profile.active_business_id

    // Check conversation ownership
    const { data: conv, error: convErr } = await admin
      .from('waba_conversations')
      .select('id, business_id, wa_id, contact_name, customer_id')
      .eq('id', conversationId)
      .eq('business_id', businessId)
      .single()

    if (convErr || !conv) {
      return NextResponse.json({ error: 'Percakapan tidak ditemukan.' }, { status: 404 })
    }

    // Fetch messages thread
    const { data: messages, error: msgErr } = await admin
      .from('waba_messages')
      .select('*')
      .eq('conversation_id', conversationId)
      .order('created_at', { ascending: true })

    if (msgErr) throw msgErr

    // Reset unread count to 0 when messages are read
    await admin
      .from('waba_conversations')
      .update({ unread_count: 0, updated_at: new Date().toISOString() })
      .eq('id', conversationId)

    return NextResponse.json({
      success: true,
      conversation: conv,
      messages: messages || [],
    })

  } catch (err: any) {
    console.error('Fetch Messages Error:', err)
    return NextResponse.json({ error: err.message || 'Server error' }, { status: 500 })
  }
}
