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
        payment_status,
        date,
        payment_account_id
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

    // 3. Fetch journal lines for all transactions to determine initial payments in main expense transactions
    const mainTxPaidMap = new Map<string, number>()
    if (txIds.size > 0) {
      const { data: jlData } = await supabase
        .from('journal_lines')
        .select(`
          transaction_id,
          credit,
          accounts!inner(code, type)
        `)
        .in('transaction_id', Array.from(txIds))
        .gt('credit', 0)

      if (jlData) {
        jlData.forEach((jl: any) => {
          const accCode = jl.accounts?.code || ''
          const accType = jl.accounts?.type || ''
          // If credit line is to a Cash/Bank asset account (code starting with 101 or Asset), it's a payment
          if (accCode.startsWith('101') || (accType === 'ASSET' && !accCode.startsWith('102') && !accCode.startsWith('120'))) {
            const current = mainTxPaidMap.get(jl.transaction_id) || 0
            mainTxPaidMap.set(jl.transaction_id, current + parseFloat(jl.credit || 0))
          }
        })
      }
    }

    // 4. Process each expense
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

      const isMainTxVoided = isTxVoided(exp.transaction_id)
      const mainTxPaidAmount = (!isMainTxVoided && exp.transaction_id)
        ? (mainTxPaidMap.get(exp.transaction_id) || 0)
        : 0

      // Sum external payments (excluding any payment log tied to the main transaction to avoid double counting)
      const externalPaymentsSum = validPayments
        .filter(p => p.transaction_id !== exp.transaction_id)
        .reduce((acc: number, p: ExpensePaymentRecord) => acc + parseFloat(String(p.amount || 0)), 0)

      const validPaidSum = mainTxPaidAmount + externalPaymentsSum
      const totalAmount = parseFloat(exp.amount || 0)

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

      // If main transaction was voided and there are no valid external payments, ensure unpaid
      if (isMainTxVoided && externalPaymentsSum <= 0.01) {
        newPaid = 0
        newOutstanding = totalAmount
        newStatus = 'unpaid'
      }

      // Update expense if status or amounts changed
      if (
        Math.abs(parseFloat(exp.amount_paid || 0) - newPaid) > 0.01 ||
        Math.abs(parseFloat(exp.outstanding_amount || 0) - newOutstanding) > 0.01 ||
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

      // Auto-backfill initial payment log into expense_payments table for Single Source of Truth
      if (!isMainTxVoided && mainTxPaidAmount > 0 && expPayments.length === 0) {
        await supabase
          .from('expense_payments')
          .insert({
            business_id: businessId,
            expense_id: exp.id,
            transaction_id: exp.transaction_id || null,
            date: exp.date || new Date().toISOString().split('T')[0],
            amount: mainTxPaidAmount,
            payment_method_account_id: exp.payment_account_id || null,
            notes: newStatus === 'paid' ? 'Pembayaran Lunas Saat Pengeluaran Dibuat' : 'Uang Muka / DP'
          })
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
        payment_status,
        date
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

      // Auto-backfill initial payment log into purchase_payments table for Single Source of Truth
      if (!isMainTxVoided && validPaidSum > 0 && purPayments.length === 0) {
        await supabase
          .from('purchase_payments')
          .insert({
            business_id: businessId,
            purchase_id: pur.id,
            transaction_id: pur.transaction_id || null,
            date: pur.date || new Date().toISOString().split('T')[0],
            amount: validPaidSum,
            payment_method_account_id: null,
            notes: newStatus === 'paid' ? 'Pembayaran Lunas Saat Pembelian Dibuat' : 'Uang Muka / DP'
          })
      }
    }
  } catch (err) {
    console.error('Error syncing purchase status:', err)
  }
}
