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
    console.error("Error:", error.message)
    return
  }
  
  if (data && data.tables) {
    console.log("Tables structure:")
    data.tables.forEach(t => {
      console.log(`- ${t.table_name || t.name || JSON.stringify(t)}`)
    })
  } else {
    console.log("No data.tables array found. Full data keys:", Object.keys(data))
  }
}

run()
