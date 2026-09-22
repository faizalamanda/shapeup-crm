import { NextResponse } from 'next/server'
import { createClient, getAdminSupabase, getAuthUser } from '@/lib/supabaseServer'
import { getKirimDevConfig } from '@/lib/integrations/kirimdev'

// ============================================================
// GET /api/plugin/kirimdev/conversations
// Returns list of conversations for the active business.
// ============================================================
export async function GET(req: Request) {
  try {
    const supabase = await createClient()
    const { user, error: authErr } = await getAuthUser(supabase)
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

    const businessId = profile.active_business_id

    // Check integration status
    const config = await getKirimDevConfig(businessId)
    const isConfigured = Boolean(config?.api_key && config?.phone_number_id)
    const isActive = Boolean(config?.is_active)

    if (!isConfigured || !isActive) {
      return NextResponse.json({
        success: true,
        configured: isConfigured,
        active: isActive,
        conversations: [],
        message: 'Plugin kirim.dev belum aktif atau belum dikonfigurasi.',
      })
    }

    const admin = getAdminSupabase()
    const { data: conversations, error: fetchErr } = await admin
      .from('kirimdev_conversations')
      .select(`
        id,
        business_id,
        customer_id,
        wa_id,
        contact_name,
        last_message_text,
        last_message_at,
        unread_count,
        status,
        assigned_to,
        metadata,
        created_at,
        updated_at,
        customers (
          id,
          name,
          phone,
          email,
          category,
          address_data
        )
      `)
      .eq('business_id', businessId)
      .order('last_message_at', { ascending: false })
      .limit(100)

    if (fetchErr) throw fetchErr

    return NextResponse.json({
      success: true,
      configured: true,
      active: true,
      conversations: conversations ?? [],
    })
  } catch (err: any) {
    console.error('[kirimdev] Fetch Conversations Error:', err)
    return NextResponse.json({ error: err.message ?? 'Server error' }, { status: 500 })
  }
}
