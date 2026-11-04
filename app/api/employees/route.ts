import { NextResponse } from 'next/server'
import { verifyPayrollAccess } from '@/lib/payrollLedger'
import { isUuid } from '@/lib/utils'

export async function GET() {
  const access = await verifyPayrollAccess()
  if (access.error) return access.error

  const { businessId, supabaseAdmin } = access

  try {
    const { data: employees, error: fetchErr } = await supabaseAdmin
      .from('employees')
      .select('*')
      .eq('business_id', businessId)
      .order('name', { ascending: true })

    if (fetchErr) throw fetchErr

    return NextResponse.json(employees || [])
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

export async function POST(req: Request) {
  const access = await verifyPayrollAccess()
  if (access.error) return access.error

  const { businessId, supabaseAdmin } = access

  let body: any
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Payload JSON tidak valid atau kosong.' }, { status: 400 })
  }

  const { name, position, email, phone, status } = body

  if (!name || !String(name).trim()) {
    return NextResponse.json({ error: 'Nama karyawan wajib diisi.' }, { status: 400 })
  }

  try {
    const { data: employee, error: insertErr } = await supabaseAdmin
      .from('employees')
      .insert({
        business_id: businessId,
        name: String(name).trim(),
        position: position ? String(position).trim() : null,
        email: email ? String(email).trim() : null,
        phone: phone ? String(phone).trim() : null,
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
  const access = await verifyPayrollAccess()
  if (access.error) return access.error

  const { businessId, supabaseAdmin } = access
  const url = new URL(req.url)
  const id = url.searchParams.get('id')

  if (!isUuid(id)) {
    return NextResponse.json({ error: 'ID karyawan tidak valid atau kosong.' }, { status: 400 })
  }

  let body: any
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Payload JSON tidak valid atau kosong.' }, { status: 400 })
  }

  const { name, position, email, phone, status } = body

  if (!name || !String(name).trim()) {
    return NextResponse.json({ error: 'Nama karyawan wajib diisi.' }, { status: 400 })
  }

  try {
    const { data: employee, error: updateErr } = await supabaseAdmin
      .from('employees')
      .update({
        name: String(name).trim(),
        position: position ? String(position).trim() : null,
        email: email ? String(email).trim() : null,
        phone: phone ? String(phone).trim() : null,
        status: status || 'active'
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
  const access = await verifyPayrollAccess()
  if (access.error) return access.error

  const { businessId, supabaseAdmin } = access
  const url = new URL(req.url)
  const id = url.searchParams.get('id')

  if (!isUuid(id)) {
    return NextResponse.json({ error: 'ID karyawan tidak valid atau kosong.' }, { status: 400 })
  }

  try {
    const { error: deleteErr } = await supabaseAdmin
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
