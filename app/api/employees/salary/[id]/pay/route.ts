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

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = await createClient()
  const access = await verifyAccess(supabase)
  if (access.error) {
    return NextResponse.json({ error: access.error }, { status: access.status })
  }

  const { businessId } = access

  try {
    const { id } = await params
    const body = await req.json()
    const { amount, payment_method_account_id, date, notes } = body

    if (amount === undefined || !payment_method_account_id || !date) {
      return NextResponse.json({ error: 'Data nominal amount, akun pembayaran, dan tanggal wajib diisi.' }, { status: 400 })
    }

    const numAmount = parseFloat(amount)
    if (isNaN(numAmount) || numAmount <= 0) {
      return NextResponse.json({ error: 'Nominal pembayaran harus valid dan lebih dari 0.' }, { status: 400 })
    }

    // 1. Fetch the employee salary record
    const { data: salary, error: getErr } = await supabase
      .from('employee_salaries')
      .select('*, employees!inner(name, business_id)')
      .eq('id', id)
      .eq('employees.business_id', businessId)
      .single()

    if (getErr || !salary) {
      return NextResponse.json({ error: 'Catatan gaji tidak ditemukan atau Anda tidak memiliki akses.' }, { status: 404 })
    }

    if (salary.payment_status === 'cancelled') {
      return NextResponse.json({ error: 'Catatan gaji yang sudah dibatalkan tidak dapat dibayar.' }, { status: 400 })
    }

    const currentOutstanding = parseFloat(salary.outstanding_amount ?? salary.amount)
    if (currentOutstanding <= 0) {
      return NextResponse.json({ error: 'Kewajiban gaji ini sudah lunas.' }, { status: 400 })
    }

    // Ensure we do not overpay
    if (numAmount > currentOutstanding + 0.01) {
      return NextResponse.json({ error: `Nominal pembayaran melebihi sisa hutang. Sisa: Rp ${currentOutstanding.toLocaleString('id-ID')}` }, { status: 400 })
    }

    const newOutstanding = Math.max(0, currentOutstanding - numAmount)
    const newAmountPaid = parseFloat(salary.amount_paid ?? 0) + numAmount
    const newPaymentStatus = newOutstanding <= 0.01 ? 'paid' : 'partial'

    // Resolve Account Mapping for Hutang Gaji & Upah
    const accountMap = await ensureExpenseAccounts(businessId, supabase)
    const salaryLiabilityAccountId = accountMap['201100'] // Hutang Gaji & Upah

    if (!salaryLiabilityAccountId) {
      return NextResponse.json({ error: 'Akun Hutang Gaji & Upah (201100) tidak ditemukan.' }, { status: 500 })
    }

    // 2. Create Payment Transaction
    const { data: payTx, error: txErr } = await supabase
      .from('transactions')
      .insert({
        business_id: businessId,
        date: date,
        description: `Pembayaran Gaji Karyawan: ${salary.employees.name} (${salary.period})`
      })
      .select('*')
      .single()

    if (txErr || !payTx) {
      return NextResponse.json({ error: `Gagal membuat transaksi pembayaran: ${txErr?.message}` }, { status: 500 })
    }

    // 3. Post Journal Lines
    const journalLines = [
      {
        transaction_id: payTx.id,
        account_id: salaryLiabilityAccountId, // Debit Hutang Gaji to decrease liability
        debit: numAmount,
        credit: 0
      },
      {
        transaction_id: payTx.id,
        account_id: payment_method_account_id, // Credit Cash/Bank
        debit: 0,
        credit: numAmount
      }
    ]

    const { error: jlErr } = await supabase.from('journal_lines').insert(journalLines)
    if (jlErr) {
      await supabase.from('transactions').delete().eq('id', payTx.id)
      return NextResponse.json({ error: `Gagal membuat jurnal penyeimbang: ${jlErr.message}` }, { status: 500 })
    }

    // 4. Create Payment Log Record
    const { data: paymentLog, error: payLogErr } = await supabase
      .from('salary_payments')
      .insert({
        business_id: businessId,
        salary_id: id,
        transaction_id: payTx.id,
        date,
        amount: numAmount,
        payment_method_account_id,
        notes
      })
      .select('*')
      .single()

    if (payLogErr) {
      await supabase.from('transactions').delete().eq('id', payTx.id)
      return NextResponse.json({ error: `Gagal merekam log pembayaran: ${payLogErr.message}` }, { status: 500 })
    }

    // 5. Update parent Employee Salary record
    const { error: updErr } = await supabase
      .from('employee_salaries')
      .update({
        amount_paid: newAmountPaid,
        outstanding_amount: newOutstanding,
        payment_status: newPaymentStatus,
        paid_at: newPaymentStatus === 'paid' ? date : salary.paid_at
      })
      .eq('id', id)

    if (updErr) {
      await supabase.from('transactions').delete().eq('id', payTx.id)
      return NextResponse.json({ error: `Gagal memperbarui status catatan gaji: ${updErr.message}` }, { status: 500 })
    }

    return NextResponse.json(paymentLog)
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
