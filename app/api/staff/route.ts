import { createClient } from '@supabase/supabase-js'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'

// Helper to initialize Supabase Admin Client
function getSupabaseAdmin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

// Helper to check if the current user is an Admin
async function checkAdminSession(cookieStore: any) {
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return cookieStore.getAll() },
        setAll() {},
      },
    }
  )

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { isAdmin: false, error: "Sesi tidak valid, silakan login ulang." }

  const { data: profile } = await supabase
    .from('profiles')
    .select('business_id, role')
    .eq('id', user.id)
    .single()

  if (!profile || profile.role !== 'admin') {
    return { isAdmin: false, error: "Hanya Admin yang memiliki akses ke fitur ini." }
  }

  return { isAdmin: true, adminProfile: profile, user }
}

export async function POST(req: Request) {
  const cookieStore = await cookies()
  const { email, password, full_name, role } = await req.json()

  try {
    const { isAdmin, adminProfile, error: authError } = await checkAdminSession(cookieStore)
    if (!isAdmin) {
      return NextResponse.json({ error: authError }, { status: 403 })
    }

    const supabaseAdmin = getSupabaseAdmin()

    // 1. Buat User di Auth Supabase (Tanpa konfirmasi email)
    const { data: newUser, error: createError } = await supabaseAdmin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name }
    })

    if (createError) throw createError

    // 2. Update Profile Staff tersebut agar nyambung ke Bisnis Admin dan Role yang dipilih
    const { error: profileError } = await supabaseAdmin
      .from('profiles')
      .update({ 
        full_name,
        business_id: adminProfile.business_id,
        active_business_id: adminProfile.business_id, // Also set active business ID
        role: role || 'staff'
      })
      .eq('id', newUser.user.id)

    if (profileError) throw profileError

    return NextResponse.json({ success: true, message: "Staff berhasil didaftarkan" })

  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

export async function PUT(req: Request) {
  const cookieStore = await cookies()
  const { id, email, password, full_name, role } = await req.json()

  if (!id) {
    return NextResponse.json({ error: "ID staff wajib disertakan" }, { status: 400 })
  }

  try {
    const { isAdmin, adminProfile, error: authError } = await checkAdminSession(cookieStore)
    if (!isAdmin) {
      return NextResponse.json({ error: authError }, { status: 403 })
    }

    const supabaseAdmin = getSupabaseAdmin()

    // Cek apakah staff yang diedit berada dalam bisnis yang sama dengan admin
    const { data: targetProfile, error: targetProfileError } = await supabaseAdmin
      .from('profiles')
      .select('business_id')
      .eq('id', id)
      .single()

    if (targetProfileError || !targetProfile) {
      return NextResponse.json({ error: "Staff tidak ditemukan" }, { status: 404 })
    }

    if (targetProfile.business_id !== adminProfile.business_id) {
      return NextResponse.json({ error: "Anda tidak memiliki akses untuk mengedit staff di unit bisnis lain" }, { status: 403 })
    }

    // 1. Update Auth Supabase jika email/password/metadata berubah
    const updateAuthData: any = {}
    if (email) updateAuthData.email = email
    if (password) updateAuthData.password = password
    if (full_name) updateAuthData.user_metadata = { full_name }

    if (Object.keys(updateAuthData).length > 0) {
      const { error: updateAuthError } = await supabaseAdmin.auth.admin.updateUserById(id, updateAuthData)
      if (updateAuthError) throw updateAuthError
    }

    // 2. Update profiles table
    const updateProfileData: any = {}
    if (full_name !== undefined) updateProfileData.full_name = full_name
    if (role !== undefined) updateProfileData.role = role

    if (Object.keys(updateProfileData).length > 0) {
      const { error: updateProfileError } = await supabaseAdmin
        .from('profiles')
        .update(updateProfileData)
        .eq('id', id)

      if (updateProfileError) throw updateProfileError
    }

    return NextResponse.json({ success: true, message: "Data staff berhasil diperbarui" })

  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}