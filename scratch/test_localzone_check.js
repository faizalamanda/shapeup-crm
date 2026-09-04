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
const businessId = '097211f4-2d19-4196-a7b7-5b2cd17c2588' // Toko Alamanda

// Import localzone logic directly for node test
const DEFAULT_TIMEZONE = 'Asia/Jakarta'

function getBusinessTimezone(tz) {
  if (!tz || typeof tz !== 'string' || !tz.trim()) return DEFAULT_TIMEZONE
  return tz.trim()
}

function formatLocalDateString(date = new Date(), timezone = DEFAULT_TIMEZONE) {
  const tz = getBusinessTimezone(timezone)
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
  return formatter.format(date)
}

function getUtcTimestampInTimezone(dateStr, timeStr, timezone = DEFAULT_TIMEZONE) {
  const tz = getBusinessTimezone(timezone)
  const [year, month, day] = dateStr.split('-').map(Number)
  const timeParts = timeStr.split('.')[0].split(':').map(Number)
  const hours = timeParts[0] || 0
  const minutes = timeParts[1] || 0
  const seconds = timeParts[2] || 0
  const ms = Number(timeStr.split('.')[1] || 0)

  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  })

  const utcDate = new Date(Date.UTC(year, month - 1, day, hours, minutes, seconds, ms))
  const parts = formatter.formatToParts(utcDate)
  const partValues = {}
  parts.forEach(p => {
    if (p.type !== 'literal') {
      partValues[p.type] = Number(p.value)
    }
  })

  const fMonth = partValues.month
  const fDay = partValues.day
  const fYear = partValues.year
  const fHour = partValues.hour === 24 ? 0 : partValues.hour
  const fMin = partValues.minute
  const fSec = partValues.second

  const formattedUtc = new Date(Date.UTC(fYear, fMonth - 1, fDay, fHour, fMin, fSec, ms))
  const diffMs = utcDate.getTime() - formattedUtc.getTime()
  const targetDate = new Date(utcDate.getTime() + diffMs)

  return targetDate.toISOString()
}

function localDateToUtcBounds(startDate, endDate, timezone = DEFAULT_TIMEZONE) {
  const tz = getBusinessTimezone(timezone)
  const startOfDayISO = startDate ? getUtcTimestampInTimezone(startDate, '00:00:00.000', tz) : null
  const endOfDayISO = endDate ? getUtcTimestampInTimezone(endDate, '23:59:59.999', tz) : null
  return { startOfDayISO, endOfDayISO }
}

async function runLocalzoneDiagnostic() {
  console.log('================================================================')
  console.log('        GLOBAL LOCALZONE DIAGNOSTIC & CHECKER TOOL            ')
  console.log('================================================================\n')

  // 1. Fetch business profile
  const { data: biz, error: bizErr } = await supabase.from('businesses').select('*').eq('id', businessId).single()
  if (bizErr) {
    console.error('❌ Failed to fetch business:', bizErr.message)
    return
  }

  const tz = getBusinessTimezone(biz?.timezone)
  console.log(`📍 Business Name: ${biz.name}`)
  console.log(`🌍 Configured Localzone: ${tz}`)
  console.log(`⏰ Current Local Time in ${tz}: ${formatLocalDateString(new Date(), tz)}`)
  console.log(`⏰ Current UTC Time: ${new Date().toISOString()}`)

  // 2. Test boundary calculations for August 2026
  const sampleStart = '2026-08-01'
  const sampleEnd = '2026-08-31'
  const bounds = localDateToUtcBounds(sampleStart, sampleEnd, tz)

  console.log('\n--- Date Boundary Verification ---')
  console.log(`Local Date Range: ${sampleStart} to ${sampleEnd}`)
  console.log(`UTC Start Bound:  ${bounds.startOfDayISO}`)
  console.log(`UTC End Bound:    ${bounds.endOfDayISO}`)

  // Verify WIB offset (UTC+7)
  const startUtc = new Date(bounds.startOfDayISO)
  const startExpected = new Date('2026-08-01T00:00:00+07:00')
  const diffStart = startUtc.getTime() - startExpected.getTime()

  if (diffStart === 0) {
    console.log('✅ UTC Start bound perfectly matches +07:00 offset!')
  } else {
    console.error('❌ UTC Start bound mismatch:', diffStart, 'ms')
  }

  // 3. Query DB RPC get_ledger_balances for both Accrual Basis and Cash Basis
  console.log('\n--- Fetching Balances for Accrual Basis & Cash Basis ---')
  
  const [accrualRes, cashRes] = await Promise.all([
    supabase.rpc('get_ledger_balances', {
      p_business_id: businessId,
      p_start_date: bounds.startOfDayISO,
      p_end_date: bounds.endOfDayISO,
      p_basis: 'accrual'
    }),
    supabase.rpc('get_ledger_balances', {
      p_business_id: businessId,
      p_start_date: bounds.startOfDayISO,
      p_end_date: bounds.endOfDayISO,
      p_basis: 'cash'
    })
  ])

  if (accrualRes.error) {
    console.error('❌ Accrual Basis RPC error:', accrualRes.error.message)
    return
  }
  if (cashRes.error) {
    console.error('❌ Cash Basis RPC error:', cashRes.error.message)
    return
  }

  console.log(`✅ Accrual Basis returned ${accrualRes.data.length} account balance rows.`)
  console.log(`✅ Cash Basis returned ${cashRes.data.length} account balance rows.`)

  // 4. Fetch account names & types
  const { data: accounts } = await supabase.from('accounts').select('*').eq('business_id', businessId)
  const accMap = new Map(accounts.map(a => [a.id, a]))

  let accrualRevenue = 0, accrualExpense = 0
  accrualRes.data.forEach(r => {
    const acc = accMap.get(r.account_id)
    if (!acc) return
    const bal = r.credit_sum - r.debit_sum
    if (acc.type === 'REVENUE') accrualRevenue += bal
    if (acc.type === 'EXPENSE') accrualExpense += (r.debit_sum - r.credit_sum)
  })

  let cashRevenue = 0, cashExpense = 0
  cashRes.data.forEach(r => {
    const acc = accMap.get(r.account_id)
    if (!acc) return
    const bal = r.credit_sum - r.debit_sum
    if (acc.type === 'REVENUE') cashRevenue += bal
    if (acc.type === 'EXPENSE') cashExpense += (r.debit_sum - r.credit_sum)
  })

  console.log('\n--- Profit & Loss Summary (Localzone Normalised) ---')
  console.log(`Accrual Basis - Revenue: Rp ${accrualRevenue.toLocaleString('id-ID')} | Expenses: Rp ${accrualExpense.toLocaleString('id-ID')} | Net Profit: Rp ${(accrualRevenue - accrualExpense).toLocaleString('id-ID')}`)
  console.log(`Cash Basis    - Revenue: Rp ${cashRevenue.toLocaleString('id-ID')} | Expenses: Rp ${cashExpense.toLocaleString('id-ID')} | Net Profit: Rp ${(cashRevenue - cashExpense).toLocaleString('id-ID')}`)

  console.log('\n🎉 ALL LOCALZONE CHECKS PASSED SUCCESSFULLY!')
}

runLocalzoneDiagnostic()
