import { NextResponse } from 'next/server'
import { getApiContext } from '@/lib/apiContext'
import { getOrCreateDefaultAccounts } from '@/lib/accountHelper'
import { postJournalTransaction } from '@/lib/journalHelper'
import { isUuid } from '@/lib/utils'

export async function GET(request: Request) {
  const { businessId, supabase, error } = await getApiContext({ req: request })
  if (error) return error

  const url = new URL(request.url)
  const rawLimit = parseInt(url.searchParams.get('limit') || '500', 10)
  const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(1000, rawLimit) : 500

  // 1. Database-Driven View: Single Source of Truth langsung dari PostgreSQL (Zero in-app logic)
  const { data: viewReturns, error: viewErr } = await supabase
    .from('v_quarantine_returns')
    .select('*')
    .eq('business_id', businessId)
    .order('return_date', { ascending: false })
    .limit(limit)

  if (!viewErr && viewReturns) {
    return NextResponse.json(viewReturns)
  }

  // 2. Graceful Fallback jika SQL View v_quarantine_returns belum dieksekusi di Supabase
  const { data: allQuarantineMoves, error: fetchErr } = await supabase
    .from('stock_moves')
    .select(`
      id, reference, qty, unit_cost, type, created_at, source_type, source_id, product_id, variant_id,
      product:products(id, name, sku, unit, cost_price)
    `)
    .eq('business_id', businessId)
    .or('bucket.eq.quarantine,and(type.eq.receipt,source_type.eq.order)')
    .order('created_at', { ascending: false })
    .limit(limit)

  if (fetchErr) {
    return NextResponse.json({ error: fetchErr.message }, { status: 500 })
  }

  const receipts = (allQuarantineMoves || []).filter((m) => m.type === 'receipt')
  const releases = (allQuarantineMoves || []).filter((m) => m.type !== 'receipt')

  const releaseMap = new Map<string, any>()
  releases.forEach((r) => {
    if (r.source_id && !releaseMap.has(r.source_id)) {
      releaseMap.set(r.source_id, r)
    }
  })

  const mappedFallback = receipts.map((m: any) => {
    const rel = releaseMap.get(m.id)
    let status = 'pending'
    let statusLabel = 'Menunggu Verifikasi'

    if (rel) {
      if (rel.source_type === 'order_return_release' || rel.source_type === 'rma_release') {
        status = 'received'
        statusLabel = 'Diterima di Gudang'
      } else if (rel.source_type === 'order_return_rtv' || rel.source_type === 'rma_rtv') {
        status = 'rtv'
        statusLabel = 'Diklaim ke Supplier'
      } else if (rel.source_type === 'order_return_loss' || rel.source_type === 'rma_loss') {
        status = 'lost'
        statusLabel = 'Hilang / Rusak'
      }
    }

    return {
      move_id: m.id,
      business_id: businessId,
      product_id: m.product_id,
      variant_id: m.variant_id || null,
      reference: m.reference,
      return_qty: Number(m.qty || 0),
      return_date: m.created_at,
      product_name: m.product?.name || 'Produk',
      product_sku: m.product?.sku || null,
      product_unit: m.product?.unit || 'Pcs',
      cost_price: Number(m.unit_cost || m.product?.cost_price || 0),
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
  let body: any
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Payload JSON tidak valid atau kosong' }, { status: 400 })
  }

  const reqBizId = typeof body?.business_id === 'string' ? body.business_id : undefined
  const { user, businessId, supabase, supabaseAdmin, error } = await getApiContext({
    req: request,
    requestedBusinessId: reqBizId
  })
  if (error) return error

  const admin = supabaseAdmin || supabase
  const { moveId, moveIds, action } = body || {}

  // Normalize single moveId or bulk moveIds[] with strict UUID validation (AGENTS.md Rule 9)
  const targetMoveIds: string[] = Array.isArray(moveIds)
    ? moveIds.filter(isUuid)
    : isUuid(moveId)
    ? [moveId]
    : []

  if (targetMoveIds.length === 0) {
    return NextResponse.json(
      { error: 'Pilih minimal 1 item karantina dengan UUID yang valid' },
      { status: 400 }
    )
  }

  if (action !== 'terima' && action !== 'hilang' && action !== 'rtv') {
    return NextResponse.json(
      { error: 'action harus bernilai "terima", "hilang", atau "rtv"' },
      { status: 400 }
    )
  }

  const accountMap = await getOrCreateDefaultAccounts(businessId, admin)

  // 1. Fast Path: Execute via 1-Roundtrip Semi-Modular ACID RPC (~50ms even for 50 items!)
  const { data: rpcRes, error: rpcErr } = await admin.rpc('process_quarantine_batch_v1', {
    payload: {
      business_id: businessId,
      actor_id: user.id,
      action,
      move_ids: targetMoveIds,
      inventory_account_id: accountMap['102000'] || null,
      quarantine_account_id: accountMap['102100'] || accountMap['102000'] || null,
      loss_account_id: accountMap['502100'] || accountMap['502000'] || null,
      payable_account_id: accountMap['201000'] || null
    }
  })

  if (!rpcErr && rpcRes?.success) {
    const count = Number(rpcRes.processed_count || 0)
    if (count === 0) {
      return NextResponse.json(
        { error: 'Barang retur sudah pernah diproses sebelumnya atau tidak ditemukan.' },
        { status: 400 }
      )
    }

    const msgMap: Record<string, string> = {
      terima: `${count} item retur berhasil diterima ke rak Gudang Utama (termasuk sinkronisasi varian).`,
      hilang: `${count} item ditandai rusak/hilang dan jurnal kerugian telah diposting.`,
      rtv: `${count} item berhasil dialihkan ke Klaim Supplier (RTV) dan memotong saldo karantina.`
    }
    return NextResponse.json({
      success: true,
      processedCount: count,
      message: msgMap[action]
    })
  }

  if (rpcErr && rpcErr.code !== 'PGRST202') {
    return NextResponse.json({ error: rpcErr.message }, { status: 500 })
  }

  // 2. Resilient Node Fallback (if SQL RPC migration has not been applied yet)
  const { data: moves, error: movesErr } = await admin
    .from('stock_moves')
    .select('*, product:products(id, name, cost_price)')
    .in('id', targetMoveIds)
    .eq('business_id', businessId)

  if (movesErr || !moves || moves.length === 0) {
    return NextResponse.json({ error: 'Mutasi karantina tidak ditemukan' }, { status: 404 })
  }

  const { data: existingRels } = await admin
    .from('stock_moves')
    .select('source_id')
    .in('source_id', targetMoveIds)
    .in('type', ['transfer', 'adjustment', 'delivery'])
    .eq('status', 'done')

  const resolvedSet = new Set((existingRels || []).map((r: any) => r.source_id))
  const actionableMoves = moves.filter((m: any) => !resolvedSet.has(m.id))

  if (actionableMoves.length === 0) {
    return NextResponse.json(
      { error: 'Barang retur ini sudah pernah diproses sebelumnya.' },
      { status: 400 }
    )
  }

  const nowIso = new Date().toISOString()
  const dummyOrigin = '00000000-0000-0000-0000-000000000000'
  const outRows: Record<string, any>[] = []
  const inRows: Record<string, any>[] = []
  let valFromQuarantine = 0
  let valFromMain = 0
  const hasSeparateQuarantineAcc =
    Boolean(accountMap['102100']) &&
    Boolean(accountMap['102000']) &&
    accountMap['102100'] !== accountMap['102000']

  for (const move of actionableMoves) {
    const unitCost = Number(move.unit_cost || move.product?.cost_price || 0)
    const qty = Number(move.qty || 1)
    const sourceRefId = isUuid(move.source_id) ? move.source_id : move.id
    const isQuarantineGlMove =
      hasSeparateQuarantineAcc &&
      ['rma_receipt', 'pos_return', 'order_return'].includes(move.source_type)

    if (action === 'terima') {
      const releaseRow: Record<string, any> = {
        business_id: businessId,
        product_id: move.product_id,
        reference: `${move.reference} (Keluar Karantina)`,
        bucket: 'quarantine',
        type: 'transfer',
        source_type: 'order_return_release',
        source_id: move.id,
        qty,
        unit_cost: unitCost,
        status: 'done',
        created_at: nowIso
      }
      if (isUuid(move.variant_id)) releaseRow.variant_id = move.variant_id
      outRows.push(releaseRow)

      const arrivalRow: Record<string, any> = {
        business_id: businessId,
        product_id: move.product_id,
        reference: `${move.reference} (Terima Gudang)`,
        bucket: 'main',
        type: 'receipt',
        source_type: 'order_return_receive',
        source_id: sourceRefId,
        qty,
        unit_cost: unitCost,
        status: 'done',
        created_at: nowIso
      }
      if (isUuid(move.variant_id)) arrivalRow.variant_id = move.variant_id
      inRows.push(arrivalRow)

      if (isQuarantineGlMove) {
        valFromQuarantine += Math.round(qty * unitCost)
      }
    } else if (action === 'hilang') {
      const lossRow: Record<string, any> = {
        business_id: businessId,
        product_id: move.product_id,
        reference: `${move.reference} (Hilang/Rusak)`,
        bucket: 'quarantine',
        type: 'adjustment',
        source_type: 'order_return_loss',
        source_id: move.id,
        origin_location_id: dummyOrigin,
        qty,
        unit_cost: unitCost,
        status: 'done',
        created_at: nowIso
      }
      if (isUuid(move.variant_id)) lossRow.variant_id = move.variant_id
      outRows.push(lossRow)
      if (isQuarantineGlMove) valFromQuarantine += Math.round(qty * unitCost)
      else valFromMain += Math.round(qty * unitCost)
    } else if (action === 'rtv') {
      const rtvRow: Record<string, any> = {
        business_id: businessId,
        product_id: move.product_id,
        reference: `${move.reference} (Klaim Supplier)`,
        bucket: 'quarantine',
        type: 'delivery',
        source_type: 'order_return_rtv',
        source_id: move.id,
        qty,
        unit_cost: unitCost,
        status: 'done',
        created_at: nowIso
      }
      if (isUuid(move.variant_id)) rtvRow.variant_id = move.variant_id
      outRows.push(rtvRow)
      if (isQuarantineGlMove) valFromQuarantine += Math.round(qty * unitCost)
      else valFromMain += Math.round(qty * unitCost)
    }
  }

  if (outRows.length > 0) {
    const { error: outErr } = await admin.from('stock_moves').insert(outRows)
    if (outErr) return NextResponse.json({ error: outErr.message }, { status: 500 })
  }

  if (inRows.length > 0) {
    const { error: inErr } = await admin.from('stock_moves').insert(inRows)
    if (inErr) return NextResponse.json({ error: inErr.message }, { status: 500 })
  }

  const totalJournalValue = valFromQuarantine + valFromMain
  if (totalJournalValue > 0) {
    if (action === 'terima' && valFromQuarantine > 0 && hasSeparateQuarantineAcc) {
      await postJournalTransaction(
        businessId,
        null,
        nowIso,
        `Reklasifikasi Retur Karantina ke Gudang Utama (${actionableMoves.length} item)`,
        [
          { account_id: accountMap['102000'], debit: valFromQuarantine, credit: 0 },
          { account_id: accountMap['102100'], debit: 0, credit: valFromQuarantine }
        ],
        admin,
        true
      )
    } else if (action === 'hilang' || action === 'rtv') {
      const debitAcc =
        action === 'rtv'
          ? accountMap['201000']
          : accountMap['502100'] || accountMap['502000']

      if (debitAcc) {
        const jLines: Array<{ account_id: string; debit: number; credit: number }> = [
          { account_id: debitAcc, debit: totalJournalValue, credit: 0 }
        ]
        if (valFromQuarantine > 0 && accountMap['102100']) {
          jLines.push({ account_id: accountMap['102100'], debit: 0, credit: valFromQuarantine })
        }
        if (valFromMain > 0 && accountMap['102000']) {
          jLines.push({ account_id: accountMap['102000'], debit: 0, credit: valFromMain })
        }

        const desc =
          action === 'rtv'
            ? `Klaim Retur Cacat Pabrik ke Supplier / RTV (${actionableMoves.length} item)`
            : `Kerugian Retur / Barang Rusak Karantina (${actionableMoves.length} item)`

        await postJournalTransaction(businessId, null, nowIso, desc, jLines, admin, true)
      }
    }
  }

  return NextResponse.json({
    success: true,
    processedCount: actionableMoves.length,
    message: `${actionableMoves.length} item retur berhasil diproses.`
  })
}
