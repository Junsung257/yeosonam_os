/**
 * GET /api/cron/free-travel-plan-housekeeping
 *
 * plan_json 만료(plan_expires_at) 통계만 집계 (삭제 없음).
 * 운영이 TTL·리타겟 정책을 맞출 때 참고.
 */

import { NextRequest } from 'next/server';
import { apiResponse } from '@/lib/api-response';
import { isCronAuthorized, cronUnauthorizedResponse } from '@/lib/cron-auth';
import { sanitizeDbError } from '@/lib/error-sanitizer';
import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 30;

export async function GET(request: NextRequest) {
  if (!isCronAuthorized(request)) {
    return cronUnauthorizedResponse();
  }
  if (!isSupabaseConfigured || !supabaseAdmin) {
    return apiResponse({ error: 'DB not configured' }, { status: 503 });
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
    return apiResponse(
      { error: sanitizeDbError(e1 ?? e2, 'Plan housekeeping failed') },
      { status: 500 },
    );
  }

  return apiResponse({
    ok: true,
    asOf: nowIso,
    planExpiredRowCount: expiredCount ?? 0,
    planActiveRowCount: activeCount ?? 0,
  });
}
