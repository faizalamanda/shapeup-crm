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

    // --- LOGIKA PEMBERSIHAN NOMOR TELEPON ---
    let rawPhone = woo.billing?.phone || '0';
    let cleanPhone = rawPhone.replace(/\D/g, ''); 
    if (cleanPhone.startsWith('0')) {
      cleanPhone = '62' + cleanPhone.substring(1);
    } else if (cleanPhone.startsWith('8')) {
      cleanPhone = '62' + cleanPhone;
    }
    const billingPhone = cleanPhone;

    const fullName = `${woo.billing?.first_name || ''} ${woo.billing?.last_name || ''}`.trim() || 'No Name';

    // 1. UPSERT CUSTOMER
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
          country: woo.billing?.country,
          raw_phone_origin: rawPhone 
        }
      }, { onConflict: 'business_id, phone' })
      .select('id')
      .single()

    if (custError) throw new Error(`Customer Error: ${custError.message}`);

    // --- START: UPDATE LOGIKA BIAYA-BIAYA (FIXED) ---
    
    // Hitung Other Fees dari fee_lines (Tempat Biaya COD / Admin Fee)
    const other_fees = woo.fee_lines 
      ? woo.fee_lines.reduce((acc: number, fee: any) => acc + toNum(fee.total), 0) 
      : 0;

    // Hitung Subtotal asli dari akumulasi harga produk (sebelum diskon & ongkir)
    const calculatedSubtotal = woo.line_items
      ? woo.line_items.reduce((acc: number, item: any) => acc + toNum(item.subtotal), 0)
      : 0;

    // --- END: UPDATE LOGIKA BIAYA-BIAYA ---

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
        
        // Mapping Biaya yang sudah diperbaiki
        subtotal: calculatedSubtotal,
        discount_amount: toNum(woo.discount_total),
        shipping_cost: toNum(woo.shipping_total),
        other_fees: other_fees, // Sekarang mengambil data COD/Admin dari fee_lines
        grand_total: toNum(woo.total), // Nilai akhir dari WooCommerce (sudah termasuk semua)
        
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