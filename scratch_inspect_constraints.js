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

async function getConstraints() {
  // Let's run a query to check constraints on table accounts
  const { data, error } = await supabase.rpc('inspect_table_constraints', { table_name: 'accounts' })
  if (error) {
    console.log("RPC inspect_table_constraints not found, trying query via postgres functions...")
    
    // We can also query pg_constraint using a generic query if we can, 
    // or try creating an account with type LIABILITY to see if it works!
    console.log("Trying to insert a temp account with type LIABILITY...")
    const { data: insData, error: insError } = await supabase.from('accounts').insert({
      code: '999999',
      name: 'Temp Account',
      type: 'LIABILITY',
      business_id: '097211f4-2d19-4196-a7b7-5b2cd17c2588' // Alamanda business
    }).select()
    
    if (insError) {
      console.log("Insert failed:", insError.message)
    } else {
      console.log("Insert succeeded!", insData)
      // Clean up
      await supabase.from('accounts').delete().eq('code', '999999')
    }
  } else {
    console.log("Constraints:", data)
  }
}

getConstraints()
