import { NextResponse } from 'next/server'
import { getApiContext } from '@/lib/apiContext'
import { postJournalTransaction } from '@/lib/journalHelper'
import { ensureExpenseAccounts } from '@/lib/expenseLedger'
import { isUuid } from '@/lib/utils'

export async function GET(request: Request) {
  const { businessId, supabase, error } = await getApiContext()
  if (error) return error

  // 1. Database-Driven View: Single Source of Truth langsung dari PostgreSQL (Zero in-app logic)
  const { data: viewReturns, error: viewErr } = await supabase
    .from('v_quarantine_returns')
    .select('*')
    .eq('business_id', businessId)
    .order('return_date', { ascending: false })

  if (!viewErr && viewReturns) {
    return NextResponse.json(viewReturns)
  }

  // 2. Graceful Fallback jika SQL View v_quarantine_returns belum dieksekusi di Supabase SQL Editor
  let { data: allQuarantineMoves, error: fetchErr } = await supabase
    .from('stock_moves')
    .select(`
      id, reference, qty, type, created_at, source_type, source_id, product_id,
      product:products(id, name, sku, unit, cost_price)
    `)
    .eq('business_id', businessId)
    .or('bucket.eq.quarantine,and(type.eq.receipt,source_type.eq.order)')
    .order('created_at', { ascending: false })

  if (fetchErr) {
    return NextResponse.json({ error: fetchErr.message }, { status: 500 })
  }

  const receipts = (allQuarantineMoves || []).filter(m => m.type === 'receipt')
  const releases = (allQuarantineMoves || []).filter(m => m.type !== 'receipt')

  const releaseMap = new Map<string, any>()
  releases.forEach(r => {
    if (r.source_id && !releaseMap.has(r.source_id)) {
      releaseMap.set(r.source_id, r)
    }
  })

  const mappedFallback = receipts.map((m: any) => {
    const rel = releaseMap.get(m.id)
    let status = 'pending'
    let statusLabel = 'Menunggu Verifikasi'

    if (rel) {
      if (rel.source_type === 'order_return_release') {
        status = 'received'
        statusLabel = 'Diterima di Gudang'
      } else if (rel.source_type === 'order_return_loss') {
        status = 'lost'
        statusLabel = 'Hilang di Ekspedisi'
      }
    }

    return {
      move_id: m.id,
      business_id: businessId,
      product_id: m.product_id,
      reference: m.reference,
      return_qty: Number(m.qty || 0),
      return_date: m.created_at,
      product_name: m.product?.name || 'Produk',
      product_sku: m.product?.sku || null,
      product_unit: m.product?.unit || 'Pcs',
      cost_price: Number(m.product?.cost_price || 0),
      status,
      status_label: statusLabel,
      resolved_at: rel ? rel.created_at : null,
      resolution_reference: rel ? rel.reference : null,
      is_actionable: !rel
    }
  })

  return NextResponse.json(mappedFallback)
}

export async function POST(request: Request) {
  const { businessId, supabase, error } = await getApiContext()
  if (error) return error

  // Safe Vercel Body Parse (Mencegah SyntaxError jika payload kosong atau rusak)
  let body: any
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Payload JSON tidak valid atau kosong' }, { status: 400 })
  }

  const { moveId, action } = body || {}

  // Strict UUID Input Sanitization (PostgreSQL Zero-Tolerance Rule)
  if (!isUuid(moveId)) {
    return NextResponse.json({ error: 'moveId harus berupa format UUID yang valid' }, { status: 400 })
  }

  if (action !== 'terima' && action !== 'hilang') {
    return NextResponse.json({ error: 'action harus bernilai "terima" atau "hilang"' }, { status: 400 })
  }

  // Idempotency Guard: Pastikan move belum pernah diselesaikan
  const { data: existingRelease } = await supabase
    .from('stock_moves')
    .select('id')
    .eq('source_id', moveId)
    .in('type', ['transfer', 'adjustment'])
    .maybeSingle()

  if (existingRelease) {
    return NextResponse.json({ error: 'Barang retur ini sudah pernah diproses sebelumnya.' }, { status: 400 })
  }

  // 1. Ambil detail move karantina asal (Tenant-isolated via business_id)
  const { data: move, error: moveErr } = await supabase
    .from('stock_moves')
    .select('*, product:products(id, name, cost_price)')
    .eq('id', moveId)
    .eq('business_id', businessId)
    .single()

  if (moveErr || !move) {
    return NextResponse.json({ error: 'Mutasi tidak ditemukan atau tidak memiliki hak akses' }, { status: 404 })
  }

  const nowIso = new Date().toISOString()
  const sourceRefId = isUuid(move.source_id) ? move.source_id : move.id

  if (action === 'terima') {
    // 2a. Aksi TERIMA (Pure Append-Only Event Sourcing - ZERO UPDATE pada data lama):
    // 1. Catat pengeluaran dari Karantina (Offsetting move: -qty di karantina)
    const releaseRow: Record<string, any> = {
      business_id: businessId,
      product_id: move.product_id,
      reference: `${move.reference} (Keluar Karantina)`,
      bucket: 'quarantine',
      type: 'transfer',
      source_type: 'order_return_release',
      source_id: move.id,
      qty: Number(move.qty || 1),
      unit_cost: Number(move.unit_cost || move.product?.cost_price || 0),
      status: 'done',
      created_at: nowIso
    }

    let { error: outErr } = await supabase.from('stock_moves').insert(releaseRow)
    if (outErr && outErr.message?.includes('bucket')) {
      delete releaseRow.bucket
      const retry = await supabase.from('stock_moves').insert(releaseRow)
      outErr = retry.error
    }
    if (outErr) return NextResponse.json({ error: outErr.message }, { status: 500 })

    // 2. Catat penerimaan fisik ke Gudang Utama (Arrival move: +qty di rak Gudang Utama)
    const inRow: Record<string, any> = {
      business_id: businessId,
      product_id: move.product_id,
      reference: `${move.reference} (Terima Gudang)`,
      bucket: 'main',
      type: 'receipt',
      source_type: 'order_return_receive',
      source_id: sourceRefId,
      qty: Number(move.qty || 1),
      unit_cost: Number(move.unit_cost || move.product?.cost_price || 0),
      status: 'done',
      created_at: nowIso
    }

    let { error: inErr } = await supabase.from('stock_moves').insert(inRow)
    if (inErr && inErr.message?.includes('bucket')) {
      delete inRow.bucket
      const retry = await supabase.from('stock_moves').insert(inRow)
      inErr = retry.error
    }
    if (inErr) return NextResponse.json({ error: inErr.message }, { status: 500 })

    return NextResponse.json({ message: 'Barang berhasil diterima ke gudang utama (mutasi penyeimbang dicatat)' })

  } else if (action === 'hilang') {
    // 2b. Aksi HILANG (Pure Append-Only Event Sourcing - ZERO UPDATE pada data lama):
    // 1. Catat penghapusan dari Karantina (Scrap/Loss move: -qty di karantina)
    const lossRow: Record<string, any> = {
      business_id: businessId,
      product_id: move.product_id,
      reference: `${move.reference} (Hilang Ekspedisi)`,
      bucket: 'quarantine',
      type: 'adjustment',
      source_type: 'order_return_loss',
      source_id: move.id,
      qty: Number(move.qty || 1),
      unit_cost: Number(move.unit_cost || move.product?.cost_price || 0),
      status: 'done',
      created_at: nowIso
    }

    let { error: outErr } = await supabase.from('stock_moves').insert(lossRow)
    if (outErr && outErr.message?.includes('bucket')) {
      delete lossRow.bucket
      const retry = await supabase.from('stock_moves').insert(lossRow)
      outErr = retry.error
    }
    if (outErr) return NextResponse.json({ error: outErr.message }, { status: 500 })

    // 2. Buat Jurnal Finansial Kehilangan Ekspedisi pada hari ini
    const accountMap = await ensureExpenseAccounts(businessId, supabase)
    const lossAccountId = accountMap['502000']
    const inventoryAccountId = accountMap['102000']

    if (lossAccountId && inventoryAccountId) {
      const hppValue = Number(move.qty || 1) * Number(move.product?.cost_price || move.unit_cost || 0)
      
      if (hppValue > 0) {
        const journalLines = [
          { account_id: lossAccountId, debit: hppValue, credit: 0 },
          { account_id: inventoryAccountId, debit: 0, credit: hppValue }
        ]

        const validOrderId = (move.source_type === 'order' && isUuid(move.source_id)) ? move.source_id : null

        await postJournalTransaction(
          businessId,
          validOrderId,
          nowIso,
          `Barang Hilang Ekspedisi: ${move.product?.name || move.reference} (${move.reference})`,
          journalLines,
          supabase,
          true
        )
      }
    }

    return NextResponse.json({ message: 'Barang ditandai hilang dan jurnal kerugian telah dicatat' })
  }

  return NextResponse.json({ error: 'Aksi tidak valid' }, { status: 400 })
}

