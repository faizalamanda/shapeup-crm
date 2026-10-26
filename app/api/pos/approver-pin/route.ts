import { NextResponse } from 'next/server'
import { getApiContext } from '@/lib/apiContext'
import { validatePinFormat, hashPin } from '@/lib/priceGuard/pinCrypto'
import { createClient } from '@/lib/supabaseServer'

export async function GET() {
  try {
    const ctx = await getApiContext()
    if (ctx.error) return ctx.error
    const { user, businessId, supabaseAdmin } = ctx

    if (!businessId) {
      return NextResponse.json({ error: 'Unit bisnis aktif tidak ditemukan' }, { status: 400 })
    }

    // Check if user is owner or has can_approve_pos permission
    const [bizRes, staffRes] = await Promise.all([
      supabaseAdmin.from('businesses').select('id, owner_id').eq('id', businessId).maybeSingle(),
      supabaseAdmin.from('business_staff').select('role, permissions, can_approve_pos').eq('business_id', businessId).eq('profile_id', user.id).maybeSingle()
    ])

    const isOwner = bizRes.data?.owner_id === user.id
    const perms: string[] = Array.isArray(staffRes.data?.permissions) ? staffRes.data.permissions : []
    const canApprove = isOwner || Boolean(staffRes.data?.can_approve_pos || perms.includes('can_approve_pos'))

    // Check if PIN already set
    let hasPin = false
    try {
      const { data: pinRow } = await supabaseAdmin
        .from('pos_approver_pins')
        .select('user_id')
        .eq('business_id', businessId)
        .eq('user_id', user.id)
        .maybeSingle()

      hasPin = Boolean(pinRow)
    } catch {
      // Table might not exist yet
    }

    return NextResponse.json({
      success: true,
      canApprove,
      hasPin
    })
  } catch (err: any) {
    console.error('[API /api/pos/approver-pin GET] Error:', err)
    return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500 })
  }
}

export async function POST(req: Request) {
  try {
    const ctx = await getApiContext()
    if (ctx.error) return ctx.error
    const { user, businessId, supabaseAdmin } = ctx

    if (!businessId) {
      return NextResponse.json({ error: 'Unit bisnis aktif tidak ditemukan' }, { status: 400 })
    }

    const body = await req.json().catch(() => null)
    if (!body) {
      return NextResponse.json({ error: 'Payload tidak valid' }, { status: 400 })
    }

    const action = body.action || (body.pin ? 'set_self' : '')

    // ─── ACTION 1: SET SELF PIN ──────────────────────────────────────────────
    if (action === 'set_self') {
      const pin = body.pin
      const password = body.password || body.accountPassword

      if (!pin) {
        return NextResponse.json({ error: 'PIN wajib diisi.' }, { status: 400 })
      }

      const pinValidation = validatePinFormat(pin)
      if (!pinValidation.valid) {
        return NextResponse.json({ error: pinValidation.error }, { status: 400 })
      }

      // Verify user's account password for security
      if (!password) {
        return NextResponse.json({ error: 'Password akun Anda wajib diisi untuk verifikasi keamanan.' }, { status: 400 })
      }

      const userEmail = user.email
      if (!userEmail) {
        return NextResponse.json({ error: 'Email pengguna tidak ditemukan.' }, { status: 400 })
      }

      const authClient = await createClient()
      const { error: authErr } = await authClient.auth.signInWithPassword({
        email: userEmail,
        password: String(password)
      })

      if (authErr) {
        return NextResponse.json({ error: 'Password akun yang Anda masukkan salah.' }, { status: 401 })
      }

      // Check approver eligibility
      const [bizRes, staffRes] = await Promise.all([
        supabaseAdmin.from('businesses').select('id, owner_id').eq('id', businessId).maybeSingle(),
        supabaseAdmin.from('business_staff').select('role, permissions, can_approve_pos').eq('business_id', businessId).eq('profile_id', user.id).maybeSingle()
      ])

      const isOwner = bizRes.data?.owner_id === user.id
      const perms: string[] = Array.isArray(staffRes.data?.permissions) ? staffRes.data.permissions : []
      const canApprove = isOwner || Boolean(staffRes.data?.can_approve_pos || perms.includes('can_approve_pos'))

      if (!canApprove) {
        return NextResponse.json({
          error: 'Akun Anda belum ditunjuk sebagai Approver POS oleh Pemilik/Admin.'
        }, { status: 403 })
      }

      const hashed = hashPin(pin)

      const { error: pinUpsertErr } = await supabaseAdmin
        .from('pos_approver_pins')
        .upsert({
          business_id: businessId,
          user_id: user.id,
          pin_hash: hashed,
          failed_attempts: 0,
          locked_until: null,
          updated_at: new Date().toISOString()
        }, { onConflict: 'business_id,user_id' })

      if (pinUpsertErr) {
        throw new Error('Gagal menyimpan PIN: ' + pinUpsertErr.message)
      }

      return NextResponse.json({
        success: true,
        message: 'PIN Otorisasi POS berhasil disimpan.'
      })
    }

    // ─── ACTION 2: RESET PIN (BY OWNER / ADMIN) ──────────────────────────────
    if (action === 'reset_staff') {
      const { target_user_id } = body

      if (!target_user_id) {
        return NextResponse.json({ error: 'ID staf target wajib diisi.' }, { status: 400 })
      }

      // Verify caller is Owner or Admin
      const [bizRes, callerStaffRes] = await Promise.all([
        supabaseAdmin.from('businesses').select('id, owner_id').eq('id', businessId).maybeSingle(),
        supabaseAdmin.from('business_staff').select('role').eq('business_id', businessId).eq('profile_id', user.id).maybeSingle()
      ])

      const isOwner = bizRes.data?.owner_id === user.id
      const isAdmin = isOwner || callerStaffRes.data?.role === 'admin'

      if (!isAdmin) {
        return NextResponse.json({ error: 'Hanya Pemilik atau Admin yang dapat me-reset PIN staf.' }, { status: 403 })
      }

      const { error: delErr } = await supabaseAdmin
        .from('pos_approver_pins')
        .delete()
        .eq('business_id', businessId)
        .eq('user_id', target_user_id)

      if (delErr) {
        throw new Error('Gagal mereset PIN staf: ' + delErr.message)
      }

      return NextResponse.json({
        success: true,
        message: 'PIN staf berhasil direset. Staf dapat mengatur PIN baru.'
      })
    }

    return NextResponse.json({ error: 'Aksi tidak dikenal.' }, { status: 400 })
  } catch (err: any) {
    console.error('[API /api/pos/approver-pin POST] Error:', err)
    return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500 })
  }
}
