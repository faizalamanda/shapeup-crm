import { NextRequest, NextResponse } from 'next/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'

export async function POST(req: NextRequest) {
  try {
    const rawBody = await req.text()
    console.log('[Accurate Webhook Test] Raw Body:', rawBody)
    
    // Parse the body
    let bodyData = {}
    try {
      bodyData = JSON.parse(rawBody)
    } catch (e) {
      console.error('Failed to parse webhook body as JSON', e)
    }

    // Connect to Supabase to save this payload for inspection
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
    if (serviceRoleKey) {
      const supabaseAdmin = createAdminClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        serviceRoleKey
      )
      
      const url = new URL(req.url)
      const businessId = url.searchParams.get('business_id')

      let query = supabaseAdmin
        .from('business_integrations')
        .select('id, config')
        .eq('provider', 'accurate')
        .eq('is_active', true)
        
      if (businessId) {
        query = query.eq('business_id', businessId)
      }
      
      const { data: integrations } = await query.limit(1)
        
      if (integrations && integrations.length > 0) {
        const integration = integrations[0]
        const currentConfig = integration.config || {}
        
        // Save payload
        const newConfig = {
          ...currentConfig,
          last_webhook_payload: bodyData,
          last_webhook_time: new Date().toISOString()
        }
        
        await supabaseAdmin
          .from('business_integrations')
          .update({ config: newConfig })
          .eq('id', integration.id)
      }
    }
    
    return NextResponse.json({ success: true, message: 'Webhook received and logged' }, { status: 200 })
    
  } catch (err: any) {
    console.error("Webhook Test Error:", err)
    return NextResponse.json({ success: true, warning: 'Processed with unhandled exception' }, { status: 200 })
  }
}
