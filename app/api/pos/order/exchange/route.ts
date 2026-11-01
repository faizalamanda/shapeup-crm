import { getApiContext } from '@/lib/apiContext'
import { executeReturnService } from '@/lib/pos/returns/returnsService'
import { isUuid } from '@/lib/pos/returns/engine'
import { ReturnDisposition, ReturnError, ReturnRequestItem } from '@/lib/pos/returns/types'
import { NextResponse } from 'next/server'

// POST /api/pos/order/exchange - Atomic Exchange (Tukar Barang / Return & Replace)
// Migrated onto the unified ShapeUp POS Returns Engine
export async function POST(req: Request) {
  try {
    const ctx = await getApiContext()
    if (ctx.error) return ctx.error
    const { user, businessId, supabase, supabaseAdmin } = ctx

    const body = await req.json().catch(() => null)
    if (!body) {
      return NextResponse.json({ error: 'Body permintaan tidak valid' }, { status: 400 })
    }

    const {
      order_id,
      return_items = [], // [{ product_id, variant_id, quantity, price, name, condition: 'good' | 'damaged' }]
      new_items = [],    // [{ id, variantId, quantity, price, name }]
      payment_method = 'cash',
      payment_method_account_id = null,
      cash_received = 0,
      change_amount = 0,
      notes = ''
    } = body

    if (!isUuid(order_id)) {
      return NextResponse.json({ error: 'order_id tidak valid' }, { status: 400 })
    }

    if (!Array.isArray(return_items) || return_items.length === 0) {
      return NextResponse.json({ error: 'Minimal 1 produk harus dipilih untuk ditukar/dikembalikan' }, { status: 400 })
    }

    if (!Array.isArray(new_items) || new_items.length === 0) {
      return NextResponse.json({ error: 'Minimal 1 produk baru pengganti harus dipilih' }, { status: 400 })
    }

    // Resolve user role in active business
    const { data: staffRow } = await supabase
      .from('business_staff')
      .select('role')
      .eq('business_id', businessId)
      .eq('profile_id', user.id)
      .maybeSingle()

    const role = staffRow?.role || 'owner'
    const isStaff = Boolean(staffRow)

    const cashierName =
      user.user_metadata?.full_name ||
      user.user_metadata?.name ||
      user.email?.split('@')[0] ||
      'Kasir'

    // Map return items
    const mappedItems: ReturnRequestItem[] = return_items.map((ri: any) => ({
      ref: String(ri.ref || ri.order_item_ref || ri.id || ri.product_id),
      qty: Math.abs(Number(ri.quantity || 1)),
      disposition: (ri.condition === 'damaged' ? 'quarantine' : 'restock') as ReturnDisposition
    }))

    // Map replacement items
    const mappedExchange = new_items.map((ni: any) => ({
      productId: ni.id || ni.product_id,
      variantId: ni.variantId || ni.variant_id || null,
      name: ni.name || 'Produk Pengganti',
      variantName: ni.variantName || ni.variant_name || null,
      quantity: Math.abs(Number(ni.quantity || 1)),
      unitPrice: Math.round(Number(ni.price || 0))
    }))

    const execRes = await executeReturnService(
      {
        businessId,
        orderId: order_id,
        items: mappedItems,
        exchangeItems: mappedExchange,
        returnMethod: payment_method === 'cash' ? 'cash' : 'original',
        cashierId: user.id,
        cashierName,
        reasonCode: 'other',
        reasonNote: notes || 'Tukar Barang POS',
        paymentIn: {
          method: payment_method,
          accountId: payment_method_account_id,
          amount: 0,
          cashReceived: Number(cash_received || 0),
          changeAmount: Number(change_amount || 0)
        },
        isStaff,
        role
      },
      supabase,
      supabaseAdmin
    )

    return NextResponse.json({
      success: true,
      message: execRes.message,
      returnId: execRes.returnId,
      returnNumber: execRes.returnNumber
    })
  } catch (err: any) {
    if (err instanceof ReturnError) {
      return NextResponse.json({ error: err.message, code: err.code }, { status: err.status })
    }
    console.error('POS Exchange API Error:', err)
    return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500 })
  }
}
