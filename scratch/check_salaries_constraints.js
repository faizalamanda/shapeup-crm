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
  
  if (data && data.tables && data.tables.length > 0) {
    console.log("Keys of first table:", Object.keys(data.tables[0]))
    console.log("First table sample:", JSON.stringify(data.tables[0], null, 2))
    
    const salaryTable = data.tables.find(t => t.name === 'employee_salaries' || t.table_name === 'employee_salaries')
    if (salaryTable) {
      console.log("Salary table metadata:", JSON.stringify(salaryTable, null, 2))
    }
  } else {
    console.log("No data.tables or empty")
  }
}

run()
