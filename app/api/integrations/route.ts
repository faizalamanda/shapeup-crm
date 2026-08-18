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

    const admin = getAdminSupabase()

    // Fetch integrations for this active business
    const { data: rows, error: fetchErr } = await admin
      .from('integrations')
      .select('*')
      .filter('api_credentials->>business_id', 'eq', profile.active_business_id)

    if (fetchErr) throw fetchErr

    return NextResponse.json({
      success: true,
      activeBusinessId: profile.active_business_id,
      integrations: rows || []
    })

  } catch (err: any) {
    console.error('Fetch Integrations Error:', err)
    return NextResponse.json({ error: err.message || 'Internal Server Error' }, { status: 500 })
  }
}

export async function POST(req: Request) {
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

    const body = await req.json()
    const { provider, store_url, consumer_key, consumer_secret, api_key, whatsapp_number, is_active = true, ...extraFields } = body

    if (!provider) {
      return NextResponse.json({ error: 'Provider wajib ditentukan.' }, { status: 400 })
    }

    const admin = getAdminSupabase()
    const activeBid = profile.active_business_id

    // Check if record already exists for this business & provider
    const { data: existingRows } = await admin
      .from('integrations')
      .select('id, api_credentials')
      .eq('platform_name', provider)
      .filter('api_credentials->>business_id', 'eq', activeBid)

    const existing = existingRows && existingRows.length > 0 ? existingRows[0] : null

    const apiCredentials: Record<string, any> = {
      ...(existing?.api_credentials || {}),
      business_id: activeBid,
      updated_at: new Date().toISOString()
    }

    if (consumer_key !== undefined) apiCredentials.consumer_key = consumer_key
    if (consumer_secret !== undefined) apiCredentials.consumer_secret = consumer_secret
    if (api_key !== undefined) apiCredentials.api_key = api_key
    if (whatsapp_number !== undefined) apiCredentials.whatsapp_number = whatsapp_number

    // Merge any additional fields and sanitize strings
    Object.assign(apiCredentials, extraFields)

    if (typeof apiCredentials.access_token === 'string') {
      apiCredentials.access_token = apiCredentials.access_token.replace(/\r?\n|\r/g, '').trim()
    }
    if (typeof apiCredentials.phone_number_id === 'string') {
      apiCredentials.phone_number_id = apiCredentials.phone_number_id.trim()
    }
    if (typeof apiCredentials.webhook_verify_token === 'string') {
      apiCredentials.webhook_verify_token = apiCredentials.webhook_verify_token.trim()
    }

    let resultData = null

    if (existing) {
      // Update existing record
      const { data: updated, error: updateErr } = await admin
        .from('integrations')
        .update({
          store_url: store_url || '',
          api_credentials: apiCredentials,
          is_active: is_active,
          last_sync_at: new Date().toISOString()
        })
        .eq('id', existing.id)
        .select()
        .single()

      if (updateErr) throw updateErr
      resultData = updated
    } else {
      // Insert new record
      const { data: inserted, error: insertErr } = await admin
        .from('integrations')
        .insert({
          user_id: user.id,
          platform_name: provider,
          store_url: store_url || '',
          api_credentials: apiCredentials,
          is_active: is_active,
          created_at: new Date().toISOString(),
          last_sync_at: new Date().toISOString()
        })
        .select()
        .single()

      if (insertErr) throw insertErr
      resultData = inserted
    }

    return NextResponse.json({
      success: true,
      message: 'Pengaturan integrasi berhasil disimpan!',
      integration: resultData
    })

  } catch (err: any) {
    console.error('Save Integration Error:', err)
    return NextResponse.json({ error: err.message || 'Gagal menyimpan integrasi' }, { status: 500 })
  }
}
