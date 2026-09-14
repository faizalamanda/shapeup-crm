import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabaseServer'
import { executeAccurateSync } from '@/lib/integrations/accurate/syncService'

export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient()

    const { data: userData, error: userError } = await supabase.auth.getUser()
    if (userError || !userData.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { data: profile } = await supabase
      .from('profiles')
      .select('active_business_id')
      .eq('id', userData.user.id)
      .single()

    const businessId = profile?.active_business_id
    if (!businessId) {
      return NextResponse.json({ error: 'No active business' }, { status: 400 })
    }

    let page = 1
    try {
      const body = await req.json()
      if (body.page) page = parseInt(body.page, 10)
    } catch (e) {
      // ignore
    }

    const result = await executeAccurateSync(businessId, page)

    if (!result.success) {
      return NextResponse.json({ error: result.error || 'Failed to sync' }, { status: 400 })
    }

    return NextResponse.json(result)

  } catch (error: any) {
    console.error('Error Sync Accurate:', error)
    return NextResponse.json({ error: error.message || 'Internal Server Error' }, { status: 500 })
  }
}
