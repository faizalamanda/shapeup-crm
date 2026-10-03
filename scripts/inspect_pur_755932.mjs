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

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)

async function inspectPur() {
  const { data: pur, error: pErr } = await supabase
    .from('purchases')
    .select('*')
    .ilike('purchase_number', '%PUR-755932%')
    .maybeSingle()

  if (pErr || !pur) {
    console.error('Purchase not found or error:', pErr)
    return
  }

  console.log('--- PURCHASE RECORD ---')
  console.log('ID:', pur.id)
  console.log('Purchase Number:', pur.purchase_number)
  console.log('Business ID:', pur.business_id)
  console.log('Payment Status:', pur.payment_status)
  console.log('Items JSON:', JSON.stringify(pur.items_json, null, 2))

  const { data: moves } = await supabase
    .from('stock_moves')
    .select('*')
    .or(`reference.eq.${pur.purchase_number},source_id.eq.${pur.id}`)

  console.log('\n--- STOCK MOVES FOUND FOR THIS PURCHASE ---')
  console.log('Count:', moves?.length || 0)
  console.log(moves)
}

inspectPur().catch(console.error)
