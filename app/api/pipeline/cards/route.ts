import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabaseServer';
import { createCard, updateCard, deleteCard } from '@/plugins/pipeline/helpers/pipelineApi';

export async function POST(req: Request) {
  try {
    const supabase = await createClient();
    const { data: { user }, error: authErr } = await supabase.auth.getUser();
    if (authErr || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json();
    const { data, error } = await createCard(supabase, {
      ...body,
      created_by: user.id,
    });

    if (error) throw error;

    return NextResponse.json({ success: true, card: data });
  } catch (err: any) {
    console.error('API POST /api/pipeline/cards Error:', err);
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
    if (!body.id) {
      return NextResponse.json({ error: 'ID kartu wajib diisi.' }, { status: 400 });
    }

    const { id, ...updates } = body;
    const { data, error } = await updateCard(supabase, id, updates, user.id);
    if (error) throw error;

    return NextResponse.json({ success: true, card: data });
  } catch (err: any) {
    console.error('API PUT /api/pipeline/cards Error:', err);
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
      return NextResponse.json({ error: 'ID kartu wajib ditentukan.' }, { status: 400 });
    }

    const { error } = await deleteCard(supabase, id);
    if (error) throw error;

    return NextResponse.json({ success: true, message: 'Kartu berhasil dihapus' });
  } catch (err: any) {
    console.error('API DELETE /api/pipeline/cards Error:', err);
    return NextResponse.json({ error: err.message || 'Internal Server Error' }, { status: 500 });
  }
}
