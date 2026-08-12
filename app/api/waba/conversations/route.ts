import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabaseServer'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { getWabaConfig } from '@/lib/integrations/waba'

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

    const businessId = profile.active_business_id

    // Check integration status
    const config = await getWabaConfig(businessId)
    const isConfigured = Boolean(config && config.access_token && config.phone_number_id)
    const isActive = Boolean(config && config.is_active)

    if (!isConfigured || !isActive) {
      return NextResponse.json({
        success: true,
        configured: isConfigured,
        active: isActive,
        conversations: [],
        message: 'Integrasi WABA Official belum aktif atau belum dikonfigurasi.',
      })
    }

    const admin = getAdminSupabase()

    // Fetch conversations
    const { data: conversations, error: fetchErr } = await admin
      .from('waba_conversations')
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
        metadata,
        created_at,
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

    if (fetchErr) throw fetchErr

    return NextResponse.json({
      success: true,
      configured: true,
      active: true,
      conversations: conversations || [],
    })

  } catch (err: any) {
    console.error('Fetch WABA Conversations Error:', err)
    return NextResponse.json({ error: err.message || 'Server error' }, { status: 500 })
  }
}
