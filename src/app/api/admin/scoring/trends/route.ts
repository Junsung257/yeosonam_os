/**
 * GET /api/admin/scoring/trends — v_package_rank_trends 데이터.
 */
import { NextResponse } from 'next/server';
import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  if (!isSupabaseConfigured) return NextResponse.json({ trends: [] });
  const { data, error } = await supabaseAdmin
    .from('v_package_rank_trends')
    .select('*')
    .gte('snapshots', 2)         // 최소 2개 스냅샷 있어야 변동 의미
    .order('last_seen', { ascending: false })
    .limit(200);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ trends: data ?? [] });
}
