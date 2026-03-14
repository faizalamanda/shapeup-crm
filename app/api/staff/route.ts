import { createClient } from '@supabase/supabase-js'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'

export async function POST(req: Request) {
  const cookieStore = await cookies()
  const { email, password, full_name } = await req.json()

  // 1. Inisialisasi Supabase Admin (Gunakan SERVICE_ROLE_KEY)
  // Pastikan SERVICE_ROLE_KEY ada di .env Anda
  const supabaseAdmin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY! 
  )

  // 2. Inisialisasi client biasa untuk cek sesi Admin yang sedang login
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return cookieStore.getAll() },
        setAll(cookiesToSet) { /* ... */ },
      },
    }
  )

  try {
    // Cek apakah yang memanggil API ini adalah Admin
    const { data: { user: adminUser } } = await supabase.auth.getUser()
    const { data: adminProfile } = await supabase
      .from('profiles')
      .select('business_id, role')
      .eq('id', adminUser?.id)
      .single()

    if (adminProfile?.role !== 'admin') {
      return NextResponse.json({ error: "Hanya Admin yang bisa menambah staff" }, { status: 403 })
    }

    // 3. Buat User di Auth Supabase (Tanpa konfirmasi email)
    const { data: newUser, error: createError } = await supabaseAdmin.auth.admin.createUser({
      email,
      password,
      email_confirm: true, // Langsung aktifkan
      user_metadata: { full_name }
    })

    if (createError) throw createError

    // 4. Update Profile Staff tersebut agar nyambung ke Bisnis Admin
    const { error: profileError } = await supabaseAdmin
      .from('profiles')
      .update({ 
        full_name,
        business_id: adminProfile.business_id,
        role: 'staff'
      })
      .eq('id', newUser.user.id)

    if (profileError) throw profileError

    return NextResponse.json({ success: true, message: "Staff berhasil didaftarkan" })

  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}