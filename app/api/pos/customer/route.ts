import { NextResponse } from 'next/server'
import { getApiContext } from '@/lib/apiContext'
import { resolveOrCreateCustomer } from '@/lib/customerHelper'

export async function POST(req: Request) {
  try {
    const ctx = await getApiContext()
    if (ctx.error) return ctx.error
    const { businessId, supabaseAdmin } = ctx

    let body: any
    try {
      body = await req.json()
    } catch {
      return NextResponse.json({ error: 'Payload JSON tidak valid' }, { status: 400 })
    }

    const { name, phone, email, address_data, metadata, marketplace_profiles } = body || {}

    if (!name || !String(name).trim()) {
      return NextResponse.json({ error: 'Nama pelanggan wajib diisi' }, { status: 400 })
    }

    const { customer, isExisting } = await resolveOrCreateCustomer(
      {
        businessId,
        name,
        phone: phone || null,
        email,
        address_data,
        metadata,
        marketplace_profiles: marketplace_profiles || metadata?.marketplace_profiles || null,
        reuseExistingOnPhoneMatch: true
      },
      supabaseAdmin
    )

    return NextResponse.json({
      success: true,
      existing: isExisting,
      customer
    })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
