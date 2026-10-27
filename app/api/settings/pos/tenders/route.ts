import { NextResponse } from 'next/server'
import { getApiContext } from '@/lib/apiContext'
import { resolveBusinessTenders, POSTender, COAAssetAccount } from '@/lib/pos/tenderResolver'

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

// GET: Load POS Tender Configuration and available COA Asset Accounts
export async function GET() {
  try {
    const ctx = await getApiContext()
    if (ctx.error) return ctx.error
    const { user, businessId, supabaseAdmin } = ctx

    if (!businessId) {
      return NextResponse.json({ error: 'Unit bisnis aktif tidak ditemukan' }, { status: 400 })
    }

    const { isAdmin } = await checkOwnerOrAdmin(businessId, user.id, supabaseAdmin)
    if (!isAdmin) {
      return NextResponse.json({ error: 'Akses ditolak. Hanya Pemilik atau Admin yang dapat mengakses Pengaturan Metode Pembayaran POS.' }, { status: 403 })
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

    // 2. Fetch custom tenders from integrations table
    let customTenders: POSTender[] | null = null
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
    const ctx = await getApiContext()
    if (ctx.error) return ctx.error
    const { user, businessId, supabaseAdmin } = ctx

    if (!businessId) {
      return NextResponse.json({ error: 'Unit bisnis aktif tidak ditemukan' }, { status: 400 })
    }

    const { isAdmin } = await checkOwnerOrAdmin(businessId, user.id, supabaseAdmin)
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

    // Save to integrations table (platform_name = 'pos_tenders')
    const { data: existing } = await supabaseAdmin
      .from('integrations')
      .select('id, api_credentials')
      .eq('platform_name', 'pos_tenders')
      .filter('api_credentials->>business_id', 'eq', businessId)
      .limit(1)

    const payload = {
      business_id: businessId,
      tenders: sanitizedTenders,
      updated_by: user.id,
      updated_at: new Date().toISOString()
    }

    if (existing && existing.length > 0) {
      await supabaseAdmin
        .from('integrations')
        .update({
          api_credentials: payload,
          status: 'active',
          updated_at: new Date().toISOString()
        })
        .eq('id', existing[0].id)
    } else {
      await supabaseAdmin
        .from('integrations')
        .insert({
          platform_name: 'pos_tenders',
          status: 'active',
          api_credentials: payload,
          business_id: businessId
        })
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
