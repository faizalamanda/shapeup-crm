import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'
import { seedDefaultCOA } from '@/lib/coa'
import { getAuthUser, getAdminSupabase } from '@/lib/supabaseServer'

export async function POST(req: Request) {
  const cookieStore = await cookies()
  
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return cookieStore.getAll() },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, {
                ...options,
                maxAge: 31536000,
                sameSite: 'lax',
                path: '/'
              })
            )
          } catch { /* Ignore */ }
        },
      },
    }
  )

  try {
    const body = await req.json()
    const { name, address, phone, timezone } = body
    
    // 1. Authenticate user from session/cookies
    const { user, error: authError } = await getAuthUser(supabase)
    if (authError || !user) {
      return NextResponse.json({ error: "Sesi habis, silakan login ulang." }, { status: 401 })
    }

    if (!name || !name.trim()) {
      return NextResponse.json({ error: "Nama bisnis wajib diisi." }, { status: 400 })
    }

    // 2. Use Admin Client (service role) to bypass RLS for business setup
    const adminSupabase = getAdminSupabase()

    const { data: biz, error: bizError } = await adminSupabase
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

    // 3. Update User Profile: set active_business_id, business_id, and promote role to 'admin'
    const { error: profileError } = await adminSupabase
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

    // 4. Register Owner in business_staff table as Admin
    const { error: bsError } = await adminSupabase
      .from('business_staff')
      .insert({
        business_id: biz.id,
        profile_id: user.id,
        role: 'admin'
      })

    if (bsError && !bsError.message.includes('duplicate')) {
      console.error("Business Staff Assignment Error:", bsError)
    }

    // 5. Seed Default Chart of Accounts (COA)
    try {
      await seedDefaultCOA(biz.id, adminSupabase)
    } catch (e) {
      console.error("COA Seeding warning:", e)
    }

    return NextResponse.json({ success: true, business: biz })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Terjadi kesalahan server internal"
    console.error("Server Error in POST /api/business:", err)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

