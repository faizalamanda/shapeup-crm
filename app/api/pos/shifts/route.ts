import { createClient, getAuthUser } from '@/lib/supabaseServer'
import { NextResponse } from 'next/server'

// GET /api/pos/shifts - Get active open shift or shift history
export async function GET(req: Request) {
  const supabase = await createClient()

  try {
    const { user, error: authErr } = await getAuthUser(supabase)
    if (authErr || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { data: profile } = await supabase
      .from('profiles')
      .select('active_business_id, full_name')
      .eq('id', user.id)
      .single()

    if (!profile?.active_business_id) {
      return NextResponse.json({ error: 'Active business not found' }, { status: 400 })
    }

    const businessId = profile.active_business_id

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
      cashierName: profile.full_name || 'Kasir'
    })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

// POST /api/pos/shifts - Open a new shift or Close current shift
export async function POST(req: Request) {
  const supabase = await createClient()

  try {
    const { user, error: authErr } = await getAuthUser(supabase)
    if (authErr || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { data: profile } = await supabase
      .from('profiles')
      .select('active_business_id, full_name')
      .eq('id', user.id)
      .single()

    if (!profile?.active_business_id) {
      return NextResponse.json({ error: 'Active business not found' }, { status: 400 })
    }

    const businessId = profile.active_business_id
    const body = await req.json()
    const { action, initial_cash = 0, actual_cash = 0, note = '', source_account_code = '101100' } = body

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
          cashier_name: profile.full_name || 'Kasir',
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
        cashier_name: profile.full_name || 'Kasir',
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
          const kasPosAccId = accountMap['101000']
          
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
              `Modal Awal Kasir Shift - ${profile.full_name || 'Kasir'}`,
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

      const { data: currentShift } = await supabase
        .from('pos_shifts')
        .select('*')
        .eq('id', shift_id)
        .single()

      const expectedCash = currentShift ? currentShift.expected_cash : 0
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

      return NextResponse.json({ success: true, shift: closedShift })
    }

    return NextResponse.json({ error: 'Aksi tidak valid' }, { status: 400 })

  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
