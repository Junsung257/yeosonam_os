/**
 * GET /api/cron/free-travel-plan-housekeeping
 *
 * plan_json 만료(plan_expires_at) 통계만 집계 (삭제 없음).
 * 운영이 TTL·리타겟 정책을 맞출 때 참고.
 */

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 30;

const CRON_SECRET = process.env.CRON_SECRET;

export async function GET(request: NextRequest) {
  const auth = request.headers.get('authorization');
  if (CRON_SECRET && auth !== `Bearer ${CRON_SECRET}`) {
    return NextResponse.json({ error: '인증 실패' }, { status: 401 });
  }
  if (!isSupabaseConfigured || !supabaseAdmin) {
    return NextResponse.json({ error: 'DB 미설정' }, { status: 503 });
  }

  const nowIso = new Date().toISOString();

  const { count: expiredCount, error: e1 } = await supabaseAdmin
    .from('free_travel_sessions')
    .select('*', { count: 'exact', head: true })
    .not('plan_expires_at', 'is', null)
    .lt('plan_expires_at', nowIso);

  const { count: activeCount, error: e2 } = await supabaseAdmin
    .from('free_travel_sessions')
    .select('*', { count: 'exact', head: true })
    .not('plan_expires_at', 'is', null)
    .gte('plan_expires_at', nowIso);

  if (e1 || e2) {
    return NextResponse.json(
      { error: (e1 ?? e2)?.message ?? '집계 실패' },
      { status: 500 },
    );
  }

  return NextResponse.json({
    ok: true,
    asOf: nowIso,
    planExpiredRowCount: expiredCount ?? 0,
    planActiveRowCount: activeCount ?? 0,
  });
}
