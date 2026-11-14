import { SupabaseClient } from '@supabase/supabase-js'
import { 
  DateRangeKey, 
  getLocalDateRangeLimits, 
  getUtcTimestampInTimezone, 
  localDateToUtcBounds 
} from '@/lib/localzone'

export type { DateRangeKey }

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

// Get default date range options accounting for localzone
export function getDateRangeLimits(key: DateRangeKey, timezone?: string): { start: string; end: string } {
  return getLocalDateRangeLimits(key, timezone)
}

// Helper to convert local calendar date to UTC timestamp based on timezone
export function getUtcTimestamp(dateStr: string, timeStr: string, timeZone: string): string {
  return getUtcTimestampInTimezone(dateStr, timeStr, timeZone)
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

    query = query
      .order('date', { ascending: true })
      .order('id', { ascending: true })
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

// Client-side L1 memory cache & single-flight deduplication for accounting reports
const CLIENT_ACCOUNTS_TTL_MS = 30_000
const CLIENT_REPORT_TTL_MS = 15_000

const clientAccountsCache = new Map<string, { data: Account[]; expiresAt: number }>()
const clientReportCache = new Map<string, { data: any; expiresAt: number }>()
const clientInFlightMap = new Map<string, Promise<any>>()

export function invalidateAccountingReportCache(businessId?: string) {
  if (!businessId) {
    clientAccountsCache.clear()
    clientReportCache.clear()
    return
  }
  clientAccountsCache.delete(businessId)
  for (const key of clientReportCache.keys()) {
    if (key.includes(businessId)) {
      clientReportCache.delete(key)
    }
  }
}

async function fetchAccountsCachedClient(supabase: SupabaseClient, businessId: string): Promise<Account[]> {
  const now = Date.now()
  const cached = clientAccountsCache.get(businessId)
  if (cached && cached.expiresAt > now) {
    return cached.data
  }

  const inflightKey = `acc:${businessId}`
  if (clientInFlightMap.has(inflightKey)) {
    return await clientInFlightMap.get(inflightKey)!
  }

  const p = (async () => {
    try {
      const { data: accounts, error: accountsErr } = await supabase
        .from('accounts')
        .select('*')
        .eq('business_id', businessId)
        .order('code', { ascending: true })

      if (accountsErr) {
        throw new Error(`Failed to fetch accounts: ${accountsErr.message}`)
      }
      const typed = (accounts || []) as Account[]
      clientAccountsCache.set(businessId, { data: typed, expiresAt: Date.now() + CLIENT_ACCOUNTS_TTL_MS })
      return typed
    } finally {
      clientInFlightMap.delete(inflightKey)
    }
  })()

  clientInFlightMap.set(inflightKey, p)
  return await p
}

// Fetch cash flow summary via server-side admin fast-path (bypasses RLS overhead) with client fallback
export async function fetchCashFlowSummary(
  supabase: SupabaseClient,
  businessId: string,
  startDate: string,
  endDate: string,
  timezone: string
): Promise<any> {
  const cacheKey = `cf:${businessId}:${startDate}:${endDate}:${timezone}`
  const now = Date.now()
  const cached = clientReportCache.get(cacheKey)
  if (cached && cached.expiresAt > now) {
    return cached.data
  }

  if (clientInFlightMap.has(cacheKey)) {
    return await clientInFlightMap.get(cacheKey)!
  }

  const promise = (async () => {
    try {
      // 1. Primary Fast-Path: Server API Route using supabaseAdmin (0 RLS subquery overhead)
      if (typeof window !== 'undefined') {
        try {
          const params = new URLSearchParams({
            mode: 'cash-flow',
            business_id: businessId,
            start_date: startDate,
            end_date: endDate,
            timezone
          })
          const res = await fetch(`/api/accounting/reports?${params.toString()}`, {
            headers: { 'x-business-id': businessId }
          })
          const json = await res.json().catch(() => null)
          if (res.ok && json?.data) {
            clientReportCache.set(cacheKey, { data: json.data, expiresAt: Date.now() + CLIENT_REPORT_TTL_MS })
            return json.data
          }
        } catch {
          // Fallback to direct RPC below
        }
      }

      // 2. Resilient Fallback: Direct Supabase RPC
      const startOfDayISO = getUtcTimestamp(startDate, '00:00:00.000', timezone)
      const endOfDayISO = getUtcTimestamp(endDate, '23:59:59.999', timezone)

      const { data, error } = await supabase.rpc('get_cash_flow_summary', {
        p_business_id: businessId,
        p_start_date: startOfDayISO,
        p_end_date: endOfDayISO
      })

      if (error) {
        throw new Error(`Gagal memuat laporan arus kas: ${error.message}`)
      }

      clientReportCache.set(cacheKey, { data, expiresAt: Date.now() + CLIENT_REPORT_TTL_MS })
      return data
    } finally {
      clientInFlightMap.delete(cacheKey)
    }
  })()

  clientInFlightMap.set(cacheKey, promise)
  return await promise
}

// Fetch ledger balances aggregated server-side by calling /api/accounting/reports (or get_ledger_balances RPC fallback)
export async function fetchLedgerBalances(
  supabase: SupabaseClient,
  businessId: string,
  endDate: string, // YYYY-MM-DD
  startDate?: string, // Optional YYYY-MM-DD
  timezone?: string,
  basis?: 'accrual' | 'cash'
): Promise<{ accounts: Account[]; balances: Record<string, { debit: number; credit: number }> }> {
  const effectiveBasis = basis || 'accrual'
  const effectiveTz = timezone || 'Asia/Jakarta'
  const cacheKey = `lb:${businessId}:${startDate || 'all'}:${endDate}:${effectiveTz}:${effectiveBasis}`
  const now = Date.now()

  const cached = clientReportCache.get(cacheKey)
  if (cached && cached.expiresAt > now) {
    return cached.data
  }

  if (clientInFlightMap.has(cacheKey)) {
    return await clientInFlightMap.get(cacheKey)!
  }

  const promise = (async () => {
    try {
      // 1. Primary Fast-Path: Server API Route using supabaseAdmin (parallel accounts + RPC, 0 RLS overhead)
      if (typeof window !== 'undefined') {
        try {
          const params = new URLSearchParams({
            mode: 'ledger-balances',
            business_id: businessId,
            end_date: endDate,
            timezone: effectiveTz,
            basis: effectiveBasis
          })
          if (startDate) params.set('start_date', startDate)

          const res = await fetch(`/api/accounting/reports?${params.toString()}`, {
            headers: { 'x-business-id': businessId }
          })
          const json = await res.json().catch(() => null)
          if (res.ok && Array.isArray(json?.accounts) && json?.balances) {
            const result = {
              accounts: json.accounts as Account[],
              balances: json.balances as Record<string, { debit: number; credit: number }>
            }
            clientAccountsCache.set(businessId, { data: result.accounts, expiresAt: Date.now() + CLIENT_ACCOUNTS_TTL_MS })
            clientReportCache.set(cacheKey, { data: result, expiresAt: Date.now() + CLIENT_REPORT_TTL_MS })
            return result
          }
        } catch {
          // Fallback to direct RPC below
        }
      }

      // 2. Resilient Fallback: Parallel accounts fetch + RPC
      let tz: string = timezone || ''
      if (!tz) {
        const { data: biz } = await supabase
          .from('businesses')
          .select('timezone')
          .eq('id', businessId)
          .single()
        tz = biz?.timezone || 'Asia/Jakarta'
      }

      const startOfDayISO = startDate ? getUtcTimestamp(startDate, '00:00:00.000', tz) : null
      const endOfDayISO = getUtcTimestamp(endDate, '23:59:59.999', tz)

      const [typedAccounts, balancesRes] = await Promise.all([
        fetchAccountsCachedClient(supabase, businessId),
        supabase.rpc('get_ledger_balances', {
          p_business_id: businessId,
          p_start_date: startOfDayISO,
          p_end_date: endOfDayISO,
          p_basis: effectiveBasis
        })
      ])

      if (balancesRes.error) {
        throw new Error(`Failed to fetch ledger balances: ${balancesRes.error.message}`)
      }

      const balancesMap: Record<string, { debit: number; credit: number }> = {}
      typedAccounts.forEach(acc => {
        balancesMap[acc.id] = { debit: 0, credit: 0 }
      })

      if (balancesRes.data) {
        balancesRes.data.forEach((row: any) => {
          balancesMap[row.account_id] = {
            debit: parseFloat(row.debit_sum || 0),
            credit: parseFloat(row.credit_sum || 0)
          }
        })
      }

      const result = {
        accounts: typedAccounts,
        balances: balancesMap
      }
      clientReportCache.set(cacheKey, { data: result, expiresAt: Date.now() + CLIENT_REPORT_TTL_MS })
      return result
    } finally {
      clientInFlightMap.delete(cacheKey)
    }
  })()

  clientInFlightMap.set(cacheKey, promise)
  return await promise
}

