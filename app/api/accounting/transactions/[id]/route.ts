import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const supabase = getSupabase()
    const { id } = await params

    const { data: transaction, error } = await supabase
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
          accounts (
            id,
            code,
            name,
            type,
            sub_type
          )
        )
      `)
      .eq('id', id)
      .single()

    if (error || !transaction) {
      return NextResponse.json({ error: 'Transaksi tidak ditemukan' }, { status: 404 })
    }

    return NextResponse.json({ data: transaction })
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Server error' }, { status: 500 })
  }
}

// Reversal / Void entry or direct deletion if draft
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const supabase = getSupabase()
    const { id } = await params
    const body = await request.json().catch(() => ({}))
    const action = body.action || 'void' // 'void' or 'delete'

    // Fetch target transaction
    const { data: targetTx, error: fetchErr } = await supabase
      .from('transactions')
      .select(`
        id,
        date,
        description,
        business_id,
        order_id,
        journal_lines (
          id,
          account_id,
          debit,
          credit
        )
      `)
      .eq('id', id)
      .single()

    if (fetchErr || !targetTx) {
      return NextResponse.json({ error: 'Transaksi tidak ditemukan' }, { status: 404 })
    }

    if (action === 'delete') {
      // Hard delete option if permitted (e.g. for unposted manual draft)
      const { error: delLinesErr } = await supabase
        .from('journal_lines')
        .delete()
        .eq('transaction_id', id)

      if (delLinesErr) {
        return NextResponse.json({ error: `Gagal menghapus rincian jurnal: ${delLinesErr.message}` }, { status: 500 })
      }

      const { error: delTxErr } = await supabase
        .from('transactions')
        .delete()
        .eq('id', id)

      if (delTxErr) {
        return NextResponse.json({ error: `Gagal menghapus transaksi: ${delTxErr.message}` }, { status: 500 })
      }

      return NextResponse.json({ message: 'Transaksi berhasil dihapus' })
    } else {
      // Standard Accounting Audit Trail: Reversal / Void Entry
      const reversalDescription = `[VOID / REVERSAL] ${targetTx.description}`
      const nowISO = new Date().toISOString()

      // 1. Create Reversal Transaction Header
      const { data: revTx, error: revTxErr } = await supabase
        .from('transactions')
        .insert({
          business_id: targetTx.business_id,
          date: nowISO,
          description: reversalDescription,
          order_id: targetTx.order_id || null
        })
        .select('*')
        .single()

      if (revTxErr || !revTx) {
        return NextResponse.json({ error: `Gagal membuat transaksi jurnal pembalik: ${revTxErr?.message}` }, { status: 500 })
      }

      // 2. Invert Debits and Credits
      const reversedLines = (targetTx.journal_lines || []).map((line: any) => ({
        transaction_id: revTx.id,
        account_id: line.account_id,
        debit: parseFloat(line.credit || 0),   // Credit becomes Debit
        credit: parseFloat(line.debit || 0)    // Debit becomes Credit
      }))

      const { data: createdRevLines, error: revLinesErr } = await supabase
        .from('journal_lines')
        .insert(reversedLines)
        .select(`
          id,
          transaction_id,
          account_id,
          debit,
          credit,
          accounts (
            id,
            code,
            name,
            type,
            sub_type
          )
        `)

      if (revLinesErr) {
        await supabase.from('transactions').delete().eq('id', revTx.id)
        return NextResponse.json({ error: `Gagal menyimpan baris jurnal pembalik: ${revLinesErr.message}` }, { status: 500 })
      }

      return NextResponse.json({
        message: 'Transaksi berhasil di-void dengan jurnal pembalik (reversal entry)',
        data: {
          ...revTx,
          journal_lines: createdRevLines
        }
      })
    }
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Server error' }, { status: 500 })
  }
}

function cleanDescriptionString(description?: string | null): string {
  if (!description) return ''
  let cleaned = description

  const historiIdx = cleaned.indexOf('[HISTORI_EDIT:')
  if (historiIdx !== -1) {
    const historiEndIdx = cleaned.lastIndexOf(']')
    if (historiEndIdx > historiIdx) {
      cleaned = cleaned.substring(0, historiIdx) + cleaned.substring(historiEndIdx + 1)
    } else {
      cleaned = cleaned.substring(0, historiIdx)
    }
  }

  cleaned = cleaned.replace(/\[Diedit:[^\]]+\]/g, '')
  return cleaned.trim()
}

function parseHistoryList(description?: string | null): any[] {
  if (!description) return []
  const historiIdx = description.indexOf('[HISTORI_EDIT:')
  if (historiIdx === -1) return []

  const historiEndIdx = description.lastIndexOf(']')
  if (historiEndIdx <= historiIdx) return []

  const historyStr = description.substring(historiIdx + '[HISTORI_EDIT:'.length, historiEndIdx).trim()
  if (!historyStr) return []

  try {
    return JSON.parse(historyStr)
  } catch {
    try {
      const decoded = Buffer.from(historyStr, 'base64').toString('utf-8')
      return JSON.parse(decoded)
    } catch {
      return []
    }
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const supabase = getSupabase()
    const { id } = await params
    const body = await request.json()

    const { date, description, journal_lines, order_id } = body

    if (!date) {
      return NextResponse.json({ error: 'date is required' }, { status: 400 })
    }
    if (!description || !description.trim()) {
      return NextResponse.json({ error: 'Keterangan/Deskripsi transaksi tidak boleh kosong' }, { status: 400 })
    }
    if (!Array.isArray(journal_lines) || journal_lines.length < 2) {
      return NextResponse.json({ error: 'Transaksi harus memiliki minimal 2 baris jurnal (Debet & Kredit)' }, { status: 400 })
    }

    // 1. Fetch full existing transaction BEFORE edit to capture snapshot
    const { data: existingTx, error: fetchErr } = await supabase
      .from('transactions')
      .select(`
        id,
        date,
        description,
        business_id,
        order_id,
        journal_lines (
          id,
          account_id,
          debit,
          credit,
          accounts (
            id,
            code,
            name,
            type
          )
        )
      `)
      .eq('id', id)
      .single()

    if (fetchErr || !existingTx) {
      return NextResponse.json({ error: 'Transaksi tidak ditemukan' }, { status: 404 })
    }

    if (existingTx.description?.includes('[VOID') || existingTx.description?.includes('REVERSAL')) {
      return NextResponse.json({ error: 'Transaksi yang sudah di-void tidak dapat diedit' }, { status: 400 })
    }

    // 2. Validate double-entry balance for new edits
    let totalDebit = 0
    let totalCredit = 0

    for (const line of journal_lines) {
      if (!line.account_id) {
        return NextResponse.json({ error: 'Setiap baris jurnal harus memilih akun' }, { status: 400 })
      }
      const d = Math.abs(parseFloat(line.debit || 0))
      const c = Math.abs(parseFloat(line.credit || 0))

      if (d === 0 && c === 0) {
        return NextResponse.json({ error: 'Baris jurnal harus mengisi nominal Debet atau Kredit' }, { status: 400 })
      }
      if (d > 0 && c > 0) {
        return NextResponse.json({ error: 'Satu baris jurnal tidak boleh memilih Debet dan Kredit sekaligus' }, { status: 400 })
      }

      totalDebit += d
      totalCredit += c
    }

    const diff = Math.abs(totalDebit - totalCredit)
    if (diff > 0.01) {
      return NextResponse.json({
        error: `Jurnal tidak seimbang! Total Debet (Rp ${totalDebit.toLocaleString('id-ID')}) ≠ Total Kredit (Rp ${totalCredit.toLocaleString('id-ID')}). Selisih: Rp ${diff.toLocaleString('id-ID')}`
      }, { status: 400 })
    }

    // 3. Parse existing history list & create snapshot of data before edit
    let historyList = parseHistoryList(existingTx.description)
    const cleanOldDesc = cleanDescriptionString(existingTx.description)

    const snapshot = {
      edited_at: new Date().toLocaleString('id-ID', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      }),
      prev_date: existingTx.date,
      prev_desc: cleanOldDesc,
      prev_lines: (existingTx.journal_lines || []).map((l: any) => ({
        code: l.accounts?.code || '',
        name: l.accounts?.name || 'Akun',
        debit: l.debit || 0,
        credit: l.credit || 0
      }))
    }

    historyList.push(snapshot)

    // 4. Construct final description with edit timestamp & Base64 history snapshot
    const cleanNewDesc = cleanDescriptionString(description)
    const editTimestamp = snapshot.edited_at
    const historyB64 = Buffer.from(JSON.stringify(historyList)).toString('base64')
    const finalDescription = `${cleanNewDesc} [Diedit: ${editTimestamp}] [HISTORI_EDIT:${historyB64}]`


    let txDate = new Date(date).toISOString()

    // 5. Update transaction header
    const { data: updatedTx, error: updateErr } = await supabase
      .from('transactions')
      .update({
        date: txDate,
        description: finalDescription,
        order_id: order_id || null
      })
      .eq('id', id)
      .select('*')
      .single()

    if (updateErr || !updatedTx) {
      return NextResponse.json({ error: `Gagal memperbarui transaksi: ${updateErr?.message}` }, { status: 500 })
    }

    // 6. Delete previous journal lines
    const { error: deleteLinesErr } = await supabase
      .from('journal_lines')
      .delete()
      .eq('transaction_id', id)

    if (deleteLinesErr) {
      return NextResponse.json({ error: `Gagal memperbarui rincian jurnal lama: ${deleteLinesErr.message}` }, { status: 500 })
    }

    // 7. Insert new journal lines
    const linesToInsert = journal_lines.map((line: any) => ({
      transaction_id: id,
      account_id: line.account_id,
      debit: Math.abs(parseFloat(line.debit || 0)),
      credit: Math.abs(parseFloat(line.credit || 0))
    }))

    const { data: createdLines, error: linesErr } = await supabase
      .from('journal_lines')
      .insert(linesToInsert)
      .select(`
        id,
        transaction_id,
        account_id,
        debit,
        credit,
        accounts (
          id,
          code,
          name,
          type,
          sub_type
        )
      `)

    if (linesErr) {
      return NextResponse.json({ error: `Gagal membuat baris jurnal baru: ${linesErr.message}` }, { status: 500 })
    }

    return NextResponse.json({
      message: 'Transaksi berhasil diperbarui dan versi data sebelumnya tersimpan di audit log',
      data: {
        ...updatedTx,
        journal_lines: createdLines
      }
    })

  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Server error' }, { status: 500 })
  }
}

