const { createClient } = require('@supabase/supabase-js')
const fs = require('fs')
const path = require('path')

const envPath = path.join(__dirname, 'scratch', 'check_env.js')
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

async function run() {
  console.log("Checking products table row sample...")
  const { data, error } = await supabase.from('products').select('*').limit(1)
  console.log("Data:", data)
  console.log("Error:", error)
  if (data && data[0]) {
    console.log("Keys in products table:", Object.keys(data[0]))
  }
}

run()
