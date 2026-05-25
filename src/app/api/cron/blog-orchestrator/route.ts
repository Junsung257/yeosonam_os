import { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { isCronAuthorized, cronUnauthorizedResponse } from '@/lib/cron-auth';
import { runOrchestrator } from '@/lib/blog-content-orchestrator';
import { isSupabaseConfigured } from '@/lib/supabase';

/**
 * Blog Orchestrator Cron — 매시간 경량 실행
 *
 * 역할:
 *   - 모든 크론의 건강 상태 모니터링
 *   - 실패 큐 항목 자동 복구 (Self-Healing)
 *   - 이상 징후 발견 시 admin_alerts 에 알림 적재
 *
 * 영향:
 *   - DB: cron_logs 읽기 / blog_topic_queue 업데이트 / admin_alerts 적재
 *   - 비용: 시간당 1회 무료 Vercel Cron 호출
 */
export const dynamic = 'force-dynamic';
export const maxDuration = 120; // 2분

export async function GET(request: NextRequest) {
  if (!isCronAuthorized(request)) {
    return cronUnauthorizedResponse();
  }

  if (!isSupabaseConfigured) {
    return NextResponse.json({ skipped: true, reason: 'Supabase 미설정' });
  }

  const startedAt = new Date().toISOString();

  try {
    const result = await runOrchestrator();

    return NextResponse.json({
      ok: true,
      startedAt,
      healthy: result.health.healthy,
      cronCount: result.health.cronStatuses.length,
      unhealthyCount: result.health.cronStatuses.filter(cs => cs.status !== 'ok').length,
      recovered: result.healed.recovered,
      stillFailed: result.healed.stillFailed,
      adviceCount: result.health.strategicAdvice.length,
    });
  } catch (err) {
    console.error('[cron/blog-orchestrator] fatal:', err);
    return NextResponse.json(
      { ok: false, startedAt, error: err instanceof Error ? err.message : 'unknown' },
      { status: 500 },
    );
  }
}
