import { NextRequest, NextResponse } from 'next/server'
import { getApiContext } from '@/lib/apiContext'

export async function GET(request: NextRequest) {
  try {
    const ctx = await getApiContext()
    if (ctx.error) return ctx.error
    const { businessId, supabase } = ctx

    const { searchParams } = new URL(request.url)
    const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10))
    const pageSize = Math.min(100, Math.max(1, parseInt(searchParams.get('pageSize') || '20', 10)))
    const offset = (page - 1) * pageSize

    const paymentType = searchParams.get('paymentType') // 'all', 'inbound', 'outbound'
    const channel = searchParams.get('channel') // 'all', 'POS', 'Invoice', 'Purchases', 'Expenses', 'Payroll'
    const search = searchParams.get('search')?.trim()
    const dateFrom = searchParams.get('dateFrom')
    const dateTo = searchParams.get('dateTo')
    const sortField = searchParams.get('sortField') || 'created_at'
    const sortOrder = searchParams.get('sortOrder') === 'asc' ? true : false

    // 1. Build Query on v_all_payments
    let query = supabase
      .from('v_all_payments')
      .select('*', { count: 'exact' })
      .eq('business_id', businessId)

    if (paymentType && paymentType !== 'all') {
      query = query.eq('payment_type', paymentType)
    }

    if (channel && channel !== 'all') {
      query = query.eq('channel', channel)
    }

    if (dateFrom) {
      query = query.gte('date', dateFrom)
    }

    if (dateTo) {
      query = query.lte('date', dateTo)
    }

    if (search) {
      query = query.or(
        `document_number.ilike.%${search}%,partner_name.ilike.%${search}%,reference_number.ilike.%${search}%,notes.ilike.%${search}%`
      )
    }

    // Apply Server-Side Sorting
    const validSortFields = ['date', 'amount', 'created_at', 'document_number', 'channel', 'payment_type']
    const safeSortField = validSortFields.includes(sortField) ? sortField : 'created_at'
    query = query.order(safeSortField, { ascending: sortOrder }).range(offset, offset + pageSize - 1)

    const { data: payments, count, error } = await query

    if (error) {
      // Graceful fallback if view is still compiling or pending migration execution
      if (error.message?.includes('does not exist') || error.code === '42P01') {
        return NextResponse.json({
          payments: [],
          totalCount: 0,
          page,
          pageSize,
          kpi: { totalInbound: 0, totalOutbound: 0, netBalance: 0 },
          notice: 'Tabel/View v_all_payments sedang disiapkan atau belum dimigrasikan.'
        })
      }
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    // 2. Fetch Aggregate KPI (Inbound, Outbound, Net) for this business in the date range
    let kpiQuery = supabase
      .from('v_all_payments')
      .select('payment_type, amount')
      .eq('business_id', businessId)

    if (dateFrom) kpiQuery = kpiQuery.gte('date', dateFrom)
    if (dateTo) kpiQuery = kpiQuery.lte('date', dateTo)

    const { data: kpiData } = await kpiQuery

    let totalInbound = 0
    let totalOutbound = 0

    if (kpiData && Array.isArray(kpiData)) {
      for (const item of kpiData) {
        const amt = Number(item.amount) || 0
        if (item.payment_type === 'inbound') {
          totalInbound += amt
        } else if (item.payment_type === 'outbound') {
          totalOutbound += amt
        }
      }
    }

    return NextResponse.json({
      payments: payments || [],
      totalCount: count || 0,
      page,
      pageSize,
      kpi: {
        totalInbound,
        totalOutbound,
        netBalance: totalInbound - totalOutbound
      }
    })
  } catch (err: any) {
    console.error('Accounting Payments GET API Error:', err)
    return NextResponse.json({ error: err.message || 'Terjadi kesalahan internal server' }, { status: 500 })
  }
}
