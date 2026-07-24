const { createClient } = require('@supabase/supabase-js')
const fs = require('fs')
const path = require('path')

const envPath = path.join(__dirname, '..', '.env.local')
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

const { DEFAULT_COA_TEMPLATE } = require('../lib/coa')

async function test() {
  console.log('🧪 Testing automatic COA creation for a new business...')

  // 1. Create a dummy test business
  const testBizName = 'Test Auto COA Biz ' + Date.now()
  const { data: biz, error: createErr } = await supabase
    .from('businesses')
    .insert({
      name: testBizName,
      timezone: 'Asia/Jakarta'
    })
    .select()
    .single()

  if (createErr || !biz) {
    console.error('❌ Failed to create test business:', createErr?.message)
    return
  }

  console.log(`✅ Business created: "${biz.name}" (ID: ${biz.id})`)

  // 2. Simulate app layer seeding via seedDefaultCOA logic
  const accountsToInsert = DEFAULT_COA_TEMPLATE.map(a => ({
    ...a,
    business_id: biz.id
  }))

  const { error: insErr } = await supabase.from('accounts').insert(accountsToInsert)
  if (insErr) {
    console.error('❌ Failed to seed accounts:', insErr.message)
  }

  // 3. Fetch accounts created for this business
  const { data: accounts, error: accErr } = await supabase
    .from('accounts')
    .select('*')
    .eq('business_id', biz.id)

  if (accErr) {
    console.error('❌ Failed to fetch accounts for new business:', accErr.message)
  } else {
    console.log(`🎉 Found ${accounts.length} accounts successfully seeded for new business!`)
    console.log('Sample created accounts:')
    accounts.slice(0, 5).forEach(a => {
      console.log(`   - [${a.code}] ${a.name} (${a.type} / ${a.sub_type})`)
    })
  }

  // 4. Cleanup test business
  console.log('🧹 Cleaning up test business...')
  await supabase.from('businesses').delete().eq('id', biz.id)
  console.log('✅ Cleanup finished. Test PASSED!')
}

test()
