import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';

export async function POST(req: Request) {
  const supabase = createRouteHandlerClient({ cookies });
  const { name, address, phone } = await req.json();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    // 1. Masukkan data ke tabel businesses
    const { data: biz, error: bizError } = await supabase
      .from('businesses')
      .insert({ name, address, phone, owner_id: user.id })
      .select()
      .single();

    if (bizError) throw bizError;

    // 2. Tempelkan business_id ke profile user yang membuat
    const { error: profileError } = await supabase
      .from('profiles')
      .update({ business_id: biz.id })
      .eq('id', user.id);

    if (profileError) throw profileError;

    return NextResponse.json({ success: true, business: biz });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}