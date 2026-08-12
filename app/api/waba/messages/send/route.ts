import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabaseServer'
import { sendWabaTextMessage } from '@/lib/integrations/waba'

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

    const body = await req.json()
    const { conversation_id, to, text } = body

    if (!text || !text.trim()) {
      return NextResponse.json({ error: 'Teks pesan tidak boleh kosong.' }, { status: 400 })
    }

    if (!to && !conversation_id) {
      return NextResponse.json({ error: 'Nomor penerima (to) atau ID Percakapan (conversation_id) wajib diisi.' }, { status: 400 })
    }

    const result = await sendWabaTextMessage({
      businessId: profile.active_business_id,
      to: to || '',
      text: text.trim(),
      conversationId: conversation_id || undefined,
    })

    return NextResponse.json({
      success: true,
      message: 'Pesan berhasil dikirim via WABA Official',
      result,
    })

  } catch (err: any) {
    console.error('Send WABA Message Error:', err)
    return NextResponse.json({
      error: err.message || 'Gagal mengirim pesan via Meta WABA.',
    }, { status: 500 })
  }
}
