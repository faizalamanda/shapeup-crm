const { createClient } = require('@supabase/supabase-js')
const fs = require('fs')
const path = require('path')

const envPath = path.join(__dirname, '..', '.env.local')
const envContent = fs.readFileSync(envPath, 'utf8')
const env = {}
envContent.split('\n').forEach(line => {
  const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/)
  if (match) {
    const key = match[1]
    let value = match[2] || ''
    if (value.length > 0 && value.charAt(0) === '"' && value.charAt(value.length - 1) === '"') {
      value = value.replace(/^"|"/g, '')
    }
    env[key] = value
  }
})

const supabaseUrl = env.NEXT_PUBLIC_SUPABASE_URL
const supabaseServiceKey = env.SUPABASE_SERVICE_ROLE_KEY
const supabase = createClient(supabaseUrl, supabaseServiceKey)

const DEFAULT_COA_TEMPLATE = [
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

async function seedCOAForBusiness(businessId) {
  const { data: existing } = await supabase
    .from('accounts')
    .select('code')
    .eq('business_id', businessId)

  const existingCodes = new Set((existing || []).map(a => a.code))
  const accountsToCreate = DEFAULT_COA_TEMPLATE
    .filter(a => !existingCodes.has(a.code))
    .map(a => ({ ...a, business_id: businessId }))

  if (accountsToCreate.length > 0) {
    const { error } = await supabase.from('accounts').insert(accountsToCreate)
    if (error && !error.message.includes('duplicate key')) {
      console.error(`❌ Error seeding business ${businessId}:`, error.message)
      return 0
    }
  }

  return accountsToCreate.length
}

async function run() {
  console.log('🔄 Fetching all businesses...')
  const { data: businesses, error } = await supabase.from('businesses').select('id, name')
  if (error || !businesses) {
    console.error('❌ Failed to fetch businesses:', error?.message)
    return
  }

  console.log(`📦 Found ${businesses.length} businesses. Seeding COA...`)
  for (const b of businesses) {
    const inserted = await seedCOAForBusiness(b.id)
    const { data: totalAccs } = await supabase.from('accounts').select('id', { count: 'exact' }).eq('business_id', b.id)
    console.log(`✅ Business: "${b.name}" (${b.id}) -> +${inserted} new accounts (Total: ${totalAccs ? totalAccs.length : 0})`)
  }

  console.log('\n🎉 Finished seeding COA for all existing businesses!')
}

run()
