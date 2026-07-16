import { createClient } from '@/lib/supabaseServer'
import { ensureExpenseAccounts } from '@/lib/expenseLedger'
import { NextResponse } from 'next/server'

// Secure check for salary management permission
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
    return { error: 'Anda tidak memiliki hak akses untuk mengelola data gaji.', status: 403 }
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
    // Get all salaries for the active business by doing inner join on employees
    const { data: salaries, error: fetchErr } = await supabase
      .from('employee_salaries')
      .select('*, employees!inner(*)')
      .eq('employees.business_id', businessId)
      .order('period', { ascending: false })

    if (fetchErr) throw fetchErr

    return NextResponse.json(salaries)
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
  const { employee_id, amount, period, payment_status, payment_account_id } = body

  if (!employee_id || !amount || !period) {
    return NextResponse.json({ error: 'Data employee_id, nominal amount, dan periode wajib diisi.' }, { status: 400 })
  }

  const numAmount = parseFloat(amount)
  if (isNaN(numAmount) || numAmount <= 0) {
    return NextResponse.json({ error: 'Nominal gaji harus valid dan lebih dari 0.' }, { status: 400 })
  }

  try {
    // 1. Verify that the employee belongs to this business
    const { data: employee, error: empErr } = await supabase
      .from('employees')
      .select('name')
      .eq('id', employee_id)
      .eq('business_id', businessId)
      .single()

    if (empErr || !employee) {
      return NextResponse.json({ error: 'Karyawan tidak ditemukan di unit bisnis ini.' }, { status: 404 })
    }

    let transactionId = null
    const isPaid = payment_status === 'paid'

    if (isPaid) {
      if (!payment_account_id) {
        return NextResponse.json({ error: 'Akun pembayaran (Kas/Bank) wajib diisi untuk status Lunas.' }, { status: 400 })
      }

      // Ensure Beban Gaji & Upah (503300) account exists for ledger entries
      const accountMap = await ensureExpenseAccounts(businessId, supabase)
      const salaryExpenseAccountId = accountMap['503300']
      if (!salaryExpenseAccountId) {
        return NextResponse.json({ error: 'Akun Beban Gaji & Upah (503300) tidak ditemukan.' }, { status: 400 })
      }

      // Create a ledger transaction
      const todayStr = new Date().toISOString().split('T')[0]
      const { data: tx, error: txErr } = await supabase
        .from('transactions')
        .insert({
          business_id: businessId,
          date: todayStr,
          description: `Pembayaran Gaji Karyawan: ${employee.name} (${period})`
        })
        .select('*')
        .single()

      if (txErr || !tx) {
        return NextResponse.json({ error: `Gagal membuat transaksi jurnal: ${txErr?.message}` }, { status: 500 })
      }

      transactionId = tx.id

      // Create balancing journal lines
      const journalLines = [
        // Debit Beban Gaji
        {
          transaction_id: transactionId,
          account_id: salaryExpenseAccountId,
          debit: numAmount,
          credit: 0
        },
        // Credit Kas/Bank
        {
          transaction_id: transactionId,
          account_id: payment_account_id,
          debit: 0,
          credit: numAmount
        }
      ]

      const { error: jlErr } = await supabase.from('journal_lines').insert(journalLines)
      if (jlErr) {
        // Rollback transaction
        await supabase.from('transactions').delete().eq('id', transactionId)
        return NextResponse.json({ error: `Gagal membuat jurnal penyeimbang: ${jlErr.message}` }, { status: 500 })
      }
    }

    // 2. Insert salary payroll record
    const { data: salaryRecord, error: insErr } = await supabase
      .from('employee_salaries')
      .insert({
        business_id: businessId,
        employee_id,
        amount: numAmount,
        period,
        payment_status: payment_status || 'pending',
        payment_account_id: isPaid ? payment_account_id : null,
        paid_at: isPaid ? new Date().toISOString() : null,
        transaction_id: transactionId
      })
      .select('*')
      .single()

    if (insErr) {
      // If payroll record insert fails, try to rollback transaction & journal
      if (transactionId) {
        await supabase.from('transactions').delete().eq('id', transactionId)
      }
      throw insErr
    }

    return NextResponse.json(salaryRecord)
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
    return NextResponse.json({ error: 'ID catatan gaji wajib disertakan.' }, { status: 400 })
  }

  const body = await req.json()
  const { payment_status, payment_account_id } = body

  try {
    // Get existing record
    const { data: existing, error: getErr } = await supabase
      .from('employee_salaries')
      .select('*, employees!inner(name, business_id)')
      .eq('id', id)
      .eq('employees.business_id', businessId)
      .single()

    if (getErr || !existing) {
      return NextResponse.json({ error: 'Catatan gaji tidak ditemukan atau Anda tidak memiliki akses.' }, { status: 404 })
    }

    if (existing.payment_status === 'paid') {
      return NextResponse.json({ error: 'Catatan gaji yang sudah Lunas tidak dapat diedit.' }, { status: 400 })
    }

    const isPaid = payment_status === 'paid'
    let transactionId = existing.transaction_id

    if (isPaid) {
      if (!payment_account_id) {
        return NextResponse.json({ error: 'Akun pembayaran (Kas/Bank) wajib diisi untuk mengubah status menjadi Lunas.' }, { status: 400 })
      }

      // Ensure Beban Gaji & Upah (503300) account exists
      const accountMap = await ensureExpenseAccounts(businessId, supabase)
      const salaryExpenseAccountId = accountMap['503300']
      if (!salaryExpenseAccountId) {
        return NextResponse.json({ error: 'Akun Beban Gaji & Upah (503300) tidak ditemukan.' }, { status: 400 })
      }

      // Create a ledger transaction
      const todayStr = new Date().toISOString().split('T')[0]
      const { data: tx, error: txErr } = await supabase
        .from('transactions')
        .insert({
          business_id: businessId,
          date: todayStr,
          description: `Pembayaran Gaji Karyawan: ${existing.employees.name} (${existing.period})`
        })
        .select('*')
        .single()

      if (txErr || !tx) {
        return NextResponse.json({ error: `Gagal membuat transaksi jurnal: ${txErr?.message}` }, { status: 500 })
      }

      transactionId = tx.id

      // Create balancing journal lines
      const journalLines = [
        // Debit Beban Gaji
        {
          transaction_id: transactionId,
          account_id: salaryExpenseAccountId,
          debit: existing.amount,
          credit: 0
        },
        // Credit Kas/Bank
        {
          transaction_id: transactionId,
          account_id: payment_account_id,
          debit: 0,
          credit: existing.amount
        }
      ]

      const { error: jlErr } = await supabase.from('journal_lines').insert(journalLines)
      if (jlErr) {
        await supabase.from('transactions').delete().eq('id', transactionId)
        return NextResponse.json({ error: `Gagal membuat jurnal penyeimbang: ${jlErr.message}` }, { status: 500 })
      }
    }

    // Update existing salary record
    const updateData: any = {
      payment_status,
      payment_account_id: isPaid ? payment_account_id : existing.payment_account_id,
      paid_at: isPaid ? new Date().toISOString() : existing.paid_at,
      transaction_id: transactionId
    }

    const { data: updatedRecord, error: updErr } = await supabase
      .from('employee_salaries')
      .update(updateData)
      .eq('id', id)
      .select('*')
      .single()

    if (updErr) {
      if (isPaid && transactionId) {
        await supabase.from('transactions').delete().eq('id', transactionId)
      }
      throw updErr
    }

    return NextResponse.json(updatedRecord)
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
