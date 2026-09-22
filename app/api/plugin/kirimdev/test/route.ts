import { NextResponse } from 'next/server'
import { createClient, getAuthUser } from '@/lib/supabaseServer'
import { testKirimDevConnection } from '@/lib/integrations/kirimdev'

// ============================================================
// POST /api/plugin/kirimdev/test
// Test API key validity with kirim.dev.
// Body: { api_key, phone_number_id }
// ============================================================
export async function POST(req: Request) {
  try {
    const supabase = await createClient()
    const { user, error: authErr } = await getAuthUser(supabase)
    if (authErr || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await req.json()
    const { api_key, phone_number_id } = body

    if (!api_key || !phone_number_id) {
      return NextResponse.json(
        { error: 'API Key dan Phone Number ID wajib diisi untuk test koneksi.' },
        { status: 400 }
      )
    }

    const result = await testKirimDevConnection(api_key.trim(), phone_number_id.trim())
    return NextResponse.json(result)
  } catch (err: any) {
    console.error('[kirimdev] Test Connection Error:', err)
    return NextResponse.json(
      { error: err.message ?? 'Test koneksi gagal.' },
      { status: 400 }
    )
  }
}
