import { NextResponse } from 'next/server'
import { getApiContext } from '@/lib/apiContext'
import { getPriceGuardSettings, savePriceGuardSettings } from '@/lib/priceGuard/settings'

// Helper to verify caller is Owner or Admin of the active business
async function checkOwnerOrAdmin(businessId: string, userId: string, adminClient: any) {
  const [bizRes, staffRes] = await Promise.all([
    adminClient.from('businesses').select('id, owner_id').eq('id', businessId).maybeSingle(),
    adminClient.from('business_staff').select('role, permissions').eq('business_id', businessId).eq('profile_id', userId).maybeSingle()
  ])

  const isOwner = bizRes.data?.owner_id === userId
  const isAdmin = isOwner || staffRes.data?.role === 'admin'
  return { isOwner, isAdmin, ownerId: bizRes.data?.owner_id }
}

// GET: Fetch POS Price Guard settings and list of approvers
export async function GET() {
  try {
    const ctx = await getApiContext()
    if (ctx.error) return ctx.error
    const { user, businessId, supabaseAdmin } = ctx

    if (!businessId) {
      return NextResponse.json({ error: 'Unit bisnis aktif tidak ditemukan' }, { status: 400 })
    }

    const { isAdmin, ownerId } = await checkOwnerOrAdmin(businessId, user.id, supabaseAdmin)
    if (!isAdmin) {
      return NextResponse.json({ error: 'Akses ditolak. Hanya Pemilik atau Admin yang dapat mengakses Pengaturan POS.' }, { status: 403 })
    }

    // 1. Fetch current price guard settings
    const settings = await getPriceGuardSettings(businessId, supabaseAdmin)

    // 2. Fetch Owner profile
    const { data: ownerProfile } = await supabaseAdmin
      .from('profiles')
      .select('id, full_name, email')
      .eq('id', ownerId)
      .maybeSingle()

    // 3. Fetch Staff profiles and permissions
    const { data: staffRows } = await supabaseAdmin
      .from('business_staff')
      .select('profile_id, role, permissions, can_approve_pos, profile:profiles(id, full_name, email)')
      .eq('business_id', businessId)

    // 4. Fetch PIN existence status (without revealing hashes)
    let pinUserIds = new Set<string>()
    try {
      const { data: pins } = await supabaseAdmin
        .from('pos_approver_pins')
        .select('user_id')
        .eq('business_id', businessId)

      if (pins) {
        pins.forEach((p: any) => pinUserIds.add(p.user_id))
      }
    } catch {
      // Table might not exist yet
    }

    // Build unified approver candidates list
    const approvers: any[] = []

    if (ownerProfile) {
      approvers.push({
        user_id: ownerProfile.id,
        name: ownerProfile.full_name || 'Pemilik Unit Bisnis',
        email: ownerProfile.email || '',
        role: 'owner',
        is_owner: true,
        can_approve_pos: true, // Owner always eligible
        has_pin: pinUserIds.has(ownerProfile.id)
      })
    }

    if (Array.isArray(staffRows)) {
      staffRows.forEach((row: any) => {
        const prof = Array.isArray(row.profile) ? row.profile[0] : row.profile
        if (!prof || prof.id === ownerId) return // Skip owner if duplicated in staff

        const perms: string[] = Array.isArray(row.permissions) ? row.permissions : []
        const canApprove = Boolean(row.can_approve_pos || perms.includes('can_approve_pos'))

        approvers.push({
          user_id: prof.id,
          name: prof.full_name || 'Staf',
          email: prof.email || '',
          role: row.role || 'staff',
          is_owner: false,
          can_approve_pos: canApprove,
          has_pin: pinUserIds.has(prof.id)
        })
      })
    }

    return NextResponse.json({
      success: true,
      settings,
      approvers
    })
  } catch (err: any) {
    console.error('[API /api/settings/pos GET] Error:', err)
    return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500 })
  }
}

// POST: Save POS Price Guard settings and update approvers
export async function POST(req: Request) {
  try {
    const ctx = await getApiContext()
    if (ctx.error) return ctx.error
    const { user, businessId, supabaseAdmin } = ctx

    if (!businessId) {
      return NextResponse.json({ error: 'Unit bisnis aktif tidak ditemukan' }, { status: 400 })
    }

    const { isAdmin } = await checkOwnerOrAdmin(businessId, user.id, supabaseAdmin)
    if (!isAdmin) {
      return NextResponse.json({ error: 'Akses ditolak. Hanya Pemilik atau Admin yang dapat mengubah Pengaturan POS.' }, { status: 403 })
    }

    const body = await req.json().catch(() => null)
    if (!body) {
      return NextResponse.json({ error: 'Payload tidak valid' }, { status: 400 })
    }

    const { settings, approver_user_ids } = body

    // 1. Save settings
    const savedSettings = await savePriceGuardSettings(
      businessId,
      settings || {},
      user.id,
      supabaseAdmin
    )

    // 2. Update staff can_approve_pos status if approver_user_ids provided
    if (Array.isArray(approver_user_ids)) {
      const allowedSet = new Set(approver_user_ids)

      const { data: staffList } = await supabaseAdmin
        .from('business_staff')
        .select('id, profile_id, permissions')
        .eq('business_id', businessId)

      if (Array.isArray(staffList)) {
        await Promise.all(
          staffList.map(async (st: any) => {
            const shouldApprove = allowedSet.has(st.profile_id)
            const currentPerms: string[] = Array.isArray(st.permissions) ? st.permissions : []
            const newPerms = shouldApprove
              ? Array.from(new Set([...currentPerms, 'can_approve_pos']))
              : currentPerms.filter((p: string) => p !== 'can_approve_pos')

            const updatePayload: Record<string, any> = {
              permissions: newPerms
            }

            // Also update can_approve_pos column if it exists in schema
            try {
              await supabaseAdmin
                .from('business_staff')
                .update({ ...updatePayload, can_approve_pos: shouldApprove })
                .eq('id', st.id)
            } catch {
              // Fallback if column not yet added
              await supabaseAdmin
                .from('business_staff')
                .update(updatePayload)
                .eq('id', st.id)
            }
          })
        )
      }
    }

    return NextResponse.json({
      success: true,
      settings: savedSettings
    })
  } catch (err: any) {
    console.error('[API /api/settings/pos POST] Error:', err)
    return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500 })
  }
}
