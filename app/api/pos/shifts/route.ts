import { getApiContext } from '@/lib/apiContext'
import { NextResponse } from 'next/server'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const isUuid = (v: unknown): v is string => typeof v === 'string' && UUID_RE.test(v)

// GET /api/pos/shifts - Get active open shift or shift history
export async function GET(req: Request) {
  try {
    const ctx = await getApiContext()
    if (ctx.error) return ctx.error
    const { user, businessId, supabase } = ctx

    const { data: profile } = await supabase
      .from('profiles')
      .select('full_name')
      .eq('id', user.id)
      .maybeSingle()

    // Check active shift
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

    return NextResponse.json({
      activeShift: activeShift || null,
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

    const body = await req.json()
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

    if (action === 'open') {
      // Check if already has an open shift
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

      const { data: newShift, error: insertErr } = await supabase
        .from('pos_shifts')
        .insert({
          business_id: businessId,
          user_id: user.id,
          register_id: cleanRegisterId,
          cashier_name: cashierName,
          initial_cash: Number(initial_cash),
          expected_cash: Number(initial_cash),
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
          const { getOrCreateDefaultAccounts } = await import('@/lib/accountHelper')
          const { postJournalTransaction } = await import('@/lib/journalHelper')
          
          const accountMap = await getOrCreateDefaultAccounts(businessId, supabase)
          let kasPosAccId = accountMap['101000']
          
          if (cleanRegisterId) {
            const { data: regData } = await supabase
              .from('pos_registers')
              .select('account_id')
              .eq('id', cleanRegisterId)
              .maybeSingle()
            if (regData?.account_id) kasPosAccId = regData.account_id
          }
          
          // Resolve source credit account ID (defaults to 101100 Kas Utama, 101300 Kas Kecil, or 301000 Modal Pemilik)
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

      const expectedCash = currentShift ? currentShift.expected_cash : 0
      const shiftRegisterId = currentShift && isUuid(currentShift.register_id) ? currentShift.register_id : null
      const difference = Number(actual_cash) - Number(expectedCash)

      const { data: closedShift, error: closeErr } = await supabase
        .from('pos_shifts')
        .update({
          status: 'closed',
          closed_at: new Date().toISOString(),
          actual_cash: Number(actual_cash),
          difference: difference,
          note: note
        })
        .eq('id', shift_id)
        .select()
        .single()

      if (closeErr) {
        return NextResponse.json({ success: true, message: 'Shift ditutup (Lokal)' })
      }

      // Record Accounting Entry for Cash Remittance if actual_cash > 0
      if (Number(actual_cash) > 0 && target_account_code) {
        try {
          const { getOrCreateDefaultAccounts } = await import('@/lib/accountHelper')
          const { postJournalTransaction } = await import('@/lib/journalHelper')
          
          const accountMap = await getOrCreateDefaultAccounts(businessId, supabase)
          let kasPosAccId = accountMap['101000']
          
          if (shiftRegisterId) {
            const { data: regData } = await supabase
              .from('pos_registers')
              .select('account_id')
              .eq('id', shiftRegisterId)
              .maybeSingle()
            if (regData?.account_id) kasPosAccId = regData.account_id
          }
          
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

          if (kasPosAccId && debitAccId) {
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
          console.warn('Shift Journal Entry Warning:', jErr)
        }
      }

      return NextResponse.json({ success: true, shift: closedShift })
    }

    return NextResponse.json({ error: 'Aksi tidak valid' }, { status: 400 })

  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
