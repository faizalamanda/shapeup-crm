const { createClient } = require('@supabase/supabase-js')
const fs = require('fs')
const path = require('path')

// Read env file manually
const envPath = path.join('/home/faiz-jazuli/shapeup-crm', '.env.local')
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

async function inspectSchema() {
  // Query all tables in public schema
  const { data: tables, error: tableErr } = await supabase.rpc('inspect_tables_rpc')
  
  if (tableErr) {
    console.log("RPC inspect_tables_rpc not found. Trying query via postgres...")
    // Let's try executing standard sql queries via Supabase REST API if there's any SQL endpoint, 
    // or select table schema by querying some known tables.
    // Let's query information_schema.tables using a quick RPC if available.
    // If not, we can inspect by trying to fetch from different common table names.
  }
  
  // Let's write a query using pg/sql via a custom function if it exists, or just query known tables.
  const knownTables = [
    'accounts', 'transactions', 'journal_lines', 'products', 'categories', 
    'businesses', 'profiles', 'business_staff', 'customers', 'orders', 
    'expenses', 'purchases', 'stock_opname', 'stock_adjustments', 'suppliers'
  ]
  
  console.log('--- Inspecting Known Tables ---')
  for (const table of knownTables) {
    const { data, error } = await supabase.from(table).select('*').limit(1)
    if (error) {
      console.log(`Table '${table}': does NOT exist or error: ${error.message}`)
    } else {
      console.log(`Table '${table}': EXISTS. Sample data keys:`, data[0] ? Object.keys(data[0]) : '(empty table)')
    }
  }
}

inspectSchema()
