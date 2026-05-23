import { NextRequest, NextResponse } from 'next/server';
import { isSupabaseConfigured, supabaseAdmin } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

export async function PATCH(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!isSupabaseConfigured) {
    return NextResponse.json({ error: 'Supabase 미설정' }, { status: 503 });
  }

  const { id } = await params;
  const body = await _req.json();
  const { is_active } = body;

  if (typeof is_active !== 'boolean') {
    return NextResponse.json({ error: 'is_active (boolean) 필요' }, { status: 400 });
  }

  const { error } = await supabaseAdmin
    .from('response_corrections')
    .update({ is_active })
    .eq('id', id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
