import { NextResponse } from 'next/server'
import { getApiContext } from '@/lib/apiContext'

// Helper to check if the current user is an Admin
async function checkAdminSession() {
  const ctx = await getApiContext()
  if (ctx.error) {
    return { isAdmin: false, error: "Sesi tidak valid, silakan login ulang." }
  }

  const { user, businessId, supabaseAdmin } = ctx
  const activeBid = businessId

  // Parallelize admin & owner verification in 1 round-trip
  const [profileRes, ownedRes, bsRes] = await Promise.all([
    supabaseAdmin.from('profiles').select('business_id, active_business_id, role, full_name, email').eq('id', user.id).maybeSingle(),
    activeBid ? supabaseAdmin.from('businesses').select('id, owner_id').eq('id', activeBid).maybeSingle() : Promise.resolve({ data: null }),
    activeBid ? supabaseAdmin.from('business_staff').select('role').eq('business_id', activeBid).eq('profile_id', user.id).maybeSingle() : Promise.resolve({ data: null })
  ])

  const profile = profileRes.data
  const bizData = ownedRes.data
  const isOwner = bizData?.owner_id === user.id
  const isStaffAdmin = bsRes.data?.role === 'admin'
  const isGlobalAdmin = profile?.role === 'admin'
  const isAdminUser = isGlobalAdmin || isOwner || isStaffAdmin

  if (!isAdminUser) {
    return { isAdmin: false, error: "Hanya Admin atau Pemilik Unit Bisnis yang memiliki akses ke fitur ini." }
  }

  const adminProfile = {
    ...(profile || {}),
    active_business_id: activeBid
  }

  return { isAdmin: true, adminProfile, user, supabaseAdmin, ownerId: bizData?.owner_id }
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const email = searchParams.get('email')

  try {
    const { isAdmin, adminProfile, user, supabaseAdmin, ownerId, error: authError } = await checkAdminSession()
    if (!isAdmin || !adminProfile || !adminProfile.active_business_id) {
      return NextResponse.json({ error: authError || "Akses ditolak" }, { status: 403 })
    }

    if (email) {
      const trimmedEmail = email.trim().toLowerCase()
      
      // Fast-path profile lookup by email
      let { data: existingProfile, error: profileError } = await supabaseAdmin
        .from('profiles')
        .select('id, full_name, email, business_id')
        .eq('email', trimmedEmail)
        .maybeSingle()

      if (profileError) throw profileError

      // Fallback to auth admin listUsers if not in profiles table
      if (!existingProfile) {
        const { data: { users }, error: listError } = await supabaseAdmin.auth.admin.listUsers({ perPage: 1000 })
        if (listError) throw listError

        const existingAuthUser = users?.find(u => u.email?.toLowerCase() === trimmedEmail)
        if (existingAuthUser) {
          const { data: newProfile } = await supabaseAdmin
            .from('profiles')
            .upsert({
              id: existingAuthUser.id,
              email: existingAuthUser.email,
              full_name: existingAuthUser.user_metadata?.full_name || email.split('@')[0],
              role: 'staff'
            }, { onConflict: 'id' })
            .select('id, full_name, email, business_id')
            .single()
          existingProfile = newProfile
        }
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

    const activeBid = adminProfile.active_business_id

    // Fetch staff list directly
    let { data: bsData, error: staffError } = await supabaseAdmin
      .from('business_staff')
      .select('role, permissions, profiles (*)')
      .eq('business_id', activeBid)

    if (staffError) throw staffError

    // Conditional auto-heal ONLY if ownerId or user.id is missing from business_staff
    const existingProfileIds = new Set(bsData?.map((item: any) => item.profiles?.id).filter(Boolean))
    const missingIds: string[] = []
    if (ownerId && !existingProfileIds.has(ownerId)) missingIds.push(ownerId)
    if (user?.id && !existingProfileIds.has(user.id)) missingIds.push(user.id)

    if (missingIds.length > 0) {
      await Promise.allSettled(missingIds.map(profileId =>
        supabaseAdmin
          .from('business_staff')
          .upsert({
            business_id: activeBid,
            profile_id: profileId,
            role: 'admin',
            permissions: ['full_access']
          }, { onConflict: 'business_id,profile_id' })
      ))

      const { data: reFetched } = await supabaseAdmin
        .from('business_staff')
        .select('role, permissions, profiles (*)')
        .eq('business_id', activeBid)
      
      if (reFetched) bsData = reFetched
    }

    const staff = bsData?.map((item: any) => ({
      ...item.profiles,
      role: item.role || 'staff',
      permissions: item.permissions || []
    })).filter(s => Boolean(s.id)) || []

    return NextResponse.json({ staff })

  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

export async function POST(req: Request) {
  const { email, password, full_name, role, permissions } = await req.json()

  try {
    const { isAdmin, adminProfile, supabaseAdmin, error: authError } = await checkAdminSession()
    if (!isAdmin || !adminProfile || !adminProfile.active_business_id) {
      return NextResponse.json({ error: authError || "Akses ditolak atau bisnis aktif tidak ditemukan" }, { status: 403 })
    }

    const trimmedEmail = email.trim().toLowerCase()

    // 1. Fast-path lookup by email in profiles table
    let { data: existingProfile, error: fastProfileError } = await supabaseAdmin
      .from('profiles')
      .select('id, business_id, email, full_name')
      .eq('email', trimmedEmail)
      .maybeSingle()

    if (fastProfileError) throw fastProfileError

    if (!existingProfile) {
      // Fallback search in auth users
      const { data: { users }, error: listError } = await supabaseAdmin.auth.admin.listUsers({ perPage: 1000 })
      if (listError) throw listError

      const existingAuthUser = users?.find(u => u.email?.toLowerCase() === trimmedEmail)
      if (existingAuthUser) {
        const { data: newProfile, error: insertProfileError } = await supabaseAdmin
          .from('profiles')
          .upsert({
            id: existingAuthUser.id,
            email: existingAuthUser.email,
            full_name: existingAuthUser.user_metadata?.full_name || email.split('@')[0],
            role: role || 'staff'
          }, { onConflict: 'id' })
          .select('id, business_id, email, full_name')
          .single()

        if (insertProfileError) throw insertProfileError
        existingProfile = newProfile
      }
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
          role: role || 'staff',
          permissions: permissions || []
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
        role: role || 'staff',
        permissions: permissions || []
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
  const { id, email, password, full_name, role, permissions } = await req.json()

  if (!id) {
    return NextResponse.json({ error: "ID staff wajib disertakan" }, { status: 400 })
  }

  try {
    const { isAdmin, adminProfile, supabaseAdmin, error: authError } = await checkAdminSession()
    if (!isAdmin || !adminProfile || !adminProfile.active_business_id) {
      return NextResponse.json({ error: authError || "Akses ditolak" }, { status: 403 })
    }

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

    // 3. Update business_staff role and permissions
    if (role !== undefined || permissions !== undefined) {
      const updateData: any = {}
      if (role !== undefined) updateData.role = role
      if (permissions !== undefined) updateData.permissions = permissions

      const { error: updateBsError } = await supabaseAdmin
        .from('business_staff')
        .update(updateData)
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
  const { searchParams } = new URL(req.url)
  const id = searchParams.get('id')

  if (!id) {
    return NextResponse.json({ error: "ID staff wajib disertakan" }, { status: 400 })
  }

  try {
    const { isAdmin, adminProfile, supabaseAdmin, error: authError } = await checkAdminSession()
    if (!isAdmin || !adminProfile || !adminProfile.active_business_id) {
      return NextResponse.json({ error: authError || "Akses ditolak" }, { status: 403 })
    }

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