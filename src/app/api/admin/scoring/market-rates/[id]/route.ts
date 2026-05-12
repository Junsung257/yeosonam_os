import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';
import { withAdminGuard } from '@/lib/admin-guard';

export const dynamic = 'force-dynamic';

const deleteHandler = async (_req: NextRequest, { params }: { params: { id: string } }) => {
  if (!isSupabaseConfigured) return NextResponse.json({ error: 'Supabase 미설정' }, { status: 503 });
  const { error } = await supabaseAdmin
    .from('optional_tour_market_rates').delete().eq('id', params.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

export const DELETE = withAdminGuard(deleteHandler);
