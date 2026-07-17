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

const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)
const businessId = '097211f4-2d19-4196-a7b7-5b2cd17c2588' // Alamanda

async function run() {
  console.log('Testing Accrual Basis...')
  const { data: accrualData, error: accrualErr } = await supabase.rpc('get_ledger_balances', {
    p_business_id: businessId,
    p_basis: 'accrual'
  })

  if (accrualErr) {
    console.error('❌ Accrual Basis call failed:', accrualErr.message)
  } else {
    console.log('✅ Accrual Basis call succeeded! Rows returned:', accrualData.length)
  }

  console.log('\nTesting Cash Basis...')
  const { data: cashData, error: cashErr } = await supabase.rpc('get_ledger_balances', {
    p_business_id: businessId,
    p_basis: 'cash'
  })

  if (cashErr) {
    console.error('❌ Cash Basis call failed:', cashErr.message)
  } else {
    console.log('✅ Cash Basis call succeeded! Rows returned:', cashData.length)
  }
}

run()
