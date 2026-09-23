import { createClient } from '@supabase/supabase-js'
import * as fs from 'fs'
import * as path from 'path'

const envPath = path.join(__dirname, '..', '.env.local')
const envContent = fs.readFileSync(envPath, 'utf8')
const env: Record<string, string> = {}
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

async function testShiftJournal() {
  console.log('🧪 Testing Open Shift Custom Source Account & Journal Entry...\n')

  const { data: biz } = await supabase.from('businesses').select('id').limit(1).single()
  if (!biz) return

  const { getOrCreateDefaultAccounts } = require('../lib/accountHelper')
  const { postJournalTransaction } = require('../lib/journalHelper')

  const accountMap = await getOrCreateDefaultAccounts(biz.id, supabase)
  const kasPosId = accountMap['101000']
  const modalPemilikId = accountMap['301000']

  console.log('Accounts resolved:', { KasPOS: kasPosId, ModalPemilik: modalPemilikId })

  const shiftId = 'test-shift-' + Date.now()
  const initialCash = 150000

  const res = await postJournalTransaction(
    biz.id,
    shiftId,
    new Date().toISOString(),
    'Modal Awal Kasir Shift - QA Test (Kredit: 301000 Modal Pemilik)',
    [
      { account_id: kasPosId, debit: initialCash, credit: 0 },
      { account_id: modalPemilikId, debit: 0, credit: initialCash }
    ],
    supabase
  )

  console.log('Journal Entry Post Result:', res)

  // Verify
  const { data: tx } = await supabase
    .from('transactions')
    .select('id, description, journal_lines(debit, credit, account_id)')
    .eq('order_id', shiftId)
    .single()

  console.log('✅ Posted Transaction:', tx)

  // Clean up
  await supabase.from('transactions').delete().eq('order_id', shiftId)
  console.log('✨ Cleaned up test shift transaction.')
}

testShiftJournal()
