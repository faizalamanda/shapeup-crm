import { getApiContext } from '@/lib/apiContext'
import { NextResponse } from 'next/server'
import { ensureExpenseAccounts } from '@/lib/expenseLedger'
import { postJournalTransaction } from '@/lib/journalHelper'

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const ctx = await getApiContext()
  if (ctx.error) return ctx.error
  const { businessId, supabase } = ctx

  try {
    const { id } = await params
    const body = await req.json()
    const {
      amount,
      payment_method_account_id,
      date,
      write_off_amount = 0,
      write_off_account_id,
      notes,
      attachment_url
    } = body

    if (amount === undefined || !payment_method_account_id || !date) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
    }

    const numAmount = parseFloat(amount)
    const numWriteOff = parseFloat(write_off_amount) || 0

    if (isNaN(numAmount) || numAmount <= 0) {
      return NextResponse.json({ error: 'Invalid payment amount' }, { status: 400 })
    }

    if (numWriteOff !== 0 && !write_off_account_id) {
      return NextResponse.json({ error: 'Write-off account is required when write-off amount is non-zero' }, { status: 400 })
    }

    // Resolve Account Mapping (cached)
    const accountMap = await ensureExpenseAccounts(businessId, supabase)
    const accHutang = accountMap['201000'] // Hutang Usaha

    if (!accHutang) {
      return NextResponse.json({ error: 'Required accounts payable could not be resolved' }, { status: 500 })
    }

    // Fetch the purchase
    const { data: purchase, error: getErr } = await supabase
      .from('purchases')
      .select('*')
      .eq('id', id)
      .eq('business_id', businessId)
      .single()

    if (getErr || !purchase) {
      return NextResponse.json({ error: 'Purchase not found' }, { status: 404 })
    }

    // Calculate new amounts
    const totalDebtCleared = numAmount + numWriteOff
    const newAmountPaid = (purchase.amount_paid || 0) + totalDebtCleared
    const grandTotal = purchase.grand_total

    // Ensure we are not overpaying (with a small floating point tolerance)
    if (newAmountPaid > grandTotal + 0.01) {
      return NextResponse.json({ error: `Payment exceeds remaining balance. Remaining: ${grandTotal - purchase.amount_paid}` }, { status: 400 })
    }

    const newPaymentStatus = newAmountPaid >= grandTotal - 0.01 ? 'paid' : 'partial'

    // 1. Post Payment Journal Transaction via postJournalTransaction helper
    const journalLines: any[] = [
      {
        account_id: accHutang, // Debit Hutang Usaha to decrease liability
        debit: totalDebtCleared,
        credit: 0
      },
      {
        account_id: payment_method_account_id, // Credit Cash/Bank
        debit: 0,
        credit: numAmount
      }
    ]

    // Handle Write-off Line Item if any
    if (numWriteOff !== 0) {
      if (numWriteOff > 0) {
        // Cash paid is less than debt cleared. Credit write-off account (Gain/Discount)
        journalLines.push({
          account_id: write_off_account_id,
          debit: 0,
          credit: numWriteOff
        })
      } else {
        // Cash paid is more than debt cleared. Debit write-off account (Fee/Expense)
        journalLines.push({
          account_id: write_off_account_id,
          debit: Math.abs(numWriteOff),
          credit: 0
        })
      }
    }

    let payTxId: string
    try {
      const postRes = await postJournalTransaction(
        businessId,
        null,
        date,
        `Pembayaran Pembelian: ${purchase.purchase_number}`,
        journalLines,
        supabase,
        true
      )
      payTxId = postRes.transactionId
    } catch (txErr: any) {
      return NextResponse.json({ error: `Failed to create payment transaction: ${txErr?.message}` }, { status: 500 })
    }

    // 2. Create Payment Log Record
    const { data: paymentLog, error: payLogErr } = await supabase
      .from('purchase_payments')
      .insert({
        business_id: businessId,
        purchase_id: id,
        transaction_id: payTxId,
        date,
        amount: numAmount,
        payment_method_account_id,
        write_off_amount: numWriteOff,
        write_off_account_id: write_off_account_id || null,
        attachment_url,
        notes
      })
      .select('*')
      .single()

    if (payLogErr) {
      await supabase.from('transactions').delete().eq('id', payTxId)
      return NextResponse.json({ error: `Failed to record payment log: ${payLogErr.message}` }, { status: 500 })
    }

    // 3. Update Purchase
    const { error: updErr } = await supabase
      .from('purchases')
      .update({
        amount_paid: newAmountPaid,
        payment_status: newPaymentStatus
      })
      .eq('id', id)

    if (updErr) {
      await supabase.from('transactions').delete().eq('id', payTxId)
      return NextResponse.json({ error: `Failed to update purchase details: ${updErr.message}` }, { status: 500 })
    }

    return NextResponse.json(paymentLog)
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
