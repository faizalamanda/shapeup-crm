import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'

// Inisialisasi Supabase Admin (Gunakan Service Role Key agar bisa bypass RLS)
const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function POST(req: Request) {
  try {
    // 1. Ambil Business ID (bid) dari Query Parameter (?bid=...)
    const { searchParams } = new URL(req.url)
    const businessId = searchParams.get('bid')

    // 2. Ambil Body JSON dari WooCommerce
    const woo = await req.json()

    // Validasi dasar: Harus ada Business ID dan ID Order dari WooCommerce
    if (!businessId || !woo.id) {
      return NextResponse.json(
        { error: 'Missing Business ID or Order Data' }, 
        { status: 400 }
      )
    }

    const billingPhone = woo.billing?.phone || '0';

    // --- LOGIKA UPSERT CUSTOMER (MIRRORING) ---
    // Jika No WA sudah ada di business_id tersebut, data akan di-update ke yang terbaru
    const { data: customer, error: custError } = await supabaseAdmin
      .from('customers')
      .upsert({ 
        business_id: businessId,
        phone: billingPhone,
        name: `${woo.billing?.first_name || ''} ${woo.billing?.last_name || ''}`.trim(),
        email: woo.billing?.email,
        metadata: { 
          address: woo.billing?.address_1, 
          city: woo.billing?.city,
          last_updated_source: 'webhook_woo'
        }
      }, { onConflict: 'business_id, phone' })
      .select('id')
      .single()

    if (custError) throw new Error(`Customer Sync Error: ${custError.message}`)

    // --- LOGIKA UPSERT ORDER (FULL MIRRORING) ---
    // Menggunakan external_id untuk memastikan satu order WooCommerce = satu baris di CRM
    const { error: orderError } = await supabaseAdmin
      .from('orders')
      .upsert({
        business_id: businessId,
        customer_id: customer.id,
        external_id: woo.id.toString(),
        source_platform: 'WooCommerce',
        order_number: woo.number,
        order_date: woo.date_created,
        status: woo.status, // FULL MIRRORING: Simpan apa adanya (completed, processing, dll)
        
        // Data Finansial
        total_qty: woo.line_items?.reduce((acc: number, item: any) => acc + item.quantity, 0) || 0,
        subtotal: parseFloat(woo.total || 0) - parseFloat(woo.shipping_total || 0) + parseFloat(woo.discount_total || 0),
        shipping_cost: parseFloat(woo.shipping_total || 0),
        discount_amount: parseFloat(woo.discount_total || 0),
        other_fees: parseFloat(woo.total_tax || 0),
        grand_total: parseFloat(woo.total || 0),
        payment_method: woo.payment_method_title,

        // Data Produk (Disimpan sebagai JSON Array)
        items_json: woo.line_items?.map((item: any) => ({
          sku: item.sku,
          name: item.name,
          qty: item.quantity,
          price: item.price,
          total: item.total
        })) || [],

        // Archive Data Asli (Payload Mentah dari WooCommerce)
        raw_source_data: woo,
        updated_at: new Date().toISOString()
      }, { onConflict: 'source_platform, external_id' })

    if (orderError) throw new Error(`Order Sync Error: ${orderError.message}`)

    // Berhasil
    return NextResponse.json({ 
      success: true, 
      message: `Order ${woo.number} synced successfully`,
      customer_id: customer.id 
    }, { status: 200 })

  } catch (err: any) {
    console.error('Webhook Error Trace:', err.message)
    return NextResponse.json(
      { error: err.message }, 
      { status: 500 }
    )
  }
}