import { NextRequest } from 'next/server';
import { isCronAuthorized, cronUnauthorizedResponse } from '@/lib/cron-auth';
import { runOrchestrator } from '@/lib/blog-content-orchestrator';
import { isSupabaseConfigured } from '@/lib/supabase';
import { withCronLogging } from '@/lib/cron-observability';

/**
 * Blog Orchestrator Cron — 매시간 경량 실행
 *
 * 역할:
 *   - 모든 크론의 건강 상태 모니터링
 *   - 실패 큐 항목 자동 복구 (Self-Healing)
 *   - 이상 징후 발견 시 admin_alerts 에 알림 적재
 */
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

const handleOrchestrator = async (request: NextRequest) => {
  if (!isCronAuthorized(request)) {
    return cronUnauthorizedResponse();
  }
  if (!isSupabaseConfigured) {
    return { skipped: true, reason: 'Supabase 미설정', errors: [] as string[] };
  }

  const startedAt = new Date().toISOString();

  try {
    const result = await runOrchestrator();
    const unhealthy = result.health.cronStatuses.filter(cs => cs.status !== 'ok');

    return {
      ok: true,
      startedAt,
      healthy: result.health.healthy,
      cronCount: result.health.cronStatuses.length,
      unhealthyCount: unhealthy.length,
      recovered: result.healed.recovered,
      stillFailed: result.healed.stillFailed,
      adviceCount: result.health.strategicAdvice.length,
      errors: unhealthy.map(u => `${u.name}: status=${u.status}, 연속실패=${u.consecutiveFailures}`),
    };
  } catch (err) {
    console.error('[cron/blog-orchestrator] fatal:', err);
    const msg = err instanceof Error ? err.message : 'unknown';
    return { ok: false, startedAt, error: msg, errors: [msg] };
  }
};

export const GET = withCronLogging('blog-orchestrator', handleOrchestrator);
