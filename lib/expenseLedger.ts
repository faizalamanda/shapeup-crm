import { SupabaseClient } from '@supabase/supabase-js'

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

  if (accountsToCreate.length > 0) {
    const { error: insAccErr } = await supabase.from('accounts').insert(accountsToCreate)
    if (insAccErr && !insAccErr.message.includes('duplicate key')) {
      throw new Error(`Failed to create default accounts: ${insAccErr.message}`)
    }
  }

  // Refetch accounts to build the mapping
  const targetCodes = [
    '201000', '502000', '503000', '102000',
    '503100', '503200', '503300', '503400',
    '503500', '503600', '503700', '503800',
    '503900', '504000', '120000'
  ]
  const { data: allAccounts, error: refetchAccErr } = await supabase
    .from('accounts')
    .select('id, code')
    .eq('business_id', businessId)
    .in('code', targetCodes)

  if (refetchAccErr || !allAccounts) {
    throw new Error(`Failed to refetch ledger accounts: ${refetchAccErr?.message || 'unknown'}`)
  }

  accountMap = {}
  allAccounts.forEach(a => {
    accountMap[a.code] = a.id
  })

  expenseAccountCache[businessId] = accountMap
  return accountMap
}
