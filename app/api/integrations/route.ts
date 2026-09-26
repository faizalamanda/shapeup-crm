import { NextResponse } from 'next/server'
import { getApiContext } from '@/lib/apiContext'

export async function GET(req: Request) {
  try {
    const ctx = await getApiContext()
    if (ctx.error) return ctx.error
    const { businessId: activeBid, supabaseAdmin: admin } = ctx

    const url = new URL(req.url)
    const isSummary = url.searchParams.get('summary') === 'true'
    const providerParam = url.searchParams.get('provider')

    // Mode 1: Summary mode (lightweight query for catalog statuses directly from DB)
    if (isSummary) {
      const [rowsRes, bizRowsRes] = await Promise.all([
        admin
          .from('integrations')
          .select('id, platform_name, is_active, api_credentials, store_url')
          .filter('api_credentials->>business_id', 'eq', activeBid),
        admin
          .from('business_integrations')
          .select('id, provider, is_active, config')
          .eq('business_id', activeBid)
      ])

      const statuses: Record<string, { is_active: boolean; is_configured: boolean; store_url?: string }> = {}

      rowsRes.data?.forEach(row => {
        statuses[row.platform_name] = {
          is_active: Boolean(row.is_active),
          is_configured: Boolean(row.api_credentials && Object.keys(row.api_credentials).length > 1),
          store_url: row.store_url || undefined
        }
      })

      bizRowsRes.data?.forEach(br => {
        statuses[br.provider] = {
          is_active: Boolean(br.is_active),
          is_configured: Boolean(br.config && Object.keys(br.config).length > 0)
        }
      })

      return NextResponse.json({
        success: true,
        activeBusinessId: activeBid,
        statuses
      })
    }

    // Mode 2: Single provider detailed config mode (loaded on click when configuring)
    if (providerParam) {
      const { data: bizRow } = await admin
        .from('business_integrations')
        .select('*')
        .eq('business_id', activeBid)
        .eq('provider', providerParam)
        .maybeSingle()

      if (bizRow) {
        return NextResponse.json({
          success: true,
          activeBusinessId: activeBid,
          integration: {
            id: bizRow.id,
            platform_name: bizRow.provider,
            provider: bizRow.provider,
            is_active: bizRow.is_active,
            config: bizRow.config,
            api_credentials: {
              business_id: bizRow.business_id,
              config: bizRow.config
            }
          }
        })
      }

      const { data: intRow } = await admin
        .from('integrations')
        .select('*')
        .eq('platform_name', providerParam)
        .filter('api_credentials->>business_id', 'eq', activeBid)
        .maybeSingle()

      return NextResponse.json({
        success: true,
        activeBusinessId: activeBid,
        integration: intRow ? {
          id: intRow.id,
          platform_name: intRow.platform_name,
          provider: intRow.platform_name,
          is_active: intRow.is_active,
          store_url: intRow.store_url,
          api_credentials: intRow.api_credentials
        } : null
      })
    }

    // Mode 3: Default full list (for fallback/backwards compatibility)
    const { data: rows, error: fetchErr } = await admin
      .from('integrations')
      .select('*')
      .filter('api_credentials->>business_id', 'eq', activeBid)

    if (fetchErr) throw fetchErr

    const { data: bizRows } = await admin
      .from('business_integrations')
      .select('*')
      .eq('business_id', activeBid)

    const integrations = rows || []

    if (bizRows) {
      bizRows.forEach(br => {
        integrations.push({
          id: br.id,
          platform_name: br.provider,
          provider: br.provider,
          is_active: br.is_active,
          config: br.config,
          api_credentials: {
            business_id: br.business_id,
            config: br.config
          }
        })
      })
    }

    return NextResponse.json({
      success: true,
      activeBusinessId: activeBid,
      integrations
    })

  } catch (err: any) {
    console.error('Fetch Integrations Error:', err)
    return NextResponse.json({ error: err.message || 'Internal Server Error' }, { status: 500 })
  }
}

export async function POST(req: Request) {
  try {
    const ctx = await getApiContext()
    if (ctx.error) return ctx.error
    const { user, businessId: activeBid, supabaseAdmin: admin } = ctx

    const body = await req.json()
    const { provider, store_url, consumer_key, consumer_secret, api_key, whatsapp_number, is_active = true, config, name, ...extraFields } = body

    if (!provider) {
      return NextResponse.json({ error: 'Provider wajib ditentukan.' }, { status: 400 })
    }

    // Check if it's a plugin using business_integrations table
    if (provider === 'accurate' || config !== undefined) {
      const { data: updated, error: updateErr } = await admin
        .from('business_integrations')
        .upsert({
          business_id: activeBid,
          provider: provider,
          name: name || provider,
          config: config || {},
          is_active: is_active
        }, { onConflict: 'business_id,provider' })
        .select()
        .single()

      if (updateErr) {
        console.error("Upsert Error: ", updateErr)
        return NextResponse.json({ error: updateErr.message || 'Gagal menyimpan ke database' }, { status: 500 })
      }

      return NextResponse.json({
        success: true,
        message: 'Pengaturan integrasi berhasil disimpan!',
        integration: updated
      })
    }

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
