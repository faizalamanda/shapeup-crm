import { NextResponse } from 'next/server'
import { getApiContext } from '@/lib/apiContext'
import { ReturnError } from '@/lib/pos/returns/types'
import { isUuid } from '@/lib/utils'
import {
  createRmaService,
  getOrderRmaPreview,
  inspectRmaService,
  settleRmaService
} from '@/lib/rma/rmaService'
import { RMA_DISPOSITION_MAP, RmaDisposition, RmaSettlementMethod } from '@/lib/rma/types'

export async function GET(req: Request) {
  try {
    const ctx = await getApiContext({ req })
    if (ctx.error) return ctx.error
    const { businessId, supabaseAdmin } = ctx

    const url = new URL(req.url)
    const mode = url.searchParams.get('mode') || 'list'
    const orderId = url.searchParams.get('order_id')

    // Mode 1: Order/Invoice Returnable Preview (1 parallel RTT)
    if (mode === 'preview' && orderId) {
      if (!isUuid(orderId)) {
        return NextResponse.json({ error: 'order_id tidak valid' }, { status: 400 })
      }
      const preview = await getOrderRmaPreview(businessId, orderId, supabaseAdmin)
      return NextResponse.json({ success: true, ...preview })
    }

    // Safe Pagination & Sanitized Search (AGENTS.md Rule 10)
    const rawPage = parseInt(url.searchParams.get('page') || '1', 10)
    const page = Number.isFinite(rawPage) && rawPage > 0 ? rawPage : 1

    const rawLimit = parseInt(url.searchParams.get('limit') || '50', 10)
    const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(200, rawLimit) : 50
    const offset = (page - 1) * limit

    const rawSearch = url.searchParams.get('search') || ''
    const search = rawSearch.replace(/[,()]/g, ' ').trim()
    const stageFilter = url.searchParams.get('stage') || 'all'

    let query = supabaseAdmin
      .from('rma_requests')
      .select(
        `
        *,
        rma_items (*),
        orders (
          id,
          order_number,
          grand_total,
          amount_paid,
          payment_status,
          status,
          source_platform,
          customers (
            id,
            name,
            phone
          )
        )
      `,
        { count: 'exact' }
      )
      .eq('business_id', businessId)
      .order('created_at', { ascending: false })

    if (orderId && isUuid(orderId)) {
      query = query.eq('order_id', orderId)
    } else {
      if (stageFilter === 'awaiting_parcel') {
        query = query.in('fulfillment_stage', ['requested', 'approved'])
      } else if (stageFilter === 'needs_qc') {
        query = query.eq('fulfillment_stage', 'received_quarantine')
      } else if (stageFilter === 'ready_settle') {
        query = query
          .in('fulfillment_stage', ['received_quarantine', 'inspected'])
          .eq('settlement_stage', 'pending')
      } else if (stageFilter === 'settled') {
        query = query.eq('settlement_stage', 'settled')
      }

      if (search) {
        query = query.or(
          `rma_number.ilike.%${search}%,return_tracking_number.ilike.%${search}%,reason_note.ilike.%${search}%`
        )
      }

      query = query.range(offset, offset + limit - 1)
    }

    const [listRes, summaryRes] = await Promise.all([
      query,
      orderId
        ? Promise.resolve({ data: null, error: null })
        : supabaseAdmin
            .from('rma_requests')
            .select(
              'fulfillment_stage, settlement_stage, net_credit_amount, reason_code'
            )
            .eq('business_id', businessId)
            .limit(1000)
    ])

    if (listRes.error) {
      if (
        listRes.error.code === 'PGRST205' ||
        listRes.error.code === '42P01' ||
        listRes.error.message?.includes('does not exist')
      ) {
        return NextResponse.json({
          success: true,
          migrationPending: true,
          rmas: [],
          total: 0,
          page,
          limit,
          summary: {
            awaiting_parcel: 0,
            needs_qc: 0,
            ready_settle: 0,
            settled: 0,
            total_net_credit: 0,
            top_reason: null
          }
        })
      }
      return NextResponse.json({ error: listRes.error.message }, { status: 500 })
    }

    let awaitingParcel = 0
    let needsQc = 0
    let readySettle = 0
    let settled = 0
    let totalNetCredit = 0
    const reasonCounts: Record<string, number> = {}

    if (Array.isArray(summaryRes.data)) {
      for (const r of summaryRes.data) {
        if (r.fulfillment_stage === 'rejected' || r.fulfillment_stage === 'cancelled') continue
        if (r.fulfillment_stage === 'requested' || r.fulfillment_stage === 'approved') {
          awaitingParcel++
        }
        if (r.fulfillment_stage === 'received_quarantine') {
          needsQc++
        }
        if (
          (r.fulfillment_stage === 'received_quarantine' || r.fulfillment_stage === 'inspected') &&
          r.settlement_stage === 'pending'
        ) {
          readySettle++
        }
        if (r.settlement_stage === 'settled') {
          settled++
        }
        totalNetCredit += Number(r.net_credit_amount || 0)
        if (r.reason_code) {
          reasonCounts[r.reason_code] = (reasonCounts[r.reason_code] || 0) + 1
        }
      }
    }

    const topReasonEntry = Object.entries(reasonCounts).sort((a, b) => b[1] - a[1])[0]

    return NextResponse.json({
      success: true,
      rmas: listRes.data || [],
      total: listRes.count ?? (listRes.data || []).length,
      page,
      limit,
      summary: {
        awaiting_parcel: awaitingParcel,
        needs_qc: needsQc,
        ready_settle: readySettle,
        settled,
        total_net_credit: totalNetCredit,
        top_reason: topReasonEntry ? { code: topReasonEntry[0], count: topReasonEntry[1] } : null
      }
    })
  } catch (err: any) {
    if (err instanceof ReturnError) {
      return NextResponse.json({ error: err.message, code: err.code }, { status: err.status })
    }
    console.error('[API RMA GET]', err)
    return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500 })
  }
}

export async function POST(req: Request) {
  let body: any
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Payload JSON tidak valid atau kosong' }, { status: 400 })
  }

  try {
    const reqBizId = typeof body?.business_id === 'string' ? body.business_id : undefined
    const ctx = await getApiContext({ req, requestedBusinessId: reqBizId })
    if (ctx.error) return ctx.error
    const { user, businessId, supabase, supabaseAdmin } = ctx

    const actorName =
      user.user_metadata?.full_name ||
      user.user_metadata?.name ||
      user.email?.split('@')[0] ||
      'Admin'

    const action = String(body?.action || 'create')

    if (action === 'create') {
      const orderId = body?.order_id
      if (!isUuid(orderId)) {
        return NextResponse.json({ error: 'order_id wajib berupa UUID yang valid' }, { status: 400 })
      }

      const rawItems = Array.isArray(body?.items) ? body.items : []
      const res = await createRmaService(
        {
          businessId,
          actorId: user.id,
          actorName,
          orderId,
          items: rawItems.map((i: any) => ({
            ref: String(i.ref || ''),
            qty: Number(i.qty || 0),
            disposition: RMA_DISPOSITION_MAP[i.disposition]
              ? (i.disposition as Exclude<RmaDisposition, 'pending'>)
              : 'restock'
          })),
          reasonCode: String(body?.reason_code || 'defective'),
          reasonNote: body?.reason_note ? String(body.reason_note) : '',
          returnCourier: body?.return_courier ? String(body.return_courier) : '',
          returnTrackingNumber: body?.return_tracking_number
            ? String(body.return_tracking_number)
            : '',
          restockingFeeOverride:
            body?.restocking_fee !== undefined ? Number(body.restocking_fee) : undefined,
          idempotencyKey:
            typeof body?.idempotency_key === 'string' && body.idempotency_key.trim()
              ? body.idempotency_key.trim()
              : undefined,
          expressComplete: Boolean(body?.express_complete),
          settlementMethod: (body?.settlement_method as RmaSettlementMethod) || 'credit_memo',
          refundAccountId: isUuid(body?.refund_account_id) ? body.refund_account_id : null,
          refundMethodLabel: body?.refund_method_label ? String(body.refund_method_label) : null
        },
        supabase,
        supabaseAdmin
      )
      return NextResponse.json(res)
    }

    if (action === 'inspect') {
      const rmaId = body?.rma_id
      if (!isUuid(rmaId)) {
        return NextResponse.json({ error: 'rma_id wajib berupa UUID yang valid' }, { status: 400 })
      }

      const rawItems = Array.isArray(body?.items) ? body.items : []
      const res = await inspectRmaService(
        {
          businessId,
          actorId: user.id,
          rmaId,
          items: rawItems
            .filter((i: any) => isUuid(i.rma_item_id))
            .map((i: any) => ({
              rmaItemId: i.rma_item_id,
              disposition: RMA_DISPOSITION_MAP[i.disposition]
                ? (i.disposition as Exclude<RmaDisposition, 'pending'>)
                : 'restock'
            })),
          returnCourier: body?.return_courier ? String(body.return_courier) : undefined,
          returnTrackingNumber: body?.return_tracking_number
            ? String(body.return_tracking_number)
            : undefined
        },
        supabase,
        supabaseAdmin
      )
      return NextResponse.json(res)
    }

    if (action === 'settle') {
      const rmaId = body?.rma_id
      if (!isUuid(rmaId)) {
        return NextResponse.json({ error: 'rma_id wajib berupa UUID yang valid' }, { status: 400 })
      }

      const res = await settleRmaService(
        {
          businessId,
          actorId: user.id,
          actorName,
          rmaId,
          settlementMethod: (body?.settlement_method as RmaSettlementMethod) || 'credit_memo',
          refundAccountId: isUuid(body?.refund_account_id) ? body.refund_account_id : null,
          refundMethodLabel: body?.refund_method_label ? String(body.refund_method_label) : null,
          restockingFeeOverride:
            body?.restocking_fee !== undefined ? Number(body.restocking_fee) : undefined,
          shiftId: isUuid(body?.shift_id) ? body.shift_id : null
        },
        supabase,
        supabaseAdmin
      )
      return NextResponse.json(res)
    }

    if (action === 'reject') {
      const rmaId = body?.rma_id
      if (!isUuid(rmaId)) {
        return NextResponse.json({ error: 'rma_id wajib berupa UUID yang valid' }, { status: 400 })
      }
      const rejectNote = String(body?.reason_note || '').trim()
      if (rejectNote.length < 3) {
        return NextResponse.json({ error: 'Alasan pembatalan/penolakan RMA wajib diisi' }, { status: 400 })
      }

      const { data: existing } = await supabaseAdmin
        .from('rma_requests')
        .select('id, fulfillment_stage, settlement_stage, reason_note')
        .eq('id', rmaId)
        .eq('business_id', businessId)
        .single()

      if (!existing) {
        return NextResponse.json({ error: 'Dokumen RMA tidak ditemukan' }, { status: 404 })
      }
      if (existing.settlement_stage === 'settled' || existing.fulfillment_stage === 'inspected') {
        return NextResponse.json(
          { error: 'RMA yang sudah selesai QC atau diselesaikan keuangannya tidak dapat dibatalkan.' },
          { status: 400 }
        )
      }

      const { error: updErr } = await supabaseAdmin
        .from('rma_requests')
        .update({
          fulfillment_stage: 'cancelled',
          settlement_stage: 'not_applicable',
          reason_note: existing.reason_note
            ? `${existing.reason_note} | [BATAL: ${rejectNote}]`
            : `[BATAL: ${rejectNote}]`,
          updated_at: new Date().toISOString()
        })
        .eq('id', rmaId)
        .eq('business_id', businessId)

      if (updErr) {
        return NextResponse.json({ error: updErr.message }, { status: 500 })
      }

      return NextResponse.json({ success: true, message: 'Tiket RMA berhasil dibatalkan.' })
    }

    return NextResponse.json({ error: 'Action tidak dikenali' }, { status: 400 })
  } catch (err: any) {
    if (err instanceof ReturnError) {
      return NextResponse.json({ error: err.message, code: err.code }, { status: err.status })
    }
    console.error('[API RMA POST]', err)
    return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500 })
  }
}

