import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function POST(req: Request) {
  try {
    const { searchParams } = new URL(req.url)
    const businessId = searchParams.get('bid')

    if (!businessId) {
      return NextResponse.json({ error: 'Missing Business ID' }, { status: 400 })
    }

    // --- PROTEKSI JSON ---
    let woo;
    const contentType = req.headers.get('content-type') || ''
    
    if (contentType.includes('application/json')) {
      woo = await req.json()
    } else {
      // Jika WooCommerce mengirim format teks/form, kita ambil teksnya saja
      const text = await req.text()
      console.log('Terima kiriman non-JSON:', text)
      
      // Jika isinya cuma webhook_id (Ping test), kita kasih respon OK biar Woo senang
      if (text.includes('webhook_id')) {
        return NextResponse.json({ message: 'Ping received' }, { status: 200 })
      }
      return NextResponse.json({ error: 'Format harus JSON' }, { status: 400 })
    }

    // --- LANJUT LOGIKA UPSERT SEPERTI BIASA ---
    // Pastikan ini adalah data order (punya id)
    if (!woo.id) {
      return NextResponse.json({ message: 'Not an order data' }, { status: 200 })
    }

    const billingPhone = woo.billing?.phone || '0';
    const fullName = `${woo.billing?.first_name || ''} ${woo.billing?.last_name || ''}`.trim() || 'No Name';

    // 1. UPSERT CUSTOMER
    const { data: customer, error: custError } = await supabaseAdmin
      .from('customers')
      .upsert({ 
        business_id: businessId,
        phone: billingPhone,
        name: fullName,
        email: woo.billing?.email || ''
      }, { onConflict: 'business_id, phone' })
      .select('id')
      .single()

    if (custError) throw custError

    // 2. UPSERT ORDER
    const { error: orderError } = await supabaseAdmin
      .from('orders')
      .upsert({
        business_id: businessId,
        customer_id: customer.id,
        external_id: woo.id.toString(),
        source_platform: 'WooCommerce',
        order_number: woo.number,
        order_date: woo.date_created,
        status: woo.status,
        grand_total: parseFloat(woo.total || 0),
        items_json: woo.line_items || [],
        raw_source_data: woo,
        updated_at: new Date().toISOString()
      }, { onConflict: 'source_platform, external_id' })

    if (orderError) throw orderError

    return NextResponse.json({ success: true }, { status: 200 })

  } catch (err: any) {
    console.error('Webhook Error Trace:', err.message)
    // Tetap return 200 untuk 'webhook_id' agar WooCommerce tidak menonaktifkan webhook secara otomatis
    if (err.message.includes("webhook_id")) return NextResponse.json({ ok: true });
    
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}