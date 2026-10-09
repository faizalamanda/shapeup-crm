import { NextResponse } from 'next/server'
import { getApiContext } from '@/lib/apiContext'
import { syncOrderToLedger } from '@/lib/orderLedger'

export async function POST(
  request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const { supabase, authError } = await getApiContext()
    if (authError || !supabase) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const orderId = params.id
    if (!orderId) {
      return NextResponse.json({ error: 'Missing invoice ID' }, { status: 400 })
    }

    const { success, message } = await syncOrderToLedger(orderId, supabase)

    if (!success) {
      return NextResponse.json({ error: message }, { status: 500 })
    }

    return NextResponse.json({ success: true, message: 'Audit stok selesai' })
  } catch (error: any) {
    console.error('Audit stock error:', error)
    return NextResponse.json(
      { error: error.message || 'Terjadi kesalahan saat audit stok' },
      { status: 500 }
    )
  }
}
