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

const { createClient } = require('@supabase/supabase-js')
const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)

async function checkCron() {
  const url = env.NEXT_PUBLIC_SUPABASE_URL + '/rest/v1/cron?select=*'
  const headers = {
    'apikey': env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    'Authorization': 'Bearer ' + env.SUPABASE_SERVICE_ROLE_KEY
  }
  
  try {
    const response = await fetch(url, { headers })
    if (response.ok) {
        console.log("Cron jobs accessible!")
        console.log(await response.json())
    } else {
        console.log("Cron REST status:", response.status)
        // Let's try rpc to query cron.job if we made one
        const { data, error } = await supabase.rpc('get_cron_jobs')
        console.log("RPC get_cron_jobs:", data || error)
    }
  } catch (err) {
    console.error("Error:", err)
  }
}
checkCron()
