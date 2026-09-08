import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabaseServer';
import { fetchPipelineById, updatePipeline, deletePipeline } from '@/plugins/pipeline/helpers/pipelineApi';

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const supabase = await createClient();
    const { data: { user }, error: authErr } = await supabase.auth.getUser();
    if (authErr || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { data, error } = await fetchPipelineById(supabase, id);
    if (error) throw error;
    if (!data) return NextResponse.json({ error: 'Pipeline tidak ditemukan' }, { status: 404 });

    return NextResponse.json({ success: true, pipeline: data });
  } catch (err: any) {
    console.error('API GET /api/pipeline/[id] Error:', err);
    return NextResponse.json({ error: err.message || 'Internal Server Error' }, { status: 500 });
  }
}

export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const supabase = await createClient();
    const { data: { user }, error: authErr } = await supabase.auth.getUser();
    if (authErr || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json();
    const { data, error } = await updatePipeline(supabase, id, body);
    if (error) throw error;

    return NextResponse.json({ success: true, pipeline: data });
  } catch (err: any) {
    console.error('API PUT /api/pipeline/[id] Error:', err);
    return NextResponse.json({ error: err.message || 'Internal Server Error' }, { status: 500 });
  }
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const supabase = await createClient();
    const { data: { user }, error: authErr } = await supabase.auth.getUser();
    if (authErr || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { error } = await deletePipeline(supabase, id);
    if (error) throw error;

    return NextResponse.json({ success: true, message: 'Pipeline berhasil dihapus' });
  } catch (err: any) {
    console.error('API DELETE /api/pipeline/[id] Error:', err);
    return NextResponse.json({ error: err.message || 'Internal Server Error' }, { status: 500 });
  }
}
