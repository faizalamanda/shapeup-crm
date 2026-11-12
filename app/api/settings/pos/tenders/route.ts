import { NextResponse } from 'next/server'
import { getApiContext } from '@/lib/apiContext'
import { resolveBusinessTenders, classifyAccountCategory, POSTender, COAAssetAccount } from '@/lib/pos/tenderResolver'

// Helper to verify caller permissions for the business
async function checkBusinessAccess(businessId: string, userId: string, adminClient: any) {
  const [bizRes, staffRes] = await Promise.all([
    adminClient.from('businesses').select('id, owner_id').eq('id', businessId).maybeSingle(),
    adminClient.from('business_staff').select('role, permissions').eq('business_id', businessId).eq('profile_id', userId).maybeSingle()
  ])

  const isOwner = bizRes.data?.owner_id === userId
  const isStaff = Boolean(staffRes.data)
  const staffRole = staffRes.data?.role
  const staffPerms: string[] = Array.isArray(staffRes.data?.permissions) ? staffRes.data.permissions : []
  const isAdmin = isOwner || staffRole === 'admin' || staffPerms.includes('full_access')
  return { isOwner, isStaff, isAdmin, ownerId: bizRes.data?.owner_id }
}

// GET: Load POS Tender Configuration and available COA Asset Accounts
export async function GET(req: Request) {
  try {
    const ctx = await getApiContext({ req })
    if (ctx.error) return ctx.error
    const { user, businessId, supabaseAdmin } = ctx

    if (!businessId) {
      return NextResponse.json({ error: 'Unit bisnis aktif tidak ditemukan' }, { status: 400 })
    }

    // Owner and Staff (Cashiers) can read tender configurations
    const { isOwner, isStaff } = await checkBusinessAccess(businessId, user.id, supabaseAdmin)
    if (!isOwner && !isStaff) {
      return NextResponse.json({ error: 'Akses ditolak ke unit bisnis ini.' }, { status: 403 })
    }

    // 1. Fetch COA asset accounts
    const { data: accountsData } = await supabaseAdmin
      .from('accounts')
      .select('id, code, name, type, sub_type')
      .eq('business_id', businessId)
      .eq('type', 'ASSET')
      .order('code', { ascending: true })

    const availableAccounts: COAAssetAccount[] = (accountsData || []).filter(
      (a: any) => a.code?.startsWith('101') || a.sub_type === 'bank_cash'
    )

    // 2. Fetch custom tenders: first check business_integrations table, fallback to integrations table
    let customTenders: POSTender[] | null = null

    try {
      const { data: bRow } = await supabaseAdmin
        .from('business_integrations')
        .select('config')
        .eq('business_id', businessId)
        .eq('provider', 'pos_tenders')
        .maybeSingle()

      if (bRow?.config && Array.isArray(bRow.config.tenders)) {
        customTenders = bRow.config.tenders
      }
    } catch (bErr) {
      console.warn('[API /api/settings/pos/tenders GET] business_integrations check notice:', bErr)
    }

    if (!customTenders) {
      try {
        const { data: intRows } = await supabaseAdmin
          .from('integrations')
          .select('api_credentials')
          .eq('platform_name', 'pos_tenders')
          .filter('api_credentials->>business_id', 'eq', businessId)
          .limit(1)

        const creds = intRows?.[0]?.api_credentials
        if (creds && Array.isArray(creds.tenders)) {
          customTenders = creds.tenders
        }
      } catch (err) {
        console.warn('[API /api/settings/pos/tenders] Notice loading custom tenders:', err)
      }
    }

    // Jika custom tenders sudah ada, pastikan semua akun aset tetap tampil di list
    // Akun aset baru yang belum dikonfigurasi otomatis ditambahkan dengan status tidak aktif (is_active: false)
    if (Array.isArray(customTenders) && customTenders.length > 0) {
      const configuredAccIds = new Set(customTenders.map((t) => t.account_id))
      const missingAccounts = availableAccounts.filter((a) => !configuredAccIds.has(a.id))

      if (missingAccounts.length > 0) {
        let nextOrder = Math.max(...customTenders.map((t) => t.sort_order ?? 0), 0) + 1
        missingAccounts.forEach((acc) => {
          const cat = classifyAccountCategory(acc)
          let cleanName = acc.name
          if (cat === 'qris' && !cleanName.toLowerCase().startsWith('qris')) {
            cleanName = `QRIS ${cleanName}`
          } else if (cat === 'bank' && !cleanName.toLowerCase().startsWith('bank') && !cleanName.toLowerCase().startsWith('transfer')) {
            cleanName = `Transfer ${cleanName}`
          } else if (cat === 'edc' && !cleanName.toLowerCase().startsWith('edc')) {
            cleanName = `EDC ${cleanName}`
          }

          customTenders!.push({
            id: `tender-${acc.id}`,
            name: cleanName,
            category: cat,
            account_id: acc.id,
            account_code: acc.code,
            account_name: acc.name,
            is_active: false,
            sort_order: nextOrder++
          })
        })
      }
    }

    // 3. Resolve active tenders (hybrid)
    const resolvedTenders = resolveBusinessTenders({
      accounts: availableAccounts,
      customTenders
    })

    return NextResponse.json({
      success: true,
      customTenders,
      resolvedTenders,
      availableAccounts
    })
  } catch (err: any) {
    console.error('[API /api/settings/pos/tenders GET] Error:', err)
    return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500 })
  }
}

// POST: Save custom POS Tenders
export async function POST(req: Request) {
  try {
    const ctx = await getApiContext({ req })
    if (ctx.error) return ctx.error
    const { user, businessId, supabaseAdmin } = ctx

    if (!businessId) {
      return NextResponse.json({ error: 'Unit bisnis aktif tidak ditemukan' }, { status: 400 })
    }

    const { isAdmin } = await checkBusinessAccess(businessId, user.id, supabaseAdmin)
    if (!isAdmin) {
      return NextResponse.json({ error: 'Akses ditolak. Hanya Pemilik atau Admin yang dapat mengubah Pengaturan Metode Pembayaran POS.' }, { status: 403 })
    }

    const body = await req.json().catch(() => null)
    if (!body || !Array.isArray(body.tenders)) {
      return NextResponse.json({ error: 'Payload tidak valid. Parameter tenders (array) diperlukan.' }, { status: 400 })
    }

    const sanitizedTenders: POSTender[] = body.tenders.map((t: any, idx: number) => ({
      id: String(t.id || `tender-${Date.now()}-${idx}`),
      name: String(t.name || 'Metode Pembayaran').trim(),
      category: ['cash', 'qris', 'bank', 'edc'].includes(t.category) ? t.category : 'bank',
      account_id: String(t.account_id || ''),
      account_code: t.account_code || undefined,
      account_name: t.account_name || undefined,
      is_active: t.is_active !== false,
      sort_order: Number(t.sort_order ?? idx + 1)
    }))

    const payload = {
      business_id: businessId,
      tenders: sanitizedTenders,
      updated_by: user.id,
      updated_at: new Date().toISOString()
    }

    // 1. Primary Save: business_integrations table (multi-tenant safe, UUID business_id)
    let saveSucceeded = false
    try {
      const { error: bErr } = await supabaseAdmin
        .from('business_integrations')
        .upsert({
          business_id: businessId,
          provider: 'pos_tenders',
          name: 'POS Payment Tenders',
          is_active: true,
          config: payload,
          updated_at: new Date().toISOString()
        }, { onConflict: 'business_id,provider' })

      if (!bErr) {
        saveSucceeded = true
      } else {
        console.warn('[API /api/settings/pos/tenders POST] business_integrations upsert error:', bErr)
      }
    } catch (bErr) {
      console.warn('[API /api/settings/pos/tenders POST] business_integrations exception:', bErr)
    }

    // 2. Secondary Sync: integrations table (with valid schema columns)
    try {
      const { data: existing } = await supabaseAdmin
        .from('integrations')
        .select('id')
        .eq('platform_name', 'pos_tenders')
        .filter('api_credentials->>business_id', 'eq', businessId)
        .limit(1)

      if (existing && existing.length > 0) {
        const { error: uErr } = await supabaseAdmin
          .from('integrations')
          .update({
            api_credentials: payload,
            is_active: true,
            last_sync_at: new Date().toISOString()
          })
          .eq('id', existing[0].id)

        if (!uErr) saveSucceeded = true
      } else {
        const { error: iErr } = await supabaseAdmin
          .from('integrations')
          .insert({
            user_id: user.id,
            platform_name: 'pos_tenders',
            store_url: 'pos://tenders',
            api_credentials: payload,
            is_active: true,
            last_sync_at: new Date().toISOString()
          })

        if (!iErr) saveSucceeded = true
      }
    } catch (iErr) {
      console.warn('[API /api/settings/pos/tenders POST] integrations sync exception:', iErr)
    }

    if (!saveSucceeded) {
      throw new Error('Gagal menyimpan metode pembayaran ke basis data.')
    }

    return NextResponse.json({
      success: true,
      tenders: sanitizedTenders
    })
  } catch (err: any) {
    console.error('[API /api/settings/pos/tenders POST] Error:', err)
    return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500 })
  }
}
