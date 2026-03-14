import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { formatPhoneNumberSmart } from '@/lib/utils';

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { name, phone, items, total_amount } = body;

    // 1. Cuci Nomor HP
    const cleanPhone = formatPhoneNumberSmart(phone);

    // 2. UPSERT Customer (Cek HP, jika tidak ada buat baru)
    const { data: customer, error: custError } = await supabase
      .from('customers')
      .upsert({ 
        phone: cleanPhone, 
        full_name: name,
        source: 'manual' 
      }, { onConflict: 'phone' })
      .select()
      .single();

    if (custError) throw custError;

    // 3. INSERT ke Tabel Orders (Kepala)
    const { data: order, error: orderError } = await supabase
      .from('orders')
      .insert({
        customer_id: customer.id,
        total_amount: total_amount,
        source: 'manual',
        status: 'completed' // Default untuk manual biasanya langsung lunas/selesai
      })
      .select()
      .single();

    if (orderError) throw orderError;

    // 4. INSERT ke Tabel Order_Items (Banyak Baris)
    const preparedItems = items.map((item: any) => ({
      order_id: order.id,
      product_name: item.product_name,
      quantity: item.quantity,
      price: item.price,
      subtotal: item.quantity * item.price
    }));

    const { error: itemsError } = await supabase
      .from('order_items')
      .insert(preparedItems);

    if (itemsError) throw itemsError;

    return NextResponse.json({ success: true, orderId: order.id });

  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}