import { NextRequest, NextResponse } from 'next/server';
import { isSupabaseConfigured, supabaseAdmin } from '@/lib/supabase';
import { requireAdminRequest } from '@/lib/admin-guard';
import { getAdminContext } from '@/lib/admin-context';

export async function GET(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const authError = await requireAdminRequest(req);
  if (authError) return authError;

  const params = await props.params;
  if (!isSupabaseConfigured) return NextResponse.json({ notes: [] });

  const { data, error } = await supabaseAdmin
    .from('customer_notes')
    .select('*')
    .eq('customer_id', params.id)
    .order('created_at', { ascending: false });

  if (error) return NextResponse.json({ notes: [] });
  return NextResponse.json({ notes: data });
}

export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const authError = await requireAdminRequest(req);
  if (authError) return authError;

  const params = await props.params;
  if (!isSupabaseConfigured) return NextResponse.json({ error: 'Supabase 미설정' }, { status: 500 });

  const { content, channel = 'phone' } = await req.json();
  if (!content?.trim()) return NextResponse.json({ error: 'content 필요' }, { status: 400 });

  const { data, error } = await supabaseAdmin
    .from('customer_notes')
    .insert([{ customer_id: params.id, content: content.trim(), channel }])
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  void supabaseAdmin.from('ops_events').insert({
    event_type: 'customer_note',
    severity: 'info',
    title: `${channel} 상담 메모`,
    description: content.trim().slice(0, 200),
    customer_id: params.id,
    target_type: 'customer_notes',
    target_id: (data as { id?: string } | null)?.id ?? null,
    status: 'resolved',
    metadata: { channel },
    created_by: getAdminContext(req).actor,
  } as Record<string, unknown>).then(() => undefined, error => {
    console.warn('[customer notes ops_event] 실패:', error?.message ?? error);
  });
  return NextResponse.json({ note: data });
}

export async function DELETE(req: NextRequest, _ctx: { params: Promise<{ id: string }> }) {
  const authError = await requireAdminRequest(req);
  if (authError) return authError;

  if (!isSupabaseConfigured) return NextResponse.json({ error: 'Supabase 미설정' }, { status: 500 });

  const { searchParams } = new URL(req.url);
  const noteId = searchParams.get('noteId');
  if (!noteId) return NextResponse.json({ error: 'noteId 필요' }, { status: 400 });

  const { error } = await supabaseAdmin.from('customer_notes').delete().eq('id', noteId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
