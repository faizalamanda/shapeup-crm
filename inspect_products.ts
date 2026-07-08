import { createClient } from '@supabase/supabase-js'
import * as fs from 'fs'
import * as path from 'path'

// Read env file manually
const envPath = path.join('/home/faiz-jazuli/shapeup-crm', '.env.local')
const envContent = fs.readFileSync(envPath, 'utf8')
const env: Record<string, string> = {}
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

const businessId = '097211f4-2d19-4196-a7b7-5b2cd17c2588' // Alamanda

async function checkForeignKeys() {
  const { data: fks, error } = await supabase.rpc('get_foreign_keys_referencing_products')
  if (error) {
    console.error('Error fetching FKs:', error)
    
    // Fallback: let's query information_schema via custom sql or check tables
    const { data: tables, error: sqlErr } = await supabase.from('products').select('*').limit(1)
    console.log('Sample product:', tables)
  } else {
    console.log('Foreign keys referencing products:', fks)
  }
}

checkForeignKeys()
