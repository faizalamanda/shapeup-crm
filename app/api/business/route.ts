import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'

export async function POST(req: Request) {
  const cookieStore = await cookies()
  
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return cookieStore.getAll() },
        setAll(cookiesToSet) {
          // Di Route Handler, setAll seringkali menyebabkan error jika header sudah dikirim
          // Kita biarkan kosong atau pakai try-catch sederhana
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            )
          } catch (e) { /* Ignore */ }
        },
      },
    }
  )

  try {
    const body = await req.json()
    const { name, address, phone } = body
    
    // 1. Cek User
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: "Sesi habis, silakan login ulang" }, { status: 401 })
    }

    // 2. Simpan Bisnis ke Tabel
    // Pastikan kolom owner_id ada di tabel businesses
    const { data: biz, error: bizError } = await supabase
      .from('businesses')
      .insert({ 
        name, 
        address: address || '', 
        phone: phone || '', 
        owner_id: user.id 
      })
      .select()
      .single()

    if (bizError) {
      console.error("Biz Error:", bizError)
      return NextResponse.json({ error: `Gagal simpan bisnis: ${bizError.message}` }, { status: 400 })
    }

    // 3. Update Profile User: Pasang business_id DAN jadikan role 'admin'
    const { error: profileError } = await supabase
      .from('profiles')
      .update({ 
        business_id: biz.id,
        role: 'admin' // Tambahkan ini agar sistem tahu dia bos-nya
      })
      .eq('id', user.id)

    if (profileError) {
      console.error("Profile Update Error:", profileError)
      return NextResponse.json({ error: `Gagal update profil: ${profileError.message}` }, { status: 400 })
    }

    return NextResponse.json({ success: true, business: biz })
  } catch (err: any) {
    console.error("Server Error:", err)
    return NextResponse.json({ error: "Terjadi kesalahan server internal" }, { status: 500 })
  }
}