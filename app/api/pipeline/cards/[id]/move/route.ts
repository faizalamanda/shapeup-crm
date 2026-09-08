import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabaseServer';
import { moveCard } from '@/plugins/pipeline/helpers/pipelineApi';

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const supabase = await createClient();
    const { data: { user }, error: authErr } = await supabase.auth.getUser();
    if (authErr || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json();
    const { target_stage_id, new_display_order } = body;

    if (!target_stage_id) {
      return NextResponse.json({ error: 'target_stage_id wajib diisi.' }, { status: 400 });
    }

    const { data, error } = await moveCard(supabase, {
      card_id: id,
      target_stage_id,
      new_display_order: new_display_order || 0,
      user_id: user.id,
    });

    if (error) throw error;

    return NextResponse.json({ success: true, card: data });
  } catch (err: any) {
    console.error('API POST /api/pipeline/cards/[id]/move Error:', err);
    return NextResponse.json({ error: err.message || 'Internal Server Error' }, { status: 500 });
  }
}
