/**
 * @file /api/cron/refresh-registration-mv/route.ts
 * @description daily_registration_stats MV 자동 REFRESH (P13-1).
 *
 * 박제 (2026-05-13): MV 가 90일 누적 통계 — 새벽 1회 갱신.
 * CONCURRENTLY 옵션으로 LIVE 트래픽 영향 없음.
 */

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';
import { isCronAuthorized, cronUnauthorizedResponse } from '@/lib/cron-auth';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(request: NextRequest): Promise<NextResponse> {
  if (!isCronAuthorized(request)) return cronUnauthorizedResponse();
  if (!isSupabaseConfigured) {
    return NextResponse.json({ ok: false, error: 'Supabase 미설정' }, { status: 503 });
  }

  const started = Date.now();
  try {
    // CONCURRENTLY 옵션 — LIVE 트래픽 영향 없음 (UNIQUE INDEX 필요, 박혀 있음)
    const { error } = await supabaseAdmin.rpc('refresh_daily_registration_stats');
    if (error) {
      // RPC 없으면 fallback (RAW SQL은 supabase-js 에서 못 함, RPC 박제 필요)
      console.warn('[refresh-registration-mv] RPC 없음 — 마이그레이션으로 박제 권장:', error.message);
      return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    }
    return NextResponse.json({
      ok: true,
      duration_ms: Date.now() - started,
      refreshed_at: new Date().toISOString(),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'refresh 실패';
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
