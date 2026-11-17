import { SupabaseClient } from '@supabase/supabase-js'
import { getAdminSupabase } from '@/lib/supabaseServer'
import { formatTransactionDate } from '@/lib/timeUtils'
import { isUuid } from '@/lib/utils'

const expenseAccountCache: Record<string, Record<string, string>> = {}

/**
 * Ensures default expense and inventory adjustment accounts are created for a business.
 * Returns a mapping of account codes to their UUIDs.
 */
export async function ensureExpenseAccounts(
  businessId: string,
  supabase: SupabaseClient
): Promise<Record<string, string>> {
  let accountMap = expenseAccountCache[businessId]
  if (accountMap) {
    return accountMap
  }

  const defaultAccounts = [
    { code: '201000', name: 'Hutang Usaha', type: 'LIABILITY', business_id: businessId },
    { code: '201100', name: 'Hutang Gaji & Upah', type: 'LIABILITY', business_id: businessId },
    { code: '502000', name: 'Penyesuaian Persediaan', type: 'EXPENSE', business_id: businessId },
    { code: '503000', name: 'Beban Operasional', type: 'EXPENSE', business_id: businessId },
    { code: '102000', name: 'Persediaan Barang', type: 'ASSET', business_id: businessId },
    { code: '503100', name: 'Beban Pemasaran & Promosi', type: 'EXPENSE', business_id: businessId },
    { code: '503200', name: 'Beban Utilitas (Listrik/Air/Internet)', type: 'EXPENSE', business_id: businessId },
    { code: '503300', name: 'Beban Gaji & Upah', type: 'EXPENSE', business_id: businessId },
    { code: '503400', name: 'Beban Perlengkapan Kantor / ATK', type: 'EXPENSE', business_id: businessId },
    { code: '503500', name: 'Beban Transportasi & Perjalanan Dinas', type: 'EXPENSE', business_id: businessId },
    { code: '503600', name: 'Beban Sewa Tempat', type: 'EXPENSE', business_id: businessId },
    { code: '503700', name: 'Beban Pemeliharaan & Perbaikan', type: 'EXPENSE', business_id: businessId },
    { code: '503800', name: 'Beban Pajak & Perizinan', type: 'EXPENSE', business_id: businessId },
    { code: '503900', name: 'Beban Konsumsi & Hiburan', type: 'EXPENSE', business_id: businessId },
    { code: '504000', name: 'Beban Bunga & Administrasi Bank', type: 'EXPENSE', business_id: businessId },
    { code: '120000', name: 'Peralatan & Inventaris Kantor', type: 'ASSET', business_id: businessId }
  ]

  // Fetch existing accounts for this business
  const { data: existingAccounts, error: fetchErr } = await supabase
    .from('accounts')
    .select('id, code')
    .eq('business_id', businessId)

  if (fetchErr) {
    throw new Error(`Failed to fetch existing accounts: ${fetchErr.message}`)
  }

  const existingCodes = existingAccounts ? existingAccounts.map(a => a.code) : []
  const accountsToCreate = defaultAccounts.filter(a => !existingCodes.includes(a.code))

  const targetCodes = [
    '201000', '201100', '502000', '503000', '102000',
    '503100', '503200', '503300', '503400',
    '503500', '503600', '503700', '503800',
    '503900', '504000', '120000'
  ]

  if (accountsToCreate.length > 0) {
    let { error: insAccErr } = await supabase.from('accounts').insert(accountsToCreate)

    if (insAccErr && !insAccErr.message.includes('duplicate key')) {
      try {
        const admin = getAdminSupabase()
        const adminRes = await admin.from('accounts').insert(accountsToCreate)
        insAccErr = adminRes.error
      } catch (adminErr) {
        console.warn('[ExpenseLedger] Admin fallback failed:', adminErr)
      }
    }

    if (insAccErr && !insAccErr.message.includes('duplicate key')) {
      throw new Error(`Failed to create default accounts: ${insAccErr.message}`)
    }

    // Refetch accounts to build the mapping only when we inserted new ones
    let { data: allAccounts, error: refetchAccErr } = await supabase
      .from('accounts')
      .select('id, code')
      .eq('business_id', businessId)
      .in('code', targetCodes)

    if (refetchAccErr || !allAccounts || allAccounts.length < targetCodes.length) {
      try {
        const admin = getAdminSupabase()
        const adminRes = await admin
          .from('accounts')
          .select('id, code')
          .eq('business_id', businessId)
          .in('code', targetCodes)
        if (adminRes.data && adminRes.data.length > 0) {
          allAccounts = adminRes.data
          refetchAccErr = null
        }
      } catch {
        // ignore
      }
    }

    if (refetchAccErr || !allAccounts) {
      throw new Error(`Failed to refetch ledger accounts: ${refetchAccErr?.message || 'unknown'}`)
    }

    accountMap = {}
    allAccounts.forEach(a => {
      accountMap[a.code] = a.id
    })
  } else {
    // Build mapping directly from existingAccounts without an extra database query
    accountMap = {}
    if (existingAccounts) {
      existingAccounts.forEach(a => {
        if (targetCodes.includes(a.code)) {
          accountMap[a.code] = a.id
        }
      })
    }
  }

  expenseAccountCache[businessId] = accountMap
  return accountMap
}

export type ExpenseLedgerInput = {
  category_account_id?: unknown
  payment_account_id?: unknown
  amount?: unknown
  date?: unknown
  description?: unknown
  vendor_name?: unknown
  attachment_url?: unknown
  payment_status?: unknown
  due_date?: unknown
  amount_paid?: unknown
}

export type ExpenseJournalLine = {
  account_id: string
  debit: number
  credit: number
}

export type PreparedExpenseLedger = {
  business_id: string
  category_account_id: string
  payment_account_id: string
  payment_method_account_id: string | null
  amount: number
  date: string
  tx_date: string
  tx_description: string
  description: string | null
  vendor_name: string | null
  attachment_url: string | null
  payment_status: 'paid' | 'unpaid' | 'partial'
  due_date: string | null
  amount_paid: number
  outstanding_amount: number
  journal_lines: ExpenseJournalLine[]
}

/**
 * Centralized validation, COA resolution, and balancing journal line builder
 * for expense creation, editing, and bulk import.
 */
export async function prepareExpenseLedgerData(
  input: ExpenseLedgerInput,
  businessId: string,
  supabase: SupabaseClient,
  preloadedHutangAccountId?: string
): Promise<
  | { ok: true; data: PreparedExpenseLedger }
  | { ok: false; error: string; status: number }
> {
  const categoryAccountId = isUuid(input.category_account_id) ? input.category_account_id : null
  const paymentAccountId = isUuid(input.payment_account_id) ? input.payment_account_id : null
  const dateStr = typeof input.date === 'string' ? input.date.trim() : ''

  if (!categoryAccountId || input.amount === undefined || input.amount === null || !dateStr) {
    return { ok: false, error: 'Missing required fields', status: 400 }
  }

  const numAmount = parseFloat(String(input.amount))
  if (isNaN(numAmount) || numAmount < 0) {
    return { ok: false, error: 'Invalid amount', status: 400 }
  }

  const rawStatus = typeof input.payment_status === 'string' ? input.payment_status : 'paid'
  const status: 'paid' | 'unpaid' | 'partial' =
    rawStatus === 'unpaid' || rawStatus === 'partial' ? rawStatus : 'paid'

  if (status !== 'unpaid' && !paymentAccountId) {
    return { ok: false, error: 'Missing payment account for paid/partial expense', status: 400 }
  }

  const numAmountPaid =
    status === 'paid'
      ? numAmount
      : status === 'unpaid'
        ? 0
        : parseFloat(String(input.amount_paid ?? 0))

  if (isNaN(numAmountPaid) || numAmountPaid < 0 || numAmountPaid > numAmount) {
    return { ok: false, error: 'Invalid amount paid', status: 400 }
  }

  const numOutstanding = numAmount - numAmountPaid

  // Only resolve Hutang Usaha (201000) when there is an outstanding/unpaid balance
  let hutangAccountId = preloadedHutangAccountId
  if ((numOutstanding > 0 || status === 'unpaid') && !hutangAccountId) {
    const accountMap = await ensureExpenseAccounts(businessId, supabase)
    hutangAccountId = accountMap['201000']
  }

  if ((numOutstanding > 0 || status === 'unpaid') && !hutangAccountId) {
    return { ok: false, error: 'Hutang Usaha account (201000) not found', status: 400 }
  }

  const descriptionStr = typeof input.description === 'string' ? input.description : null
  const vendorNameStr = typeof input.vendor_name === 'string' ? input.vendor_name : null
  const attachmentUrlStr = typeof input.attachment_url === 'string' && input.attachment_url.trim()
    ? input.attachment_url.trim()
    : null
  const dueDateStr = status !== 'paid' && typeof input.due_date === 'string' && input.due_date.trim()
    ? input.due_date.trim()
    : null

  const journalLines: ExpenseJournalLine[] = [
    {
      account_id: categoryAccountId,
      debit: numAmount,
      credit: 0
    }
  ]

  if (numAmountPaid > 0 && paymentAccountId) {
    journalLines.push({
      account_id: paymentAccountId,
      debit: 0,
      credit: numAmountPaid
    })
  }

  if (numOutstanding > 0 && hutangAccountId) {
    journalLines.push({
      account_id: hutangAccountId,
      debit: 0,
      credit: numOutstanding
    })
  }

  return {
    ok: true,
    data: {
      business_id: businessId,
      category_account_id: categoryAccountId,
      payment_account_id: status !== 'unpaid' && paymentAccountId ? paymentAccountId : (hutangAccountId as string),
      payment_method_account_id: paymentAccountId,
      amount: numAmount,
      date: dateStr,
      tx_date: formatTransactionDate(dateStr),
      tx_description: `Pengeluaran: ${descriptionStr || 'Operasional'}`,
      description: descriptionStr,
      vendor_name: vendorNameStr,
      attachment_url: attachmentUrlStr,
      payment_status: status,
      due_date: dueDateStr,
      amount_paid: numAmountPaid,
      outstanding_amount: numOutstanding,
      journal_lines: journalLines
    }
  }
}

/**
 * Creates an expense, its ledger transaction, balancing journal lines, and initial payment log
 * in a single ACID PostgreSQL RPC call.
 */
export async function createExpenseWithLedger(
  businessId: string,
  input: ExpenseLedgerInput,
  supabase: SupabaseClient
) {
  const prepared = await prepareExpenseLedgerData(input, businessId, supabase)
  if (!prepared.ok) {
    return { ok: false as const, error: prepared.error, status: prepared.status }
  }

  const { data, error } = await supabase.rpc('create_expense_transaction_v1', {
    payload: prepared.data
  })

  if (error) {
    return { ok: false as const, error: `Failed to create expense: ${error.message}`, status: 500 }
  }

  return { ok: true as const, data }
}

/**
 * Updates an expense, its ledger transaction, and rebuilds balancing journal lines
 * in a single ACID PostgreSQL RPC call.
 */
export async function updateExpenseWithLedger(
  businessId: string,
  expenseId: string,
  input: ExpenseLedgerInput,
  supabase: SupabaseClient
) {
  if (!isUuid(expenseId)) {
    return { ok: false as const, error: 'Invalid expense ID', status: 400 }
  }

  const prepared = await prepareExpenseLedgerData(input, businessId, supabase)
  if (!prepared.ok) {
    return { ok: false as const, error: prepared.error, status: prepared.status }
  }

  const { data, error } = await supabase.rpc('update_expense_transaction_v1', {
    payload: {
      ...prepared.data,
      expense_id: expenseId
    }
  })

  if (error) {
    if (error.message.includes('EXPENSE_NOT_FOUND')) {
      return { ok: false as const, error: 'Expense not found', status: 404 }
    }
    if (error.message.includes('EXPENSE_ALREADY_PAID')) {
      return {
        ok: false as const,
        error: 'Pengeluaran tidak dapat diubah karena statusnya sudah lunas. Silakan batalkan transaksi jika ingin mengubah.',
        status: 400
      }
    }
    if (error.message.includes('EXPENSE_HAS_PAYMENTS')) {
      return {
        ok: false as const,
        error: 'Pengeluaran tidak dapat diubah karena sudah memiliki riwayat pembayaran cicilan. Silakan hapus pembayaran cicilan terlebih dahulu.',
        status: 400
      }
    }
    return { ok: false as const, error: `Failed to update expense: ${error.message}`, status: 500 }
  }

  return { ok: true as const, data }
}
