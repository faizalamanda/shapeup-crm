import { NextRequest, NextResponse } from 'next/server'
import { getApiContext } from '@/lib/apiContext'
import { getUtcTimestampInTimezone, getBusinessTimezone } from '@/lib/localzone'

interface CachedEntry<T> {
  data: T
  expiresAt: number
}

const ACCOUNTS_TTL_MS = 30_000
const REPORT_TTL_MS = 15_000

const g = globalThis as unknown as {
  __suAccountingAccountsCache?: Map<string, CachedEntry<any[]>>
  __suAccountingReportCache?: Map<string, CachedEntry<any>>
  __suAccountingInFlight?: Map<string, Promise<any>>
}

const accountsCache = (g.__suAccountingAccountsCache ??= new Map())
const reportCache = (g.__suAccountingReportCache ??= new Map())
const inFlightMap = (g.__suAccountingInFlight ??= new Map())

async function getBusinessAccountsCached(businessId: string, supabaseAdmin: any): Promise<any[]> {
  const now = Date.now()
  const cached = accountsCache.get(businessId)
  if (cached && cached.expiresAt > now) {
    return cached.data
  }

  const inflightKey = `accounts:${businessId}`
  if (inFlightMap.has(inflightKey)) {
    return await inFlightMap.get(inflightKey)!
  }

  const promise = (async () => {
    try {
      const { data, error } = await supabaseAdmin
        .from('accounts')
        .select('*')
        .eq('business_id', businessId)
        .order('code', { ascending: true })

      if (error) throw new Error(`Failed to fetch accounts: ${error.message}`)
      const list = data || []
      accountsCache.set(businessId, { data: list, expiresAt: Date.now() + ACCOUNTS_TTL_MS })
      return list
    } finally {
      inFlightMap.delete(inflightKey)
    }
  })()

  inFlightMap.set(inflightKey, promise)
  return await promise
}

export async function GET(req: NextRequest) {
  try {
    const ctx = await getApiContext({ req })
    if (ctx.error) return ctx.error
    const { businessId, supabaseAdmin } = ctx

    const url = new URL(req.url)
    const mode = url.searchParams.get('mode') || 'ledger-balances'
    const startDate = url.searchParams.get('start_date') || ''
    const endDate = url.searchParams.get('end_date') || ''
    const rawTz = url.searchParams.get('timezone') || ''
    const basis = url.searchParams.get('basis') === 'cash' ? 'cash' : 'accrual'
    const bustCache = url.searchParams.get('refresh') === '1'

    if (!endDate) {
      return NextResponse.json({ error: 'Parameter end_date wajib diisi' }, { status: 400 })
    }

    // Resolve timezone without extra DB query when already provided by client
    let tz = rawTz ? getBusinessTimezone(rawTz) : ''
    if (!tz) {
      const { data: biz } = await supabaseAdmin
        .from('businesses')
        .select('timezone')
        .eq('id', businessId)
        .maybeSingle()
      tz = getBusinessTimezone(biz?.timezone)
    }

    const startOfDayISO = startDate ? getUtcTimestampInTimezone(startDate, '00:00:00.000', tz) : null
    const endOfDayISO = getUtcTimestampInTimezone(endDate, '23:59:59.999', tz)

    if (mode === 'cash-flow') {
      if (!startOfDayISO) {
        return NextResponse.json({ error: 'Parameter start_date wajib diisi untuk laporan arus kas' }, { status: 400 })
      }

      const cacheKey = `cf:${businessId}:${startOfDayISO}:${endOfDayISO}`
      const now = Date.now()
      if (!bustCache) {
        const cached = reportCache.get(cacheKey)
        if (cached && cached.expiresAt > now) {
          return NextResponse.json({ data: cached.data, cached: true })
        }
      }

      if (inFlightMap.has(cacheKey)) {
        const data = await inFlightMap.get(cacheKey)!
        return NextResponse.json({ data, deduplicated: true })
      }

      const cfPromise = (async () => {
        try {
          const { data, error } = await supabaseAdmin.rpc('get_cash_flow_summary', {
            p_business_id: businessId,
            p_start_date: startOfDayISO,
            p_end_date: endOfDayISO
          })
          if (error) throw new Error(`Failed to fetch cash flow summary: ${error.message}`)
          reportCache.set(cacheKey, { data, expiresAt: Date.now() + REPORT_TTL_MS })
          return data
        } finally {
          inFlightMap.delete(cacheKey)
        }
      })()

      inFlightMap.set(cacheKey, cfPromise)
      const data = await cfPromise
      return NextResponse.json({ data })
    }

    // Default mode: 'ledger-balances'
    const cacheKey = `lb:${businessId}:${startOfDayISO || 'all'}:${endOfDayISO}:${basis}`
    const now = Date.now()
    if (!bustCache) {
      const cached = reportCache.get(cacheKey)
      if (cached && cached.expiresAt > now) {
        return NextResponse.json({ ...cached.data, cached: true })
      }
    }

    if (inFlightMap.has(cacheKey)) {
      const result = await inFlightMap.get(cacheKey)!
      return NextResponse.json({ ...result, deduplicated: true })
    }

    const lbPromise = (async () => {
      try {
        const [accounts, balancesRes] = await Promise.all([
          getBusinessAccountsCached(businessId, supabaseAdmin),
          supabaseAdmin.rpc('get_ledger_balances', {
            p_business_id: businessId,
            p_start_date: startOfDayISO,
            p_end_date: endOfDayISO,
            p_basis: basis
          })
        ])

        if (balancesRes.error) {
          throw new Error(`Failed to fetch ledger balances: ${balancesRes.error.message}`)
        }

        const balancesMap: Record<string, { debit: number; credit: number }> = {}
        for (const acc of accounts) {
          balancesMap[acc.id] = { debit: 0, credit: 0 }
        }

        if (Array.isArray(balancesRes.data)) {
          for (const row of balancesRes.data) {
            balancesMap[row.account_id] = {
              debit: parseFloat(row.debit_sum || 0),
              credit: parseFloat(row.credit_sum || 0)
            }
          }
        }

        const payload = { accounts, balances: balancesMap }
        reportCache.set(cacheKey, { data: payload, expiresAt: Date.now() + REPORT_TTL_MS })
        return payload
      } finally {
        inFlightMap.delete(cacheKey)
      }
    })()

    inFlightMap.set(cacheKey, lbPromise)
    const result = await lbPromise
    return NextResponse.json(result)
  } catch (err: any) {
    console.error('[API Accounting Reports] Error:', err)
    return NextResponse.json(
      { error: err?.message || 'Gagal memuat data laporan akuntansi' },
      { status: 500 }
    )
  }
}

