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

async function checkAllOpnamesForKardigan() {
  const { data: opnames } = await supabase
    .from('stock_opname')
    .select('*')
    .order('created_at', { ascending: false })

  console.log(`Total stock_opname documents in DB: ${opnames?.length || 0}`)

  for (const op of opnames || []) {
    const items = Array.isArray(op.items_json) ? op.items_json : []
    const kardiganItem = items.find(i => (i.name || '').includes('Kardigan Rajut Oversize - Denim') || String(i.product_id) === '2399caa1-72be-408c-a77c-9f6fa98f352b')
    if (kardiganItem) {
      console.log(`Opname ${op.opname_number} (${op.date || op.created_at}):`, kardiganItem)
    }
  }
}

checkAllOpnamesForKardigan().catch(console.error)
