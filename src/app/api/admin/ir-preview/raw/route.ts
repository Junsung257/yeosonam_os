import { NextRequest, NextResponse } from 'next/server';
import { withAdminGuard } from '@/lib/admin-guard';
import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';

const postHandler = async (request: NextRequest) => {
  if (!isSupabaseConfigured) {
    return NextResponse.json({ error: 'DB not configured' }, { status: 503 });
  }

  const body = await request.json().catch(() => null) as { id?: string } | null;
  const id = body?.id;
  if (!id) {
    return NextResponse.json({ error: 'id required' }, { status: 400 });
  }

  const { data, error } = await supabaseAdmin
    .from('normalized_intakes')
    .select('raw_text')
    .eq('id', id)
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json({ error: 'not found' }, { status: 404 });
  }

  return NextResponse.json({ rawText: String((data as { raw_text?: string | null }).raw_text ?? '') });
};

export const POST = withAdminGuard(postHandler);
