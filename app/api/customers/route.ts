import { NextResponse } from 'next/server'
import { getApiContext } from '@/lib/apiContext'
import { isUuid } from '@/lib/utils'
import {
  queryBusinessCustomers,
  resolveOrCreateCustomer
} from '@/lib/customerHelper'

async function resolveTargetBusinessId(
  requestedBizId: string | null,
  defaultBusinessId: string,
  userId: string,
  supabaseAdmin: any
): Promise<string> {
  if (!requestedBizId || !isUuid(requestedBizId) || requestedBizId === defaultBusinessId) {
    return defaultBusinessId
  }

  // Verify user is owner or assigned staff of requestedBizId
  const [{ data: owned }, { data: staff }] = await Promise.all([
    supabaseAdmin
      .from('businesses')
      .select('id')
      .eq('id', requestedBizId)
      .eq('owner_id', userId)
      .maybeSingle(),
    supabaseAdmin
      .from('business_staff')
      .select('business_id')
      .eq('business_id', requestedBizId)
      .eq('profile_id', userId)
      .maybeSingle()
  ])

  if (owned?.id || staff?.business_id) {
    return requestedBizId
  }
  return defaultBusinessId
}

export async function GET(req: Request) {
  try {
    const ctx = await getApiContext()
    if (ctx.error) return ctx.error
    const { user, businessId: activeBusinessId, supabaseAdmin } = ctx

    const { searchParams } = new URL(req.url)
    const reqBizId = searchParams.get('business_id')
    const businessId = await resolveTargetBusinessId(
      reqBizId,
      activeBusinessId,
      user.id,
      supabaseAdmin
    )

    const search = searchParams.get('search') || ''
    const includeId = searchParams.get('include_id') || null
    const forceRefresh = searchParams.get('refresh') === '1'
    const rawLimit = parseInt(searchParams.get('limit') || '0', 10)
    const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? rawLimit : 0

    const { customers, total } = await queryBusinessCustomers(businessId, supabaseAdmin, {
      search,
      limit,
      includeId,
      forceRefresh
    })

    return NextResponse.json({
      success: true,
      customers,
      total
    })
  } catch (err: any) {
    console.error('[ShapeUp] Customer GET error:', err)
    return NextResponse.json({ error: err.message || 'Gagal memuat data pelanggan' }, { status: 500 })
  }
}

export async function POST(req: Request) {
  try {
    const ctx = await getApiContext()
    if (ctx.error) return ctx.error
    const { user, businessId: activeBusinessId, supabaseAdmin } = ctx

    let body: any
    try {
      body = await req.json()
    } catch {
      return NextResponse.json({ error: 'Payload JSON tidak valid atau kosong' }, { status: 400 })
    }

    const {
      business_id: reqBizId,
      name,
      phone,
      email,
      category,
      address_data,
      metadata,
      reuse_existing = false
    } = body || {}

    const businessId = await resolveTargetBusinessId(
      reqBizId || null,
      activeBusinessId,
      user.id,
      supabaseAdmin
    )

    if (!name || !phone) {
      return NextResponse.json({ error: 'Nama dan Nomor HP wajib diisi' }, { status: 400 })
    }

    const { customer, isExisting } = await resolveOrCreateCustomer(
      {
        businessId,
        name,
        phone,
        email,
        category,
        address_data,
        metadata,
        reuseExistingOnPhoneMatch: Boolean(reuse_existing)
      },
      supabaseAdmin
    )

    return NextResponse.json({
      success: true,
      existing: isExisting,
      customer
    })
  } catch (err: any) {
    if (err.statusCode === 400) {
      return NextResponse.json(
        { error: err.message, existingCustomer: err.existingCustomer },
        { status: 400 }
      )
    }
    console.error('[ShapeUp] Customer create error:', err)
    return NextResponse.json({ error: err.message || 'Gagal menyimpan pelanggan' }, { status: 500 })
  }
}
