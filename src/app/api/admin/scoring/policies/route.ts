import { NextResponse } from 'next/server';
import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

/** 모든 정책 목록 (A/B 비교용 — 활성 + shadow 모두) */
export async function GET() {
  if (!isSupabaseConfigured) return NextResponse.json({ error: 'Supabase 미설정' }, { status: 503 });
  const { data, error } = await supabaseAdmin
    .from('scoring_policies')
    .select('id, version, is_active, weights, notes, updated_at')
    .order('is_active', { ascending: false })
    .order('updated_at', { ascending: false })
    .limit(50);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ policies: data ?? [] });
}
