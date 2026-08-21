import { createClient } from '@/lib/supabaseServer'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const supabase = await createClient()

  try {
    const { data: { user }, error: authErr } = await supabase.auth.getUser()
    if (authErr || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { data: profile, error: profErr } = await supabase
      .from('profiles')
      .select('active_business_id')
      .eq('id', user.id)
      .single()

    if (profErr || !profile?.active_business_id) {
      return NextResponse.json({ error: 'Active business not found for user profile' }, { status: 400 })
    }

    const businessId = profile.active_business_id

    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
    if (!serviceRoleKey) {
      return NextResponse.json({ 
        error: 'SUPABASE_SERVICE_ROLE_KEY is not defined in env' 
      }, { status: 500 })
    }

    const supabaseAdmin = createAdminClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      serviceRoleKey
    )

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
  const supabase = await createClient()

  try {
    // 1. Get logged-in user and active business ID
    const { data: { user }, error: authErr } = await supabase.auth.getUser()
    if (authErr || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { data: profile, error: profErr } = await supabase
      .from('profiles')
      .select('active_business_id')
      .eq('id', user.id)
      .single()

    if (profErr || !profile?.active_business_id) {
      return NextResponse.json({ error: 'Active business not found for user profile' }, { status: 400 })
    }

    const businessId = profile.active_business_id

    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
    if (!serviceRoleKey) {
      return NextResponse.json({ 
        error: 'SUPABASE_SERVICE_ROLE_KEY is not defined in env' 
      }, { status: 500 })
    }

    // 2. Initialize Admin Client to bypass RLS
    const supabaseAdmin = createAdminClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      serviceRoleKey
    )

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

    // Parse request body
    const body = await req.json()
    const { name, phone, email, category, address_data, metadata } = body

    const targetName = name !== undefined ? name.trim() : existing.name
    let targetPhone = existing.phone

    if (phone !== undefined && phone !== null) {
      let cleanPhone = String(phone).replace(/\D/g, '')
      if (cleanPhone.startsWith('0')) {
        cleanPhone = '62' + cleanPhone.substring(1)
      } else if (cleanPhone.startsWith('8')) {
        cleanPhone = '62' + cleanPhone
      }
      targetPhone = cleanPhone

      // Check if phone number is already used by ANOTHER customer in the same business
      const { data: phoneCheck, error: phoneErr } = await supabaseAdmin
        .from('customers')
        .select('id, name')
        .eq('business_id', businessId)
        .eq('phone', targetPhone)
        .neq('id', id)
        .maybeSingle()

      if (phoneErr) throw phoneErr
      if (phoneCheck) {
        return NextResponse.json({ 
          error: `Nomor HP sudah digunakan oleh customer lain: ${phoneCheck.name}` 
        }, { status: 400 })
      }
    }

    if (!targetName || !targetPhone) {
      return NextResponse.json({ error: 'Nama dan Nomor HP wajib diisi' }, { status: 400 })
    }

    const mergedMetadata = metadata !== undefined 
      ? { ...(existing.metadata || {}), ...metadata }
      : existing.metadata

    // Update customer
    const { data: updatedCustomer, error: updateErr } = await supabaseAdmin
      .from('customers')
      .update({
        name: targetName,
        phone: targetPhone,
        email: email !== undefined ? (email ? email.trim() : null) : existing.email,
        category: category !== undefined ? (category || 'General') : existing.category,
        address_data: address_data !== undefined ? (address_data || null) : existing.address_data,
        metadata: mergedMetadata || null
      })
      .eq('id', id)
      .select('*')
      .single()

    if (updateErr) throw updateErr

    return NextResponse.json({ 
      success: true, 
      customer: updatedCustomer 
    })

  } catch (err: any) {
    console.error('[ShapeUp] Customer update error:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
