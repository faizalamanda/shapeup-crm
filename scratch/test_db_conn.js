const { Client } = require('pg')
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

// Extract project ref from SUPABASE_URL: https://jfflztwirjonhumcykay.supabase.co
const projectRef = env.NEXT_PUBLIC_SUPABASE_URL.replace('https://', '').split('.')[0]
console.log('Project Ref:', projectRef)

// Try connecting via pg using pooler / direct connection if password or connection string is known, OR check supabase client
const { createClient } = require('@supabase/supabase-js')
const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)

async function test() {
  const { data, error } = await supabase.from('products').select('*').limit(1)
  console.log('Product check:', data, error)
}
test()
