const { createClient } = require('@supabase/supabase-js')
const fs = require('fs')
const path = require('path')

const envLocalPath = path.join('/home/faiz-jazuli/shapeup-crm', '.env.local')
const envContent = fs.readFileSync(envLocalPath, 'utf8')
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

const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)

async function testSqlRpc() {
  console.log("Testing executing migration script via Supabase rpc/rest...")
  const sql = fs.readFileSync(path.join('/home/faiz-jazuli/shapeup-crm/supabase/migrations/20260812000000_add_variable_hpp_and_recipes.sql'), 'utf8')
  
  // Try calling exec_sql or rpc if present
  const { data, error } = await supabase.rpc('exec_sql', { sql_query: sql })
  console.log("RPC exec_sql result:", data, error?.message)
}

testSqlRpc()
