import { SupabaseClient } from '@supabase/supabase-js'

export const DEFAULT_COA_TEMPLATE = [
  // ASSET (100000 - 199999)
  { code: '101000', name: 'Kas POS (Tunai)', type: 'ASSET', sub_type: 'bank_cash' },
  { code: '101100', name: 'Rekening Bank Utama', type: 'ASSET', sub_type: 'bank_cash' },
  { code: '101200', name: 'Bank / QRIS POS', type: 'ASSET', sub_type: 'bank_cash' },
  { code: '101300', name: 'Kas Kecil / Petty Cash', type: 'ASSET', sub_type: 'bank_cash' },
  { code: '102000', name: 'Persediaan Barang Dagangan', type: 'ASSET', sub_type: 'current_assets' },
  { code: '103000', name: 'Piutang Usaha', type: 'ASSET', sub_type: 'receivable' },
  { code: '105000', name: 'Beban Dibayar di Muka', type: 'ASSET', sub_type: 'current_assets' },
  { code: '120000', name: 'Peralatan & Inventaris Kantor', type: 'ASSET', sub_type: 'fixed_assets' },
  { code: '129000', name: 'Akumulasi Penyusutan Aset Tetap', type: 'ASSET', sub_type: 'fixed_assets' },

  // LIABILITY (200000 - 299999)
  { code: '201000', name: 'Hutang Usaha', type: 'LIABILITY', sub_type: 'payable' },
  { code: '201100', name: 'Hutang Gaji & Upah', type: 'LIABILITY', sub_type: 'payable' },
  { code: '201200', name: 'Hutang Pajak (PPN/PPh)', type: 'LIABILITY', sub_type: 'current_liabilities' },
  { code: '202000', name: 'Pendapatan Diterima di Muka', type: 'LIABILITY', sub_type: 'current_liabilities' },

  // EQUITY (300000 - 399999)
  { code: '301000', name: 'Modal Pemilik', type: 'EQUITY', sub_type: 'equity' },
  { code: '302000', name: 'Prive / Penarikan Pemilik', type: 'EQUITY', sub_type: 'equity' },
  { code: '303000', name: 'Laba Ditahan', type: 'EQUITY', sub_type: 'equity' },

  // REVENUE (400000 - 499999)
  { code: '401000', name: 'Pendapatan Penjualan POS', type: 'REVENUE', sub_type: 'income' },
  { code: '401100', name: 'Potongan & Retur Penjualan', type: 'REVENUE', sub_type: 'income' },
  { code: '402000', name: 'Pendapatan Ongkir', type: 'REVENUE', sub_type: 'income' },
  { code: '403000', name: 'Pendapatan Lain-lain & Biaya Admin', type: 'REVENUE', sub_type: 'other_income' },

  // EXPENSE (500000 - 599999)
  { code: '501000', name: 'Harga Pokok Penjualan (HPP)', type: 'EXPENSE', sub_type: 'cogs' },
  { code: '502000', name: 'Penyesuaian Persediaan', type: 'EXPENSE', sub_type: 'expense' },
  { code: '503000', name: 'Beban Operasional', type: 'EXPENSE', sub_type: 'expense' },
  { code: '503100', name: 'Beban Pemasaran, Iklan & Promosi', type: 'EXPENSE', sub_type: 'expense' },
  { code: '503200', name: 'Beban Utilitas (Listrik/Air/Internet)', type: 'EXPENSE', sub_type: 'expense' },
  { code: '503300', name: 'Beban Gaji, Tunjangan & Upah', type: 'EXPENSE', sub_type: 'expense' },
  { code: '503400', name: 'Beban Perlengkapan & ATK', type: 'EXPENSE', sub_type: 'expense' },
  { code: '503500', name: 'Beban Transportasi & Perjalanan Dinas', type: 'EXPENSE', sub_type: 'expense' },
  { code: '503600', name: 'Beban Sewa Tempat & Bangunan', type: 'EXPENSE', sub_type: 'expense' },
  { code: '503700', name: 'Beban Pemeliharaan & Perbaikan', type: 'EXPENSE', sub_type: 'expense' },
  { code: '503800', name: 'Beban Pajak, Retribusi & Perizinan', type: 'EXPENSE', sub_type: 'expense' },
  { code: '503900', name: 'Beban Konsumsi & Entertainment', type: 'EXPENSE', sub_type: 'expense' },
  { code: '504000', name: 'Beban Bunga & Administrasi Bank', type: 'EXPENSE', sub_type: 'expense' },
  { code: '505000', name: 'Beban Penyusutan Aset Tetap', type: 'EXPENSE', sub_type: 'depreciation' }
]

/**
 * Seeds default Chart of Accounts (COA) for a business if they don't already exist.
 */
export async function seedDefaultCOA(businessId: string, supabase: SupabaseClient): Promise<void> {
  if (!businessId) return

  try {
    const { data: existingAccounts, error: fetchErr } = await supabase
      .from('accounts')
      .select('code')
      .eq('business_id', businessId)

    if (fetchErr) {
      console.error('Error checking existing accounts for COA seeding:', fetchErr.message)
      return
    }

    const existingCodes = new Set((existingAccounts || []).map(a => a.code))
    const accountsToInsert = DEFAULT_COA_TEMPLATE
      .filter(a => !existingCodes.has(a.code))
      .map(a => ({
        ...a,
        business_id: businessId
      }))

    if (accountsToInsert.length > 0) {
      const { error: insErr } = await supabase
        .from('accounts')
        .insert(accountsToInsert)

      if (insErr && !insErr.message.includes('duplicate key')) {
        console.error('Failed to seed default COA:', insErr.message)
      }
    }
  } catch (err: unknown) {
    console.error('Unexpected error in seedDefaultCOA:', err)
  }
}

export interface COAPaymentAccount {
  id: string
  code: string
  name: string
  type: string
  sub_type?: string | null
}

/**
 * Determines whether a COA account is an active Cash / Bank / Payment account.
 * Supports custom COA codes and names across different businesses.
 */
export function isCashBankAccount(acc: {
  code?: string | null
  name?: string | null
  type?: string | null
  sub_type?: string | null
}): boolean {
  if (acc.type && acc.type !== 'ASSET') return false
  const code = String(acc.code || '').trim()
  const name = String(acc.name || '').toLowerCase()
  const subType = String(acc.sub_type || '').toLowerCase()

  // Exclude Accounts Receivable (Piutang), Inventory (Persediaan), Prepayments, and Fixed Assets
  if (
    subType === 'receivable' ||
    subType === 'fixed_assets' ||
    subType === 'non_current_assets' ||
    subType === 'prepayments'
  ) {
    return false
  }
  if (
    code.startsWith('102') ||
    code.startsWith('103') ||
    code.startsWith('105') ||
    code.startsWith('12') ||
    code.startsWith('13') ||
    name.includes('piutang') ||
    name.includes('persediaan') ||
    name.includes('akumulasi') ||
    name.includes('peralatan') ||
    name.includes('inventaris') ||
    name.includes('dibayar di muka')
  ) {
    return false
  }

  if (subType === 'bank_cash') return true
  if (code.startsWith('101') || code.startsWith('1100') || code.startsWith('100')) return true
  if (
    /kas|bank|qris|tunai|rekening|giro|edc|wallet|e-wallet|gopay|ovo|dana|shopeepay|linkaja|bca|mandiri|bni|bri|bsi|cimb|permata/i.test(
      name
    )
  ) {
    return true
  }

  return false
}

/**
 * Resolves the best matching COA payment account from a business's active COA list
 * based on an explicit accountId or a payment_method string (supporting custom COA names & legacy strings).
 */
export function resolvePaymentAccountFromCOA(
  paymentAccounts: COAPaymentAccount[],
  methodStr?: string | null,
  accountId?: string | null
): COAPaymentAccount | null {
  if (!paymentAccounts || paymentAccounts.length === 0) return null

  if (accountId) {
    const byId = paymentAccounts.find(a => a.id === accountId)
    if (byId) return byId
  }

  const raw = String(methodStr || '').trim()
  if (raw) {
    const lower = raw.toLowerCase()

    // 1. Exact match by id, code, name, or "[code] name"
    const exact = paymentAccounts.find(
      a =>
        a.id === raw ||
        a.code.toLowerCase() === lower ||
        a.name.toLowerCase() === lower ||
        `[${a.code}] ${a.name}`.toLowerCase() === lower
    )
    if (exact) return exact

    // 2. Substring match against active COA account names (e.g. "BCA" <-> "Bank BCA")
    const partial = paymentAccounts.find(a => {
      const accName = a.name.toLowerCase()
      return (accName.length >= 3 && lower.includes(accName)) || (lower.length >= 3 && accName.includes(lower))
    })
    if (partial) return partial

    // 3. Semantic category match against the business's active COA accounts
    if (lower.includes('cash') || lower.includes('tunai') || lower.includes('kas') || lower.includes('cod')) {
      const cashAcc =
        paymentAccounts.find(a => /tunai|kas pos|kas laci|kas utama|kas toko|kas kecil|cash/i.test(a.name)) ||
        paymentAccounts.find(a => a.code === '101000') ||
        paymentAccounts.find(a => a.name.toLowerCase().includes('kas'))
      if (cashAcc) return cashAcc
    }

    if (lower.includes('qris')) {
      const qrisAcc =
        paymentAccounts.find(a => a.name.toLowerCase().includes('qris')) ||
        paymentAccounts.find(a => a.code === '101200')
      if (qrisAcc) return qrisAcc
    }

    if (lower.includes('bank') || lower.includes('transfer') || lower.includes('rekening')) {
      const bankAcc =
        paymentAccounts.find(a => /bank|rekening|bca|mandiri|bni|bri|bsi|cimb|permata|giro/i.test(a.name)) ||
        paymentAccounts.find(a => a.code === '101100' || a.code === '101200')
      if (bankAcc) return bankAcc
    }
  }

  // Default to the first active bank/cash account in the business's COA
  return (
    paymentAccounts.find(a => /bank|rekening|bca|mandiri|bni|bri/i.test(a.name)) ||
    paymentAccounts[0] ||
    null
  )
}
