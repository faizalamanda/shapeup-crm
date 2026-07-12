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

async function fetchRaw() {
  const url = env.NEXT_PUBLIC_SUPABASE_URL + '/rest/v1/'
  const headers = {
    'apikey': env.SUPABASE_SERVICE_ROLE_KEY,
    'Authorization': 'Bearer ' + env.SUPABASE_SERVICE_ROLE_KEY
  }
  
  try {
    const response = await fetch(url, { headers })
    console.log("Status:", response.status)
    const text = await response.text()
    console.log("Text length:", text.length)
    if (response.status === 200 && text.length > 0) {
      const data = JSON.parse(text)
      if (data.paths) {
        const rpcs = Object.keys(data.paths).filter(p => p.startsWith('/rpc/'))
        console.log("Available RPCs:", rpcs)
      }
    } else {
      console.log("Error body:", text)
    }
  } catch (err) {
    console.error("Error fetching raw:", err)
  }
}

fetchRaw()
