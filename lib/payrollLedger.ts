import { NextResponse } from 'next/server'
import { SupabaseClient } from '@supabase/supabase-js'
import { getApiContext } from '@/lib/apiContext'
import { ensureExpenseAccounts } from '@/lib/expenseLedger'
import { isUuid } from '@/lib/utils'

export async function verifyPayrollAccess() {
  const ctx = await getApiContext()
  if (ctx.error) return { error: ctx.error }

  const { user, businessId, supabase, supabaseAdmin } = ctx

  const [{ data: biz }, { data: bs }, { data: profile }] = await Promise.all([
    supabaseAdmin.from('businesses').select('owner_id').eq('id', businessId).maybeSingle(),
    supabaseAdmin
      .from('business_staff')
      .select('role, permissions')
      .eq('profile_id', user.id)
      .eq('business_id', businessId)
      .maybeSingle(),
    supabaseAdmin.from('profiles').select('role').eq('id', user.id).maybeSingle()
  ])

  const isOwner = biz?.owner_id === user.id || profile?.role === 'admin'
  const isAdminStaff = bs?.role === 'admin'
  const hasHR =
    bs?.permissions?.includes('full_access') ||
    bs?.permissions?.includes('manage_employees_salary')

  if (!isOwner && !isAdminStaff && !hasHR) {
    return {
      error: NextResponse.json(
        { error: 'Anda tidak memiliki hak akses untuk mengelola data karyawan dan penggajian.' },
        { status: 403 }
      )
    }
  }

  return { user, businessId, supabase, supabaseAdmin }
}

export function getPeriodLastDay(periodStr: string): string {
  if (!periodStr) return new Date().toISOString().split('T')[0]
  const cleanPeriod = periodStr.split(' ')[0].trim()
  const parts = cleanPeriod.split('-')
  if (parts.length === 3) {
    return cleanPeriod
  }
  if (parts.length === 2) {
    const year = parseInt(parts[0], 10)
    const month = parseInt(parts[1], 10)
    if (Number.isFinite(year) && Number.isFinite(month) && month >= 1 && month <= 12) {
      const lastDay = new Date(year, month, 0).getDate()
      const monthStr = String(month).padStart(2, '0')
      const dayStr = String(lastDay).padStart(2, '0')
      return `${year}-${monthStr}-${dayStr}`
    }
  }
  return new Date().toISOString().split('T')[0]
}

/**
 * Ensures that a salary record uses the clean Two-Transaction Model:
 * 1. Accrual Transaction (salary.transaction_id): Dr. Beban Gaji (503300) / Cr. Hutang Gaji (201100)
 * 2. Settlement Transaction (salary_payments.transaction_id): Dr. Hutang Gaji (201100) / Cr. Kas-Bank (101xxx)
 *
 * If a legacy salary record shares `salary.transaction_id === salary_payments.transaction_id`,
 * this function atomically splits them into separate accrual and settlement transactions so
 * subsequent payment voids or accrual edits never corrupt each other.
 */
export async function ensureDecoupledSalaryLedger(params: {
  salary: any
  employeeName: string
  businessId: string
  salaryExpenseAccountId: string
  salaryLiabilityAccountId: string
  db: SupabaseClient
}) {
  const {
    salary,
    employeeName,
    businessId,
    salaryExpenseAccountId,
    salaryLiabilityAccountId,
    db
  } = params

  if (!salary?.id || !salary?.transaction_id) return

  const { data: sharedPayments } = await db
    .from('salary_payments')
    .select('*')
    .eq('salary_id', salary.id)
    .eq('transaction_id', salary.transaction_id)

  if (!sharedPayments || sharedPayments.length === 0) {
    return
  }

  // 1. Rebuild salary.transaction_id as a pure Accrual Transaction (Dr. Beban Gaji / Cr. Hutang Gaji)
  const totalAmount = Number(salary.amount) || 0
  await db.from('journal_lines').delete().eq('transaction_id', salary.transaction_id)
  await db.from('journal_lines').insert([
    {
      transaction_id: salary.transaction_id,
      account_id: salaryExpenseAccountId,
      debit: totalAmount,
      credit: 0
    },
    {
      transaction_id: salary.transaction_id,
      account_id: salaryLiabilityAccountId,
      debit: 0,
      credit: totalAmount
    }
  ])

  // 2. Give each shared payment its own dedicated Settlement Transaction (Dr. Hutang Gaji / Cr. Kas-Bank)
  for (const sp of sharedPayments) {
    const payAmt = Number(sp.amount) || 0
    const payDate = sp.date || new Date().toISOString().split('T')[0]
    const { data: newPayTx } = await db
      .from('transactions')
      .insert({
        business_id: businessId,
        date: payDate,
        description: `Pembayaran Gaji Karyawan: ${employeeName} (${salary.period})`
      })
      .select('id')
      .single()

    if (newPayTx?.id) {
      await db.from('journal_lines').insert([
        {
          transaction_id: newPayTx.id,
          account_id: salaryLiabilityAccountId,
          debit: payAmt,
          credit: 0
        },
        {
          transaction_id: newPayTx.id,
          account_id: sp.payment_method_account_id,
          debit: 0,
          credit: payAmt
        }
      ])

      await db
        .from('salary_payments')
        .update({ transaction_id: newPayTx.id })
        .eq('id', sp.id)
    }
  }
}

/**
 * Voids a single active salary payment using an Append-Only Reversal Journal Entry:
 *   Dr. Kas / Bank (payment_method_account_id)
 *   Cr. Hutang Gaji & Upah (201100)
 * Marks the payment record as `status = 'voided'` (with fallback delete if migration not yet applied).
 */
export async function voidSingleSalaryPayment(params: {
  payment: any
  salary: any
  employeeName: string
  businessId: string
  voidReason?: string
  salaryExpenseAccountId: string
  salaryLiabilityAccountId: string
  db: SupabaseClient
}): Promise<{ reversalTransactionId: string; reversalDescription: string }> {
  const {
    payment,
    salary,
    employeeName,
    businessId,
    voidReason = 'Dibatalkan oleh pengguna',
    salaryExpenseAccountId,
    salaryLiabilityAccountId,
    db
  } = params

  // Ensure legacy combined transactions are decoupled before voiding
  await ensureDecoupledSalaryLedger({
    salary,
    employeeName,
    businessId,
    salaryExpenseAccountId,
    salaryLiabilityAccountId,
    db
  })

  const payAmount = Number(payment.amount) || 0
  const reversalDate = new Date().toISOString().split('T')[0]
  const cleanReason = voidReason.trim() || 'Koreksi Pembayaran'
  const reversalDescription = `Pembatalan Pembayaran Gaji: ${employeeName} (${salary.period}) — ${cleanReason}`

  // 1. Create Reversal Transaction Header
  const { data: revTx, error: revTxErr } = await db
    .from('transactions')
    .insert({
      business_id: businessId,
      date: reversalDate,
      description: reversalDescription
    })
    .select('id')
    .single()

  if (revTxErr || !revTx) {
    throw new Error(`Gagal membuat jurnal pembalik pembayaran: ${revTxErr?.message || 'Unknown error'}`)
  }

  // 2. Post Balancing Reversal Journal Lines (Dr. Kas/Bank, Cr. Hutang Gaji)
  const { error: jlErr } = await db.from('journal_lines').insert([
    {
      transaction_id: revTx.id,
      account_id: payment.payment_method_account_id,
      debit: payAmount,
      credit: 0
    },
    {
      transaction_id: revTx.id,
      account_id: salaryLiabilityAccountId,
      debit: 0,
      credit: payAmount
    }
  ])

  if (jlErr) {
    await db.from('transactions').delete().eq('id', revTx.id)
    throw new Error(`Gagal membuat baris jurnal pembalik pembayaran: ${jlErr.message}`)
  }

  // 3. Mark salary_payments row as voided (with resilient fallback if schema migration not yet applied)
  const { error: updPayErr } = await db
    .from('salary_payments')
    .update({
      status: 'voided',
      voided_at: new Date().toISOString(),
      void_reason: cleanReason,
      reversal_transaction_id: revTx.id
    })
    .eq('id', payment.id)

  if (updPayErr) {
    // Fallback if `status` column is not migrated yet: remove from salary_payments sub-ledger
    // while keeping both original and reversal transactions in General Ledger.
    await db.from('salary_payments').delete().eq('id', payment.id)
  }

  return {
    reversalTransactionId: revTx.id,
    reversalDescription
  }
}

/**
 * Recalculates `amount_paid`, `outstanding_amount`, `payment_status`, and `paid_at`
 * on `employee_salaries` from active `salary_payments`.
 */
export async function recalculateSalaryStatus(params: {
  salaryId: string
  totalAmount: number
  db: SupabaseClient
}) {
  const { salaryId, totalAmount, db } = params

  const { data: allPayments } = await db
    .from('salary_payments')
    .select('*')
    .eq('salary_id', salaryId)
    .order('date', { ascending: true })

  const activePayments = (allPayments || []).filter(
    (p: any) => (p.status || 'active') === 'active'
  )

  const netPaid = activePayments.reduce((sum: number, p: any) => sum + (Number(p.amount) || 0), 0)
  const outstanding = Math.max(0, totalAmount - netPaid)
  const paymentStatus: 'pending' | 'partial' | 'paid' =
    netPaid <= 0.01 ? 'pending' : outstanding <= 0.01 ? 'paid' : 'partial'

  const lastPayment = activePayments.length > 0 ? activePayments[activePayments.length - 1] : null

  const { data: updatedSalary, error: updErr } = await db
    .from('employee_salaries')
    .update({
      amount: totalAmount,
      amount_paid: netPaid,
      outstanding_amount: outstanding,
      payment_status: paymentStatus,
      paid_at: lastPayment ? lastPayment.date : null,
      payment_account_id: lastPayment && isUuid(lastPayment.payment_method_account_id)
        ? lastPayment.payment_method_account_id
        : null
    })
    .eq('id', salaryId)
    .select('*, employees!inner(*), salary_payments(*, accounts:payment_method_account_id(id, name, code))')
    .single()

  if (updErr) throw updErr

  return {
    updatedSalary,
    netPaid,
    outstanding,
    paymentStatus,
    activePaymentsCount: activePayments.length
  }
}

/**
 * Creates a new settlement transaction + salary_payments row.
 */
export async function createSalarySettlementPayment(params: {
  businessId: string
  salaryId: string
  employeeName: string
  period: string
  amount: number
  paymentAccountId: string
  paymentDate: string
  notes: string
  salaryLiabilityAccountId: string
  db: SupabaseClient
}) {
  const {
    businessId,
    salaryId,
    employeeName,
    period,
    amount,
    paymentAccountId,
    paymentDate,
    notes,
    salaryLiabilityAccountId,
    db
  } = params

  const { data: payTx, error: txErr } = await db
    .from('transactions')
    .insert({
      business_id: businessId,
      date: paymentDate,
      description: `Pembayaran Gaji Karyawan: ${employeeName} (${period})`
    })
    .select('id')
    .single()

  if (txErr || !payTx) {
    throw new Error(`Gagal membuat transaksi jurnal pembayaran gaji: ${txErr?.message}`)
  }

  const { error: jlErr } = await db.from('journal_lines').insert([
    {
      transaction_id: payTx.id,
      account_id: salaryLiabilityAccountId,
      debit: amount,
      credit: 0
    },
    {
      transaction_id: payTx.id,
      account_id: paymentAccountId,
      debit: 0,
      credit: amount
    }
  ])

  if (jlErr) {
    await db.from('transactions').delete().eq('id', payTx.id)
    throw new Error(`Gagal membuat baris jurnal pembayaran gaji: ${jlErr.message}`)
  }

  const { data: paymentRecord, error: payErr } = await db
    .from('salary_payments')
    .insert({
      business_id: businessId,
      salary_id: salaryId,
      transaction_id: payTx.id,
      date: paymentDate,
      amount,
      payment_method_account_id: paymentAccountId,
      notes
    })
    .select('*')
    .single()

  if (payErr) {
    await db.from('transactions').delete().eq('id', payTx.id)
    throw new Error(`Gagal merekam riwayat pembayaran gaji: ${payErr.message}`)
  }

  return { paymentRecord, paymentTransactionId: payTx.id }
}

