const { createClient } = require('@supabase/supabase-js')
const { randomUUID } = require('crypto')

const SUPABASE_URL = 'https://jfflztwirjonhumcykay.supabase.co'
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImpmZmx6dHdpcmpvbmh1bWN5a2F5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzMxMTc4NjcsImV4cCI6MjA4ODY5Mzg2N30.mbac9-NZXAv3yA2jPkHuis-2obs6Aoonro5jhGlx_k0'

async function runTest() {
  console.log('1. Menghubungkan ke Supabase...')
  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)

  console.log('2. Melakukan autentikasi user alamandatoko@gmail.com...')
  const { data: authData, error: authErr } = await supabase.auth.signInWithPassword({
    email: 'alamandatoko@gmail.com',
    password: 'Alamandaoke'
  })

  if (authErr) {
    console.error('Gagal autentikasi:', authErr.message)
    process.exit(1)
  }
  console.log('Autentikasi Sukses! User ID:', authData.user.id)

  console.log('3. Mengambil profil aktif bisnis...')
  const { data: profile, error: profErr } = await supabase
    .from('profiles')
    .select('active_business_id')
    .eq('id', authData.user.id)
    .single()

  if (profErr) {
    console.error('Gagal mengambil profil:', profErr.message)
    process.exit(1)
  }
  const businessId = profile.active_business_id
  console.log('Active Business ID:', businessId)

  console.log('4. Mengambil akun keuangan untuk Toko Alamanda...')
  const { data: accounts, error: accErr } = await supabase
    .from('accounts')
    .select('id, code, name, type')
    .eq('business_id', businessId)

  if (accErr) {
    console.error('Gagal mengambil akun:', accErr.message)
    process.exit(1)
  }
  console.log(`Ditemukan ${accounts.length} akun keuangan.`)

  // Helpers to resolve accounts
  const categoryAccounts = accounts.filter(a => a.type === 'EXPENSE' || (a.type === 'ASSET' && !a.code.startsWith('101') && !a.code.startsWith('102')))
  const paymentAccounts = accounts.filter(a => a.type === 'ASSET' && a.code.startsWith('101'))
  const hutangAccount = accounts.find(a => a.code === '201000')

  if (!hutangAccount) {
    console.error('Error: Akun Hutang Usaha (201000) tidak ditemukan.')
    process.exit(1)
  }
  console.log('Akun Hutang Usaha ID:', hutangAccount.id)

  const resolveAccount = (name, list) => {
    const str = name.toLowerCase().trim()
    // By code
    const byCode = list.find(a => a.code === str)
    if (byCode) return byCode.id
    // By name exact
    const byNameExact = list.find(a => a.name.toLowerCase() === str)
    if (byNameExact) return byNameExact.id
    // By name fuzzy
    const byNameFuzzy = list.find(a => a.name.toLowerCase().includes(str) || str.includes(a.name.toLowerCase()))
    if (byNameFuzzy) return byNameFuzzy.id
    return null
  }

  // Raw Test CSV data representation
  const testRows = [
    {
      date: '2026-07-18',
      description: 'Beli Kertas ATK',
      vendor_name: 'Toko Buku ABC',
      amount: 150000,
      category_name: 'Beban Perlengkapan Kantor / ATK',
      payment_name: 'Kas POS (Tunai)',
      status: 'paid',
      amount_paid: 150000
    },
    {
      date: '2026-07-19',
      description: 'Biaya Iklan Facebook',
      vendor_name: 'Facebook Ads',
      amount: 250000,
      category_name: 'Beban Pemasaran & Promosi',
      payment_name: 'Bank / QRIS POS',
      status: 'paid',
      amount_paid: 250000
    },
    {
      date: '2026-07-20',
      description: 'Tagihan Listrik Juli',
      vendor_name: 'PLN',
      amount: 500000,
      category_name: 'Beban Utilitas (Listrik/Air/Internet)',
      payment_name: 'Bank / QRIS POS',
      status: 'unpaid',
      due_date: '2026-07-25',
      amount_paid: 0
    },
    {
      date: '2026-07-21',
      description: 'DP Renovasi Kantor',
      vendor_name: 'Tukang Sejahtera',
      amount: 1000000,
      category_name: 'Beban Pemeliharaan & Perbaikan',
      payment_name: 'Bank / QRIS POS',
      status: 'partial',
      due_date: '2026-07-30',
      amount_paid: 400000
    }
  ]

  console.log('5. Melakukan pemetaan dan validasi baris data...')
  const transactionsToInsert = []
  const journalLinesToInsert = []
  const expensesToInsert = []

  for (let i = 0; i < testRows.length; i++) {
    const row = testRows[i]
    
    // Resolve Category
    const catId = resolveAccount(row.category_name, categoryAccounts)
    if (!catId) {
      console.error(`Gagal resolve kategori untuk: ${row.category_name}`)
      process.exit(1)
    }

    // Resolve Payment Method
    const payId = resolveAccount(row.payment_name, paymentAccounts)
    if (!payId) {
      console.error(`Gagal resolve kas/bank untuk: ${row.payment_name}`)
      process.exit(1)
    }

    const txId = randomUUID()
    const outstanding = row.amount - row.amount_paid

    // Transaction
    transactionsToInsert.push({
      id: txId,
      business_id: businessId,
      date: row.date,
      description: `Pengeluaran: ${row.description}`
    })

    // Journal Lines: Debit Category
    journalLinesToInsert.push({
      transaction_id: txId,
      account_id: catId,
      debit: row.amount,
      credit: 0
    })

    // Journal Lines: Credit Payment (Cash/Bank)
    if (row.amount_paid > 0) {
      journalLinesToInsert.push({
        transaction_id: txId,
        account_id: payId,
        debit: 0,
        credit: row.amount_paid
      })
    }

    // Journal Lines: Credit Hutang Usaha
    if (outstanding > 0) {
      journalLinesToInsert.push({
        transaction_id: txId,
        account_id: hutangAccount.id,
        debit: 0,
        credit: outstanding
      })
    }

    // Expense
    expensesToInsert.push({
      business_id: businessId,
      transaction_id: txId,
      category_account_id: catId,
      payment_account_id: row.status !== 'unpaid' ? payId : hutangAccount.id,
      amount: row.amount,
      date: row.date,
      description: row.description,
      vendor_name: row.vendor_name,
      payment_status: row.status,
      due_date: row.status !== 'paid' ? row.due_date : null,
      amount_paid: row.amount_paid,
      outstanding_amount: outstanding
    })
  }

  console.log(`Hasil pemetaan: ${expensesToInsert.length} pengeluaran siap diimpor.`);

  console.log('6. Mengeksekusi penyisipan massal (Bulk Insert)...')
  
  // A. Insert Transactions
  console.log('Inserting transactions...')
  const { error: txErr } = await supabase.from('transactions').insert(transactionsToInsert)
  if (txErr) {
    console.error('Gagal insert transactions:', txErr.message)
    process.exit(1)
  }

  // B. Insert Journal Lines
  console.log('Inserting journal lines...')
  const { error: jlErr } = await supabase.from('journal_lines').insert(journalLinesToInsert)
  if (jlErr) {
    console.error('Gagal insert journal lines, melakukan rollback transactions...')
    const txIds = transactionsToInsert.map(t => t.id)
    await supabase.from('transactions').delete().in('id', txIds)
    process.exit(1)
  }

  // C. Insert Expenses
  console.log('Inserting expenses...')
  const { error: expErr } = await supabase.from('expenses').insert(expensesToInsert)
  if (expErr) {
    console.error('Gagal insert expenses, melakukan rollback transactions...')
    const txIds = transactionsToInsert.map(t => t.id)
    await supabase.from('transactions').delete().in('id', txIds)
    process.exit(1)
  }

  console.log('==================================================')
  console.log('🎉 PENGUJIAN INTEGRASI BULK IMPORT DATABASE SUKSES!')
  console.log(`Berhasil menyisipkan ${expensesToInsert.length} pengeluaran beserta jurnal terkait.`)
  console.log('==================================================')
}

runTest()
