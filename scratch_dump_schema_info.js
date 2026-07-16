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

async function run() {
  const { data, error } = await supabase.rpc('get_complete_schema')
  if (error) {
    console.error("Error calling get_complete_schema:", error.message)
    return
  }
  
  const targetTables = ['accounts', 'transactions', 'journal_lines']
  if (data.tables) {
    data.tables.forEach(t => {
      if (targetTables.includes(t.name)) {
        console.log(`\nTable JSON for: ${t.name}`)
        console.log(JSON.stringify(t, null, 2))
      }
    })
  }
}

run()
