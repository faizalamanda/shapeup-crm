/**
 * MIGRASI: metadata → address_data
 *
 * Script ini membaca semua customer yang masih memiliki data di kolom `metadata`
 * (format lama dari webhook WooCommerce) dan memindahkannya ke kolom `address_data`
 * sesuai struktur AddressData dari CustomerAddressForm.
 *
 * Format LAMA (metadata):
 *   { address: string, city: string, country: string }
 *
 * Format BARU (address_data):
 *   { country_preset, country, address_line1, address_line2, subdistrict, city, state, postcode }
 *
 * Jalankan: node migrate_metadata_to_address_data.js
 */

const fs   = require('fs')
const path = require('path')
const { createClient } = require('@supabase/supabase-js')

// Baca .env.local secara manual tanpa dotenv
const envLines = fs.readFileSync(path.join(__dirname, '.env.local'), 'utf8').split('\n')
const env = {}
for (const line of envLines) {
  const t = line.trim()
  if (!t || t.startsWith('#')) continue
  const eq = t.indexOf('=')
  if (eq === -1) continue
  env[t.slice(0, eq).trim()] = t.slice(eq + 1).trim()
}

const supabase = createClient(
  env.NEXT_PUBLIC_SUPABASE_URL,
  env.SUPABASE_SERVICE_ROLE_KEY
)

// Mapping country code/name → preset AddressData
function resolvePreset(country) {
  if (!country) return { preset: 'custom', name: '' }
  const c = country.toUpperCase()
  if (c === 'ID' || c === 'INDONESIA')  return { preset: 'indonesia', name: 'Indonesia' }
  if (c === 'MY' || c === 'MALAYSIA')   return { preset: 'malaysia',  name: 'Malaysia' }
  if (c === 'US' || c === 'UNITED STATES' || c === 'USA') return { preset: 'usa', name: 'United States' }
  // Negara lain — simpan apa adanya
  return { preset: 'custom', name: country }
}

const PAGE_SIZE = 1000

async function fetchAllCustomers() {
  let allCustomers = []
  let from = 0

  while (true) {
    const { data, error } = await supabase
      .from('customers')
      .select('id, name, phone, metadata, address_data')
      .not('metadata', 'is', null)
      .range(from, from + PAGE_SIZE - 1)

    if (error) {
      console.error('❌ Gagal mengambil data:', error.message)
      process.exit(1)
    }

    allCustomers = allCustomers.concat(data || [])
    console.log(`   📦 Halaman ${Math.floor(from / PAGE_SIZE) + 1}: ${data?.length || 0} baris diambil`)

    if (!data || data.length < PAGE_SIZE) break  // tidak ada halaman berikutnya
    from += PAGE_SIZE
  }

  return allCustomers
}

async function migrate() {
  console.log('🔍 Mengambil semua customer dengan metadata (paginasi)...')
  const customers = await fetchAllCustomers()

  // Filter: hanya yang metadata-nya punya field address/city/country
  const toMigrate = customers.filter(c => {
    const m = c.metadata
    return m && (m.address || m.city || m.country)
  })

  console.log(`📊 Total customer dengan metadata: ${customers.length}`)
  console.log(`🔄 Perlu dimigrasi: ${toMigrate.length}`)
  console.log(`⏭️  Sudah ada address_data: ${customers.filter(c => c.address_data).length}`)
  console.log('')

  if (toMigrate.length === 0) {
    console.log('✅ Tidak ada data yang perlu dimigrasi.')
    return
  }

  let successCount = 0
  let skipCount = 0
  let errorCount = 0

  for (const customer of toMigrate) {
    const m = customer.metadata || {}

    // Jika sudah ada address_data, skip (tidak menimpa data yang lebih lengkap)
    if (customer.address_data && Object.keys(customer.address_data).length > 0) {
      console.log(`⏭️  SKIP  [${customer.id}] ${customer.name} — address_data sudah ada`)
      skipCount++
      continue
    }

    const { preset, name: countryName } = resolvePreset(m.country || '')

    const newAddressData = {
      country_preset: preset,
      country:        countryName,
      address_line1:  m.address || '',
      address_line2:  '',
      subdistrict:    '',          // tidak ada di format lama
      city:           m.city || '',
      state:          '',          // tidak ada di format lama
      postcode:       '',          // tidak ada di format lama
    }

    const { error: updateErr } = await supabase
      .from('customers')
      .update({ address_data: newAddressData })
      .eq('id', customer.id)

    if (updateErr) {
      console.error(`❌ ERROR [${customer.id}] ${customer.name}: ${updateErr.message}`)
      errorCount++
    } else {
      console.log(`✅ OK    [${customer.id}] ${customer.name} → preset:${preset}, city:${m.city || '-'}, country:${m.country || '-'}`)
      successCount++
    }
  }

  console.log('')
  console.log('═══════════════════════════════')
  console.log(`✅ Berhasil  : ${successCount}`)
  console.log(`⏭️  Di-skip   : ${skipCount}`)
  console.log(`❌ Error     : ${errorCount}`)
  console.log('═══════════════════════════════')
  console.log('Migrasi selesai.')
}

migrate()
