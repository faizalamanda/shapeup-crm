import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabaseServer';
import { createClient as createAdminClient } from '@supabase/supabase-js';
import { fetchPipelines, createPipeline } from '@/plugins/pipeline/helpers/pipelineApi';

function getAdminSupabase() {
  if (process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return createAdminClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    );
  }
  return null;
}

export async function GET(req: Request) {
  try {
    const supabase = await createClient();
    const { data: { user }, error: authErr } = await supabase.auth.getUser();
    if (authErr || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { data: profile } = await supabase
      .from('profiles')
      .select('active_business_id')
      .eq('id', user.id)
      .single();

    if (!profile?.active_business_id) {
      return NextResponse.json({ error: 'Unit bisnis aktif tidak terdeteksi.' }, { status: 400 });
    }

    const admin = getAdminSupabase() || supabase;
    const { data, error } = await fetchPipelines(admin, profile.active_business_id, user.id);
    if (error) throw error;

    return NextResponse.json({ success: true, pipelines: data || [] });
  } catch (err: any) {
    console.error('API GET /api/pipeline Error:', err);
    return NextResponse.json({ error: err.message || 'Internal Server Error' }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const supabase = await createClient();
    const { data: { user }, error: authErr } = await supabase.auth.getUser();
    if (authErr || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { data: profile } = await supabase
      .from('profiles')
      .select('active_business_id')
      .eq('id', user.id)
      .single();

    if (!profile?.active_business_id) {
      return NextResponse.json({ error: 'Unit bisnis aktif tidak terdeteksi.' }, { status: 400 });
    }

    const body = await req.json();
    if (!body.name) {
      return NextResponse.json({ error: 'Nama pipeline wajib diisi.' }, { status: 400 });
    }

    const admin = getAdminSupabase() || supabase;

    const { data, error } = await createPipeline(admin, {
      ...body,
      business_id: profile.active_business_id,
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
