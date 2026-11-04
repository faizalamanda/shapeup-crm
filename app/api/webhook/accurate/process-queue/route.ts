import { NextRequest, NextResponse } from 'next/server'
import { processAccurateWebhookPayload } from '@/lib/integrations/accurate/syncService'

export async function POST(req: NextRequest) {
  try {
    // Validate service key
    const authHeader = req.headers.get('authorization')
    const serviceKeyHeader = req.headers.get('x-service-key')
    const token = authHeader ? authHeader.replace(/^Bearer\s+/i, '') : serviceKeyHeader

    if (token !== process.env.SUPABASE_SERVICE_ROLE_KEY) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await req.json().catch(() => null)
    const { businessId, payload } = body || {}
    
    if (!businessId || !payload) {
      return NextResponse.json({ error: 'Invalid payload' }, { status: 400 })
    }

    const res = await processAccurateWebhookPayload(businessId, payload)
    if (!res.success) {
      return NextResponse.json({ error: res.error || 'Sync failed' }, { status: 500 })
    }

    return NextResponse.json({ success: true })
  } catch (error: any) {
    console.error('[Accurate Process Queue] Error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
