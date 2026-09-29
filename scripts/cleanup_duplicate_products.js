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

async function cleanupDuplicateProducts() {
  const headers = {
    'apikey': env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    'Authorization': 'Bearer ' + env.SUPABASE_SERVICE_ROLE_KEY,
    'Content-Type': 'application/json',
    'Prefer': 'return=minimal'
  }

  console.log('🚀 Memulai Pembersihan Produk Ganda (Duplicates) di Database...\n')

  const res = await fetch(env.NEXT_PUBLIC_SUPABASE_URL + '/rest/v1/products?select=id,business_id,name,sku,stock_quantity,cost_price,price,created_at&limit=2000', { headers })
  const prods = await res.json()

  const groups = new Map()

  prods.forEach(p => {
    const key = `${p.business_id}_${p.name.trim().toLowerCase()}`
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(p)
  })

  const duplicateGroups = Array.from(groups.entries()).filter(([k, list]) => list.length > 1)

  console.log(`Ditemukan ${duplicateGroups.length} grup produk ganda.\n`)

  for (const [key, list] of duplicateGroups) {
    // Sort so product with stock > 0 or latest price comes first as primary
    list.sort((a, b) => {
      if (b.stock_quantity !== a.stock_quantity) return b.stock_quantity - a.stock_quantity
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    })

    const primary = list[0]
    const duplicates = list.slice(1)

    let combinedStock = Number(primary.stock_quantity || 0)
    duplicates.forEach(d => {
      combinedStock += Number(d.stock_quantity || 0)
    })

    console.log(`Penggabungan untuk "${primary.name}":`)
    console.log(`  - Primary ID: ${primary.id} (Stok Baru: ${combinedStock})`)

    // 1. Update primary product stock
    await fetch(env.NEXT_PUBLIC_SUPABASE_URL + `/rest/v1/products?id=eq.${primary.id}`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ stock_quantity: combinedStock })
    })

    // 2. Re-point stock_moves and delete duplicates
    for (const dup of duplicates) {
      console.log(`  - Merelokasi stock_moves & menghapus Duplicate ID: ${dup.id}`)
      
      // Update stock_moves to primary ID
      await fetch(env.NEXT_PUBLIC_SUPABASE_URL + `/rest/v1/stock_moves?product_id=eq.${dup.id}`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify({ product_id: primary.id })
      })

      // Delete duplicate product
      await fetch(env.NEXT_PUBLIC_SUPABASE_URL + `/rest/v1/products?id=eq.${dup.id}`, {
        method: 'DELETE',
        headers
      })
    }
  }

  console.log('\n🎉 Selesai! Semua produk ganda telah berhasil digabungkan dan dibersihkan dari database.')
}

cleanupDuplicateProducts()
