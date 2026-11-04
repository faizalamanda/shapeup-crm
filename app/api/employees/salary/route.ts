import { NextResponse } from 'next/server'
import { ensureExpenseAccounts } from '@/lib/expenseLedger'
import { isUuid } from '@/lib/utils'
import {
  verifyPayrollAccess,
  getPeriodLastDay,
  ensureDecoupledSalaryLedger,
  voidSingleSalaryPayment,
  recalculateSalaryStatus,
  createSalarySettlementPayment
} from '@/lib/payrollLedger'

export async function GET() {
  const access = await verifyPayrollAccess()
  if (access.error) return access.error

  const { businessId, supabaseAdmin } = access

  try {
    const { data: salaries, error: fetchErr } = await supabaseAdmin
      .from('employee_salaries')
      .select('*, employees!inner(*), salary_payments(*, accounts:payment_method_account_id(id, name, code))')
      .eq('employees.business_id', businessId)
      .order('period', { ascending: false })
      .order('created_at', { ascending: false })

    if (fetchErr) throw fetchErr

    return NextResponse.json(salaries || [])
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

  const {
    employee_id,
    amount,
    period,
    payment_status,
    payment_account_id,
    amount_paid,
    payment_date
  } = body

  const cleanEmployeeId = isUuid(employee_id) ? employee_id : null
  const cleanPaymentAccountId = isUuid(payment_account_id) ? payment_account_id : null

  if (!cleanEmployeeId || amount === undefined || !period) {
    return NextResponse.json(
      { error: 'Data karyawan, nominal gaji, dan periode wajib diisi.' },
      { status: 400 }
    )
  }

  const numAmount = parseFloat(amount)
  if (!Number.isFinite(numAmount) || numAmount <= 0) {
    return NextResponse.json(
      { error: 'Nominal gaji harus valid dan lebih dari Rp 0.' },
      { status: 400 }
    )
  }

  try {
    // 1. Verify employee belongs to this business
    const { data: employee, error: empErr } = await supabaseAdmin
      .from('employees')
      .select('id, name')
      .eq('id', cleanEmployeeId)
      .eq('business_id', businessId)
      .single()

    if (empErr || !employee) {
      return NextResponse.json(
        { error: 'Karyawan tidak ditemukan di unit bisnis ini.' },
        { status: 404 }
      )
    }

    // 2. Check existing salary for the same employee and period
    const { data: existingInPeriod } = await supabaseAdmin
      .from('employee_salaries')
      .select('id, payment_status, period')
      .eq('business_id', businessId)
      .eq('employee_id', cleanEmployeeId)
      .eq('period', period)

    const activeExisting = (existingInPeriod || []).find(
      (r: any) => r.payment_status !== 'cancelled'
    )
    if (activeExisting) {
      return NextResponse.json(
        {
          error: `Slip gaji untuk ${employee.name} pada periode ${period} sudah terdaftar. Silakan gunakan tombol Edit atau Bayar pada daftar gaji.`
        },
        { status: 400 }
      )
    }

    // Resilient fallback if database still has legacy unconditional UNIQUE(employee_id, period)
    const cancelledExisting = (existingInPeriod || []).filter(
      (r: any) => r.payment_status === 'cancelled'
    )
    for (const canc of cancelledExisting) {
      const shortCode = String(canc.id).slice(0, 4).toUpperCase()
      await supabaseAdmin
        .from('employee_salaries')
        .update({ period: `${period} (Batal #${shortCode})` })
        .eq('id', canc.id)
    }

    const status: 'paid' | 'partial' | 'pending' = payment_status || 'pending'
    const numAmountPaid =
      status === 'paid'
        ? numAmount
        : status === 'pending'
        ? 0
        : parseFloat(amount_paid || 0)

    if (!Number.isFinite(numAmountPaid) || numAmountPaid < 0 || numAmountPaid > numAmount) {
      return NextResponse.json(
        { error: 'Jumlah nominal terbayar tidak valid.' },
        { status: 400 }
      )
    }

    const numOutstanding = Math.max(0, numAmount - numAmountPaid)

    if (numAmountPaid > 0 && !cleanPaymentAccountId) {
      return NextResponse.json(
        { error: 'Akun pembayaran (Kas/Bank) wajib dipilih untuk status Lunas atau Sebagian.' },
        { status: 400 }
      )
    }

    // 3. Ensure Double-Entry Accounts exist
    const accountMap = await ensureExpenseAccounts(businessId, supabaseAdmin)
    const salaryExpenseAccountId = accountMap['503300'] // Beban Gaji & Upah
    const salaryLiabilityAccountId = accountMap['201100'] // Hutang Gaji & Upah

    if (!salaryExpenseAccountId || !salaryLiabilityAccountId) {
      return NextResponse.json(
        { error: 'Akun Beban Gaji (503300) atau Hutang Gaji (201100) belum tersedia.' },
        { status: 400 }
      )
    }

    // 4. PHASE 1 (ACCRUAL): Create pure Accrual Journal Transaction on period end date
    //    Dr. Beban Gaji & Upah (503300) = numAmount
    //    Cr. Hutang Gaji & Upah (201100) = numAmount
    const accrualDate = getPeriodLastDay(period)
    const accrualDescription = `Pencatatan Gaji Karyawan: ${employee.name} (${period})`

    const { data: accrualTx, error: txErr } = await supabaseAdmin
      .from('transactions')
      .insert({
        business_id: businessId,
        date: accrualDate,
        description: accrualDescription
      })
      .select('id')
      .single()

    if (txErr || !accrualTx) {
      return NextResponse.json(
        { error: `Gagal membuat transaksi jurnal akrual gaji: ${txErr?.message}` },
        { status: 500 }
      )
    }

    const { error: jlErr } = await supabaseAdmin.from('journal_lines').insert([
      {
        transaction_id: accrualTx.id,
        account_id: salaryExpenseAccountId,
        debit: numAmount,
        credit: 0
      },
      {
        transaction_id: accrualTx.id,
        account_id: salaryLiabilityAccountId,
        debit: 0,
        credit: numAmount
      }
    ])

    if (jlErr) {
      await supabaseAdmin.from('transactions').delete().eq('id', accrualTx.id)
      return NextResponse.json(
        { error: `Gagal membuat baris jurnal akrual gaji: ${jlErr.message}` },
        { status: 500 }
      )
    }

    // 5. Insert employee_salaries record
    const actualPaidDate =
      numAmountPaid > 0
        ? payment_date || new Date().toISOString().split('T')[0]
        : null

    const { data: salaryRecord, error: insErr } = await supabaseAdmin
      .from('employee_salaries')
      .insert({
        business_id: businessId,
        employee_id: cleanEmployeeId,
        amount: numAmount,
        period,
        payment_status: status,
        payment_account_id: numAmountPaid > 0 ? cleanPaymentAccountId : null,
        paid_at: actualPaidDate,
        transaction_id: accrualTx.id,
        amount_paid: numAmountPaid,
        outstanding_amount: numOutstanding
      })
      .select('*')
      .single()

    if (insErr || !salaryRecord) {
      await supabaseAdmin.from('transactions').delete().eq('id', accrualTx.id)
      throw insErr
    }

    // 6. PHASE 2 (SETTLEMENT): If paid upfront (paid or partial), create separate Settlement Transaction
    //    Dr. Hutang Gaji & Upah (201100) = numAmountPaid
    //    Cr. Kas / Bank (cleanPaymentAccountId) = numAmountPaid
    if (numAmountPaid > 0 && cleanPaymentAccountId && actualPaidDate) {
      await createSalarySettlementPayment({
        businessId,
        salaryId: salaryRecord.id,
        employeeName: employee.name,
        period,
        amount: numAmountPaid,
        paymentAccountId: cleanPaymentAccountId,
        paymentDate: actualPaidDate,
        notes:
          status === 'paid'
            ? 'Pelunasan Gaji Saat Pencatatan'
            : 'Pembayaran Sebagian Saat Pencatatan',
        salaryLiabilityAccountId,
        db: supabaseAdmin
      })
    }

    const { data: hydratedRecord } = await supabaseAdmin
      .from('employee_salaries')
      .select('*, employees!inner(*), salary_payments(*, accounts:payment_method_account_id(id, name, code))')
      .eq('id', salaryRecord.id)
      .single()

    return NextResponse.json({
      ...(hydratedRecord || salaryRecord),
      auditSummary: {
        action: 'created',
        accrualAmount: numAmount,
        paidAmount: numAmountPaid,
        outstandingAmount: numOutstanding
      }
    })
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
    return NextResponse.json({ error: 'ID catatan gaji tidak valid.' }, { status: 400 })
  }

  let body: any
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Payload JSON tidak valid atau kosong.' }, { status: 400 })
  }

  const {
    employee_id,
    amount,
    period,
    payment_status,
    payment_account_id,
    amount_paid,
    payment_date,
    cancel_reason,
    edit_reason,
    reset_payments
  } = body

  try {
    // 1. Fetch existing salary record with employee & payment history
    const { data: existing, error: getErr } = await supabaseAdmin
      .from('employee_salaries')
      .select('*, employees!inner(id, name, business_id), salary_payments(*)')
      .eq('id', id)
      .eq('employees.business_id', businessId)
      .single()

    if (getErr || !existing) {
      return NextResponse.json(
        { error: 'Catatan gaji tidak ditemukan atau Anda tidak memiliki akses.' },
        { status: 404 }
      )
    }

    if (existing.payment_status === 'cancelled') {
      return NextResponse.json(
        { error: 'Catatan gaji yang sudah dibatalkan tidak dapat diubah kembali. Silakan buat catatan gaji baru.' },
        { status: 400 }
      )
    }

    // 2. Load Double-Entry Accounts
    const accountMap = await ensureExpenseAccounts(businessId, supabaseAdmin)
    const salaryExpenseAccountId = accountMap['503300'] // Beban Gaji & Upah
    const salaryLiabilityAccountId = accountMap['201100'] // Hutang Gaji & Upah

    if (!salaryExpenseAccountId || !salaryLiabilityAccountId) {
      return NextResponse.json(
        { error: 'Akun pembukuan gaji (503300 / 201100) belum lengkap.' },
        { status: 400 }
      )
    }

    // 3. Ensure legacy combined transaction (if any) is decoupled into pure Accrual + Settlement
    await ensureDecoupledSalaryLedger({
      salary: existing,
      employeeName: existing.employees.name,
      businessId,
      salaryExpenseAccountId,
      salaryLiabilityAccountId,
      db: supabaseAdmin
    })

    // Re-fetch payments after potential decoupling
    const { data: currentPayments } = await supabaseAdmin
      .from('salary_payments')
      .select('*')
      .eq('salary_id', id)
      .order('date', { ascending: true })

    const activePayments = (currentPayments || []).filter(
      (p: any) => (p.status || 'active') === 'active'
    )

    // ═══════════════════════════════════════════════════════════════════════════
    // CASE 1: ONE-CLICK CASCADE CANCELLATION (Batal Slip Gaji & Seluruh Pembayarannya)
    // ═══════════════════════════════════════════════════════════════════════════
    if (payment_status === 'cancelled') {
      const cleanCancelReason = cancel_reason ? String(cancel_reason).trim() : 'Pembatalan Slip Gaji'
      let reversedPaymentsCount = 0
      let reversedCashTotal = 0

      // Step 1A: Void all active payments (Dr. Kas/Bank, Cr. Hutang Gaji)
      for (const actPay of activePayments) {
        await voidSingleSalaryPayment({
          payment: actPay,
          salary: existing,
          employeeName: existing.employees.name,
          businessId,
          voidReason: cleanCancelReason,
          salaryExpenseAccountId,
          salaryLiabilityAccountId,
          db: supabaseAdmin
        })
        reversedPaymentsCount++
        reversedCashTotal += Number(actPay.amount) || 0
      }

      // Step 1B: Post Accrual Reversal Transaction (Dr. Hutang Gaji, Cr. Beban Gaji)
      const reversalDate = getPeriodLastDay(existing.period)
      const reversalDesc = `Pembatalan Gaji Karyawan: ${existing.employees.name} (${existing.period})`

      const { data: revTx, error: revTxErr } = await supabaseAdmin
        .from('transactions')
        .insert({
          business_id: businessId,
          date: reversalDate,
          description: reversalDesc
        })
        .select('id')
        .single()

      if (revTxErr || !revTx) {
        return NextResponse.json(
          { error: `Gagal membuat transaksi jurnal pembalik gaji: ${revTxErr?.message}` },
          { status: 500 }
        )
      }

      const fullSalaryAmount = Number(existing.amount) || 0
      const { error: jlErr } = await supabaseAdmin.from('journal_lines').insert([
        {
          transaction_id: revTx.id,
          account_id: salaryLiabilityAccountId,
          debit: fullSalaryAmount,
          credit: 0
        },
        {
          transaction_id: revTx.id,
          account_id: salaryExpenseAccountId,
          debit: 0,
          credit: fullSalaryAmount
        }
      ])

      if (jlErr) {
        await supabaseAdmin.from('transactions').delete().eq('id', revTx.id)
        return NextResponse.json(
          { error: `Gagal membuat jurnal pembalik beban gaji: ${jlErr.message}` },
          { status: 500 }
        )
      }

      // Step 1C: Update employee_salaries status to cancelled
      const { data: cancelledRecord, error: updErr } = await supabaseAdmin
        .from('employee_salaries')
        .update({
          payment_status: 'cancelled',
          paid_at: null,
          amount_paid: 0,
          outstanding_amount: 0
        })
        .eq('id', id)
        .select('*, employees!inner(*), salary_payments(*, accounts:payment_method_account_id(id, name, code))')
        .single()

      if (updErr) {
        await supabaseAdmin.from('transactions').delete().eq('id', revTx.id)
        throw updErr
      }

      return NextResponse.json({
        ...cancelledRecord,
        auditSummary: {
          action: 'cancelled',
          reversedAccrualAmount: fullSalaryAmount,
          reversedPaymentsCount,
          reversedCashTotal,
          reversalTransactionId: revTx.id
        }
      })
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // CASE 2: SMART EDIT & REVISION (Ubah Gaji / Koreksi Pembayaran)
    // ═══════════════════════════════════════════════════════════════════════════
    const newEmployeeId = isUuid(employee_id) ? employee_id : existing.employee_id
    const newAmount = amount !== undefined ? parseFloat(amount) : Number(existing.amount)
    const newPeriod = period ? String(period).trim() : existing.period
    const requestedStatus: 'paid' | 'partial' | 'pending' = payment_status || existing.payment_status
    const cleanPaymentAccountId = isUuid(payment_account_id)
      ? payment_account_id
      : isUuid(existing.payment_account_id)
      ? existing.payment_account_id
      : null

    if (!Number.isFinite(newAmount) || newAmount <= 0) {
      return NextResponse.json(
        { error: 'Nominal gaji harus valid dan lebih dari Rp 0.' },
        { status: 400 }
      )
    }

    // Verify if changing period/employee conflicts with another active salary
    if (newEmployeeId !== existing.employee_id || newPeriod !== existing.period) {
      const { data: conflictRows } = await supabaseAdmin
        .from('employee_salaries')
        .select('id, payment_status')
        .eq('business_id', businessId)
        .eq('employee_id', newEmployeeId)
        .eq('period', newPeriod)
        .neq('id', id)

      const activeConflict = (conflictRows || []).find(
        (r: any) => r.payment_status !== 'cancelled'
      )
      if (activeConflict) {
        return NextResponse.json(
          { error: `Karyawan tersebut sudah memiliki catatan gaji aktif pada periode ${newPeriod}.` },
          { status: 400 }
        )
      }
    }

    // Resolve employee name
    let employeeName = existing.employees.name
    if (newEmployeeId !== existing.employee_id) {
      const { data: newEmp, error: newEmpErr } = await supabaseAdmin
        .from('employees')
        .select('name')
        .eq('id', newEmployeeId)
        .eq('business_id', businessId)
        .single()

      if (newEmpErr || !newEmp) {
        return NextResponse.json({ error: 'Karyawan baru tidak ditemukan.' }, { status: 404 })
      }
      employeeName = newEmp.name
    }

    const currentActivePaid = activePayments.reduce(
      (sum: number, p: any) => sum + (Number(p.amount) || 0),
      0
    )

    const requestedAmountPaid =
      requestedStatus === 'paid'
        ? newAmount
        : requestedStatus === 'pending'
        ? 0
        : amount_paid !== undefined
        ? parseFloat(amount_paid)
        : currentActivePaid

    if (!Number.isFinite(requestedAmountPaid) || requestedAmountPaid < 0 || requestedAmountPaid > newAmount) {
      return NextResponse.json(
        { error: 'Jumlah nominal terbayar tidak valid atau melebihi total gaji.' },
        { status: 400 }
      )
    }

    // Determine if existing active payments need to be voided & replaced
    const singleActivePay = activePayments.length === 1 ? activePayments[0] : null
    const accountChanged =
      singleActivePay &&
      cleanPaymentAccountId &&
      singleActivePay.payment_method_account_id !== cleanPaymentAccountId
    const dateChanged =
      singleActivePay &&
      payment_date &&
      singleActivePay.date !== payment_date

    const shouldResetPayments =
      Boolean(reset_payments) ||
      (activePayments.length > 0 &&
        (requestedStatus === 'pending' ||
          newAmount < currentActivePaid - 0.01 ||
          newEmployeeId !== existing.employee_id ||
          Math.abs(requestedAmountPaid - currentActivePaid) > 0.01 ||
          Boolean(accountChanged) ||
          Boolean(dateChanged)))

    let voidedOldPaymentsCount = 0
    let voidedOldCashTotal = 0

    if (shouldResetPayments && activePayments.length > 0) {
      if (requestedAmountPaid > 0 && !cleanPaymentAccountId) {
        return NextResponse.json(
          { error: 'Silakan pilih akun pembayaran (Kas/Bank) untuk mencatat pembayaran baru.' },
          { status: 400 }
        )
      }

      const reason = edit_reason
        ? String(edit_reason).trim()
        : 'Koreksi / Perubahan Data Gaji'

      for (const actPay of activePayments) {
        await voidSingleSalaryPayment({
          payment: actPay,
          salary: existing,
          employeeName: existing.employees.name,
          businessId,
          voidReason: reason,
          salaryExpenseAccountId,
          salaryLiabilityAccountId,
          db: supabaseAdmin
        })
        voidedOldPaymentsCount++
        voidedOldCashTotal += Number(actPay.amount) || 0
      }
    }

    // Update or create Accrual Transaction (Dr. Beban Gaji = newAmount, Cr. Hutang Gaji = newAmount)
    let accrualTxId = existing.transaction_id
    const accrualDate = getPeriodLastDay(newPeriod)
    const accrualDesc = `Pencatatan Gaji Karyawan: ${employeeName} (${newPeriod})`

    if (!accrualTxId) {
      const { data: newTx, error: txErr } = await supabaseAdmin
        .from('transactions')
        .insert({
          business_id: businessId,
          date: accrualDate,
          description: accrualDesc
        })
        .select('id')
        .single()

      if (txErr || !newTx) {
        return NextResponse.json(
          { error: `Gagal membuat transaksi jurnal akrual: ${txErr?.message}` },
          { status: 500 }
        )
      }
      accrualTxId = newTx.id
    } else {
      await supabaseAdmin
        .from('transactions')
        .update({
          date: accrualDate,
          description: accrualDesc
        })
        .eq('id', accrualTxId)

      await supabaseAdmin.from('journal_lines').delete().eq('transaction_id', accrualTxId)
    }

    const { error: accrualJlErr } = await supabaseAdmin.from('journal_lines').insert([
      {
        transaction_id: accrualTxId,
        account_id: salaryExpenseAccountId,
        debit: newAmount,
        credit: 0
      },
      {
        transaction_id: accrualTxId,
        account_id: salaryLiabilityAccountId,
        debit: 0,
        credit: newAmount
      }
    ])

    if (accrualJlErr) {
      return NextResponse.json(
        { error: `Gagal memperbarui baris jurnal beban gaji: ${accrualJlErr.message}` },
        { status: 500 }
      )
    }

    // Update core employee_salaries fields first
    await supabaseAdmin
      .from('employee_salaries')
      .update({
        employee_id: newEmployeeId,
        amount: newAmount,
        period: newPeriod,
        transaction_id: accrualTxId
      })
      .eq('id', id)

    // If there are no active payments remaining (either originally pending or just reset)
    // and the user specified a paid/partial amount > 0, record the new Settlement Payment!
    const hasRemainingActivePayments = !shouldResetPayments && activePayments.length > 0
    if (!hasRemainingActivePayments && requestedAmountPaid > 0) {
      if (!cleanPaymentAccountId) {
        return NextResponse.json(
          { error: 'Akun pembayaran (Kas/Bank) wajib dipilih untuk status Lunas atau Sebagian.' },
          { status: 400 }
        )
      }
      const effectivePayDate = payment_date || new Date().toISOString().split('T')[0]
      await createSalarySettlementPayment({
        businessId,
        salaryId: id,
        employeeName,
        period: newPeriod,
        amount: requestedAmountPaid,
        paymentAccountId: cleanPaymentAccountId,
        paymentDate: effectivePayDate,
        notes:
          voidedOldPaymentsCount > 0
            ? `Pembayaran Gaji (Hasil Revisi Data Gaji)`
            : requestedStatus === 'paid'
            ? 'Pelunasan Gaji'
            : 'Pembayaran Sebagian Gaji',
        salaryLiabilityAccountId,
        db: supabaseAdmin
      })
    }

    // Recalculate final status & totals from active salary_payments
    const { updatedSalary, netPaid, outstanding, paymentStatus } = await recalculateSalaryStatus({
      salaryId: id,
      totalAmount: newAmount,
      db: supabaseAdmin
    })

    return NextResponse.json({
      ...updatedSalary,
      auditSummary: {
        action: 'updated',
        newAmount,
        netPaid,
        outstanding,
        paymentStatus,
        voidedOldPaymentsCount,
        voidedOldCashTotal
      }
    })
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
    return NextResponse.json({ error: 'ID catatan gaji tidak valid.' }, { status: 400 })
  }

  try {
    const { data: existing, error: getErr } = await supabaseAdmin
      .from('employee_salaries')
      .select('*, employees!inner(name, business_id), salary_payments(*)')
      .eq('id', id)
      .eq('employees.business_id', businessId)
      .single()

    if (getErr || !existing) {
      return NextResponse.json(
        { error: 'Catatan gaji tidak ditemukan atau Anda tidak memiliki akses.' },
        { status: 404 }
      )
    }

    const allPayments = existing.salary_payments || []
    const activePayments = allPayments.filter(
      (p: any) => (p.status || 'active') === 'active'
    )

    if (activePayments.length > 0 && existing.payment_status !== 'cancelled') {
      return NextResponse.json(
        {
          error:
            'Catatan gaji ini masih memiliki pembayaran aktif. Silakan klik tombol "Batal" pada daftar gaji (untuk membalik jurnal otomatis) atau batalkan pembayarannya terlebih dahulu.'
        },
        { status: 400 }
      )
    }

    // Collect all related transaction IDs (accrual, payments, and payment reversals)
    const txIdsToDelete = new Set<string>()
    if (isUuid(existing.transaction_id)) {
      txIdsToDelete.add(existing.transaction_id)
    }
    for (const p of allPayments) {
      if (isUuid(p.transaction_id)) txIdsToDelete.add(p.transaction_id)
      if (isUuid(p.reversal_transaction_id)) txIdsToDelete.add(p.reversal_transaction_id)
    }

    // 1. Delete salary record
    const { error: delSalErr } = await supabaseAdmin
      .from('employee_salaries')
      .delete()
      .eq('id', id)

    if (delSalErr) {
      return NextResponse.json(
        { error: `Gagal menghapus catatan gaji: ${delSalErr.message}` },
        { status: 500 }
      )
    }

    // 2. Delete collected transactions
    if (txIdsToDelete.size > 0) {
      await supabaseAdmin
        .from('transactions')
        .delete()
        .in('id', Array.from(txIdsToDelete))
    }

    // 3. Delete any accrual reversal transactions if cancelled
    const cleanPeriod = String(existing.period).split(' (Batal')[0]
    const reversalDescPrefix = `Pembatalan Gaji Karyawan: ${existing.employees.name} (${cleanPeriod})`
    await supabaseAdmin
      .from('transactions')
      .delete()
      .eq('business_id', businessId)
      .ilike('description', `${reversalDescPrefix}%`)

    return NextResponse.json({
      success: true,
      auditSummary: {
        action: 'deleted',
        employeeName: existing.employees.name,
        period: existing.period
      }
    })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
