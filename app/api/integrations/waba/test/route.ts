import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabaseServer'
import { testWabaConnection } from '@/lib/integrations/waba'

export async function POST(req: Request) {
  try {
    const supabase = await createClient()
    const { data: { user }, error: authErr } = await supabase.auth.getUser()

    if (authErr || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await req.json()
    const { access_token, phone_number_id } = body

    if (!access_token || !phone_number_id) {
      return NextResponse.json({ error: 'Access Token dan Phone Number ID wajib diisi.' }, { status: 400 })
    }

    const result = await testWabaConnection(access_token, phone_number_id)

    return NextResponse.json({
      success: true,
      message: `✅ Berhasil terhubung ke Meta Graph API! Nomor WABA: ${result.display_phone_number} (${result.verified_name})`,
      details: result,
    })

  } catch (err: any) {
    console.error('WABA Test Error:', err)
    return NextResponse.json({
      error: err.message || 'Gagal terhubung ke Meta API. Periksa kembali Token dan Phone Number ID Anda.',
    }, { status: 400 })
  }
}
