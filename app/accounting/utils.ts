import { SupabaseClient } from '@supabase/supabase-js'

export type Account = {
  id: string
  code: string
  name: string
  type: 'ASSET' | 'LIABILITY' | 'EQUITY' | 'REVENUE' | 'EXPENSE'
  sub_type?: string | null
  created_at?: string
  business_id: string
}

export type JournalLine = {
  id: string
  account_id: string
  debit: number
  credit: number
  transaction_id: string
  accounts?: Account
}

export type Transaction = {
  id: string
  date: string
  description: string | null
  order_id?: string | null
  business_id: string
  journal_lines: JournalLine[]
}

// Format number to IDR currency
export function formatCurrencyIDR(val: number): string {
  return new Intl.NumberFormat('id-ID', {
    style: 'currency',
    currency: 'IDR',
    minimumFractionDigits: 0
  }).format(val)
}

// Get default date range options
export type DateRangeKey = 'this-month' | 'this-quarter' | 'this-year' | 'last-month' | 'last-quarter' | 'last-year' | 'custom'

export function getDateRangeLimits(key: DateRangeKey): { start: string; end: string } {
  const now = new Date()
  let start = new Date()
  let end = new Date()

  switch (key) {
    case 'this-month':
      start = new Date(now.getFullYear(), now.getMonth(), 1)
      end = new Date(now.getFullYear(), now.getMonth() + 1, 0)
      break
    case 'this-quarter': {
      const q = Math.floor(now.getMonth() / 3)
      start = new Date(now.getFullYear(), q * 3, 1)
      end = new Date(now.getFullYear(), (q + 1) * 3, 0)
      break
    }
    case 'this-year':
      start = new Date(now.getFullYear(), 0, 1)
      end = new Date(now.getFullYear(), 11, 31)
      break
    case 'last-month':
      start = new Date(now.getFullYear(), now.getMonth() - 1, 1)
      end = new Date(now.getFullYear(), now.getMonth(), 0)
      break
    case 'last-quarter': {
      const q = Math.floor(now.getMonth() / 3) - 1
      // Handle underflow for previous year
      const targetYear = q < 0 ? now.getFullYear() - 1 : now.getFullYear()
      const targetQ = q < 0 ? 3 : q
      start = new Date(targetYear, targetQ * 3, 1)
      end = new Date(targetYear, (targetQ + 1) * 3, 0)
      break
    }
    case 'last-year':
      start = new Date(now.getFullYear() - 1, 0, 1)
      end = new Date(now.getFullYear() - 1, 11, 31)
      break
    case 'custom':
      // Return current month as placeholder
      start = new Date(now.getFullYear(), now.getMonth(), 1)
      end = new Date(now.getFullYear(), now.getMonth() + 1, 0)
      break
  }

  // Format as local YYYY-MM-DD
  const toLocalISODate = (d: Date) => {
    const year = d.getFullYear()
    const month = String(d.getMonth() + 1).padStart(2, '0')
    const day = String(d.getDate()).padStart(2, '0')
    return `${year}-${month}-${day}`
  }
  return { start: toLocalISODate(start), end: toLocalISODate(end) }
}

// Helper to convert local calendar date to UTC timestamp based on timezone
export function getUtcTimestamp(dateStr: string, timeStr: string, timeZone: string): string {
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
  const partValues: Record<string, number> = {};
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

// Fetch all business accounts and ledger transactions up to end date
export async function fetchLedgerData(
  supabase: SupabaseClient,
  businessId: string,
  endDate: string, // YYYY-MM-DD
  startDate?: string, // Optional YYYY-MM-DD
  timezone?: string
): Promise<{ accounts: Account[]; transactions: Transaction[] }> {
  // 1. Fetch all accounts
  const { data: accounts, error: accountsErr } = await supabase
    .from('accounts')
    .select('*')
    .eq('business_id', businessId)
    .order('code', { ascending: true })

  if (accountsErr) {
    throw new Error(`Failed to fetch accounts: ${accountsErr.message}`)
  }

  // Resolve business timezone
  let tz: string = timezone || '';
  if (!tz) {
    const { data: biz } = await supabase
      .from('businesses')
      .select('timezone')
      .eq('id', businessId)
      .single();
    tz = biz?.timezone || 'Asia/Jakarta';
  }

  // 2. Fetch all transactions and journal lines up to the end date (end of day) using paginated requests
  const endOfDayISO = getUtcTimestamp(endDate, '23:59:59.999', tz)
  
  let allTransactions: any[] = []
  let page = 0
  const pageSize = 1000
  let hasMore = true

  while (hasMore) {
    let query = supabase
      .from('transactions')
      .select(`
        id,
        date,
        description,
        order_id,
        business_id,
        journal_lines (
          id,
          account_id,
          debit,
          credit,
          transaction_id
        )
      `)
      .eq('business_id', businessId)
      .lte('date', endOfDayISO)

    if (startDate) {
      const startOfDayISO = getUtcTimestamp(startDate, '00:00:00.000', tz)
      query = query.gte('date', startOfDayISO)
    }

    query = query.order('date', { ascending: true })
      .range(page * pageSize, (page + 1) * pageSize - 1)

    const { data: pageData, error: txErr } = await query

    if (txErr) {
      throw new Error(`Failed to fetch transactions page ${page}: ${txErr.message}`)
    }

    if (!pageData || pageData.length === 0) {
      hasMore = false
    } else {
      allTransactions = allTransactions.concat(pageData)
      if (pageData.length < pageSize) {
        hasMore = false
      } else {
        page++
      }
    }
  }

  // Cast type and map accounts into journal lines for easy reference
  const typedAccounts = (accounts || []) as Account[]
  const accountsMap = new Map<string, Account>()
  typedAccounts.forEach(a => accountsMap.set(a.id, a))

  const typedTransactions = allTransactions.map((t: any) => {
    const journalLines = (t.journal_lines || []).map((jl: any) => ({
      ...jl,
      debit: parseFloat(jl.debit || 0),
      credit: parseFloat(jl.credit || 0),
      accounts: accountsMap.get(jl.account_id)
    }))

    return {
      ...t,
      journal_lines: journalLines
    }
  }) as Transaction[]

  return {
    accounts: typedAccounts,
    transactions: typedTransactions
  }
}

// Fetch ledger balances aggregated server-side by calling the get_ledger_balances RPC
export async function fetchLedgerBalances(
  supabase: SupabaseClient,
  businessId: string,
  endDate: string, // YYYY-MM-DD
  startDate?: string, // Optional YYYY-MM-DD
  timezone?: string,
  basis?: 'accrual' | 'cash'
): Promise<{ accounts: Account[]; balances: Record<string, { debit: number; credit: number }> }> {
  // 1. Fetch all accounts
  const { data: accounts, error: accountsErr } = await supabase
    .from('accounts')
    .select('*')
    .eq('business_id', businessId)
    .order('code', { ascending: true })

  if (accountsErr) {
    throw new Error(`Failed to fetch accounts: ${accountsErr.message}`)
  }

  // Resolve business timezone
  let tz: string = timezone || '';
  if (!tz) {
    const { data: biz } = await supabase
      .from('businesses')
      .select('timezone')
      .eq('id', businessId)
      .single();
    tz = biz?.timezone || 'Asia/Jakarta';
  }

  // 2. Fetch aggregated balances from RPC
  const startOfDayISO = startDate ? getUtcTimestamp(startDate, '00:00:00.000', tz) : null
  const endOfDayISO = getUtcTimestamp(endDate, '23:59:59.999', tz)

  const { data: balancesData, error: balancesErr } = await supabase
    .rpc('get_ledger_balances', {
      p_business_id: businessId,
      p_start_date: startOfDayISO,
      p_end_date: endOfDayISO,
      p_basis: basis || 'accrual'
    })

  if (balancesErr) {
    throw new Error(`Failed to fetch ledger balances: ${balancesErr.message}`)
  }

  const balancesMap: Record<string, { debit: number; credit: number }> = {}
  
  // Initialize all accounts with zero balances
  const typedAccounts = (accounts || []) as Account[]
  typedAccounts.forEach(acc => {
    balancesMap[acc.id] = { debit: 0, credit: 0 }
  })

  // Populate balances from RPC result
  if (balancesData) {
    balancesData.forEach((row: any) => {
      balancesMap[row.account_id] = {
        debit: parseFloat(row.debit_sum || 0),
        credit: parseFloat(row.credit_sum || 0)
      }
    })
  }

  return {
    accounts: typedAccounts,
    balances: balancesMap
  }
}

