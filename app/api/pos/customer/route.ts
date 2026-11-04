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

    const { name, phone, email, address_data, metadata } = body || {}

    if (!name || !phone) {
      return NextResponse.json({ error: 'Nama dan Nomor HP wajib diisi' }, { status: 400 })
    }

    const { customer, isExisting } = await resolveOrCreateCustomer(
      {
        businessId,
        name,
        phone,
        email,
        address_data,
        metadata,
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
