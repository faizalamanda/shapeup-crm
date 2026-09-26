import { NextResponse } from 'next/server'
import { seedDefaultCOA } from '@/lib/coa'
import { getApiContext, invalidateProfileCache } from '@/lib/apiContext'

export async function POST(req: Request) {
  try {
    const ctx = await getApiContext({ requireBusiness: false })
    if (ctx.error) return ctx.error
    const { user, supabaseAdmin } = ctx

    const body = await req.json()
    const { name, address, phone, timezone } = body

    if (!name || !name.trim()) {
      return NextResponse.json({ error: "Nama bisnis wajib diisi." }, { status: 400 })
    }

    const { data: biz, error: bizError } = await supabaseAdmin
      .from('businesses')
      .insert({ 
        name: name.trim(), 
        address: address || '', 
        phone: phone?.trim() || null, 
        timezone: timezone || 'Asia/Jakarta',
        owner_id: user.id 
      })
      .select()
      .single()

    if (bizError) {
      console.error("Biz Error:", bizError)
      return NextResponse.json({ error: `Gagal simpan bisnis: ${bizError.message}` }, { status: 400 })
    }

    const { error: profileError } = await supabaseAdmin
      .from('profiles')
      .update({ 
        business_id: biz.id,
        active_business_id: biz.id,
        role: 'admin'
      })
      .eq('id', user.id)

    if (profileError) {
      console.error("Profile Update Error:", profileError)
      return NextResponse.json({ error: `Gagal update profil: ${profileError.message}` }, { status: 400 })
    }

    const { error: bsError } = await supabaseAdmin
      .from('business_staff')
      .insert({
        business_id: biz.id,
        profile_id: user.id,
        role: 'admin'
      })

    if (bsError && !bsError.message.includes('duplicate')) {
      console.error("Business Staff Assignment Error:", bsError)
    }

    try {
      await seedDefaultCOA(biz.id, supabaseAdmin)
    } catch (e) {
      console.error("COA Seeding warning:", e)
    }

    invalidateProfileCache(user.id)

    return NextResponse.json({ success: true, business: biz })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Terjadi kesalahan server internal"
    console.error("Server Error in POST /api/business:", err)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

