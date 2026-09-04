const { createClient } = require('@supabase/supabase-js')
const fs = require('fs')
const path = require('path')

// Read env file
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

// Helper getUtcTimestamp from app/accounting/utils.ts
function getUtcTimestamp(dateStr, timeStr, timeZone) {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false
  });
  
  const [year, month, day] = dateStr.split('-').map(Number);
  const [hours, minutes, seconds] = timeStr.split('.')[0].split(':').map(Number);
  const ms = Number(timeStr.split('.')[1] || 0);
  
  const utcDate = new Date(Date.UTC(year, month - 1, day, hours, minutes, seconds, ms));
  const parts = formatter.formatToParts(utcDate);
  const partValues = {};
  parts.forEach(p => {
    if (p.type !== 'literal') {
      partValues[p.type] = Number(p.value);
    }
  });
  
  const fMonth = partValues.month;
  const fDay = partValues.day;
  const fYear = partValues.year;
  const fHour = partValues.hour === 24 ? 0 : partValues.hour;
  const fMin = partValues.minute;
  const fSec = partValues.second;
  
  const formattedUtc = new Date(Date.UTC(fYear, fMonth - 1, fDay, fHour, fMin, fSec, ms));
  const diffMs = utcDate.getTime() - formattedUtc.getTime();
  const targetDate = new Date(utcDate.getTime() + diffMs);
  return targetDate.toISOString();
}

async function testLocalzone() {
  const timezone = 'Asia/Jakarta'
  const startDate = '2026-08-01'
  const endDate = '2026-08-31'

  const startOfDayISO = getUtcTimestamp(startDate, '00:00:00.000', timezone)
  const endOfDayISO = getUtcTimestamp(endDate, '23:59:59.999', timezone)

  console.log('Business Timezone:', timezone)
  console.log('Local Date Range:', startDate, 'to', endDate)
  console.log('Computed Start ISO (UTC):', startOfDayISO)
  console.log('Computed End ISO (UTC):', endOfDayISO)

  // Verify in UTC vs Local
  console.log('\n--- Accrual Basis Balances ---')
  const { data: accrualData, error: accrualErr } = await supabase.rpc('get_ledger_balances', {
    p_business_id: businessId,
    p_start_date: startOfDayISO,
    p_end_date: endOfDayISO,
    p_basis: 'accrual'
  })
  if (accrualErr) console.error('Accrual err:', accrualErr)

  console.log('\n--- Cash Basis Balances ---')
  const { data: cashData, error: cashErr } = await supabase.rpc('get_ledger_balances', {
    p_business_id: businessId,
    p_start_date: startOfDayISO,
    p_end_date: endOfDayISO,
    p_basis: 'cash'
  })
  if (cashErr) console.error('Cash err:', cashErr)

  // Compare sums for REVENUE and EXPENSE
  const { data: accounts } = await supabase.from('accounts').select('*').eq('business_id', businessId)
  const accMap = new Map(accounts.map(a => [a.id, a]))

  let accrualRev = 0, accrualExp = 0
  accrualData?.forEach(r => {
    const acc = accMap.get(r.account_id)
    if (!acc) return
    if (acc.type === 'REVENUE') accrualRev += (r.credit_sum - r.debit_sum)
    if (acc.type === 'EXPENSE') accrualExp += (r.debit_sum - r.credit_sum)
  })

  let cashRev = 0, cashExp = 0
  cashData?.forEach(r => {
    const acc = accMap.get(r.account_id)
    if (!acc) return
    if (acc.type === 'REVENUE') cashRev += (r.credit_sum - r.debit_sum)
    if (acc.type === 'EXPENSE') cashExp += (r.debit_sum - r.credit_sum)
  })

  console.log('\n--- Profit & Loss Summary Comparison (Aug 2026) ---')
  console.log('Accrual Revenue:', accrualRev, '| Accrual Expense:', accrualExp, '| Net:', accrualRev - accrualExp)
  console.log('Cash Revenue:   ', cashRev, '| Cash Expense:   ', cashExp, '| Net:', cashRev - cashExp)
}

testLocalzone()
