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

    // 1. PROTEKSI FORMAT DATA (JSON vs FORM-URLENCODED)
    let woo;
    const contentType = req.headers.get('content-type') || ''
    
    if (contentType.includes('application/json')) {
      woo = await req.json()
    } else {
      const text = await req.text()
      // Jika isinya cuma ping test webhook_id, balas 200 OK biar Woo senang
      if (text.includes('webhook_id')) {
        return NextResponse.json({ message: 'Ping received' }, { status: 200 })
      }
      return NextResponse.json({ error: 'Format harus JSON' }, { status: 400 })
    }

    // 2. VALIDASI DATA ORDER
    if (!woo.id) {
      return NextResponse.json({ message: 'Not an order data' }, { status: 200 })
    }

    // Helper: Mengubah string ke number secara aman
    const toNum = (val: any) => {
      const parsed = parseFloat(val);
      return isNaN(parsed) ? 0 : parsed;
    };

    const billingPhone = woo.billing?.phone || '0';
    const fullName = `${woo.billing?.first_name || ''} ${woo.billing?.last_name || ''}`.trim() || 'No Name';

    // 3. UPSERT CUSTOMER (Update data terbaru jika nomor WA sama)
    const { data: customer, error: custError } = await supabaseAdmin
      .from('customers')
      .upsert({ 
        business_id: businessId,
        phone: billingPhone,
        name: fullName,
        email: woo.billing?.email || '',
        metadata: { 
          address: woo.billing?.address_1, 
          city: woo.billing?.city 
        }
      }, { onConflict: 'business_id, phone' })
      .select('id')
      .single()

    if (custError) throw new Error(`Customer Error: ${custError.message}`);

    // 4. UPSERT ORDER (Mirroring data lengkap agar tidak nol)
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

        // Data Finansial dengan Safe Parsing
        total_qty: woo.line_items?.reduce((acc: number, item: any) => acc + (toNum(item.quantity)), 0) || 0,
        grand_total: toNum(woo.total),
        shipping_cost: toNum(woo.shipping_total),
        discount_amount: toNum(woo.discount_total),
        other_fees: toNum(woo.total_tax),
        
        // Kalkulasi Subtotal: Total - Ongkir + Diskon (sebelum dipotong diskon biasanya)
        // Atau sesuai logika Mas, yang penting data tidak 0
        subtotal: toNum(woo.total) - toNum(woo.shipping_total) + toNum(woo.discount_total),

        payment_method: woo.payment_method_title || 'Manual',
        
        // Simpan Detail Produk
        items_json: woo.line_items?.map((item: any) => ({
          sku: item.sku || '',
          name: item.name || '',
          qty: toNum(item.quantity),
          price: toNum(item.price),
          total: toNum(item.total)
        })) || [],

        raw_source_data: woo, // Cadangan data asli jika butuh debug
        updated_at: new Date().toISOString()
      }, { onConflict: 'source_platform, external_id' })

    if (orderError) throw new Error(`Order Error: ${orderError.message}`);

    return NextResponse.json({ success: true, order_id: woo.id }, { status: 200 })

  } catch (err: any) {
    console.error('Webhook Error Trace:', err.message)
    
    // Fallback: Jika error karena format webhook_id di tengah jalan, tetap kirim 200
    if (err.message.includes("webhook_id")) return NextResponse.json({ ok: true });
    
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}