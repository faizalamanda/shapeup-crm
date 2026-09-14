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

async function checkOrders() {
  const url = env.NEXT_PUBLIC_SUPABASE_URL + '/rest/v1/orders?select=id,status,order_date_utc&status=eq.completed'
  const headers = {
    'apikey': env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    'Authorization': 'Bearer ' + env.SUPABASE_SERVICE_ROLE_KEY
  }
  
  try {
    const response = await fetch(url, { headers })
    const data = await response.json()
    
    // Count by date
    const counts = {}
    data.forEach(o => {
      if(o.order_date_utc) {
        const date = o.order_date_utc.split('T')[0]
        counts[date] = (counts[date] || 0) + 1
      }
    })
    console.log("Order counts by date (Aug 11-14):")
    console.log("2026-08-11:", counts['2026-08-11'] || 0)
    console.log("2026-08-12:", counts['2026-08-12'] || 0)
    console.log("2026-08-13:", counts['2026-08-13'] || 0)
    console.log("2026-08-14:", counts['2026-08-14'] || 0)
  } catch (err) {
    console.error("Error:", err)
  }
}
checkOrders()
