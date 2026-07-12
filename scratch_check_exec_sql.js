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

async function listRPCs() {
  // We can select function names from pg_proc join pg_namespace
  // But wait, can we use supabase.from() to query pg_catalog or information_schema?
  // Let's try calling a query on information_schema.routines if permitted by RLS/PostgREST
  const { data, error } = await supabase
    .from('profiles') // just to see if we can do something else, or call RPCs
    .select('*')
    .limit(1)
    
  console.log("Checking if we can run query on pg_proc or pg_namespace...")
  
  // Let's try calling a common custom SQL execution function if it exists:
  const rpcsToTry = [
    { name: 'exec_sql', params: { sql: 'SELECT 1 as val;' } },
    { name: 'execute_sql', params: { sql: 'SELECT 1 as val;' } },
    { name: 'run_sql', params: { sql: 'SELECT 1 as val;' } },
    { name: 'exec', params: { sql: 'SELECT 1 as val;' } },
  ]
  
  for (const rpc of rpcsToTry) {
    const { data: rpcData, error: rpcError } = await supabase.rpc(rpc.name, rpc.params)
    if (rpcError) {
      console.log(`RPC '${rpc.name}': failed/does not exist:`, rpcError.message)
    } else {
      console.log(`RPC '${rpc.name}': EXISTS! Return data:`, rpcData)
    }
  }
}

listRPCs()
