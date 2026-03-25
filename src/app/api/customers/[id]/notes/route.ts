import { NextRequest, NextResponse } from 'next/server';
import { isSupabaseConfigured, supabaseAdmin } from '@/lib/supabase';

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  if (!isSupabaseConfigured) return NextResponse.json({ notes: [] });

  const { data, error } = await supabaseAdmin
    .from('customer_notes')
    .select('*')
    .eq('customer_id', params.id)
    .order('created_at', { ascending: false });

  if (error) return NextResponse.json({ notes: [] });
  return NextResponse.json({ notes: data });
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  if (!isSupabaseConfigured) return NextResponse.json({ error: 'Supabase 미설정' }, { status: 500 });

  const { content, channel = 'phone' } = await req.json();
  if (!content?.trim()) return NextResponse.json({ error: 'content 필요' }, { status: 400 });

  const { data, error } = await supabaseAdmin
    .from('customer_notes')
    .insert([{ customer_id: params.id, content: content.trim(), channel }])
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ note: data });
}

export async function DELETE(req: NextRequest, { params: _params }: { params: { id: string } }) {
  if (!isSupabaseConfigured) return NextResponse.json({ error: 'Supabase 미설정' }, { status: 500 });

  const { searchParams } = new URL(req.url);
  const noteId = searchParams.get('noteId');
  if (!noteId) return NextResponse.json({ error: 'noteId 필요' }, { status: 400 });

  const { error } = await supabaseAdmin.from('customer_notes').delete().eq('id', noteId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
