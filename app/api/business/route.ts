import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'

export async function POST(req: Request) {
  // 1. WAJIB AWAIT COOKIES di Next.js terbaru
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
              cookieStore.set(name, value, options)
            )
          } catch {
            // Ini normal jika dipanggil dari Server Component
          }
        },
      },
    }
  )

  try {
    const { name, address, phone } = await req.json()
    
    // 2. Ambil User
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: "Sesi habis, silakan login ulang" }, { status: 401 })
    }

    // 3. Simpan Bisnis
    const { data: biz, error: bizError } = await supabase
      .from('businesses')
      .insert({ 
        name, 
        address, 
        phone, 
        owner_id: user.id 
      })
      .select()
      .single()

    if (bizError) throw bizError

    // 4. Update Profile User
    const { error: profileError } = await supabase
      .from('profiles')
      .update({ business_id: biz.id })
      .eq('id', user.id)

    if (profileError) throw profileError

    return NextResponse.json({ success: true, business: biz })
  } catch (err: any) {
    console.error("Setup Error:", err.message)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}