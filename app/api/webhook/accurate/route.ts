import { NextRequest, NextResponse } from 'next/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { executeAccurateSync } from '@/lib/integrations/accurate/syncService'

export async function POST(req: NextRequest) {
  try {
    const rawBody = await req.text()
    
    // Parse JSON
    let payload = []
    try {
      payload = JSON.parse(rawBody)
    } catch (e) {
      return NextResponse.json({ success: true, message: 'Not JSON' })
    }

    if (!Array.isArray(payload)) {
      payload = [payload]
    }

    console.log('[Accurate Webhook] Received payload:', JSON.stringify(payload, null, 2))

    // Filter relevant events
    const relevantEvents = payload.filter((e: any) => 
      e.type === 'SALES_INVOICE' || e.type === 'SALES_RECEIPT' || 
      e.type === 'SALESINVOICE' || e.type === 'SALESRECEIPT' ||
      e.module === 'SALES_INVOICE' || e.module === 'salesInvoice'
    )
    
    console.log('[Accurate Webhook] Relevant events:', relevantEvents)

    if (relevantEvents.length === 0) {
      return NextResponse.json({ success: true, message: 'No relevant events' })
    }

    // Group by databaseId
    const dbIds = Array.from(new Set(relevantEvents.map((e: any) => e.databaseId)))

    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!
    const supabaseAdmin = createAdminClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, serviceRoleKey)

    // Fetch all active integrations
    const { data: integrations } = await supabaseAdmin
      .from('business_integrations')
      .select('business_id, config')
      .eq('provider', 'accurate')
      .eq('is_active', true)

    if (!integrations || integrations.length === 0) {
      return NextResponse.json({ success: true, message: 'No active integrations' })
    }

    // Process each database ID sequentially
    for (const dbId of dbIds) {
      const integration = integrations.find(int => {
        const conf = int.config as any
        return conf.db_integer_id == dbId || conf.db_id == dbId
      })

      if (integration) {
        // Run sync! (Awaited so Vercel doesn't kill it before it finishes)
        // We only fetch page 1 because webhooks trigger immediately after a transaction,
        // so the transaction is guaranteed to be in the first 10 most recent results!
        console.log(`[Accurate Webhook] Triggering sync for Business ${integration.business_id} (DB: ${dbId})`)
        await executeAccurateSync(integration.business_id, 1)
      } else {
        console.log(`[Accurate Webhook] Unknown DB ID: ${dbId}`)
      }
    }

    return NextResponse.json({ success: true, message: 'Webhook processed' })
  } catch (error: any) {
    console.error('[Accurate Webhook] Error:', error)
    // Always return 200 OK so Accurate doesn't disable the webhook
    return NextResponse.json({ success: true, warning: 'Processed with unhandled exception' })
  }
}
