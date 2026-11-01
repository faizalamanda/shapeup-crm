import { getApiContext } from '@/lib/apiContext'
import { getReturnPolicy, saveReturnPolicy } from '@/lib/pos/returns/settings'
import { NextResponse } from 'next/server'

// GET /api/pos/returns/policy
export async function GET(req: Request) {
  try {
    const ctx = await getApiContext()
    if (ctx.error) return ctx.error
    const { businessId, supabase } = ctx

    const policy = await getReturnPolicy(businessId, supabase)
    return NextResponse.json({ success: true, policy })
  } catch (err: any) {
    console.error('[API Return Policy GET]', err)
    return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500 })
  }
}

// POST /api/pos/returns/policy
export async function POST(req: Request) {
  try {
    const ctx = await getApiContext()
    if (ctx.error) return ctx.error
    const { user, businessId, supabase, supabaseAdmin } = ctx

    const body = await req.json().catch(() => null)
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ error: 'Body permintaan tidak valid' }, { status: 400 })
    }

    const client = supabaseAdmin || supabase
    const saved = await saveReturnPolicy(businessId, body, user.id, client)
    return NextResponse.json({ success: true, policy: saved })
  } catch (err: any) {
    console.error('[API Return Policy POST]', err)
    return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500 })
  }
}
