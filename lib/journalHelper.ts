import { SupabaseClient } from '@supabase/supabase-js'

export async function postJournalTransaction(
  businessId: string,
  orderId: string | null,
  date: string,
  description: string,
  journalLines: any[],
  supabase: SupabaseClient,
  skipExistingCheck: boolean = false
) {
  let transactionId = ''

  if (!skipExistingCheck) {
    // 1. Check if transaction already exists for this order + description
    let fetchQuery = supabase
      .from('transactions')
      .select('id, journal_lines(id)')
      .eq('business_id', businessId)
      .eq('description', description)

    if (orderId) {
      fetchQuery = fetchQuery.eq('order_id', orderId)
    } else {
      fetchQuery = fetchQuery.is('order_id', null)
    }

    const { data: existingTx, error: fetchErr } = await fetchQuery.limit(1)

    if (fetchErr) throw fetchErr

    if (existingTx && existingTx.length > 0) {
      const tx = existingTx[0]
      transactionId = tx.id
      
      const hasLines = tx.journal_lines && tx.journal_lines.length > 0
      if (hasLines) {
        // Transaction already properly exists, no partial-commit issue
        return { success: true, transactionId, action: 'skipped' }
      } else {
        // SELF HEALING: Transaction exists but no lines (Partial Commit Bug)
        // We will re-insert the lines below.
        console.warn(`[Journal] Self-healing partial commit for transaction ${tx.id}`)
      }
    }
  }

  if (!transactionId) {
    // 2. Insert new transaction header
    const { data: newTx, error: insTxErr } = await supabase
      .from('transactions')
      .insert({
        business_id: businessId,
        order_id: orderId,
        date: date,
        description: description
      })
      .select('id')
      .single()

    if (insTxErr) throw insTxErr
    transactionId = newTx.id
  }

  // 3. Insert journal lines
  if (journalLines.length > 0) {
    const dbJournalLines = journalLines.map(line => ({
      transaction_id: transactionId,
      account_id: line.account_id,
      debit: line.debit || 0,
      credit: line.credit || 0
    }))

    const { error: insLinesErr } = await supabase.from('journal_lines').insert(dbJournalLines)
    if (insLinesErr) throw insLinesErr
  }

  return { success: true, transactionId, action: 'created_or_healed' }
}
