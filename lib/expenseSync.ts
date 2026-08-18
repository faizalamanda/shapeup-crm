import { SupabaseClient } from '@supabase/supabase-js'

type ExpensePaymentRecord = {
  id: string
  expense_id: string
  transaction_id: string | null
  amount: number | string
}

type PurchasePaymentRecord = {
  id: string
  purchase_id: string
  transaction_id: string | null
  amount: number | string
}

/**
 * Synchronizes and recalculates payment status, amount_paid, and outstanding_amount for expenses.
 * It checks if any linked payment transactions or the main expense transaction have been voided/reversed or deleted.
 */
export async function syncExpenseStatus(
  supabase: SupabaseClient,
  businessId: string,
  targetExpenseId?: string
) {
  try {
    // 1. Fetch expenses for business (or specific target expense)
    let query = supabase
      .from('expenses')
      .select(`
        id,
        business_id,
        transaction_id,
        amount,
        amount_paid,
        outstanding_amount,
        payment_status
      `)
      .eq('business_id', businessId)

    if (targetExpenseId) {
      query = query.eq('id', targetExpenseId)
    }

    const { data: expenses, error: expErr } = await query
    if (expErr || !expenses || expenses.length === 0) return

    const expenseIds = expenses.map(e => e.id)

    // 2. Fetch all expense_payments for these expenses
    const { data: paymentsData, error: payErr } = await supabase
      .from('expense_payments')
      .select('id, expense_id, transaction_id, amount')
      .in('expense_id', expenseIds)

    if (payErr) return

    const payments: ExpensePaymentRecord[] = (paymentsData || []).map((p: any) => ({
      id: p.id,
      expense_id: p.expense_id,
      transaction_id: p.transaction_id,
      amount: p.amount
    }))

    // Collect all transaction_ids (both main expense transactions & payment transactions)
    const txIds = new Set<string>()
    expenses.forEach(e => {
      if (e.transaction_id) txIds.add(e.transaction_id)
    })
    payments.forEach(p => {
      if (p.transaction_id) txIds.add(p.transaction_id)
    })

    // Fetch existing transactions
    const existingTxMap = new Map<string, string>()
    if (txIds.size > 0) {
      const { data: txList } = await supabase
        .from('transactions')
        .select('id, description')
        .in('id', Array.from(txIds))

      txList?.forEach((t: any) => existingTxMap.set(t.id, t.description || ''))
    }

    // Fetch reversal transactions for this business
    const { data: revTxs } = await supabase
      .from('transactions')
      .select('id, description')
      .eq('business_id', businessId)
      .like('description', '[VOID / REVERSAL]%')

    const reversedDescriptions = new Set<string>()
    revTxs?.forEach((r: any) => {
      if (r.description) {
        const clean = r.description.replace('[VOID / REVERSAL]', '').trim()
        if (clean) reversedDescriptions.add(clean)
      }
    })

    // Helper to check if a transaction is voided or deleted
    const isTxVoided = (txId: string | null): boolean => {
      if (!txId) return true
      const desc = existingTxMap.get(txId)
      if (desc === undefined) return true // Transaction deleted!
      if (desc.includes('[VOID') || desc.includes('REVERSAL')) return true
      if (reversedDescriptions.has(desc.trim())) return true
      return false
    }

    // 3. Process each expense
    for (const exp of expenses) {
      const expPayments = payments.filter(p => p.expense_id === exp.id)
      
      const validPayments: ExpensePaymentRecord[] = []
      const invalidPaymentIds: string[] = []

      for (const p of expPayments) {
        if (isTxVoided(p.transaction_id)) {
          invalidPaymentIds.push(p.id)
        } else {
          validPayments.push(p)
        }
      }

      // Clean up voided/invalid expense_payments from database
      if (invalidPaymentIds.length > 0) {
        await supabase.from('expense_payments').delete().in('id', invalidPaymentIds)
      }

      const totalAmount = parseFloat(exp.amount || 0)
      const validPaidSum = validPayments.reduce((acc: number, p: ExpensePaymentRecord) => acc + parseFloat(String(p.amount || 0)), 0)
      const isMainTxVoided = isTxVoided(exp.transaction_id)

      let newPaid = validPaidSum
      let newOutstanding = Math.max(0, totalAmount - newPaid)
      let newStatus: 'paid' | 'unpaid' | 'partial'

      if (validPaidSum <= 0.01) {
        newPaid = 0
        newOutstanding = totalAmount
        newStatus = 'unpaid'
      } else if (newOutstanding <= 0.01) {
        newPaid = totalAmount
        newOutstanding = 0
        newStatus = 'paid'
      } else {
        newStatus = 'partial'
      }

      // If main transaction was voided and there are no valid payments, ensure unpaid
      if (isMainTxVoided && validPaidSum <= 0.01) {
        newPaid = 0
        newOutstanding = totalAmount
        newStatus = 'unpaid'
      }

      // Update expense if status or amounts changed
      if (
        parseFloat(exp.amount_paid || 0) !== newPaid ||
        parseFloat(exp.outstanding_amount || 0) !== newOutstanding ||
        exp.payment_status !== newStatus
      ) {
        await supabase
          .from('expenses')
          .update({
            amount_paid: newPaid,
            outstanding_amount: newOutstanding,
            payment_status: newStatus
          })
          .eq('id', exp.id)
      }
    }
  } catch (err) {
    console.error('Error syncing expense status:', err)
  }
}

/**
 * Synchronizes and recalculates payment status, amount_paid, and outstanding_amount for purchases.
 * It checks if any linked payment transactions or the main purchase transaction have been voided/reversed or deleted.
 */
export async function syncPurchaseStatus(
  supabase: SupabaseClient,
  businessId: string,
  targetPurchaseId?: string
) {
  try {
    let query = supabase
      .from('purchases')
      .select(`
        id,
        business_id,
        transaction_id,
        total_amount,
        amount_paid,
        outstanding_amount,
        payment_status
      `)
      .eq('business_id', businessId)

    if (targetPurchaseId) {
      query = query.eq('id', targetPurchaseId)
    }

    const { data: purchases, error: purErr } = await query
    if (purErr || !purchases || purchases.length === 0) return

    const purchaseIds = purchases.map(p => p.id)

    const { data: paymentsData, error: payErr } = await supabase
      .from('purchase_payments')
      .select('id, purchase_id, transaction_id, amount')
      .in('purchase_id', purchaseIds)

    if (payErr) return

    const payments: PurchasePaymentRecord[] = (paymentsData || []).map((p: any) => ({
      id: p.id,
      purchase_id: p.purchase_id,
      transaction_id: p.transaction_id,
      amount: p.amount
    }))

    const txIds = new Set<string>()
    purchases.forEach(p => {
      if (p.transaction_id) txIds.add(p.transaction_id)
    })
    payments.forEach(p => {
      if (p.transaction_id) txIds.add(p.transaction_id)
    })

    const existingTxMap = new Map<string, string>()
    if (txIds.size > 0) {
      const { data: txList } = await supabase
        .from('transactions')
        .select('id, description')
        .in('id', Array.from(txIds))

      txList?.forEach((t: any) => existingTxMap.set(t.id, t.description || ''))
    }

    const { data: revTxs } = await supabase
      .from('transactions')
      .select('id, description')
      .eq('business_id', businessId)
      .like('description', '[VOID / REVERSAL]%')

    const reversedDescriptions = new Set<string>()
    revTxs?.forEach((r: any) => {
      if (r.description) {
        const clean = r.description.replace('[VOID / REVERSAL]', '').trim()
        if (clean) reversedDescriptions.add(clean)
      }
    })

    const isTxVoided = (txId: string | null): boolean => {
      if (!txId) return true
      const desc = existingTxMap.get(txId)
      if (desc === undefined) return true
      if (desc.includes('[VOID') || desc.includes('REVERSAL')) return true
      if (reversedDescriptions.has(desc.trim())) return true
      return false
    }

    for (const pur of purchases) {
      const purPayments = payments.filter(p => p.purchase_id === pur.id)
      const validPayments: PurchasePaymentRecord[] = []
      const invalidPaymentIds: string[] = []

      for (const p of purPayments) {
        if (isTxVoided(p.transaction_id)) {
          invalidPaymentIds.push(p.id)
        } else {
          validPayments.push(p)
        }
      }

      if (invalidPaymentIds.length > 0) {
        await supabase.from('purchase_payments').delete().in('id', invalidPaymentIds)
      }

      const totalAmount = parseFloat(pur.total_amount || 0)
      const validPaidSum = validPayments.reduce((acc: number, p: PurchasePaymentRecord) => acc + parseFloat(String(p.amount || 0)), 0)
      const isMainTxVoided = isTxVoided(pur.transaction_id)

      let newPaid = validPaidSum
      let newOutstanding = Math.max(0, totalAmount - newPaid)
      let newStatus: 'paid' | 'unpaid' | 'partial'

      if (validPaidSum <= 0.01) {
        newPaid = 0
        newOutstanding = totalAmount
        newStatus = 'unpaid'
      } else if (newOutstanding <= 0.01) {
        newPaid = totalAmount
        newOutstanding = 0
        newStatus = 'paid'
      } else {
        newStatus = 'partial'
      }

      if (isMainTxVoided && validPaidSum <= 0.01) {
        newPaid = 0
        newOutstanding = totalAmount
        newStatus = 'unpaid'
      }

      if (
        parseFloat(pur.amount_paid || 0) !== newPaid ||
        parseFloat(pur.outstanding_amount || 0) !== newOutstanding ||
        pur.payment_status !== newStatus
      ) {
        await supabase
          .from('purchases')
          .update({
            amount_paid: newPaid,
            outstanding_amount: newOutstanding,
            payment_status: newStatus
          })
          .eq('id', pur.id)
      }
    }
  } catch (err) {
    console.error('Error syncing purchase status:', err)
  }
}
