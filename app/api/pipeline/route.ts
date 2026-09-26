import { NextResponse } from 'next/server';
import { getApiContext } from '@/lib/apiContext';
import { fetchPipelines, createPipeline } from '@/plugins/pipeline/helpers/pipelineApi';

export async function GET() {
  try {
    const ctx = await getApiContext();
    if (ctx.error) return ctx.error;
    const { user, businessId, supabaseAdmin, supabase } = ctx;

    const admin = supabaseAdmin || supabase;
    const { data, error } = await fetchPipelines(admin, businessId, user.id);
    if (error) throw error;

    return NextResponse.json({ success: true, pipelines: data || [] });
  } catch (err: any) {
    console.error('API GET /api/pipeline Error:', err);
    return NextResponse.json({ error: err.message || 'Internal Server Error' }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const ctx = await getApiContext();
    if (ctx.error) return ctx.error;
    const { user, businessId, supabaseAdmin, supabase } = ctx;

    const body = await req.json();
    if (!body.name) {
      return NextResponse.json({ error: 'Nama pipeline wajib diisi.' }, { status: 400 });
    }

    const admin = supabaseAdmin || supabase;

    const { data, error } = await createPipeline(admin, {
      ...body,
      business_id: businessId,
      created_by: user.id,
    });

    if (error) {
      console.error('Create pipeline DB error:', error);
      return NextResponse.json({ error: error.message || 'Gagal membuat record di database.' }, { status: 400 });
    }

    return NextResponse.json({ success: true, pipeline: data });
  } catch (err: any) {
    console.error('API POST /api/pipeline Error:', err);
    return NextResponse.json({ error: err.message || 'Internal Server Error' }, { status: 500 });
  }
}
