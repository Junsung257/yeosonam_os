/**
 * GET /api/admin/scoring/history?package_id=...&departure_date=YYYY-MM-DD
 *
 * 단일 패키지의 단일 출발일 시계열 (차트용).
 */
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  if (!isSupabaseConfigured) return NextResponse.json({ history: [] });
  const sp = req.nextUrl.searchParams;
  const packageId = sp.get('package_id');
  const departureDate = sp.get('departure_date');
  if (!packageId) return NextResponse.json({ error: 'package_id 필수' }, { status: 400 });

  let q = supabaseAdmin
    .from('package_score_history')
    .select('snapshot_date, rank_in_group, effective_price, group_size, list_price')
    .eq('package_id', packageId)
    .order('snapshot_date', { ascending: true });
  if (departureDate) q = q.eq('departure_date', departureDate);

  const { data, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ history: data ?? [] });
}
