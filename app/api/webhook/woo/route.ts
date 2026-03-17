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

    if (!businessId) return NextResponse.json({ error: 'Missing Business ID' }, { status: 400 })

    let woo;
    const contentType = req.headers.get('content-type') || ''
    
    if (contentType.includes('application/json')) {
      woo = await req.json()
    } else {
      const text = await req.text()
      if (text.includes('webhook_id')) return NextResponse.json({ message: 'Ping received' }, { status: 200 })
      return NextResponse.json({ error: 'Format harus JSON' }, { status: 400 })
    }

    if (!woo.id) return NextResponse.json({ message: 'Not an order data' }, { status: 200 })

    const toNum = (val: any) => {
      const parsed = parseFloat(val);
      return isNaN(parsed) ? 0 : parsed;
    };

    // --- LOGIKA PEMBERSIHAN NOMOR TELEPON INTERNASIONAL ---
    let rawPhone = woo.billing?.phone || '0';
    let cleanPhone = rawPhone.replace(/\D/g, ''); 

    if (cleanPhone.startsWith('0')) {
      cleanPhone = '62' + cleanPhone.substring(1);
    } else if (cleanPhone.startsWith('8')) {
      cleanPhone = '62' + cleanPhone;
    }
    const billingPhone = cleanPhone;
    // ---------------------------------------------------------

    const fullName = `${woo.billing?.first_name || ''} ${woo.billing?.last_name || ''}`.trim() || 'No Name';

    const { data: customer, error: custError } = await supabaseAdmin
      .from('customers')
      .upsert({ 
        business_id: businessId,
        phone: billingPhone,
        name: fullName,
        email: woo.billing?.email || '',
        metadata: { 
          address: woo.billing?.address_1, 
          city: woo.billing?.city,
          country: woo.billing?.country, // Tambahkan info negara jika ada
          raw_phone_origin: rawPhone 
        }
      }, { onConflict: 'business_id, phone' })
      .select('id')
      .single()

    if (custError) throw new Error(`Customer Error: ${custError.message}`);

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
        total_qty: woo.line_items?.reduce((acc: number, item: any) => acc + (toNum(item.quantity)), 0) || 0,
        grand_total: toNum(woo.total),
        shipping_cost: toNum(woo.shipping_total),
        discount_amount: toNum(woo.discount_total),
        other_fees: toNum(woo.total_tax),
        subtotal: toNum(woo.total) - toNum(woo.shipping_total) + toNum(woo.discount_total),
        payment_method: woo.payment_method_title || 'Manual',
        items_json: woo.line_items || [],
        raw_source_data: woo,
        updated_at: new Date().toISOString()
      }, { onConflict: 'source_platform, external_id' })

    if (orderError) throw new Error(`Order Error: ${orderError.message}`);

    return NextResponse.json({ success: true, phone: billingPhone }, { status: 200 })

  } catch (err: any) {
    if (err.message.includes("webhook_id")) return NextResponse.json({ ok: true });
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}