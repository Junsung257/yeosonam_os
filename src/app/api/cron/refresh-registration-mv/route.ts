/**
 * @file /api/cron/refresh-registration-mv/route.ts
 * @description daily_registration_stats MV 자동 REFRESH (P13-1).
 *
 * 박제 (2026-05-13): MV 가 90일 누적 통계 — 새벽 1회 갱신.
 * CONCURRENTLY 옵션으로 LIVE 트래픽 영향 없음.
 */

import { NextRequest } from 'next/server';
import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';
import { isCronAuthorized, cronUnauthorizedResponse } from '@/lib/cron-auth';
import { apiResponse } from '@/lib/api-response';
import { sanitizeDbError } from '@/lib/error-sanitizer';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(request: NextRequest): Promise<Response> {
  if (!isCronAuthorized(request)) return cronUnauthorizedResponse();
  if (!isSupabaseConfigured || !supabaseAdmin) {
    return apiResponse({ ok: false, error: 'Supabase not configured' }, { status: 503 });
  }

  const started = Date.now();
  try {
    // CONCURRENTLY 옵션 — LIVE 트래픽 영향 없음 (UNIQUE INDEX 필요, 박혀 있음)
    const { error } = await supabaseAdmin.rpc('refresh_daily_registration_stats');
    if (error) {
      // RPC 없으면 fallback (RAW SQL은 supabase-js 에서 못 함, RPC 박제 필요)
      console.warn('[refresh-registration-mv] RPC 없음 — 마이그레이션으로 박제 권장:', sanitizeDbError(error));
      return apiResponse({ ok: false, error: sanitizeDbError(error) }, { status: 500 });
    }
    return apiResponse({
      ok: true,
      duration_ms: Date.now() - started,
      refreshed_at: new Date().toISOString(),
    });
  } catch (err) {
    const message = sanitizeDbError(err, 'Registration stats refresh failed');
    return apiResponse({ ok: false, error: message }, { status: 500 });
  }
}
