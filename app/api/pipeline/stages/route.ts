import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabaseServer';
import { createStage, updateStage, deleteStage, reorderStages } from '@/plugins/pipeline/helpers/pipelineApi';

export async function POST(req: Request) {
  try {
    const supabase = await createClient();
    const { data: { user }, error: authErr } = await supabase.auth.getUser();
    if (authErr || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json();
    const { data, error } = await createStage(supabase, body);
    if (error) throw error;

    return NextResponse.json({ success: true, stage: data });
  } catch (err: any) {
    console.error('API POST /api/pipeline/stages Error:', err);
    return NextResponse.json({ error: err.message || 'Internal Server Error' }, { status: 500 });
  }
}

export async function PUT(req: Request) {
  try {
    const supabase = await createClient();
    const { data: { user }, error: authErr } = await supabase.auth.getUser();
    if (authErr || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json();

    // Check if reordering request
    if (body.pipeline_id && Array.isArray(body.ordered_stage_ids)) {
      const { error } = await reorderStages(supabase, body.pipeline_id, body.ordered_stage_ids);
      if (error) throw error;
      return NextResponse.json({ success: true, message: 'Urutan stage berhasil diperbarui' });
    }

    if (!body.id) {
      return NextResponse.json({ error: 'ID stage wajib diisi.' }, { status: 400 });
    }

    const { id, ...updates } = body;
    const { data, error } = await updateStage(supabase, id, updates);
    if (error) throw error;

    return NextResponse.json({ success: true, stage: data });
  } catch (err: any) {
    console.error('API PUT /api/pipeline/stages Error:', err);
    return NextResponse.json({ error: err.message || 'Internal Server Error' }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  try {
    const supabase = await createClient();
    const { data: { user }, error: authErr } = await supabase.auth.getUser();
    if (authErr || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const id = searchParams.get('id');

    if (!id) {
      return NextResponse.json({ error: 'ID stage wajib ditentukan.' }, { status: 400 });
    }

    const { error } = await deleteStage(supabase, id);
    if (error) throw error;

    return NextResponse.json({ success: true, message: 'Stage berhasil dihapus' });
  } catch (err: any) {
    console.error('API DELETE /api/pipeline/stages Error:', err);
    return NextResponse.json({ error: err.message || 'Internal Server Error' }, { status: 500 });
  }
}
