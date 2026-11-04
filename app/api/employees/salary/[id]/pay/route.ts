import { NextResponse } from 'next/server'
import { ensureExpenseAccounts } from '@/lib/expenseLedger'
import { isUuid } from '@/lib/utils'
import {
  verifyPayrollAccess,
  ensureDecoupledSalaryLedger,
  createSalarySettlementPayment,
  voidSingleSalaryPayment,
  recalculateSalaryStatus
} from '@/lib/payrollLedger'

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const access = await verifyPayrollAccess()
  if (access.error) return access.error

  const { businessId, supabaseAdmin } = access

  try {
    const { id } = await params
    if (!isUuid(id)) {
      return NextResponse.json({ error: 'ID catatan gaji tidak valid.' }, { status: 400 })
    }

    let body: any
    try {
      body = await req.json()
    } catch {
      return NextResponse.json({ error: 'Payload JSON tidak valid atau kosong.' }, { status: 400 })
    }

    const { amount, payment_method_account_id, date, notes } = body
    const cleanAccountId = isUuid(payment_method_account_id) ? payment_method_account_id : null

    if (amount === undefined || !cleanAccountId || !date) {
      return NextResponse.json(
        { error: 'Data nominal pembayaran, rekening Kas/Bank, dan tanggal wajib diisi.' },
        { status: 400 }
      )
    }

    const numAmount = parseFloat(amount)
    if (!Number.isFinite(numAmount) || numAmount <= 0) {
      return NextResponse.json(
        { error: 'Nominal pembayaran harus valid dan lebih dari Rp 0.' },
        { status: 400 }
      )
    }

    // 1. Fetch the employee salary record
    const { data: salary, error: getErr } = await supabaseAdmin
      .from('employee_salaries')
      .select('*, employees!inner(name, business_id)')
      .eq('id', id)
      .eq('employees.business_id', businessId)
      .single()

    if (getErr || !salary) {
      return NextResponse.json(
        { error: 'Catatan gaji tidak ditemukan atau Anda tidak memiliki akses.' },
        { status: 404 }
      )
    }

    if (salary.payment_status === 'cancelled') {
      return NextResponse.json(
        { error: 'Catatan gaji yang sudah dibatalkan tidak dapat menerima pembayaran.' },
        { status: 400 }
      )
    }

    const accountMap = await ensureExpenseAccounts(businessId, supabaseAdmin)
    const salaryExpenseAccountId = accountMap['503300']
    const salaryLiabilityAccountId = accountMap['201100']

    if (!salaryExpenseAccountId || !salaryLiabilityAccountId) {
      return NextResponse.json(
        { error: 'Akun Hutang Gaji & Upah (201100) atau Beban Gaji (503300) tidak ditemukan.' },
        { status: 500 }
      )
    }

    // Ensure any legacy combined transaction is decoupled
    await ensureDecoupledSalaryLedger({
      salary,
      employeeName: salary.employees.name,
      businessId,
      salaryExpenseAccountId,
      salaryLiabilityAccountId,
      db: supabaseAdmin
    })

    const currentOutstanding = parseFloat(salary.outstanding_amount ?? salary.amount)
    if (currentOutstanding <= 0.01) {
      return NextResponse.json(
        { error: 'Kewajiban gaji ini sudah lunas sepenuhnya.' },
        { status: 400 }
      )
    }

    if (numAmount > currentOutstanding + 0.01) {
      return NextResponse.json(
        {
          error: `Nominal pembayaran melebihi sisa hutang gaji (Sisa: Rp ${currentOutstanding.toLocaleString('id-ID')}).`
        },
        { status: 400 }
      )
    }

    // 2. Create Settlement Payment Transaction & Log
    const { paymentRecord, paymentTransactionId } = await createSalarySettlementPayment({
      businessId,
      salaryId: id,
      employeeName: salary.employees.name,
      period: salary.period,
      amount: numAmount,
      paymentAccountId: cleanAccountId,
      paymentDate: date,
      notes: notes ? String(notes).trim() : 'Cicilan/Pelunasan Gaji',
      salaryLiabilityAccountId,
      db: supabaseAdmin
    })

    // 3. Recalculate and update parent salary record
    const { updatedSalary, netPaid, outstanding, paymentStatus } = await recalculateSalaryStatus({
      salaryId: id,
      totalAmount: Number(salary.amount) || 0,
      db: supabaseAdmin
    })

    return NextResponse.json({
      payment: paymentRecord,
      salary: updatedSalary,
      auditSummary: {
        action: 'payment_recorded',
        paidAmount: numAmount,
        netPaid,
        outstanding,
        paymentStatus,
        paymentTransactionId
      }
    })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const access = await verifyPayrollAccess()
  if (access.error) return access.error

  const { businessId, supabaseAdmin } = access

  try {
    const { id } = await params
    if (!isUuid(id)) {
      return NextResponse.json({ error: 'ID catatan gaji tidak valid.' }, { status: 400 })
    }

    const url = new URL(req.url)
    const paymentId = url.searchParams.get('paymentId')
    const voidAll = url.searchParams.get('all') === 'true'
    let voidReason = url.searchParams.get('reason') || ''

    if (!voidReason) {
      try {
        const body = await req.json()
        if (body?.reason) voidReason = String(body.reason)
      } catch {
        // optional body
      }
    }

    // 1. Fetch parent salary
    const { data: salary, error: getErr } = await supabaseAdmin
      .from('employee_salaries')
      .select('*, employees!inner(name, business_id), salary_payments(*)')
      .eq('id', id)
      .eq('employees.business_id', businessId)
      .single()

    if (getErr || !salary) {
      return NextResponse.json(
        { error: 'Catatan gaji tidak ditemukan atau Anda tidak memiliki akses.' },
        { status: 404 }
      )
    }

    if (salary.payment_status === 'cancelled') {
      return NextResponse.json(
        { error: 'Slip gaji ini sudah berstatus dibatalkan.' },
        { status: 400 }
      )
    }

    const accountMap = await ensureExpenseAccounts(businessId, supabaseAdmin)
    const salaryExpenseAccountId = accountMap['503300']
    const salaryLiabilityAccountId = accountMap['201100']

    if (!salaryExpenseAccountId || !salaryLiabilityAccountId) {
      return NextResponse.json(
        { error: 'Akun pembukuan gaji (503300 / 201100) tidak lengkap.' },
        { status: 500 }
      )
    }

    const allPayments = salary.salary_payments || []
    const activePayments = allPayments.filter(
      (p: any) => (p.status || 'active') === 'active'
    )

    if (activePayments.length === 0) {
      return NextResponse.json(
        { error: 'Tidak ada pembayaran aktif yang dapat dibatalkan pada slip gaji ini.' },
        { status: 400 }
      )
    }

    let targetsToVoid: any[] = []
    if (voidAll) {
      targetsToVoid = activePayments
    } else if (isUuid(paymentId)) {
      const target = activePayments.find((p: any) => p.id === paymentId)
      if (!target) {
        return NextResponse.json(
          { error: 'Data pembayaran tidak ditemukan atau sudah pernah dibatalkan sebelumnya.' },
          { status: 404 }
        )
      }
      targetsToVoid = [target]
    } else {
      return NextResponse.json(
        { error: 'Parameter paymentId atau all=true wajib disertakan.' },
        { status: 400 }
      )
    }

    let totalVoidedAmount = 0
    const reversalTxIds: string[] = []

    for (const targetPay of targetsToVoid) {
      const { reversalTransactionId } = await voidSingleSalaryPayment({
        payment: targetPay,
        salary,
        employeeName: salary.employees.name,
        businessId,
        voidReason: voidReason || 'Pembatalan Pembayaran (Unreconcile)',
        salaryExpenseAccountId,
        salaryLiabilityAccountId,
        db: supabaseAdmin
      })
      totalVoidedAmount += Number(targetPay.amount) || 0
      reversalTxIds.push(reversalTransactionId)
    }

    // Recalculate parent salary status & balances
    const { updatedSalary, netPaid, outstanding, paymentStatus } = await recalculateSalaryStatus({
      salaryId: id,
      totalAmount: Number(salary.amount) || 0,
      db: supabaseAdmin
    })

    return NextResponse.json({
      success: true,
      salary: updatedSalary,
      auditSummary: {
        action: 'payment_voided',
        voidedCount: targetsToVoid.length,
        voidedAmount: totalVoidedAmount,
        netPaid,
        outstanding,
        paymentStatus,
        reversalTransactionIds: reversalTxIds
      }
    })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
