import { NextResponse } from 'next/server'
import { getApiContext } from '@/lib/apiContext'
import { getPriceGuardSettings } from '@/lib/priceGuard/settings'
import { verifyPin } from '@/lib/priceGuard/pinCrypto'

// GET: Return active approvers list for POS authorization modal dropdown
export async function GET() {
  try {
    const ctx = await getApiContext()
    if (ctx.error) return ctx.error
    const { businessId, supabaseAdmin } = ctx

    if (!businessId) {
      return NextResponse.json({ error: 'Unit bisnis aktif tidak ditemukan' }, { status: 400 })
    }

    const [bizRes, staffRows, pinRows] = await Promise.all([
      supabaseAdmin.from('businesses').select('owner_id').eq('id', businessId).maybeSingle(),
      supabaseAdmin
        .from('business_staff')
        .select('profile_id, role, permissions, can_approve_pos, profile:profiles(id, full_name, email)')
        .eq('business_id', businessId),
      supabaseAdmin
        .from('pos_approver_pins')
        .select('user_id')
        .eq('business_id', businessId)
    ])

    const ownerId = bizRes.data?.owner_id
    const pinUserIds = new Set((pinRows.data || []).map((p: any) => p.user_id))

    const list: Array<{ id: string; name: string; role: string; is_owner: boolean; has_pin: boolean }> = []

    // 1. Owner
    if (ownerId) {
      const { data: ownerProf } = await supabaseAdmin
        .from('profiles')
        .select('id, full_name')
        .eq('id', ownerId)
        .maybeSingle()

      if (ownerProf) {
        list.push({
          id: ownerProf.id,
          name: `${ownerProf.full_name || 'Pemilik'} (Owner)`,
          role: 'owner',
          is_owner: true,
          has_pin: pinUserIds.has(ownerProf.id)
        })
      }
    }

    // 2. Staff with can_approve_pos
    if (Array.isArray(staffRows.data)) {
      staffRows.data.forEach((row: any) => {
        const prof = Array.isArray(row.profile) ? row.profile[0] : row.profile
        if (!prof || prof.id === ownerId) return

        const perms: string[] = Array.isArray(row.permissions) ? row.permissions : []
        const canApprove = Boolean(row.can_approve_pos || perms.includes('can_approve_pos'))

        if (canApprove) {
          list.push({
            id: prof.id,
            name: `${prof.full_name || 'Staf'} (${row.role === 'admin' ? 'Admin' : 'Staf'})`,
            role: row.role || 'staff',
            is_owner: false,
            has_pin: pinUserIds.has(prof.id)
          })
        }
      })
    }

    return NextResponse.json({
      success: true,
      approvers: list
    })
  } catch (err: any) {
    console.error('[API /api/pos/price-authorizations GET] Error:', err)
    return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500 })
  }
}

// POST: Execute authorization verification & record audit log
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

    const rawTrigger = body.trigger || (body.authorization_type === 'line_item_price' ? 'line_price' : body.authorization_type)
    const trigger = rawTrigger === 'line_item_price' ? 'line_price' : rawTrigger

    const {
      approver_id,
      pin,
      reason,
      product_id = null,
      qty = 1,
      shift_id = null
    } = body

    const requested_net_price = body.requested_net_price ?? body.proposed_price ?? 0
    const cost_snapshot = body.cost_snapshot ?? 0

    if (!trigger || !['line_price', 'global_discount'].includes(trigger)) {
      return NextResponse.json({ error: 'Tipe otorisasi tidak valid' }, { status: 400 })
    }

    // 1. Fetch current price guard settings
    const settings = await getPriceGuardSettings(businessId, supabaseAdmin)

    // Check if neither PIN nor reason is required (hard block mode)
    if (!settings.require_approver_pin && !settings.require_reason) {
      return NextResponse.json({
        error: 'Proteksi HPP aktif dan tidak mengizinkan otorisasi override. Transaksi dengan harga ini diblokir.'
      }, { status: 403 })
    }

    // 2. Validate Reason if required
    const cleanReason = (reason || '').trim()
    if (settings.require_reason && !cleanReason) {
      return NextResponse.json({
        error: 'Alasan otorisasi wajib diisi.'
      }, { status: 400 })
    }

    let approvedByName = 'Otorisasi Sistem'
    let effectiveApproverId = approver_id || user.id

    // 3. Validate PIN if required
    if (settings.require_approver_pin) {
      if (!approver_id) {
        return NextResponse.json({ error: 'Approver wajib dipilih.' }, { status: 400 })
      }
      if (!pin) {
        return NextResponse.json({ error: 'PIN Approver wajib diisi.' }, { status: 400 })
      }

      // Check approver eligibility
      const [bizRes, staffRes] = await Promise.all([
        supabaseAdmin.from('businesses').select('owner_id').eq('id', businessId).maybeSingle(),
        supabaseAdmin
          .from('business_staff')
          .select('role, permissions, can_approve_pos')
          .eq('business_id', businessId)
          .eq('profile_id', approver_id)
          .maybeSingle()
      ])

      const isOwner = bizRes.data?.owner_id === approver_id
      const perms: string[] = Array.isArray(staffRes.data?.permissions) ? staffRes.data.permissions : []
      const canApprove = isOwner || Boolean(staffRes.data?.can_approve_pos || perms.includes('can_approve_pos'))

      if (!canApprove) {
        return NextResponse.json({ error: 'Pengguna yang dipilih bukan Approver POS yang sah.' }, { status: 403 })
      }

      // Fetch PIN record
      const { data: pinRow, error: pinFetchErr } = await supabaseAdmin
        .from('pos_approver_pins')
        .select('*')
        .eq('business_id', businessId)
        .eq('user_id', approver_id)
        .maybeSingle()

      if (pinFetchErr || !pinRow || !pinRow.pin_hash) {
        return NextResponse.json({
          error: 'Approver yang dipilih belum mengatur PIN di Pengaturan Staf.'
        }, { status: 400 })
      }

      // Check lockout status
      if (pinRow.locked_until) {
        const lockedTime = new Date(pinRow.locked_until).getTime()
        const now = Date.now()
        if (lockedTime > now) {
          const remainingSeconds = Math.ceil((lockedTime - now) / 1000)
          return NextResponse.json({
            error: `PIN Approver terkunci karena 5 kali salah. Silakan coba lagi dalam ${remainingSeconds} detik.`
          }, { status: 429 })
        }
      }

      // Verify PIN
      const isMatch = verifyPin(String(pin), pinRow.pin_hash)
      if (!isMatch) {
        const newAttempts = (pinRow.failed_attempts || 0) + 1
        const lockUntil = newAttempts >= 5 ? new Date(Date.now() + 5 * 60 * 1000).toISOString() : null

        await supabaseAdmin
          .from('pos_approver_pins')
          .update({
            failed_attempts: newAttempts,
            locked_until: lockUntil,
            updated_at: new Date().toISOString()
          })
          .eq('business_id', businessId)
          .eq('user_id', approver_id)

        if (newAttempts >= 5) {
          return NextResponse.json({
            error: 'PIN salah 5 kali berturut-turut. Akun approver dikunci selama 5 menit.'
          }, { status: 429 })
        }

        return NextResponse.json({
          error: `PIN Approver salah. Sisa kesempatan: ${5 - newAttempts}x.`
        }, { status: 401 })
      }

      // Reset failed attempts on success
      if (pinRow.failed_attempts > 0 || pinRow.locked_until) {
        await supabaseAdmin
          .from('pos_approver_pins')
          .update({
            failed_attempts: 0,
            locked_until: null,
            updated_at: new Date().toISOString()
          })
          .eq('business_id', businessId)
          .eq('user_id', approver_id)
      }

      // Fetch approver name
      const { data: approverProf } = await supabaseAdmin
        .from('profiles')
        .select('full_name')
        .eq('id', approver_id)
        .maybeSingle()

      approvedByName = approverProf?.full_name || 'Approver'
    } else {
      // Reason only mode
      approvedByName = user.email || 'Kasir (Self-attestation)'
    }

    // 4. Record Append-only Audit Log
    const logPayload = {
      business_id: businessId,
      channel: 'pos',
      trigger,
      shift_id: shift_id || null,
      requested_by: user.id,
      approved_by: effectiveApproverId,
      product_id: product_id || null,
      qty: Number(qty) || 1,
      requested_net_price: Number(requested_net_price) || 0,
      cost_snapshot: Number(cost_snapshot) || 0,
      reason: cleanReason || null,
      created_at: new Date().toISOString()
    }

    let authorizationId = 'auth-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7)

    try {
      const { data: logRow, error: logErr } = await supabaseAdmin
        .from('price_override_logs')
        .insert(logPayload)
        .select('id')
        .single()

      if (!logErr && logRow?.id) {
        authorizationId = logRow.id
      }
    } catch (e) {
      console.warn('[price-authorizations] Log insert fallback:', e)
    }

    return NextResponse.json({
      success: true,
      authorization_id: authorizationId,
      approved_by: effectiveApproverId,
      approved_by_name: approvedByName,
      trigger,
      product_id,
      timestamp: new Date().toISOString()
    })
  } catch (err: any) {
    console.error('[API /api/pos/price-authorizations POST] Error:', err)
    return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500 })
  }
}
