import { createClient as createAdminClient } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabaseServer'
import { NextResponse } from 'next/server'

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
    const { name, phone, email } = await req.json()

    if (!name || !phone) {
      return NextResponse.json({ error: 'Nama dan Nomor HP wajib diisi' }, { status: 400 })
    }

    // 2. Clean phone number
    let cleanPhone = phone.replace(/\D/g, '')
    if (cleanPhone.startsWith('0')) {
      cleanPhone = '62' + cleanPhone.substring(1)
    } else if (cleanPhone.startsWith('8')) {
      cleanPhone = '62' + cleanPhone
    }

    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
    if (!serviceRoleKey) {
      return NextResponse.json({ 
        error: 'Kunci admin (SUPABASE_SERVICE_ROLE_KEY) tidak ditemukan di file .env.local Anda. Silakan tambahkan kunci tersebut dari dashboard Supabase -> Settings -> API -> service_role.' 
      }, { status: 500 })
    }

    // 3. Initialize Admin Client to bypass RLS
    const supabaseAdmin = createAdminClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      serviceRoleKey
    )

    // Check if phone number already exists
    const { data: existing, error: fetchErr } = await supabaseAdmin
      .from('customers')
      .select('id, name, phone, email')
      .eq('business_id', businessId)
      .eq('phone', cleanPhone)
      .maybeSingle()

    if (fetchErr) throw fetchErr

    if (existing) {
      return NextResponse.json({ 
        success: true, 
        existing: true, 
        customer: existing 
      })
    }

    // Insert new customer
    const { data: newCustomer, error: insertErr } = await supabaseAdmin
      .from('customers')
      .insert({
        business_id: businessId,
        name: name.trim(),
        phone: cleanPhone,
        email: email ? email.trim() : null
      })
      .select('id, name, phone, email')
      .single()

    if (insertErr) throw insertErr

    return NextResponse.json({ 
      success: true, 
      existing: false, 
      customer: newCustomer 
    })

  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
