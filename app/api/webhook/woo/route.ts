import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'

// Inisialisasi Supabase Admin (Gunakan Service Role Key agar bebas akses)
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function POST(req: Request) {
  try {
    const data = await req.json()
    const orderId = data.id.toString()

    console.log(`Processing Webhook for Order #${orderId}`)

    // 1. EKSTRAKSI BIAYA & DISKON (KRUSIAL)
    // Hitung Biaya Lain-lain (COD / Admin Fee) dari fee_lines
    const other_fees = data.fee_lines 
      ? data.fee_lines.reduce((acc: number, fee: any) => acc + parseFloat(fee.total || 0), 0) 
      : 0

    // Hitung Subtotal (Harga barang sebelum diskon/ongkir)
    const subtotal = data.line_items 
      ? data.line_items.reduce((acc: number, item: any) => acc + parseFloat(item.subtotal || 0), 0) 
      : 0

    const discount_amount = parseFloat(data.discount_total || 0)
    const shipping_cost = parseFloat(data.shipping_total || 0)
    const grand_total = parseFloat(data.total || 0)
    const total_qty = data.line_items 
      ? data.line_items.reduce((acc: number, item: any) => acc + (item.quantity || 0), 0) 
      : 0

    // 2. MAPPING DATA UNTUK TABEL ORDERS
    const orderPayload = {
      order_number: data.number,
      business_id: data.meta_data?.find((m: any) => m.key === '_business_id')?.value || '1284a75a-096d-4766-9e6b-0720be670be2', // Ganti dengan ID bisnis Toko Alamanda Mas
      status: data.status,
      order_date: data.date_created,
      subtotal: subtotal,
      discount_amount: discount_amount,
      shipping_cost: shipping_cost,
      other_fees: other_fees, // Biaya COD/Admin masuk sini
      grand_total: grand_total,
      total_qty: total_qty,
      payment_method: data.payment_method_title || data.payment_method,
      items_json: data.line_items,
      raw_source_data: data, // Untuk backup alamat detail
      customer_phone: data.billing?.phone?.replace(/\D/g, '') || ''
    }

    // 3. UPSERT KE TABEL ORDERS
    const { data: upsertedOrder, error: orderError } = await supabase
      .from('orders')
      .upsert(orderPayload, { onConflict: 'order_number' })
      .select()
      .single()

    if (orderError) throw orderError

    // 4. UPDATE / INSERT KE CUSTOMER_METRICS (LTV & Data Pelanggan)
    if (orderPayload.customer_phone) {
      const { data: existingCust } = await supabase
        .from('customer_metrics')
        .select('id, total_spend, total_orders')
        .eq('phone', orderPayload.customer_phone)
        .single()

      if (existingCust) {
        // Update LTV jika order statusnya 'completed'
        const isCompleted = data.status === 'completed'
        await supabase
          .from('customer_metrics')
          .update({
            name: `${data.billing?.first_name} ${data.billing?.last_name}`.trim(),
            total_spend: isCompleted ? (existingCust.total_spend + grand_total) : existingCust.total_spend,
            total_orders: existingCust.total_orders + 1,
            last_order_date: new Date()
          })
          .eq('phone', orderPayload.customer_phone)
      } else {
        // Insert pelanggan baru
        await supabase
          .from('customer_metrics')
          .insert({
            phone: orderPayload.customer_phone,
            name: `${data.billing?.first_name} ${data.billing?.last_name}`.trim(),
            total_spend: data.status === 'completed' ? grand_total : 0,
            total_orders: 1,
            last_order_date: new Date(),
            business_id: orderPayload.business_id
          })
      }
    }

    return NextResponse.json({ message: 'Webhook Processed Successfully', id: orderId }, { status: 200 })

  } catch (err: any) {
    console.error('Webhook Error:', err.message)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}