import { NextResponse } from 'next/server'
import { getApiContext } from '@/lib/apiContext'
import { isUuid } from '@/lib/utils'
import {
  normalizePhoneCanonical,
  buildPhoneSearchVariants,
  upsertCustomerInServerCache
} from '@/lib/customerHelper'

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  if (!isUuid(id)) {
    return NextResponse.json({ error: 'Customer ID tidak valid' }, { status: 400 })
  }

  try {
    const ctx = await getApiContext()
    if (ctx.error) return ctx.error
    const { businessId, supabaseAdmin } = ctx

    const { data: customerData, error: fetchErr } = await supabaseAdmin
      .from('customers')
      .select('*')
      .eq('id', id)
      .eq('business_id', businessId)
      .maybeSingle()

    if (fetchErr || !customerData) {
      return NextResponse.json({ error: 'Customer tidak ditemukan' }, { status: 404 })
    }

    return NextResponse.json({
      success: true,
      customer: customerData
    })
  } catch (err: any) {
    console.error('[ShapeUp] Customer get error:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  if (!isUuid(id)) {
    return NextResponse.json({ error: 'Customer ID tidak valid' }, { status: 400 })
  }

  try {
    const ctx = await getApiContext()
    if (ctx.error) return ctx.error
    const { businessId, supabaseAdmin } = ctx

    // Verify customer exists and belongs to this business
    const { data: existing, error: existErr } = await supabaseAdmin
      .from('customers')
      .select('id, business_id, name, phone, email, category, address_data, metadata')
      .eq('id', id)
      .eq('business_id', businessId)
      .maybeSingle()

    if (existErr || !existing) {
      return NextResponse.json({ error: 'Customer tidak ditemukan' }, { status: 404 })
    }

    let body: any
    try {
      body = await req.json()
    } catch {
      return NextResponse.json({ error: 'Payload JSON tidak valid' }, { status: 400 })
    }

    const { name, phone, email, category, address_data, metadata } = body || {}

    const targetName = name !== undefined ? String(name).trim() : existing.name
    let targetPhone = existing.phone

    if (phone !== undefined && phone !== null) {
      const cleanPhone = normalizePhoneCanonical(phone)
      targetPhone = cleanPhone

      // Check if phone number is already used by ANOTHER customer in the same business
      const phoneVariants = buildPhoneSearchVariants(targetPhone)
      const { data: phoneCheckList, error: phoneErr } = await supabaseAdmin
        .from('customers')
        .select('id, name')
        .eq('business_id', businessId)
        .in('phone', phoneVariants.length > 0 ? phoneVariants : [targetPhone])
        .neq('id', id)
        .limit(1)

      if (phoneErr) throw phoneErr
      if (phoneCheckList && phoneCheckList.length > 0) {
        return NextResponse.json(
          {
            error: `Nomor HP sudah digunakan oleh customer lain: ${phoneCheckList[0].name}`
          },
          { status: 400 }
        )
      }
    }

    if (!targetName || !targetPhone) {
      return NextResponse.json({ error: 'Nama dan Nomor HP wajib diisi' }, { status: 400 })
    }

    const mergedMetadata =
      metadata !== undefined
        ? { ...(existing.metadata || {}), ...metadata }
        : existing.metadata

    const { data: updatedCustomer, error: updateErr } = await supabaseAdmin
      .from('customers')
      .update({
        name: targetName,
        phone: targetPhone,
        email: email !== undefined ? (email ? String(email).trim() : null) : existing.email,
        category: category !== undefined ? (category || 'General') : existing.category,
        address_data: address_data !== undefined ? (address_data || null) : existing.address_data,
        metadata: mergedMetadata || null
      })
      .eq('id', id)
      .eq('business_id', businessId)
      .select('*')
      .single()

    if (updateErr) throw updateErr

    // Immediately update server-side directory cache
    upsertCustomerInServerCache(businessId, updatedCustomer)

    return NextResponse.json({
      success: true,
      customer: updatedCustomer
    })
  } catch (err: any) {
    console.error('[ShapeUp] Customer update error:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
