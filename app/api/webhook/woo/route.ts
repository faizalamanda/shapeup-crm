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

    const woo = await req.json()
    if (!woo.id) return NextResponse.json({ message: 'Not an order data' }, { status: 200 })

    const toNum = (val: any) => {
      const parsed = parseFloat(val);
      return isNaN(parsed) ? 0 : parsed;
    };

    // 1. MEMBERSIHKAN TEKS (Clean newline/tabs)
    const cleanText = (text: string, replacement: string = ", ") => {
      if (!text) return "";
      return text.toString()
        .replace(/[\n\r\t]+/g, replacement)
        .replace(/\s\s+/g, ' ')
        .trim();
    };

    // 2. LOGIKA TELEPON (International Format 62)
    let rawPhone = woo.billing?.phone || '0';
    let cleanPhone = rawPhone.replace(/\D/g, ''); 
    if (cleanPhone.startsWith('0')) {
      cleanPhone = '62' + cleanPhone.substring(1);
    } else if (cleanPhone.startsWith('8')) {
      cleanPhone = '62' + cleanPhone;
    }
    const billingPhone = cleanPhone;

    const fullName = `${woo.billing?.first_name || ''} ${woo.billing?.last_name || ''}`.trim() || 'No Name';

    // 3. KALKULASI BIAYA & ITEM (FIXED)
    // Mengambil biaya COD/Admin dari fee_lines
    const other_fees = woo.fee_lines 
      ? woo.fee_lines.reduce((acc: number, fee: any) => acc + toNum(fee.total), 0) 
      : 0;

    // Menghitung Subtotal Produk murni
    const calculatedSubtotal = woo.line_items
      ? woo.line_items.reduce((acc: number, item: any) => acc + toNum(item.subtotal), 0)
      : 0;

    // 4. UPSERT CUSTOMER
    const { data: customer, error: custError } = await supabaseAdmin
      .from('customers')
      .upsert({ 
        business_id: businessId,
        phone: billingPhone,
        name: fullName,
        email: woo.billing?.email || '',
        metadata: { 
          address: cleanText(woo.billing?.address_1), 
          city: woo.billing?.city,
          country: woo.billing?.country
        }
      }, { onConflict: 'business_id, phone' })
      .select('id')
      .single()

    if (custError) throw new Error(`Customer Error: ${custError.message}`);

    // 5. UPSERT ORDER KE SUPABASE
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
        total_qty: woo.line_items?.reduce((acc: number, item: any) => acc + toNum(item.quantity), 0) || 0,
        
        // Data Biaya-Biaya
        subtotal: calculatedSubtotal,
        discount_amount: toNum(woo.discount_total),
        shipping_cost: toNum(woo.shipping_total),
        other_fees: other_fees, 
        grand_total: toNum(woo.total),
        
        payment_method: woo.payment_method_title || 'Manual',
        items_json: woo.line_items || [],
        raw_source_data: woo,
        updated_at: new Date().toISOString()
      }, { onConflict: 'source_platform, external_id' })

    if (orderError) throw new Error(`Order Error: ${orderError.message}`);

    // 6. WHATSAPP LOGIC (DISABLED FOR NOW)
    /*
    if (woo.billing?.email !== "alamanda1@alamanda.com") {
      // Logic kirim WA nanti ditaruh di sini
    }
    */

    return NextResponse.json({ success: true, phone: billingPhone }, { status: 200 })

  } catch (err: any) {
    console.error("Webhook Error:", err.message);
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}