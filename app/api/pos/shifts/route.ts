import { getApiContext } from '@/lib/apiContext'
import { NextResponse } from 'next/server'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const isUuid = (v: unknown): v is string => typeof v === 'string' && UUID_RE.test(v)

// Helper: Calculate running cash balance and metrics for given shift IDs
async function calculateShiftMetrics(supabase: any, shiftIds: string[]) {
  const metricsMap = new Map<string, {
    cash_sales: number
    non_cash_sales: number
    cash_refunds: number
    cash_in: number
    cash_out: number
    total_transactions: number
  }>()

  if (!shiftIds || shiftIds.length === 0) return metricsMap

  shiftIds.forEach((id) => {
    metricsMap.set(id, {
      cash_sales: 0,
      non_cash_sales: 0,
      cash_refunds: 0,
      cash_in: 0,
      cash_out: 0,
      total_transactions: 0
    })
  })

  // 1. Fetch payments
  const { data: payments } = await supabase
    .from('order_payments')
    .select('shift_id, amount, payment_method, payment_kind')
    .in('shift_id', shiftIds)

  if (payments) {
    for (const p of payments) {
      const metric = metricsMap.get(p.shift_id)
      if (!metric) continue

      const amt = Number(p.amount) || 0
      const isCash = String(p.payment_method || '').toLowerCase() === 'cash'
      const isOutbound = p.payment_kind === 'refund' || p.payment_kind === 'void'

      if (isCash) {
        if (isOutbound) {
          metric.cash_refunds += amt
        } else {
          metric.cash_sales += amt
          metric.total_transactions += 1
        }
      } else {
        if (!isOutbound) {
          metric.non_cash_sales += amt
          metric.total_transactions += 1
        }
      }
    }
  }

  // 2. Fetch cash movements
  const { data: movements } = await supabase
    .from('pos_shift_movements')
    .select('shift_id, amount, type')
    .in('shift_id', shiftIds)

  if (movements) {
    for (const m of movements) {
      const metric = metricsMap.get(m.shift_id)
      if (!metric) continue
      const amt = Number(m.amount) || 0
      if (m.type === 'cash_in') metric.cash_in += amt
      else if (m.type === 'cash_out') metric.cash_out += amt
    }
  }

  return metricsMap
}

// GET /api/pos/shifts - Get active open shift or monitoring list
export async function GET(req: Request) {
  try {
    const ctx = await getApiContext()
    if (ctx.error) return ctx.error
    const { user, businessId, supabase } = ctx

    const { searchParams } = new URL(req.url)
    const mode = searchParams.get('mode') // 'monitoring' or default single cashier

    // ─── Mode: Manager Live Monitoring of All Active Shifts ─────────────────────
    if (mode === 'monitoring') {
      const { data: openShifts, error: monitorErr } = await supabase
        .from('pos_shifts')
        .select('*')
        .eq('business_id', businessId)
        .eq('status', 'open')
        .order('opened_at', { ascending: false })

      if (monitorErr) {
        return NextResponse.json({ error: monitorErr.message }, { status: 500 })
      }

      const activeList = openShifts || []
      const shiftIds = activeList.map((s: any) => s.id)
      const metricsMap = await calculateShiftMetrics(supabase, shiftIds)

      const enrichedShifts = activeList.map((s: any) => {
        const m = metricsMap.get(s.id) || {
          cash_sales: 0,
          non_cash_sales: 0,
          cash_refunds: 0,
          cash_in: 0,
          cash_out: 0,
          total_transactions: 0
        }
        const initialCash = Number(s.initial_cash || 0)
        const currentDrawerCash = initialCash + m.cash_sales - m.cash_refunds + m.cash_in - m.cash_out

        return {
          ...s,
          metrics: {
            ...m,
            initial_cash: initialCash,
            current_drawer_cash: currentDrawerCash,
            total_sales: m.cash_sales + m.non_cash_sales
          }
        }
      })

      return NextResponse.json({
        success: true,
        activeShifts: enrichedShifts,
        totalActiveCount: enrichedShifts.length,
        totalDrawerCash: enrichedShifts.reduce((acc, s) => acc + s.metrics.current_drawer_cash, 0)
      })
    }

    // ─── Default Mode: Cashier Active Shift ─────────────────────────────────────
    const { data: profile } = await supabase
      .from('profiles')
      .select('full_name')
      .eq('id', user.id)
      .maybeSingle()

    const { data: activeShift, error: shiftErr } = await supabase
      .from('pos_shifts')
      .select('*')
      .eq('business_id', businessId)
      .eq('user_id', user.id)
      .eq('status', 'open')
      .order('opened_at', { ascending: false })
      .maybeSingle()

    if (shiftErr && !shiftErr.message?.includes('does not exist')) {
      return NextResponse.json({ error: shiftErr.message }, { status: 500 })
    }

    let enrichedShift = activeShift || null
    if (activeShift) {
      const metricsMap = await calculateShiftMetrics(supabase, [activeShift.id])
      const m = metricsMap.get(activeShift.id) || {
        cash_sales: 0,
        non_cash_sales: 0,
        cash_refunds: 0,
        cash_in: 0,
        cash_out: 0,
        total_transactions: 0
      }
      const initialCash = Number(activeShift.initial_cash || 0)
      const currentDrawerCash = initialCash + m.cash_sales - m.cash_refunds + m.cash_in - m.cash_out

      enrichedShift = {
        ...activeShift,
        calculated_expected_cash: currentDrawerCash,
        calculated_cash_sales: m.cash_sales,
        calculated_non_cash_sales: m.non_cash_sales,
        calculated_cash_refunds: m.cash_refunds,
        calculated_cash_in: m.cash_in,
        calculated_cash_out: m.cash_out,
        total_transactions: m.total_transactions
      }
    }

    return NextResponse.json({
      activeShift: enrichedShift,
      cashierName: profile?.full_name || user.user_metadata?.full_name || 'Kasir'
    })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

// POST /api/pos/shifts - Open a new shift or Close current shift
export async function POST(req: Request) {
  try {
    const ctx = await getApiContext()
    if (ctx.error) return ctx.error
    const { user, businessId, supabase } = ctx

    const { data: profile } = await supabase
      .from('profiles')
      .select('full_name')
      .eq('id', user.id)
      .maybeSingle()

    const cashierName = profile?.full_name || user.user_metadata?.full_name || 'Kasir'

    const body = await req.json().catch(() => null)
    if (!body) {
      return NextResponse.json({ error: 'Body permintaan tidak valid' }, { status: 400 })
    }

    const { 
      action, 
      initial_cash = 0, 
      actual_cash = 0, 
      note = '', 
      source_account_code = '101100', 
      target_account_code = '101100', 
      register_id 
    } = body

    const cleanRegisterId = isUuid(register_id) ? register_id : null

    // ─── ACTION: OPEN SHIFT ─────────────────────────────────────────────────────
    if (action === 'open') {
      const { data: existingShift } = await supabase
        .from('pos_shifts')
        .select('id')
        .eq('business_id', businessId)
        .eq('user_id', user.id)
        .eq('status', 'open')
        .maybeSingle()

      if (existingShift) {
        return NextResponse.json({ error: 'Anda sudah memiliki shift yang sedang aktif.' }, { status: 400 })
      }

      // Resolve source credit account ID
      const { getOrCreateDefaultAccounts } = await import('@/lib/accountHelper')
      const accountMap = await getOrCreateDefaultAccounts(businessId, supabase)

      let creditAccId = accountMap[source_account_code] || accountMap['101100']
      if (!creditAccId) {
        const { data: customAcc } = await supabase
          .from('accounts')
          .select('id')
          .eq('business_id', businessId)
          .eq('code', source_account_code)
          .maybeSingle()
        if (customAcc) creditAccId = customAcc.id
      }

      const { data: newShift, error: insertErr } = await supabase
        .from('pos_shifts')
        .insert({
          business_id: businessId,
          user_id: user.id,
          register_id: cleanRegisterId,
          cashier_name: cashierName,
          initial_cash: Number(initial_cash),
          expected_cash: Number(initial_cash),
          source_account_id: isUuid(creditAccId) ? creditAccId : null,
          status: 'open',
          note: note ? `Source: ${source_account_code} | ${note}` : `Source Account: ${source_account_code}`
        })
        .select()
        .single()

      if (insertErr && !insertErr.message?.includes('does not exist')) {
        return NextResponse.json({ error: insertErr.message }, { status: 500 })
      }

      const activeShiftObj = newShift || {
        id: 'local-shift-' + Date.now(),
        cashier_name: cashierName,
        opened_at: new Date().toISOString(),
        initial_cash: Number(initial_cash),
        status: 'open'
      }

      // Record Accounting Entry for Initial Cash Float if initial_cash > 0
      if (Number(initial_cash) > 0) {
        try {
          const { postJournalTransaction } = await import('@/lib/journalHelper')
          
          let kasPosAccId = accountMap['101000']
          if (cleanRegisterId) {
            const { data: regData } = await supabase
              .from('pos_registers')
              .select('account_id')
              .eq('id', cleanRegisterId)
              .maybeSingle()
            if (regData?.account_id) kasPosAccId = regData.account_id
          }

          if (kasPosAccId && creditAccId) {
            await postJournalTransaction(
              businessId,
              null,
              new Date().toISOString(),
              `Modal Awal Kasir Shift - ${cashierName}`,
              [
                { account_id: kasPosAccId, debit: Number(initial_cash), credit: 0 },
                { account_id: creditAccId, debit: 0, credit: Number(initial_cash) }
              ],
              supabase
            )
          }
        } catch (jErr) {
          console.warn('Shift Journal Entry Warning:', jErr)
        }
      }

      return NextResponse.json({ success: true, shift: activeShiftObj })

    // ─── ACTION: CLOSE SHIFT ────────────────────────────────────────────────────
    } else if (action === 'close') {
      const { shift_id } = body
      if (!shift_id) {
        return NextResponse.json({ error: 'shift_id wajib diisi' }, { status: 400 })
      }

      if (!isUuid(shift_id)) {
        return NextResponse.json({ success: true, message: 'Shift ditutup (Lokal)' })
      }

      const { data: currentShift } = await supabase
        .from('pos_shifts')
        .select('*')
        .eq('id', shift_id)
        .single()

      if (!currentShift) {
        return NextResponse.json({ error: 'Data shift tidak ditemukan' }, { status: 404 })
      }

      const shiftRegisterId = currentShift && isUuid(currentShift.register_id) ? currentShift.register_id : null

      // Compute Dynamic Real-Time Expected Cash
      const metricsMap = await calculateShiftMetrics(supabase, [shift_id])
      const m = metricsMap.get(shift_id) || {
        cash_sales: 0,
        non_cash_sales: 0,
        cash_refunds: 0,
        cash_in: 0,
        cash_out: 0,
        total_transactions: 0
      }

      const initialCash = Number(currentShift.initial_cash || 0)
      const expectedCash = initialCash + m.cash_sales - m.cash_refunds + m.cash_in - m.cash_out
      const difference = Number(actual_cash) - Number(expectedCash)

      const { getOrCreateDefaultAccounts } = await import('@/lib/accountHelper')
      const accountMap = await getOrCreateDefaultAccounts(businessId, supabase)

      let debitAccId = accountMap[target_account_code] || accountMap['101100']
      if (!debitAccId) {
        const { data: customAcc } = await supabase
          .from('accounts')
          .select('id')
          .eq('business_id', businessId)
          .eq('code', target_account_code)
          .maybeSingle()
        if (customAcc) debitAccId = customAcc.id
      }

      const { data: closedShift, error: closeErr } = await supabase
        .from('pos_shifts')
        .update({
          status: 'closed',
          closed_at: new Date().toISOString(),
          expected_cash: expectedCash,
          actual_cash: Number(actual_cash),
          difference: difference,
          destination_account_id: isUuid(debitAccId) ? debitAccId : null,
          note: note
        })
        .eq('id', shift_id)
        .select()
        .single()

      if (closeErr) {
        return NextResponse.json({ success: true, message: 'Shift ditutup (Lokal)' })
      }

      // ─── POSTING JURNAL TUTUP SHIFT ───────────────────────────────────────────
      try {
        const { postJournalTransaction } = await import('@/lib/journalHelper')

        let kasPosAccId = accountMap['101000']
        if (shiftRegisterId) {
          const { data: regData } = await supabase
            .from('pos_registers')
            .select('account_id')
            .eq('id', shiftRegisterId)
            .maybeSingle()
          if (regData?.account_id) kasPosAccId = regData.account_id
        }

        // 1. Post Variance Journal (Over / Short) if difference !== 0
        if (difference !== 0 && kasPosAccId) {
          if (difference < 0) {
            // Cash Shortage (Kurang Kas) -> Beban Selisih Kas (503000)
            const selisihBebanAccId = accountMap['503000'] || accountMap['403000']
            if (selisihBebanAccId) {
              await postJournalTransaction(
                businessId,
                null,
                new Date().toISOString(),
                `Selisih Kas Kurang (Short) Tutup Shift - ${cashierName}`,
                [
                  { account_id: selisihBebanAccId, debit: Math.abs(difference), credit: 0 },
                  { account_id: kasPosAccId, debit: 0, credit: Math.abs(difference) }
                ],
                supabase
              )
            }
          } else {
            // Cash Overage (Lebih Kas) -> Pendapatan Lain-lain (403000)
            const selisihPendapatanAccId = accountMap['403000']
            if (selisihPendapatanAccId) {
              await postJournalTransaction(
                businessId,
                null,
                new Date().toISOString(),
                `Selisih Kas Lebih (Over) Tutup Shift - ${cashierName}`,
                [
                  { account_id: kasPosAccId, debit: difference, credit: 0 },
                  { account_id: selisihPendapatanAccId, debit: 0, credit: difference }
                ],
                supabase
              )
            }
          }
        }

        // 2. Post Cash Remittance Journal for actual_cash > 0
        if (Number(actual_cash) > 0 && kasPosAccId && debitAccId) {
          await postJournalTransaction(
            businessId,
            null,
            new Date().toISOString(),
            `Setoran Tutup Shift - ${cashierName}`,
            [
              { account_id: debitAccId, debit: Number(actual_cash), credit: 0 },
              { account_id: kasPosAccId, debit: 0, credit: Number(actual_cash) }
            ],
            supabase
          )
        }
      } catch (jErr) {
        console.warn('Close Shift Journal Posting Warning:', jErr)
      }

      return NextResponse.json({ success: true, shift: closedShift })
    }

    return NextResponse.json({ error: 'Aksi tidak valid' }, { status: 400 })

  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
