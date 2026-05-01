import { NextRequest, NextResponse } from 'next/server';
import { isSupabaseConfigured } from '@/lib/supabase';
import { recommendBestPackages } from '@/lib/scoring/recommend';
import { getPolicyById } from '@/lib/scoring/policy';

export const dynamic = 'force-dynamic';

/**
 * 그룹내 베스트 패키지 추천 (Effective Price + TOPSIS).
 * GET /api/packages/recommend-best?destination=다낭&departure_date=2026-04-20&window=3&limit=5
 */
export async function GET(req: NextRequest) {
  if (!isSupabaseConfigured) {
    return NextResponse.json({ error: 'Supabase 미설정' }, { status: 503 });
  }
  const sp = req.nextUrl.searchParams;
  const destination = sp.get('destination');
  if (!destination) {
    return NextResponse.json({ error: 'destination 필수' }, { status: 400 });
  }
  const intParam = (k: string) => {
    const v = sp.get(k);
    if (!v) return undefined;
    const n = parseInt(v, 10);
    return Number.isFinite(n) ? n : undefined;
  };

  try {
    const policyId = sp.get('policy_id');
    const policy = policyId ? await getPolicyById(policyId) : undefined;
    const result = await recommendBestPackages({
      destination,
      departure_date: sp.get('departure_date'),
      departure_window_days: intParam('window'),
      duration_days: intParam('duration'),
      limit: intParam('limit') ?? 5,
      policy,
    });
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'failed' },
      { status: 500 },
    );
  }
}
