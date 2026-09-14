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

async function checkQueueToday() {
  const url = env.NEXT_PUBLIC_SUPABASE_URL + '/rest/v1/marketing_queue?select=id,scenario_id,status,scheduled_at,created_at&created_at=gte.2026-09-14T00:00:00Z&order=created_at.desc'
  const headers = {
    'apikey': env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    'Authorization': 'Bearer ' + env.SUPABASE_SERVICE_ROLE_KEY
  }
  
  try {
    const response = await fetch(url, { headers })
    const data = await response.json()
    console.log("Queue items created TODAY:", data.length)
    if (data.length > 0) {
      console.log("Sample:", data[0])
    }
  } catch (err) {
    console.error("Error:", err)
  }
}
checkQueueToday()
