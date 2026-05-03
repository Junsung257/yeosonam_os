/**
 * Booking Tasks Runner Cron
 * ============================================================================
 * Vercel Cron: 매 시간 정각 (0 * * * *)
 * 강제 실행:   GET /api/cron/booking-tasks-runner?force=true
 *
 * 하는 일:
 *   1. Snooze 만기 도래 Task → open 복귀
 *   2. 6개 룰 각각:
 *      - evaluateStale (Alert Fatigue 제거가 최우선)
 *      - detect (신규 감지 — cooldown/fingerprint 3중 방어)
 *
 * 타임아웃: Vercel Hobby=10s / Pro=60s / Enterprise=300s
 *   - 룰 전체 합산 500개 이내면 ~5-10s 내 종료 가능
 *   - 500 초과하는 대형 운영 시 이벤트 기반 (Trigger.dev) 전환 예정
 *
 * 관측성: 응답 JSON 에 rule별 duration/count 포함 → 모니터링 뷰에서 참조
 */

import { NextRequest, NextResponse } from 'next/server';
import { isSupabaseConfigured } from '@/lib/supabase';
import { runAllRules } from '@/lib/booking-tasks/runner';
import { ALL_RULES } from '@/lib/booking-tasks/rules';
import { requireCronBearer } from '@/lib/cron-auth';

export const maxDuration = 60; // Vercel Pro 플랜 기준 상한

export const dynamic = 'force-dynamic';
export async function GET(request: NextRequest) {
  const authErr = requireCronBearer(request);
  if (authErr) return authErr;

  const isForce = request.nextUrl.searchParams.get('force') === 'true';

  if (!isSupabaseConfigured) {
    return NextResponse.json({ error: 'Supabase 미설정' }, { status: 503 });
  }

  const started = Date.now();
  const result = await runAllRules(ALL_RULES, { isForce });
  const totalErrors = result.rules.flatMap(r => r.errors);

  console.log('[booking-tasks-runner]', {
    runId: result.runId,
    duration_ms: result.totalDurationMs,
    woken: result.wokenFromSnooze,
    rules: result.rules.map(r => ({
      id: r.ruleId,
      det: r.detected,
      ins: r.inserted,
      auto: r.autoResolved,
      cd: r.cooldownSkipped,
      dup: r.duplicateSkipped,
      ms: r.durationMs,
      err: r.errors.length,
    })),
  });

  return NextResponse.json({
    ok: true,
    is_force: isForce,
    runId: result.runId,
    duration_ms: Date.now() - started,
    woken_from_snooze: result.wokenFromSnooze,
    rules: result.rules,
    error_count: totalErrors.length,
    run_at: new Date().toISOString(),
  });
}
