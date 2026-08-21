import { createClient as createAdminClient } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabaseServer'
import { NextResponse } from 'next/server'

export async function GET() {
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

    // 3. Fetch customers
    const { data: customers, error: fetchErr } = await supabaseAdmin
      .from('customers')
      .select('id, name, phone, email, address_data, metadata')
      .eq('business_id', businessId)
      .order('name', { ascending: true })

    if (fetchErr) throw fetchErr

    return NextResponse.json({ success: true, customers: customers || [] })

  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

export async function POST(req: Request) {
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

    // 2. Parse request body
    const body = await req.json()
    const { name, phone, email, category, address_data, metadata } = body

    if (!name || !phone) {
      return NextResponse.json({ error: 'Nama dan Nomor HP wajib diisi' }, { status: 400 })
    }

    // 3. Clean phone number
    let cleanPhone = phone.replace(/\D/g, '')
    if (cleanPhone.startsWith('0')) {
      cleanPhone = '62' + cleanPhone.substring(1)
    } else if (cleanPhone.startsWith('8')) {
      cleanPhone = '62' + cleanPhone
    }

    // 4. Initialize Admin Client to bypass RLS
    const supabaseAdmin = createAdminClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      serviceRoleKey
    )

    // 5. Check if phone number already exists in this business
    const { data: existing, error: phoneErr } = await supabaseAdmin
      .from('customers')
      .select('id, name')
      .eq('business_id', businessId)
      .eq('phone', cleanPhone)
      .maybeSingle()

    if (phoneErr) throw phoneErr
    if (existing) {
      return NextResponse.json({ 
        error: `Nomor HP sudah terdaftar atas nama pelanggan: ${existing.name}` 
      }, { status: 400 })
    }

    // 6. Insert new customer
    const { data: newCustomer, error: insertErr } = await supabaseAdmin
      .from('customers')
      .insert({
        business_id: businessId,
        name: name.trim(),
        phone: cleanPhone,
        email: email ? email.trim() : null,
        category: category || 'General',
        address_data: address_data || null,
        metadata: metadata || null
      })
      .select('*')
      .single()

    if (insertErr) throw insertErr

    return NextResponse.json({ 
      success: true, 
      customer: newCustomer 
    })

  } catch (err: any) {
    console.error('[ShapeUp] Customer create error:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

