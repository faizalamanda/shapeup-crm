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

function getPeriodLastDay(periodStr: string): string {
  if (!periodStr) return new Date().toISOString().split('T')[0]
  const parts = periodStr.split('-')
  if (parts.length === 3) {
    return periodStr
  }
  if (parts.length === 2) {
    const year = parseInt(parts[0], 10)
    const month = parseInt(parts[1], 10)
    if (!isNaN(year) && !isNaN(month) && month >= 1 && month <= 12) {
      const lastDay = new Date(year, month, 0).getDate()
      const monthStr = String(month).padStart(2, '0')
      const dayStr = String(lastDay).padStart(2, '0')
      return `${year}-${monthStr}-${dayStr}`
    }
  }
  return new Date().toISOString().split('T')[0]
}

export async function GET(req: Request) {
  const supabase = await createClient()
  const access = await verifyAccess(supabase)
  if (access.error) {
    return NextResponse.json({ error: access.error }, { status: access.status })
  }

  const { businessId } = access

  try {
    // Get all salaries for the active business, joining employee info and payments history
    const { data: salaries, error: fetchErr } = await supabase
      .from('employee_salaries')
      .select('*, employees!inner(*), salary_payments(*, accounts(id, name, code))')
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
  const { employee_id, amount, period, payment_status, payment_account_id, amount_paid, payment_date } = body

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

    const status = payment_status || 'pending'
    const numAmountPaid = status === 'paid'
      ? numAmount
      : (status === 'pending' ? 0 : parseFloat(amount_paid || 0))

    if (isNaN(numAmountPaid) || numAmountPaid < 0 || numAmountPaid > numAmount) {
      return NextResponse.json({ error: 'Jumlah nominal terbayar tidak valid.' }, { status: 400 })
    }

    const numOutstanding = numAmount - numAmountPaid

    if (numAmountPaid > 0 && !payment_account_id) {
      return NextResponse.json({ error: 'Akun pembayaran (Kas/Bank) wajib diisi untuk status Lunas atau Dibayar Sebagian.' }, { status: 400 })
    }

    // Ensure double entry accounts exist
    const accountMap = await ensureExpenseAccounts(businessId, supabase)
    const salaryExpenseAccountId = accountMap['503300'] // Beban Gaji & Upah
    const salaryLiabilityAccountId = accountMap['201100'] // Hutang Gaji & Upah

    if (!salaryExpenseAccountId) {
      return NextResponse.json({ error: 'Akun Beban Gaji & Upah (503300) tidak ditemukan.' }, { status: 400 })
    }
    if (numOutstanding > 0 && !salaryLiabilityAccountId) {
      return NextResponse.json({ error: 'Akun Hutang Gaji & Upah (201100) tidak ditemukan.' }, { status: 400 })
    }

    // 2. Create a ledger transaction using the last day of the salary period
    const txDate = getPeriodLastDay(period)
    const description = `Pencatatan Gaji Karyawan: ${employee.name} (${period})`

    const { data: tx, error: txErr } = await supabase
      .from('transactions')
      .insert({
        business_id: businessId,
        date: txDate,
        description
      })
      .select('*')
      .single()

    if (txErr || !tx) {
      return NextResponse.json({ error: `Gagal membuat transaksi jurnal: ${txErr?.message}` }, { status: 500 })
    }

    const transactionId = tx.id

    // Create balancing journal lines
    const journalLines = []

    // Debit Beban Gaji
    journalLines.push({
      transaction_id: transactionId,
      account_id: salaryExpenseAccountId,
      debit: numAmount,
      credit: 0
    })

    // Credit Kas/Bank (if paid portion > 0)
    if (numAmountPaid > 0) {
      journalLines.push({
        transaction_id: transactionId,
        account_id: payment_account_id,
        debit: 0,
        credit: numAmountPaid
      })
    }

    // Credit Hutang Gaji & Upah (if outstanding > 0)
    if (numOutstanding > 0) {
      journalLines.push({
        transaction_id: transactionId,
        account_id: salaryLiabilityAccountId,
        debit: 0,
        credit: numOutstanding
      })
    }

    const { error: jlErr } = await supabase.from('journal_lines').insert(journalLines)
    if (jlErr) {
      // Rollback transaction
      await supabase.from('transactions').delete().eq('id', transactionId)
      return NextResponse.json({ error: `Gagal membuat jurnal penyeimbang: ${jlErr.message}` }, { status: 500 })
    }

    // 3. Insert salary payroll record
    const actualPaidAt = numAmountPaid > 0 ? (payment_date ? payment_date : new Date().toISOString().split('T')[0]) : null

    const { data: salaryRecord, error: insErr } = await supabase
      .from('employee_salaries')
      .insert({
        business_id: businessId,
        employee_id,
        amount: numAmount,
        period,
        payment_status: status,
        payment_account_id: numAmountPaid > 0 ? payment_account_id : null,
        paid_at: actualPaidAt,
        transaction_id: transactionId,
        amount_paid: numAmountPaid,
        outstanding_amount: numOutstanding
      })
      .select('*')
      .single()

    if (insErr) {
      // Rollback transaction & journal lines (cascades)
      await supabase.from('transactions').delete().eq('id', transactionId)
      throw insErr
    }

    // 4. Log initial payment in salary_payments if paid portion > 0
    if (numAmountPaid > 0 && payment_account_id && salaryRecord) {
      await supabase.from('salary_payments').insert({
        business_id: businessId,
        salary_id: salaryRecord.id,
        transaction_id: transactionId,
        date: payment_date || new Date().toISOString().split('T')[0],
        amount: numAmountPaid,
        payment_method_account_id: payment_account_id,
        notes: status === 'paid' ? 'Pelunasan Gaji Saat Pencatatan' : 'Pembayaran Sebagian Saat Pencatatan'
      })
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
  const { employee_id, amount, period, payment_status, payment_account_id, amount_paid, payment_date } = body

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

    if (existing.payment_status === 'cancelled') {
      return NextResponse.json({ error: 'Catatan gaji yang sudah dibatalkan tidak dapat diubah.' }, { status: 400 })
    }

    // Check if there are any payments registered in salary_payments
    const { count, error: countErr } = await supabase
      .from('salary_payments')
      .select('id', { count: 'exact', head: true })
      .eq('salary_id', id)

    const hasPayments = count && count > 0

    // Prevent modification if already paid
    if (existing.payment_status === 'paid' && !payment_status) {
      return NextResponse.json({ error: 'Catatan gaji tidak dapat diubah karena statusnya sudah lunas. Silakan batalkan transaksi jika ingin mengubah.' }, { status: 400 })
    }

    // Prevent modification of critical fields if payments have been made
    if (hasPayments) {
      if (
        (employee_id !== undefined && employee_id !== existing.employee_id) ||
        (amount !== undefined && parseFloat(amount) !== existing.amount) ||
        (period !== undefined && period !== existing.period) ||
        (payment_status !== undefined && payment_status !== existing.payment_status) ||
        (amount_paid !== undefined && parseFloat(amount_paid) !== existing.amount_paid)
      ) {
        return NextResponse.json({ error: 'Catatan gaji tidak dapat diubah karena sudah memiliki riwayat pembayaran cicilan. Silakan hapus pembayaran cicilan terlebih dahulu.' }, { status: 400 })
      }
    }

    // Load double entry accounts
    const accountMap = await ensureExpenseAccounts(businessId, supabase)
    const salaryExpenseAccountId = accountMap['503300']
    const salaryLiabilityAccountId = accountMap['201100']

    if (!salaryExpenseAccountId || !salaryLiabilityAccountId) {
      return NextResponse.json({ error: 'Akun pembukuan gaji tidak lengkap.' }, { status: 400 })
    }

    // CASE 1: Transitioning to CANCELLED status (Jurnal Pembalik / Reversal Entry)
    if (payment_status === 'cancelled') {
      if (hasPayments) {
        return NextResponse.json({ error: 'Catatan gaji tidak dapat dibatalkan karena sudah memiliki riwayat pembayaran cicilan. Silakan hapus pembayaran cicilan terlebih dahulu.' }, { status: 400 })
      }

      const txDate = getPeriodLastDay(existing.period)
      const reversalDesc = `Pembatalan Gaji Karyawan: ${existing.employees.name} (${existing.period})`

      const { data: revTx, error: revTxErr } = await supabase
        .from('transactions')
        .insert({
          business_id: businessId,
          date: txDate,
          description: reversalDesc
        })
        .select('*')
        .single()

      if (revTxErr || !revTx) {
        return NextResponse.json({ error: `Gagal membuat transaksi jurnal pembalik: ${revTxErr?.message}` }, { status: 500 })
      }

      const reversalJournalLines = []
      
      // Debit whatever was originally credited
      if (existing.amount_paid > 0) {
        reversalJournalLines.push({
          transaction_id: revTx.id,
          account_id: existing.payment_account_id,
          debit: existing.amount_paid,
          credit: 0
        })
      }
      if (existing.outstanding_amount > 0) {
        reversalJournalLines.push({
          transaction_id: revTx.id,
          account_id: salaryLiabilityAccountId,
          debit: existing.outstanding_amount,
          credit: 0
        })
      }

      // Credit Beban Gaji
      reversalJournalLines.push({
        transaction_id: revTx.id,
        account_id: salaryExpenseAccountId,
        debit: 0,
        credit: existing.amount
      })

      const { error: jlErr } = await supabase.from('journal_lines').insert(reversalJournalLines)
      if (jlErr) {
        await supabase.from('transactions').delete().eq('id', revTx.id)
        return NextResponse.json({ error: `Gagal membuat jurnal pembalik penyeimbang: ${jlErr.message}` }, { status: 500 })
      }

      // Update employee_salaries status and reset paid/outstanding to 0
      const { data: updatedRecord, error: updErr } = await supabase
        .from('employee_salaries')
        .update({
          payment_status: 'cancelled',
          paid_at: null,
          amount_paid: 0,
          outstanding_amount: 0
        })
        .eq('id', id)
        .select('*')
        .single()

      if (updErr) {
        await supabase.from('transactions').delete().eq('id', revTx.id)
        throw updErr
      }

      return NextResponse.json(updatedRecord)
    }

    // CASE 2: Regular Edit (update fields and adjust original journal lines)
    const newEmployeeId = employee_id || existing.employee_id
    const newAmount = amount !== undefined ? parseFloat(amount) : existing.amount
    const newPeriod = period || existing.period
    const newPaymentStatus = payment_status || existing.payment_status

    if (isNaN(newAmount) || newAmount <= 0) {
      return NextResponse.json({ error: 'Nominal gaji harus valid dan lebih dari 0.' }, { status: 400 })
    }

    const newAmountPaid = newPaymentStatus === 'paid'
      ? newAmount
      : (newPaymentStatus === 'pending' ? 0 : parseFloat(amount_paid !== undefined ? amount_paid : existing.amount_paid))

    if (isNaN(newAmountPaid) || newAmountPaid < 0 || newAmountPaid > newAmount) {
      return NextResponse.json({ error: 'Jumlah nominal terbayar tidak valid.' }, { status: 400 })
    }

    const newOutstanding = newAmount - newAmountPaid
    const newPaymentAccountId = newAmountPaid > 0 ? (payment_account_id || existing.payment_account_id) : null

    if (newAmountPaid > 0 && !newPaymentAccountId) {
      return NextResponse.json({ error: 'Akun pembayaran (Kas/Bank) wajib diisi untuk status Lunas atau Dibayar Sebagian.' }, { status: 400 })
    }

    // Get employee name (resolve name if employee changed)
    let employeeName = existing.employees.name
    if (newEmployeeId !== existing.employee_id) {
      const { data: newEmployee, error: newEmpErr } = await supabase
        .from('employees')
        .select('name')
        .eq('id', newEmployeeId)
        .eq('business_id', businessId)
        .single()

      if (newEmpErr || !newEmployee) {
        return NextResponse.json({ error: 'Karyawan baru tidak ditemukan.' }, { status: 404 })
      }
      employeeName = newEmployee.name
    }

    let transactionId = existing.transaction_id
    const txDate = getPeriodLastDay(newPeriod)
    const newDescription = `Pencatatan Gaji Karyawan: ${employeeName} (${newPeriod})`

    if (!transactionId) {
      // Create new transaction if missing
      const { data: tx, error: txErr } = await supabase
        .from('transactions')
        .insert({
          business_id: businessId,
          date: txDate,
          description: newDescription
        })
        .select('*')
        .single()

      if (txErr || !tx) {
        return NextResponse.json({ error: `Gagal membuat transaksi jurnal: ${txErr?.message}` }, { status: 500 })
      }
      transactionId = tx.id
    } else {
      // Update transaction description and date
      await supabase
        .from('transactions')
        .update({
          date: txDate,
          description: newDescription
        })
        .eq('id', transactionId)

      // Clear old journal lines to rebuild
      await supabase.from('journal_lines').delete().eq('transaction_id', transactionId)
    }

    // Rebuild journal lines
    const journalLines = []

    // Debit Beban Gaji
    journalLines.push({
      transaction_id: transactionId,
      account_id: salaryExpenseAccountId,
      debit: newAmount,
      credit: 0
    })

    // Credit Kas/Bank (if paid > 0)
    if (newAmountPaid > 0) {
      journalLines.push({
        transaction_id: transactionId,
        account_id: newPaymentAccountId,
        debit: 0,
        credit: newAmountPaid
      })
    }

    // Credit Hutang Gaji & Upah (if outstanding > 0)
    if (newOutstanding > 0) {
      journalLines.push({
        transaction_id: transactionId,
        account_id: salaryLiabilityAccountId,
        debit: 0,
        credit: newOutstanding
      })
    }

    const { error: jlErr } = await supabase.from('journal_lines').insert(journalLines)
    if (jlErr) {
      return NextResponse.json({ error: `Gagal memperbarui jurnal penyeimbang: ${jlErr.message}` }, { status: 500 })
    }

    // Update existing salary record
    const updatedPaidAt = newAmountPaid > 0 ? (payment_date || existing.paid_at || new Date().toISOString().split('T')[0]) : null

    const { data: updatedRecord, error: updErr } = await supabase
      .from('employee_salaries')
      .update({
        employee_id: newEmployeeId,
        amount: newAmount,
        period: newPeriod,
        payment_status: newPaymentStatus,
        payment_account_id: newPaymentAccountId,
        paid_at: updatedPaidAt,
        transaction_id: transactionId,
        amount_paid: newAmountPaid,
        outstanding_amount: newOutstanding
      })
      .eq('id', id)
      .select('*')
      .single()

    if (updErr) throw updErr

    return NextResponse.json(updatedRecord)
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
    return NextResponse.json({ error: 'ID catatan gaji wajib disertakan.' }, { status: 400 })
  }

  try {
    // Fetch existing salary first
    const { data: existing, error: getErr } = await supabase
      .from('employee_salaries')
      .select('*, employees!inner(name, business_id)')
      .eq('id', id)
      .eq('employees.business_id', businessId)
      .single()

    if (getErr || !existing) {
      return NextResponse.json({ error: 'Catatan gaji tidak ditemukan atau Anda tidak memiliki akses.' }, { status: 404 })
    }

    // Check if there are any payments registered in salary_payments
    const { count, error: countErr } = await supabase
      .from('salary_payments')
      .select('id', { count: 'exact', head: true })
      .eq('salary_id', id)

    if (count && count > 0) {
      return NextResponse.json({ error: 'Catatan gaji tidak dapat dihapus karena sudah memiliki riwayat pembayaran. Silakan hapus pembayaran terlebih dahulu.' }, { status: 400 })
    }

    // 1. Delete salary record (payment logs would cascade delete if any did exist, but we blocked above)
    const { error: delSalErr } = await supabase
      .from('employee_salaries')
      .delete()
      .eq('id', id)

    if (delSalErr) {
      return NextResponse.json({ error: `Gagal menghapus catatan gaji: ${delSalErr.message}` }, { status: 500 })
    }

    // 2. Delete original transaction
    if (existing.transaction_id) {
      await supabase.from('transactions').delete().eq('id', existing.transaction_id)
    }

    // 3. Delete any reversal transactions if cancelled
    if (existing.payment_status === 'cancelled') {
      const reversalDesc = `Pembatalan Gaji Karyawan: ${existing.employees.name} (${existing.period})`
      await supabase
        .from('transactions')
        .delete()
        .eq('business_id', businessId)
        .eq('description', reversalDesc)
    }

    return NextResponse.json({ success: true })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
