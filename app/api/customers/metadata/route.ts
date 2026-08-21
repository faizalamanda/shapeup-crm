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

    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
    if (!serviceRoleKey) {
      return NextResponse.json({ 
        error: 'SUPABASE_SERVICE_ROLE_KEY is not defined in env' 
      }, { status: 500 })
    }

    const { ids } = await req.json()
    if (!Array.isArray(ids) || ids.length === 0) {
      return NextResponse.json({ success: true, metadataMap: {} })
    }

    const supabaseAdmin = createAdminClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      serviceRoleKey
    )

    const { data: customers, error: fetchErr } = await supabaseAdmin
      .from('customers')
      .select('id, metadata')
      .eq('business_id', businessId)
      .in('id', ids)

    if (fetchErr) throw fetchErr

    const metadataMap: Record<string, any> = {}
    customers?.forEach(c => {
      metadataMap[c.id] = c.metadata || {}
    })

    return NextResponse.json({ success: true, metadataMap })

  } catch (err: any) {
    console.error('[ShapeUp] Customer metadata fetch error:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
