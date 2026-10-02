import { NextResponse } from 'next/server'
import { getApiContext } from '@/lib/apiContext'
import { postJournalTransaction } from '@/lib/journalHelper'

export async function GET(request: Request) {
  const { businessId, supabase, error } = await getApiContext()
  if (error) return error

  // Ambil mutasi stok (tipe: receipt, status: pending) yang berasal dari order
  const { data: pendingMoves, error: fetchErr } = await supabase
    .from('stock_moves')
    .select(`
      id, reference, qty, created_at,
      product:products(id, name, sku, stock_quantity, cost_price)
    `)
    .eq('business_id', businessId)
    .eq('status', 'pending')
    .eq('type', 'receipt')
    .eq('source_type', 'order')
    .order('created_at', { ascending: false })

  if (fetchErr) {
    return NextResponse.json({ error: fetchErr.message }, { status: 500 })
  }

  return NextResponse.json(pendingMoves)
}

export async function POST(request: Request) {
  const { businessId, supabase, error } = await getApiContext()
  if (error) return error

  const body = await request.json()
  const { moveId, action } = body // action: 'terima' | 'hilang'

  if (!moveId || !action) {
    return NextResponse.json({ error: 'moveId dan action wajib diisi' }, { status: 400 })
  }

  // 1. Ambil detail move
  const { data: move, error: moveErr } = await supabase
    .from('stock_moves')
    .select('*, product:products(id, name, cost_price)')
    .eq('id', moveId)
    .eq('business_id', businessId)
    .single()

  if (moveErr || !move) {
    return NextResponse.json({ error: 'Mutasi tidak ditemukan' }, { status: 404 })
  }

  if (move.status !== 'pending') {
    return NextResponse.json({ error: 'Mutasi ini sudah diproses sebelumnya' }, { status: 400 })
  }

  if (action === 'terima') {
    // 2a. Aksi TERIMA: Cukup ubah status jadi 'done' (Trigger otomatis akan menambah stok)
    const { error: updErr } = await supabase
      .from('stock_moves')
      .update({ status: 'done', updated_at: new Date().toISOString() })
      .eq('id', moveId)

    if (updErr) return NextResponse.json({ error: updErr.message }, { status: 500 })

    return NextResponse.json({ message: 'Barang berhasil diterima ke gudang utama' })

  } else if (action === 'hilang') {
    // 2b. Aksi HILANG: Batalkan mutasi (tidak tambah stok), dan buat Jurnal Kehilangan (502000)
    
    // - Batalkan stok move
    const { error: updErr } = await supabase
      .from('stock_moves')
      .update({ status: 'cancelled', updated_at: new Date().toISOString() })
      .eq('id', moveId)

    if (updErr) return NextResponse.json({ error: updErr.message }, { status: 500 })

    // - Ambil Chart of Accounts
    const { data: accounts } = await supabase.from('accounts').select('id, code').eq('business_id', businessId)
    const accountMap: Record<string, string> = {}
    if (accounts) {
      accounts.forEach(a => accountMap[a.code] = a.id)
    }

    const lossAccountId = accountMap['502000']
    const inventoryAccountId = accountMap['102000']

    if (lossAccountId && inventoryAccountId) {
      const hppValue = Number(move.qty) * Number(move.product?.cost_price || move.unit_cost || 0)
      
      if (hppValue > 0) {
        const journalLines = [
          { account_id: lossAccountId, debit: hppValue, credit: 0 },
          { account_id: inventoryAccountId, debit: 0, credit: hppValue }
        ]

        await postJournalTransaction(
          businessId,
          move.source_id || move.id,
          new Date().toISOString(),
          `Barang Hilang Ekspedisi: ${move.product?.name} (${move.reference})`,
          journalLines,
          supabase
        )
      }
    }

    return NextResponse.json({ message: 'Barang ditandai hilang dan jurnal kerugian telah dicatat' })
  }

  return NextResponse.json({ error: 'Aksi tidak valid' }, { status: 400 })
}
