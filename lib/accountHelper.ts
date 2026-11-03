import { SupabaseClient } from '@supabase/supabase-js'
import { getAdminSupabase } from '@/lib/supabaseServer'
import { COAPaymentAccount, isCashBankAccount, resolvePaymentAccountFromCOA } from '@/lib/coa'

export type { COAPaymentAccount }
export { isCashBankAccount, resolvePaymentAccountFromCOA }

const accountCache: Record<string, Record<string, string>> = {}

/**
 * Dynamically fetches all active Cash & Bank COA accounts for the given business.
 * Uses select('*') so it works regardless of whether sub_type column exists.
 * Only seeds default accounts if the business has zero Cash/Bank accounts in its COA.
 */
export async function getActivePaymentAccounts(
  businessId: string,
  supabase: SupabaseClient
): Promise<COAPaymentAccount[]> {
  const fetchAssetAccounts = async (): Promise<COAPaymentAccount[]> => {
    let { data, error } = await supabase
      .from('accounts')
      .select('*')
      .eq('business_id', businessId)
      .eq('type', 'ASSET')
      .order('code', { ascending: true })

    if (error || !data || data.length === 0) {
      try {
        const admin = getAdminSupabase()
        const adminRes = await admin
          .from('accounts')
          .select('*')
          .eq('business_id', businessId)
          .eq('type', 'ASSET')
          .order('code', { ascending: true })
        if (adminRes.data && adminRes.data.length > 0) {
          data = adminRes.data
        }
      } catch {
        // ignore
      }
    }

    return ((data || []) as any[]).filter(isCashBankAccount).map(a => ({
      id: a.id,
      code: a.code,
      name: a.name,
      type: a.type || 'ASSET',
      sub_type: a.sub_type || null
    }))
  }

  let paymentAccounts = await fetchAssetAccounts()
  if (paymentAccounts.length === 0) {
    await getOrCreateDefaultAccounts(businessId, supabase)
    paymentAccounts = await fetchAssetAccounts()
  }

  return paymentAccounts
}

export async function getOrCreateDefaultAccounts(
  businessId: string,
  supabase: SupabaseClient
): Promise<Record<string, string>> {
  if (accountCache[businessId]) {
    return accountCache[businessId]
  }

  const defaultAccounts = [
    { code: '101000', name: 'Kas POS (Tunai)', type: 'ASSET', business_id: businessId },
    { code: '101100', name: 'Kas Utama / Rekening Bank Utama', type: 'ASSET', business_id: businessId },
    { code: '101200', name: 'Bank / QRIS POS', type: 'ASSET', business_id: businessId },
    { code: '103000', name: 'Piutang Usaha', type: 'ASSET', business_id: businessId },
    { code: '301000', name: 'Modal Pemilik', type: 'EQUITY', business_id: businessId },
    { code: '401000', name: 'Pendapatan Penjualan POS', type: 'REVENUE', business_id: businessId },
    { code: '401100', name: 'Potongan Penjualan / Diskon', type: 'REVENUE', business_id: businessId },
    { code: '402000', name: 'Pendapatan Ongkir', type: 'REVENUE', business_id: businessId },
    { code: '403000', name: 'Pendapatan Lain-lain / Admin', type: 'REVENUE', business_id: businessId },
    { code: '501000', name: 'Harga Pokok Penjualan (HPP)', type: 'EXPENSE', business_id: businessId },
    { code: '503000', name: 'Beban Selisih Kas / Operasional Lainnya', type: 'EXPENSE', business_id: businessId },
    { code: '102000', name: 'Persediaan Barang', type: 'ASSET', business_id: businessId }
  ]

  // Fetch existing accounts for this business to respect multi-tenant unique constraint on (business_id, code)
  let { data: existingAccounts } = await supabase
    .from('accounts')
    .select('id, code')
    .eq('business_id', businessId)

  // Resilient read fallback if user client cannot read accounts yet
  if (!existingAccounts || existingAccounts.length === 0) {
    try {
      const admin = getAdminSupabase()
      const adminRes = await admin
        .from('accounts')
        .select('id, code')
        .eq('business_id', businessId)
      if (adminRes.data) existingAccounts = adminRes.data
    } catch {
      // ignore
    }
  }

  const existingCodes = existingAccounts ? existingAccounts.map(a => a.code) : []
  const accountsToCreate = defaultAccounts.filter(a => !existingCodes.includes(a.code))

  if (accountsToCreate.length > 0) {
    let { error: insAccErr } = await supabase.from('accounts').insert(accountsToCreate)
    
    // Resilient admin insert fallback if client hits RLS policy
    if (insAccErr && !insAccErr.message.includes('duplicate key')) {
      try {
        const admin = getAdminSupabase()
        const adminRes = await admin.from('accounts').insert(accountsToCreate)
        insAccErr = adminRes.error
      } catch (adminFallbackErr) {
        console.warn('[AccountHelper] Admin insert fallback failed:', adminFallbackErr)
      }
    }

    if (insAccErr && !insAccErr.message.includes('duplicate key')) {
      throw new Error(`Failed to create default accounts: ${insAccErr.message}`)
    }
  }

  // Refetch all target accounts
  const targetCodes = defaultAccounts.map(a => a.code)
  let { data: allAccounts, error: refetchAccErr } = await supabase
    .from('accounts')
    .select('id, code')
    .eq('business_id', businessId)
    .in('code', targetCodes)

  // Resilient read fallback with admin client
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

  const accountMap: Record<string, string> = {}
  allAccounts.forEach(a => {
    accountMap[a.code] = a.id
  })

  // Ensure all required accounts are resolved
  for (const code of targetCodes) {
    if (!accountMap[code]) {
      throw new Error(`Account mapping failed for code ${code}`)
    }
  }

  accountCache[businessId] = accountMap
  return accountMap
}
