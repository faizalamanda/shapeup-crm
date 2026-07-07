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
    .select('business_id, active_business_id, role')
    .eq('id', user.id)
    .single()

  if (!profile || profile.role !== 'admin') {
    return { isAdmin: false, error: "Hanya Admin yang memiliki akses ke fitur ini." }
  }

  return { isAdmin: true, adminProfile: profile, user }
}

export async function GET(req: Request) {
  const cookieStore = await cookies()
  const { searchParams } = new URL(req.url)
  const email = searchParams.get('email')

  try {
    const { isAdmin, adminProfile, error: authError } = await checkAdminSession(cookieStore)
    if (!isAdmin || !adminProfile || !adminProfile.active_business_id) {
      return NextResponse.json({ error: authError || "Akses ditolak" }, { status: 403 })
    }

    const supabaseAdmin = getSupabaseAdmin()

    if (email) {
      const trimmedEmail = email.trim().toLowerCase()
      
      // Check in auth.users first using listUsers
      const { data: { users }, error: listError } = await supabaseAdmin.auth.admin.listUsers({ perPage: 1000 })
      if (listError) throw listError

      const existingAuthUser = users?.find(u => u.email?.toLowerCase() === trimmedEmail)
      let existingProfile = null

      if (existingAuthUser) {
        // Query profile by ID
        const { data: profile, error: profileError } = await supabaseAdmin
          .from('profiles')
          .select('id, full_name, email, business_id')
          .eq('id', existingAuthUser.id)
          .maybeSingle()

        if (profileError) throw profileError

        if (profile) {
          existingProfile = profile
          // Sync email if mismatched
          if (profile.email !== existingAuthUser.email) {
            const { data: updatedProfile } = await supabaseAdmin
              .from('profiles')
              .update({ email: existingAuthUser.email })
              .eq('id', profile.id)
              .select('id, full_name, email, business_id')
              .single()
            if (updatedProfile) {
              existingProfile = updatedProfile
            }
          }
        } else {
          // Create profile on the fly if missing
          const { data: newProfile } = await supabaseAdmin
            .from('profiles')
            .insert({
              id: existingAuthUser.id,
              email: existingAuthUser.email,
              full_name: existingAuthUser.user_metadata?.full_name || email.split('@')[0],
              role: 'staff'
            })
            .select('id, full_name, email, business_id')
            .single()
          existingProfile = newProfile
        }
      } else {
        // If not found in auth, check in profiles table as fallback
        const { data: profile, error: profileError } = await supabaseAdmin
          .from('profiles')
          .select('id, full_name, email, business_id')
          .eq('email', trimmedEmail)
          .maybeSingle()

        if (profileError) throw profileError
        existingProfile = profile
      }

      if (!existingProfile) {
        return NextResponse.json({ exists: false })
      }

      // Cek apakah sudah ditugaskan ke bisnis aktif ini
      const { data: existingAssignment, error: assignmentError } = await supabaseAdmin
        .from('business_staff')
        .select('id')
        .eq('business_id', adminProfile.active_business_id)
        .eq('profile_id', existingProfile.id)
        .maybeSingle()

      if (assignmentError) throw assignmentError

      return NextResponse.json({
        exists: true,
        id: existingProfile.id,
        full_name: existingProfile.full_name,
        email: existingProfile.email,
        alreadyInBusiness: !!existingAssignment
      })
    }

    // Ambil daftar staff dari business_staff join profiles menggunakan admin client
    const { data: bsData, error: staffError } = await supabaseAdmin
      .from('business_staff')
      .select('role, profiles (*)')
      .eq('business_id', adminProfile.active_business_id)

    if (staffError) throw staffError

    const staff = bsData?.map((item: any) => ({
      ...item.profiles,
      role: item.role
    })) || []

    return NextResponse.json({ staff })

  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

export async function POST(req: Request) {
  const cookieStore = await cookies()
  const { email, password, full_name, role } = await req.json()

  try {
    const { isAdmin, adminProfile, error: authError } = await checkAdminSession(cookieStore)
    if (!isAdmin || !adminProfile || !adminProfile.active_business_id) {
      return NextResponse.json({ error: authError || "Akses ditolak atau bisnis aktif tidak ditemukan" }, { status: 403 })
    }

    const supabaseAdmin = getSupabaseAdmin()

    const trimmedEmail = email.trim().toLowerCase()

    // 1. Cek apakah user dengan email tersebut sudah terdaftar di auth atau profiles
    const { data: { users }, error: listError } = await supabaseAdmin.auth.admin.listUsers({ perPage: 1000 })
    if (listError) throw listError

    const existingAuthUser = users?.find(u => u.email?.toLowerCase() === trimmedEmail)
    let existingProfile = null

    if (existingAuthUser) {
      // Get profile by ID
      const { data: profile, error: profileError } = await supabaseAdmin
        .from('profiles')
        .select('id, business_id, email, full_name')
        .eq('id', existingAuthUser.id)
        .maybeSingle()

      if (profileError) throw profileError

      if (profile) {
        existingProfile = profile
        // Sync email if mismatched
        if (profile.email !== existingAuthUser.email) {
          const { data: updated } = await supabaseAdmin
            .from('profiles')
            .update({ email: existingAuthUser.email })
            .eq('id', profile.id)
            .select('id, business_id, email, full_name')
            .single()
          if (updated) {
            existingProfile = updated
          }
        }
      } else {
        // Create profile on the fly if missing
        const { data: newProfile, error: insertProfileError } = await supabaseAdmin
          .from('profiles')
          .insert({
            id: existingAuthUser.id,
            email: existingAuthUser.email,
            full_name: existingAuthUser.user_metadata?.full_name || email.split('@')[0],
            role: role || 'staff'
          })
          .select('id, business_id, email, full_name')
          .single()
        
        if (insertProfileError) throw insertProfileError
        existingProfile = newProfile
      }
    } else {
      // Fallback check by email in profiles
      const { data: profile, error: profileError } = await supabaseAdmin
        .from('profiles')
        .select('id, business_id, email, full_name')
        .eq('email', trimmedEmail)
        .maybeSingle()

      if (profileError) throw profileError
      existingProfile = profile
    }

    if (existingProfile) {
      // Cek apakah sudah ditugaskan ke bisnis ini
      const { data: existingAssignment } = await supabaseAdmin
        .from('business_staff')
        .select('id')
        .eq('business_id', adminProfile.active_business_id)
        .eq('profile_id', existingProfile.id)
        .maybeSingle()

      if (existingAssignment) {
        return NextResponse.json({ error: "Staf dengan email ini sudah terdaftar di bisnis ini." }, { status: 400 })
      }

      // Tambahkan ke business_staff
      const { error: bsError } = await supabaseAdmin
        .from('business_staff')
        .insert({
          business_id: adminProfile.active_business_id,
          profile_id: existingProfile.id,
          role: role || 'staff'
        })

      if (bsError) throw bsError

      // Jika business_id utamanya kosong, update dengan bisnis ini
      if (!existingProfile.business_id) {
        await supabaseAdmin
          .from('profiles')
          .update({ business_id: adminProfile.active_business_id })
          .eq('id', existingProfile.id)
      }

      return NextResponse.json({ success: true, message: "Staf yang ada berhasil ditambahkan ke unit bisnis ini." })
    }

    // 2. Jika belum terdaftar, buat User Baru di Auth Supabase (Tanpa konfirmasi email)
    const { data: newUser, error: createError } = await supabaseAdmin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name }
    })

    if (createError) throw createError

    // 3. Tambahkan relasi many-to-many ke business_staff FIRST
    const { error: bsError } = await supabaseAdmin
      .from('business_staff')
      .insert({
        business_id: adminProfile.active_business_id,
        profile_id: newUser.user.id,
        role: role || 'staff'
      })

    if (bsError) throw bsError

    // 4. Update Profile Staff tersebut agar nyambung ke Bisnis Admin dan Role yang dipilih SECOND
    const { error: profileError } = await supabaseAdmin
      .from('profiles')
      .update({ 
        full_name,
        business_id: adminProfile.active_business_id,
        // Only set active_business_id if none exists yet (don't override their current context)
        active_business_id: adminProfile.active_business_id,
        role: role || 'staff'
      })
      .eq('id', newUser.user.id)
      .is('active_business_id', null)

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
    if (!isAdmin || !adminProfile || !adminProfile.active_business_id) {
      return NextResponse.json({ error: authError || "Akses ditolak" }, { status: 403 })
    }

    const supabaseAdmin = getSupabaseAdmin()

    // Cek apakah staff yang diedit ditugaskan ke bisnis aktif admin
    const { data: targetAssignment, error: targetAssignmentError } = await supabaseAdmin
      .from('business_staff')
      .select('id')
      .eq('business_id', adminProfile.active_business_id)
      .eq('profile_id', id)
      .maybeSingle()

    if (targetAssignmentError || !targetAssignment) {
      return NextResponse.json({ error: "Staf tidak ditemukan di unit bisnis ini atau Anda tidak memiliki akses" }, { status: 403 })
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

    // 3. Update business_staff role
    if (role !== undefined) {
      const { error: updateBsError } = await supabaseAdmin
        .from('business_staff')
        .update({ role })
        .eq('business_id', adminProfile.active_business_id)
        .eq('profile_id', id)

      if (updateBsError) throw updateBsError
    }

    return NextResponse.json({ success: true, message: "Data staff berhasil diperbarui" })

  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

export async function DELETE(req: Request) {
  const cookieStore = await cookies()
  const { searchParams } = new URL(req.url)
  const id = searchParams.get('id')

  if (!id) {
    return NextResponse.json({ error: "ID staff wajib disertakan" }, { status: 400 })
  }

  try {
    const { isAdmin, adminProfile, error: authError } = await checkAdminSession(cookieStore)
    if (!isAdmin || !adminProfile || !adminProfile.active_business_id) {
      return NextResponse.json({ error: authError || "Akses ditolak" }, { status: 403 })
    }

    const supabaseAdmin = getSupabaseAdmin()

    // Hapus penugasan staff dari unit bisnis aktif admin saat ini
    const { error: deleteError } = await supabaseAdmin
      .from('business_staff')
      .delete()
      .eq('business_id', adminProfile.active_business_id)
      .eq('profile_id', id)

    if (deleteError) throw deleteError

    return NextResponse.json({ success: true, message: "Hubungan staf dengan unit bisnis berhasil dihapus" })

  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}