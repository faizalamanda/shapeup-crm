import { createClient as createAdminClient } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabaseServer'
import { NextResponse } from 'next/server'

export async function POST(req: Request) {
  const supabase = await createClient()

  try {
    const { data: { user }, error: authErr } = await supabase.auth.getUser()
    if (authErr || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { data: profile, error: profErr } = await supabase
      .from('profiles')
      .select('active_business_id')
      .eq('id', user.id)
      .single()

    if (profErr || !profile?.active_business_id) {
      return NextResponse.json({ error: 'Active business not found for user profile' }, { status: 400 })
    }

    const businessId = profile.active_business_id

    const { ids } = await req.json()
    if (!Array.isArray(ids) || ids.length === 0) {
      return NextResponse.json({ success: true, metadataMap: {} })
    }

    // Try service role key first, fallback to authenticated server client
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
    let customersData: any[] | null = null
    let fetchErr: any = null

    if (serviceRoleKey) {
      const supabaseAdmin = createAdminClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        serviceRoleKey
      )
      const res = await supabaseAdmin
        .from('customers')
        .select('id, metadata')
        .eq('business_id', businessId)
        .in('id', ids)
      customersData = res.data
      fetchErr = res.error
    } else {
      const res = await supabase
        .from('customers')
        .select('id, metadata')
        .eq('business_id', businessId)
        .in('id', ids)
      customersData = res.data
      fetchErr = res.error
    }

    if (fetchErr) throw fetchErr

    const metadataMap: Record<string, any> = {}
    customersData?.forEach(c => {
      metadataMap[c.id] = c.metadata || {}
    })

    return NextResponse.json({ success: true, metadataMap })

  } catch (err: any) {
    console.error('[ShapeUp] Customer metadata fetch error:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
