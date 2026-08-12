const { createClient } = require('@supabase/supabase-js')
const fs = require('fs')
const path = require('path')

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

const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)

async function runMigration() {
  const migrationPath = path.join('/home/faiz-jazuli/shapeup-crm/supabase/migrations/20260812010000_create_waba_inbox_tables.sql')
  const sql = fs.readFileSync(migrationPath, 'utf8')
  
  console.log("Applying WABA Inbox migration...")
  const { data, error } = await supabase.rpc('exec_sql', { sql_query: sql })
  if (error) {
    console.log("RPC exec_sql error, trying alternative query exec:", error.message)
    const { data: d2, error: e2 } = await supabase.rpc('exec_sql', { sql: sql })
    console.log("RPC exec_sql result:", d2, e2)
  } else {
    console.log("Migration executed successfully via exec_sql:", data)
  }
}

runMigration()
