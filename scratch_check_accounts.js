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

async function run() {
  const { data: accounts, error } = await supabase
    .from('accounts')
    .select('*')
    .limit(100)

  if (error) {
    console.error('Error fetching accounts:', error)
    return
  }

  console.log('Total accounts found:', accounts.length)
  console.log('Sample accounts:')
  accounts.slice(0, 30).forEach(a => {
    console.log(`Business ID: ${a.business_id} | Code: ${a.code} | Name: ${a.name} | Type: ${a.type}`)
  })
}

run()
