import { SupabaseClient } from '@supabase/supabase-js'
import { getOrCreateDefaultAccounts } from '@/lib/accountHelper'
import { postJournalTransaction } from '@/lib/journalHelper'

export interface SyncMovementResult {
  totalProcessed: number
  syncedCount: number
  skippedCount: number
  details: Array<{
    movementId: string
    type: string
    amount: number
    note: string
    transactionId?: string
    status: 'synced' | 'skipped' | 'failed'
    reason?: string
  }>
}

/**
 * Synchronizes historical POS shift movements (petty cash in/out) to the accounting journal.
 * Idempotent: checks for existing transaction headers with [POS-MOV-{id}] to prevent duplicate postings.
 */
export async function syncHistoricalCashMovements(
  businessId: string,
  supabase: SupabaseClient
): Promise<SyncMovementResult> {
  // 1. Fetch default / existing accounts for this business
  const accountMap = await getOrCreateDefaultAccounts(businessId, supabase)

  const { data: allAccounts } = await supabase
    .from('accounts')
    .select('id, code, name, type, sub_type')
    .eq('business_id', businessId)

  const accountsList = allAccounts || []

  // Resolve standard accounts
  const defaultKasPosAccId = accountMap['101000'] || accountsList.find(a => a.code === '101000')?.id
  const defaultKasUtamaAccId = accountMap['101100'] || accountsList.find(a => a.code === '101100')?.id
  const defaultBebanOpsAccId = accountMap['503000'] || accountsList.find(a => a.code === '503000')?.id
  const defaultModalAccId = accountMap['301000'] || accountsList.find(a => a.code === '301000')?.id

  // 2. Fetch all shift movements for this business
  const { data: movements, error: movErr } = await supabase
    .from('pos_shift_movements')
    .select('id, shift_id, business_id, type, amount, note, created_at')
    .eq('business_id', businessId)
    .order('created_at', { ascending: true })

  if (movErr) {
    throw new Error(`Failed to fetch pos_shift_movements: ${movErr.message}`)
  }

  const movementList = movements || []
  if (movementList.length === 0) {
    return {
      totalProcessed: 0,
      syncedCount: 0,
      skippedCount: 0,
      details: []
    }
  }

  // 3. Find existing POS-MOV transactions to prevent duplicates
  const { data: existingTxs } = await supabase
    .from('transactions')
    .select('id, description')
    .eq('business_id', businessId)
    .ilike('description', '%[POS-MOV-%')

  const existingMovementIds = new Set<string>()
  if (existingTxs) {
    for (const tx of existingTxs) {
      const match = (tx.description || '').match(/\[POS-MOV-([0-9a-fA-F-]+)\]/)
      if (match && match[1]) {
        existingMovementIds.add(match[1])
      }
    }
  }

  // 4. Fetch related shifts to identify cashier name and register_id
  const shiftIds = Array.from(new Set(movementList.map(m => m.shift_id).filter(Boolean)))
  const { data: shifts } = await supabase
    .from('pos_shifts')
    .select('id, cashier_name, register_id')
    .in('id', shiftIds)

  const shiftMap = new Map<string, { cashier_name?: string; register_id?: string | null }>()
  if (shifts) {
    shifts.forEach(s => shiftMap.set(s.id, s))
  }

  // 5. Fetch pos_registers for register specific accounts
  const registerIds = Array.from(new Set(shifts?.map(s => s.register_id).filter(Boolean) as string[]))
  const registerAccountMap = new Map<string, string>()
  if (registerIds.length > 0) {
    const { data: registers } = await supabase
      .from('pos_registers')
      .select('id, account_id')
      .in('id', registerIds)
    if (registers) {
      registers.forEach(r => {
        if (r.account_id) registerAccountMap.set(r.id, r.account_id)
      })
    }
  }

  const details: SyncMovementResult['details'] = []
  let syncedCount = 0
  let skippedCount = 0

  for (const mov of movementList) {
    if (existingMovementIds.has(mov.id)) {
      skippedCount++
      details.push({
        movementId: mov.id,
        type: mov.type,
        amount: Number(mov.amount),
        note: mov.note || '',
        status: 'skipped',
        reason: 'Sudah memiliki transaksi jurnal'
      })
      continue
    }

    const shift = shiftMap.get(mov.shift_id)
    const cashierName = shift?.cashier_name || 'Kasir'
    const regAccountId = shift?.register_id ? registerAccountMap.get(shift.register_id) : null
    const kasPosAccId = regAccountId || defaultKasPosAccId

    if (!kasPosAccId) {
      details.push({
        movementId: mov.id,
        type: mov.type,
        amount: Number(mov.amount),
        note: mov.note || '',
        status: 'failed',
        reason: 'Akun Kas POS (101000) tidak ditemukan'
      })
      continue
    }

    const noteLower = (mov.note || '').toLowerCase()
    let counterAccountId: string | undefined

    if (mov.type === 'cash_out') {
      // Smart Expense account mapping based on note keyword
      if (noteLower.includes('bensin') || noteLower.includes('ongkir') || noteLower.includes('kurir') || noteLower.includes('parkir') || noteLower.includes('transport')) {
        counterAccountId = accountsList.find(a => a.code === '503500' || a.name.toLowerCase().includes('transport'))?.id
      } else if (noteLower.includes('lakban') || noteLower.includes('plastik') || noteLower.includes('atk') || noteLower.includes('kertas') || noteLower.includes('tag')) {
        counterAccountId = accountsList.find(a => a.code === '503400' || a.name.toLowerCase().includes('perlengkapan'))?.id
      } else if (noteLower.includes('minuman') || noteLower.includes('makan') || noteLower.includes('es') || noteLower.includes('air') || noteLower.includes('galon') || noteLower.includes('susu') || noteLower.includes('snack') || noteLower.includes('konsumsi')) {
        counterAccountId = accountsList.find(a => a.code === '503900' || a.name.toLowerCase().includes('konsumsi'))?.id
      } else if (noteLower.includes('gas') || noteLower.includes('listrik') || noteLower.includes('lpg')) {
        counterAccountId = accountsList.find(a => a.code === '503200' || a.name.toLowerCase().includes('utilitas'))?.id
      }

      // Fallback to default Beban Operasional
      if (!counterAccountId) {
        counterAccountId = defaultBebanOpsAccId || accountsList.find(a => a.type === 'EXPENSE')?.id
      }
    } else {
      // Cash In: Source of fund
      if (noteLower.includes('modal') || noteLower.includes('owner') || noteLower.includes('pemilik')) {
        counterAccountId = defaultModalAccId || defaultKasUtamaAccId
      } else {
        counterAccountId = defaultKasUtamaAccId || defaultModalAccId
      }
    }

    if (!counterAccountId) {
      details.push({
        movementId: mov.id,
        type: mov.type,
        amount: Number(mov.amount),
        note: mov.note || '',
        status: 'failed',
        reason: 'Akun lawan transaksi tidak ditemukan'
      })
      continue
    }

    const amountNum = Number(mov.amount) || 0
    const journalLines = mov.type === 'cash_out'
      ? [
          { account_id: counterAccountId, debit: amountNum, credit: 0 },
          { account_id: kasPosAccId, debit: 0, credit: amountNum }
        ]
      : [
          { account_id: kasPosAccId, debit: amountNum, credit: 0 },
          { account_id: counterAccountId, debit: 0, credit: amountNum }
        ]

    const noteText = mov.note || (mov.type === 'cash_in' ? 'Kas Masuk Laci' : 'Kas Keluar Operasional')
    const desc = mov.type === 'cash_out'
      ? `[POS-MOV-${mov.id}] Pengeluaran Kas POS: ${noteText} (${cashierName})`
      : `[POS-MOV-${mov.id}] Kas Masuk Laci POS: ${noteText} (${cashierName})`

    const txDate = mov.created_at || new Date().toISOString()

    try {
      const res = await postJournalTransaction(
        businessId,
        null,
        txDate,
        desc,
        journalLines,
        supabase,
        false
      )

      syncedCount++
      details.push({
        movementId: mov.id,
        type: mov.type,
        amount: amountNum,
        note: noteText,
        transactionId: res.transactionId,
        status: 'synced'
      })
    } catch (jErr: any) {
      details.push({
        movementId: mov.id,
        type: mov.type,
        amount: amountNum,
        note: noteText,
        status: 'failed',
        reason: jErr.message || 'Gagal posting jurnal'
      })
    }
  }

  return {
    totalProcessed: movementList.length,
    syncedCount,
    skippedCount,
    details
  }
}

