import { NextRequest, NextResponse } from 'next/server'
import { getApiContext } from '@/lib/apiContext'
import { getUtcTimestampInTimezone, getBusinessTimezone } from '@/lib/localzone'
import { isUuid } from '@/lib/utils'

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

    if (!endDate && mode !== 'ap-ar-summary') {
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
    const endOfDayISO = endDate ? getUtcTimestampInTimezone(endDate, '23:59:59.999', tz) : null

    if (mode === 'ap-ar-summary') {
      const cacheKey = `apar:${businessId}:${tz}`
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

      const aparPromise = (async () => {
        try {
          const { data, error } = await supabaseAdmin.rpc('get_ap_ar_summary', {
            p_business_id: businessId,
            p_timezone: tz,
          })
          if (!error && data) {
            reportCache.set(cacheKey, { data, expiresAt: Date.now() + REPORT_TTL_MS })
            return data
          }

          // Fallback if RPC migration is not yet applied on the remote DB
          const todayStr = new Intl.DateTimeFormat('en-CA', {
            timeZone: tz,
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
          }).format(new Date())
          const [ty, tm, td] = todayStr.split('-').map(Number)
          const dueSoonDate = new Date(Date.UTC(ty, (tm || 1) - 1, (td || 1) + 7))
          const dueSoonEndStr = dueSoonDate.toISOString().slice(0, 10)

          const [ordersRes, purchasesRes, expensesRes] = await Promise.all([
            supabaseAdmin
              .from('orders')
              .select('grand_total, amount_paid, payment_status, status, raw_source_data')
              .eq('business_id', businessId)
              .not('status', 'in', '(cancelled,pending)')
              .or('payment_status.in.(unpaid,partial),payment_status.is.null'),
            supabaseAdmin
              .from('purchases')
              .select('grand_total, amount_paid, payment_status, due_date')
              .eq('business_id', businessId)
              .in('payment_status', ['unpaid', 'partial']),
            supabaseAdmin
              .from('expenses')
              .select('amount, amount_paid, outstanding_amount, payment_status, due_date')
              .eq('business_id', businessId)
              .in('payment_status', ['unpaid', 'partial']),
          ])

          if (ordersRes.error) throw ordersRes.error
          if (purchasesRes.error) throw purchasesRes.error
          if (expensesRes.error) throw expensesRes.error

          const ar = {
            outstanding_amount: 0,
            outstanding_count: 0,
            overdue_amount: 0,
            overdue_count: 0,
            due_soon_amount: 0,
            due_soon_count: 0,
          }

          for (const o of ordersRes.data || []) {
            const effPayStatus =
              o.payment_status ?? (o.status === 'completed' && Number(o.amount_paid || 0) === 0 ? 'paid' : 'unpaid')
            if (effPayStatus !== 'unpaid' && effPayStatus !== 'partial') continue
            const remaining = Math.max(0, Number(o.grand_total || 0) - Number(o.amount_paid || 0))
            if (remaining <= 0.01) continue

            ar.outstanding_amount += remaining
            ar.outstanding_count += 1
            const rawDue = typeof o.raw_source_data?.due_date === 'string' ? o.raw_source_data.due_date.slice(0, 10) : ''
            const due = /^\d{4}-\d{2}-\d{2}$/.test(rawDue) ? rawDue : null
            if (due) {
              if (due < todayStr) {
                ar.overdue_amount += remaining
                ar.overdue_count += 1
              } else if (due <= dueSoonEndStr) {
                ar.due_soon_amount += remaining
                ar.due_soon_count += 1
              }
            }
          }

          const ap = {
            outstanding_amount: 0,
            outstanding_count: 0,
            overdue_amount: 0,
            overdue_count: 0,
            due_soon_amount: 0,
            due_soon_count: 0,
            purchases_amount: 0,
            purchases_count: 0,
            expenses_amount: 0,
            expenses_count: 0,
          }

          const accumulateAp = (remaining: number, due: string | null, kind: 'purchase' | 'expense') => {
            if (remaining <= 0.01) return
            ap.outstanding_amount += remaining
            ap.outstanding_count += 1
            if (kind === 'purchase') {
              ap.purchases_amount += remaining
              ap.purchases_count += 1
            } else {
              ap.expenses_amount += remaining
              ap.expenses_count += 1
            }
            if (due) {
              if (due < todayStr) {
                ap.overdue_amount += remaining
                ap.overdue_count += 1
              } else if (due <= dueSoonEndStr) {
                ap.due_soon_amount += remaining
                ap.due_soon_count += 1
              }
            }
          }

          for (const p of purchasesRes.data || []) {
            const remaining = Math.max(0, Number(p.grand_total || 0) - Number(p.amount_paid || 0))
            accumulateAp(remaining, p.due_date ? String(p.due_date).slice(0, 10) : null, 'purchase')
          }

          for (const e of expensesRes.data || []) {
            const rawRem =
              e.outstanding_amount !== null && e.outstanding_amount !== undefined
                ? Number(e.outstanding_amount)
                : Number(e.amount || 0) - Number(e.amount_paid || 0)
            accumulateAp(Math.max(0, rawRem), e.due_date ? String(e.due_date).slice(0, 10) : null, 'expense')
          }

          const fallbackPayload = { as_of_date: todayStr, receivables: ar, payables: ap }
          reportCache.set(cacheKey, { data: fallbackPayload, expiresAt: Date.now() + REPORT_TTL_MS })
          return fallbackPayload
        } finally {
          inFlightMap.delete(cacheKey)
        }
      })()

      inFlightMap.set(cacheKey, aparPromise)
      const data = await aparPromise
      return NextResponse.json({ data })
    }

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

    if (mode === 'cash-flow-analytics') {
      if (!startOfDayISO) {
        return NextResponse.json({ error: 'Parameter start_date wajib diisi untuk analitik arus kas' }, { status: 400 })
      }

      const rawGranularity = url.searchParams.get('granularity') || 'day'
      const granularity = rawGranularity === 'week' || rawGranularity === 'month' ? rawGranularity : 'day'
      const rawAccountId = url.searchParams.get('account_id') || ''
      const accountId = isUuid(rawAccountId) ? rawAccountId : null

      const cacheKey = `cfa:${businessId}:${startOfDayISO}:${endOfDayISO}:${tz}:${granularity}:${accountId || 'all'}`
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

      const cfaPromise = (async () => {
        try {
          const { data, error } = await supabaseAdmin.rpc('get_cash_flow_analytics', {
            p_business_id: businessId,
            p_start_date: startOfDayISO,
            p_end_date: endOfDayISO,
            p_timezone: tz,
            p_granularity: granularity,
            p_account_id: accountId
          })
          if (error) throw new Error(`Failed to fetch cash flow analytics: ${error.message}`)
          reportCache.set(cacheKey, { data, expiresAt: Date.now() + REPORT_TTL_MS })
          return data
        } finally {
          inFlightMap.delete(cacheKey)
        }
      })()

      inFlightMap.set(cacheKey, cfaPromise)
      const data = await cfaPromise
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

