const { createClient } = require('@supabase/supabase-js')
const fs = require('fs')
const path = require('path')
const https = require('https')

const envPath = path.join('/home/faiz-jazuli/shapeup-crm', '.env.local')
const envContent = fs.readFileSync(envPath, 'utf8')
const env = {}
envContent.split('\n').forEach(line => {
  const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?$/)
  if (match) {
    let value = match[2] || ''
    if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1)
    env[match[1]] = value
  }
})

const SUPABASE_URL = env.NEXT_PUBLIC_SUPABASE_URL
const SERVICE_KEY = env.SUPABASE_SERVICE_ROLE_KEY

const sql = fs.readFileSync('supabase/migrations/20260918000000_create_loyalty_program.sql', 'utf8')

// Use Supabase Management API / direct postgres via REST
async function execSql(sql) {
  const url = new URL('/rest/v1/rpc/exec_sql', SUPABASE_URL)
  
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ query: sql })
    const options = {
      hostname: url.hostname,
      path: url.pathname + url.search,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
        'apikey': SERVICE_KEY,
        'Authorization': `Bearer ${SERVICE_KEY}`,
        'Prefer': 'params=single-object'
      }
    }
    
    const req = https.request(options, (res) => {
      let data = ''
      res.on('data', chunk => data += chunk)
      res.on('end', () => {
        try { resolve({ status: res.statusCode, data: JSON.parse(data) }) }
        catch { resolve({ status: res.statusCode, data }) }
      })
    })
    req.on('error', reject)
    req.write(body)
    req.end()
  })
}

async function run() {
  console.log('Applying loyalty migration to:', SUPABASE_URL)
  
  const result = await execSql(sql)
  console.log('Status:', result.status)
  console.log('Response:', JSON.stringify(result.data).substring(0, 200))
  
  // Also try checking tables via Supabase client
  const supabase = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } })
  
  console.log('\n=== Verifying tables ===')
  for (const table of ['loyalty_settings', 'customer_points', 'loyalty_point_ledger']) {
    const { data, error } = await supabase.from(table).select('id').limit(1)
    if (error && error.message?.includes('does not exist')) {
      console.log(`❌ ${table}: NOT found`)
    } else if (error) {
      console.log(`⚠️  ${table}: ${error.code} - ${error.message?.substring(0, 60)}`)
    } else {
      console.log(`✅ ${table}: EXISTS`)
    }
  }
}

run().catch(console.error)
