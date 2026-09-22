import { SupabaseClient } from '@supabase/supabase-js'

const accountCache: Record<string, Record<string, string>> = {}

export async function getOrCreateDefaultAccounts(
  businessId: string,
  supabase: SupabaseClient
): Promise<Record<string, string>> {
  if (accountCache[businessId]) {
    return accountCache[businessId]
  }

  const defaultAccounts = [
    { code: '101000', name: 'Kas POS (Tunai)', type: 'ASSET', business_id: businessId },
    { code: '101200', name: 'Bank / QRIS POS', type: 'ASSET', business_id: businessId },
    { code: '103000', name: 'Piutang Usaha', type: 'ASSET', business_id: businessId },
    { code: '401000', name: 'Pendapatan Penjualan POS', type: 'REVENUE', business_id: businessId },
    { code: '401100', name: 'Potongan Penjualan / Diskon', type: 'REVENUE', business_id: businessId },
    { code: '402000', name: 'Pendapatan Ongkir', type: 'REVENUE', business_id: businessId },
    { code: '403000', name: 'Pendapatan Lain-lain / Admin', type: 'REVENUE', business_id: businessId },
    { code: '501000', name: 'Harga Pokok Penjualan (HPP)', type: 'EXPENSE', business_id: businessId },
    { code: '102000', name: 'Persediaan Barang', type: 'ASSET', business_id: businessId }
  ]

  // Fetch existing accounts for this business to respect multi-tenant unique constraint on (business_id, code)
  const { data: existingAccounts } = await supabase
    .from('accounts')
    .select('id, code')
    .eq('business_id', businessId)

  const existingCodes = existingAccounts ? existingAccounts.map(a => a.code) : []
  const accountsToCreate = defaultAccounts.filter(a => !existingCodes.includes(a.code))

  if (accountsToCreate.length > 0) {
    const { error: insAccErr } = await supabase.from('accounts').insert(accountsToCreate)
    if (insAccErr && !insAccErr.message.includes('duplicate key')) {
      throw new Error(`Failed to create default accounts: ${insAccErr.message}`)
    }
  }

  // Refetch all target accounts
  const targetCodes = defaultAccounts.map(a => a.code)
  const { data: allAccounts, error: refetchAccErr } = await supabase
    .from('accounts')
    .select('id, code')
    .eq('business_id', businessId)
    .in('code', targetCodes)

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
