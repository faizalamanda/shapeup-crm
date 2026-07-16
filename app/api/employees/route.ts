import { createClient } from '@/lib/supabaseServer'
import { NextResponse } from 'next/server'

// Secure check for employee management permission
async function verifyAccess(supabase: any) {
  const { data: { user }, error: authErr } = await supabase.auth.getUser()
  if (authErr || !user) {
    return { error: 'Sesi tidak valid, silakan login kembali.', status: 401 }
  }

  const { data: profile, error: profErr } = await supabase
    .from('profiles')
    .select('role, active_business_id')
    .eq('id', user.id)
    .single()

  if (profErr || !profile?.active_business_id) {
    return { error: 'Bisnis aktif tidak ditemukan. Silakan pilih bisnis terlebih dahulu.', status: 400 }
  }

  const businessId = profile.active_business_id

  // Check relationship & permissions in business_staff
  const { data: bs } = await supabase
    .from('business_staff')
    .select('role, permissions')
    .eq('profile_id', user.id)
    .eq('business_id', businessId)
    .maybeSingle()

  const isOwner = profile.role === 'admin'
  const isAdminStaff = bs?.role === 'admin'
  const hasHR = bs?.permissions?.includes('full_access') || bs?.permissions?.includes('manage_employees_salary')

  if (!isOwner && !isAdminStaff && !hasHR) {
    return { error: 'Anda tidak memiliki hak akses untuk mengelola data karyawan.', status: 403 }
  }

  return { businessId, user }
}

export async function GET(req: Request) {
  const supabase = await createClient()
  const access = await verifyAccess(supabase)
  if (access.error) {
    return NextResponse.json({ error: access.error }, { status: access.status })
  }

  const { businessId } = access

  try {
    const { data: employees, error: fetchErr } = await supabase
      .from('employees')
      .select('*')
      .eq('business_id', businessId)
      .order('name', { ascending: true })

    if (fetchErr) throw fetchErr

    return NextResponse.json(employees)
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

export async function POST(req: Request) {
  const supabase = await createClient()
  const access = await verifyAccess(supabase)
  if (access.error) {
    return NextResponse.json({ error: access.error }, { status: access.status })
  }

  const { businessId } = access
  const body = await req.json()
  const { name, position, email, phone, status } = body

  if (!name) {
    return NextResponse.json({ error: 'Nama karyawan wajib diisi.' }, { status: 400 })
  }

  try {
    const { data: employee, error: insertErr } = await supabase
      .from('employees')
      .insert({
        business_id: businessId,
        name,
        position,
        email,
        phone,
        status: status || 'active'
      })
      .select('*')
      .single()

    if (insertErr) throw insertErr

    return NextResponse.json(employee)
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

export async function PUT(req: Request) {
  const supabase = await createClient()
  const access = await verifyAccess(supabase)
  if (access.error) {
    return NextResponse.json({ error: access.error }, { status: access.status })
  }

  const { businessId } = access
  const url = new URL(req.url)
  const id = url.searchParams.get('id')
  
  if (!id) {
    return NextResponse.json({ error: 'ID karyawan wajib disertakan.' }, { status: 400 })
  }

  const body = await req.json()
  const { name, position, email, phone, status } = body

  if (!name) {
    return NextResponse.json({ error: 'Nama karyawan wajib diisi.' }, { status: 400 })
  }

  try {
    const { data: employee, error: updateErr } = await supabase
      .from('employees')
      .update({
        name,
        position,
        email,
        phone,
        status
      })
      .eq('id', id)
      .eq('business_id', businessId)
      .select('*')
      .single()

    if (updateErr) throw updateErr

    return NextResponse.json(employee)
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

export async function DELETE(req: Request) {
  const supabase = await createClient()
  const access = await verifyAccess(supabase)
  if (access.error) {
    return NextResponse.json({ error: access.error }, { status: access.status })
  }

  const { businessId } = access
  const url = new URL(req.url)
  const id = url.searchParams.get('id')

  if (!id) {
    return NextResponse.json({ error: 'ID karyawan wajib disertakan.' }, { status: 400 })
  }

  try {
    const { error: deleteErr } = await supabase
      .from('employees')
      .delete()
      .eq('id', id)
      .eq('business_id', businessId)

    if (deleteErr) throw deleteErr

    return NextResponse.json({ success: true })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
