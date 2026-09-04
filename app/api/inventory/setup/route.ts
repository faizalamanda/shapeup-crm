import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabaseServer'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { ensureInventoryTablesExist } from '@/plugins/inventory-reports/db/dbInit'
import { syncInventoryStockSummary } from '@/plugins/inventory-reports/inventoryHelper'

function getAdminSupabase() {
  return createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
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

    const admin = getAdminSupabase()
    const businessId = profile.active_business_id

    // Ensure inventory default locations are auto-seeded & metrics summary is synced (Full Hybrid Architecture)
    const result = await ensureInventoryTablesExist(admin, businessId)
    const syncRes = await syncInventoryStockSummary(admin, businessId)

    return NextResponse.json({
      success: true,
      message: 'Otomatisasi inisialisasi plugin & sinkronisasi metrik persediaan berhasil diselesaikan.',
      businessId,
      result,
      syncRes,
    })
  } catch (err: any) {
    console.error('[InventoryPluginSetup] Setup error:', err)
    return NextResponse.json({ error: err.message || 'Internal Server Error' }, { status: 500 })
  }
}
