import { NextResponse } from 'next/server'
import { seedDefaultCOA } from '@/lib/coa'
import { getApiContext, invalidateProfileCache } from '@/lib/apiContext'

export async function GET(req: Request) {
  try {
    const ctx = await getApiContext({ requireBusiness: false })
    if (ctx.error) return ctx.error
    const { user, supabaseAdmin } = ctx

    // 1. Ambil unit bisnis yang ditugaskan di business_staff
    const { data: bsData, error: bsError } = await supabaseAdmin
      .from('business_staff')
      .select('role, permissions, businesses (*)')
      .eq('profile_id', user.id)

    if (bsError) throw bsError

    // 2. Ambil unit bisnis yang dimiliki oleh user
    const { data: ownedData, error: ownedError } = await supabaseAdmin
      .from('businesses')
      .select('*')
      .eq('owner_id', user.id)

    if (ownedError) throw ownedError

    const bizMap = new Map<string, any>()
    bsData?.forEach((item: any) => {
      if (item.businesses) bizMap.set(item.businesses.id, item.businesses)
    })
    ownedData?.forEach((biz: any) => {
      bizMap.set(biz.id, biz)
    })

    const isOwner = Boolean(ownedData && ownedData.length > 0)

    return NextResponse.json({
      businesses: Array.from(bizMap.values()),
      isOwner
    })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Terjadi kesalahan server internal"
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

export async function POST(req: Request) {
  try {
    const ctx = await getApiContext({ requireBusiness: false })
    if (ctx.error) return ctx.error
    const { user, supabaseAdmin } = ctx

    // Guard: Periksa apakah user adalah staf dari bisnis orang lain (bukan Pengguna Utama)
    const [ownedRes, staffRes] = await Promise.all([
      supabaseAdmin.from('businesses').select('id').eq('owner_id', user.id).limit(1),
      supabaseAdmin.from('business_staff').select('id').eq('profile_id', user.id).limit(1)
    ])

    const isOwner = Boolean(ownedRes.data && ownedRes.data.length > 0)
    const isStaff = Boolean(staffRes.data && staffRes.data.length > 0)

    // Staf dari unit bisnis milik orang lain dilarang membuat bisnis baru
    if (!isOwner && isStaff) {
      return NextResponse.json(
        { error: "Hanya Pengguna Utama (Pemilik Bisnis) yang memiliki wewenang untuk membuat unit bisnis baru." },
        { status: 403 }
      )
    }

    const body = await req.json().catch(() => ({}))
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

    const userEmail = user.email || ''
    const userFullName = user.user_metadata?.full_name || user.email?.split('@')[0] || 'User'

    const { error: profileError } = await supabaseAdmin
      .from('profiles')
      .upsert({ 
        id: user.id,
        business_id: biz.id,
        active_business_id: biz.id,
        role: 'admin',
        email: userEmail,
        full_name: userFullName
      }, { onConflict: 'id' })

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

