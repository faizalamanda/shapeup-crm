import { NextResponse } from 'next/server'
import { getApiContext } from '@/lib/apiContext'

// GET: Fetch business global inventory & stock reduction settings
export async function GET() {
  try {
    const ctx = await getApiContext()
    if (ctx.error) return ctx.error
    const { businessId: activeBid, supabaseAdmin: admin } = ctx

    // Fetch global integration setting
    const { data: rows, error: fetchErr } = await admin
      .from('integrations')
      .select('*')
      .eq('platform_name', 'global')
      .filter('api_credentials->>business_id', 'eq', activeBid)

    if (fetchErr) throw fetchErr

    const globalRecord = rows && rows.length > 0 ? rows[0] : null
    const creds = globalRecord?.api_credentials || {}

    return NextResponse.json({
      success: true,
      activeBusinessId: activeBid,
      settings: {
        global_stock_reduction_status: creds.global_stock_reduction_status || ['shipped', 'completed'],
        global_journal_hpp_status: creds.global_journal_hpp_status || ['shipped', 'completed'],
        global_default_hpp_percentage: typeof creds.global_default_hpp_percentage === 'number' ? creds.global_default_hpp_percentage : 0,
        updated_at: creds.updated_at || null
      }
    })
  } catch (err: any) {
    console.error('Fetch Global Inventory Settings Error:', err)
    return NextResponse.json({ error: err.message || 'Internal Server Error' }, { status: 500 })
  }
}

// POST: Save business global inventory & stock reduction settings
export async function POST(req: Request) {
  try {
    const ctx = await getApiContext()
    if (ctx.error) return ctx.error
    const { user, businessId: activeBid, supabaseAdmin: admin } = ctx

    const body = await req.json()
    const { global_stock_reduction_status, global_journal_hpp_status, global_default_hpp_percentage } = body

    // Check if record already exists
    const { data: existingRows } = await admin
      .from('integrations')
      .select('id, api_credentials')
      .eq('platform_name', 'global')
      .filter('api_credentials->>business_id', 'eq', activeBid)

    const existing = existingRows && existingRows.length > 0 ? existingRows[0] : null

    const apiCredentials = {
      ...(existing?.api_credentials || {}),
      business_id: activeBid,
      global_stock_reduction_status: Array.isArray(global_stock_reduction_status) && global_stock_reduction_status.length > 0
        ? global_stock_reduction_status 
        : ['shipped', 'completed'],
      global_journal_hpp_status: Array.isArray(global_journal_hpp_status) && global_journal_hpp_status.length > 0
        ? global_journal_hpp_status 
        : ['shipped', 'completed'],
      global_default_hpp_percentage: typeof global_default_hpp_percentage === 'number' && !isNaN(global_default_hpp_percentage)
        ? Math.max(0, Math.min(100, global_default_hpp_percentage))
        : 0,
      updated_at: new Date().toISOString()
    }

    let resultData = null
    if (existing) {
      const { data: updated, error: updateErr } = await admin
        .from('integrations')
        .update({
          api_credentials: apiCredentials,
          is_active: true,
          last_sync_at: new Date().toISOString()
        })
        .eq('id', existing.id)
        .select()
        .single()

      if (updateErr) throw updateErr
      resultData = updated
    } else {
      const { data: inserted, error: insertErr } = await admin
        .from('integrations')
        .insert({
          user_id: user.id,
          platform_name: 'global',
          store_url: 'global://settings',
          api_credentials: apiCredentials,
          is_active: true,
          last_sync_at: new Date().toISOString()
        })
        .select()
        .single()

      if (insertErr) throw insertErr
      resultData = inserted
    }

    return NextResponse.json({
      success: true,
      settings: resultData?.api_credentials
    })
  } catch (err: any) {
    console.error('Save Global Inventory Settings Error:', err)
    return NextResponse.json({ error: err.message || 'Internal Server Error' }, { status: 500 })
  }
}
