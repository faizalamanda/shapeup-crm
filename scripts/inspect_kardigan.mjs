import { createClient } from '@supabase/supabase-js'
import fs from 'fs'
import path from 'path'

const envPath = path.resolve(process.cwd(), '.env.local')
if (fs.existsSync(envPath)) {
  const envConfig = fs.readFileSync(envPath, 'utf8')
  envConfig.split('\n').forEach(line => {
    const trimmed = line.trim()
    if (trimmed && !trimmed.startsWith('#') && trimmed.includes('=')) {
      const idx = trimmed.indexOf('=')
      const key = trimmed.slice(0, idx).trim()
      let val = trimmed.slice(idx + 1).trim()
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1)
      }
      if (!process.env[key]) {
        process.env[key] = val
      }
    }
  })
}

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

const supabase = createClient(supabaseUrl, supabaseServiceKey)

async function inspectKardigan() {
  const { data: prods } = await supabase
    .from('products')
    .select('id, name, stock_quantity, business_id')
    .ilike('name', '%Kardigan Rajut%')

  console.log('Found products:', prods)

  for (const p of prods || []) {
    const { data: moves, count } = await supabase
      .from('stock_moves')
      .select('id, reference, qty, type, status, created_at', { count: 'exact' })
      .eq('product_id', p.id)
      .order('created_at', { ascending: false })

    console.log(`Product: ${p.name} (ID: ${p.id})`)
    console.log(`Current DB Stock: ${p.stock_quantity}`)
    console.log(`Total stock moves count: ${count}`)
    console.log(`First 10 moves:`, moves?.slice(0, 10))
    
    // Count status breakdown
    const statusCounts = {}
    for (const m of moves || []) {
      statusCounts[m.status] = (statusCounts[m.status] || 0) + 1
    }
    console.log(`Status breakdown:`, statusCounts)
  }
}

inspectKardigan().catch(console.error)
