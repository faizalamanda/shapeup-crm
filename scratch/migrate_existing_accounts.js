/**
 * MIGRATION SCRIPT: migrate_existing_accounts.js
 * Run this script to automatically update the sub_type field of all existing accounts in Supabase
 * based on their codes and names.
 * 
 * Run: node scratch/migrate_existing_accounts.js
 */

const fs = require('fs')
const path = require('path')
const { createClient } = require('@supabase/supabase-js')

// Read env file manually
const envPath = path.join(__dirname, '..', '.env.local')
if (!fs.existsSync(envPath)) {
  console.error('❌ .env.local file not found at:', envPath)
  process.exit(1)
}

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

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('❌ SUPABASE URL or SERVICE ROLE KEY not found in .env.local')
  process.exit(1)
}

const supabase = createClient(supabaseUrl, supabaseServiceKey)

async function run() {
  console.log('🔄 Fetching all accounts from database...')
  const { data: accounts, error: fetchError } = await supabase
    .from('accounts')
    .select('*')

  if (fetchError) {
    console.error('❌ Failed to fetch accounts:', fetchError.message)
    if (fetchError.message.includes('sub_type')) {
      console.log('💡 TIP: Make sure you have run the ALTER TABLE SQL command first to add the sub_type column!')
    }
    process.exit(1)
  }

  console.log(`📦 Found ${accounts.length} accounts. Migrating...`)
  let updatedCount = 0

  for (const acc of accounts) {
    let subType = acc.sub_type

    // If sub_type is already populated, we skip to preserve custom updates
    if (subType) {
      console.log(`⏭️  Skipping "${acc.code} - ${acc.name}" (already has sub_type: ${subType})`)
      continue
    }

    // Determine subType based on type, code, and name
    if (acc.type === 'ASSET') {
      if (acc.code.startsWith('101') || acc.code.startsWith('1100') || acc.name.toLowerCase().includes('kas') || acc.name.toLowerCase().includes('bank') || acc.name.toLowerCase().includes('qris')) {
        subType = 'bank_cash'
      } else if (acc.code.startsWith('103') || acc.name.toLowerCase().includes('piutang')) {
        subType = 'receivable'
      } else if (acc.code.startsWith('102') || acc.name.toLowerCase().includes('persediaan')) {
        subType = 'current_assets'
      } else if (acc.code.startsWith('12') || acc.code.startsWith('13')) {
        subType = 'fixed_assets'
      } else {
        subType = 'current_assets'
      }
    } else if (acc.type === 'LIABILITY') {
      if (acc.code.startsWith('201') || acc.name.toLowerCase().includes('hutang') || acc.name.toLowerCase().includes('utang')) {
        subType = 'payable'
      } else {
        subType = 'current_liabilities'
      }
    } else if (acc.type === 'EQUITY') {
      subType = 'equity'
    } else if (acc.type === 'REVENUE') {
      if (acc.code.startsWith('401') || acc.code.startsWith('402') || acc.code.startsWith('403')) {
        subType = 'income'
      } else {
        subType = 'other_income'
      }
    } else if (acc.type === 'EXPENSE') {
      if (acc.code.startsWith('501') || acc.name.toLowerCase().includes('harga pokok') || acc.name.toLowerCase().includes('hpp')) {
        subType = 'cogs'
      } else {
        subType = 'expense'
      }
    }

    if (subType) {
      const { error: updateError } = await supabase
        .from('accounts')
        .update({ sub_type: subType })
        .eq('id', acc.id)

      if (updateError) {
        console.error(`❌ Failed to update account "${acc.code} - ${acc.name}":`, updateError.message)
      } else {
        console.log(`✅ Updated "${acc.code} - ${acc.name}" with sub_type: ${subType}`)
        updatedCount++
      }
    }
  }

  console.log(`\n🎉 Migration finished! Successfully updated ${updatedCount} accounts.`)
}

run()
