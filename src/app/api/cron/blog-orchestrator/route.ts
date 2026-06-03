import { NextRequest } from 'next/server';
import { cronUnauthorizedResponse, isCronAuthorized } from '@/lib/cron-auth';
import { withCronLogging } from '@/lib/cron-observability';
import { sanitizeDbError } from '@/lib/error-sanitizer';
import { runOrchestrator } from '@/lib/blog-content-orchestrator';
import { isSupabaseConfigured } from '@/lib/supabase';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

const handleOrchestrator = async (request: NextRequest) => {
  if (!isCronAuthorized(request)) {
    return cronUnauthorizedResponse();
  }
  if (!isSupabaseConfigured) {
    return { skipped: true, reason: 'Supabase not configured', errors: [] as string[] };
  }

  const startedAt = new Date().toISOString();

  try {
    const result = await runOrchestrator();
    const unhealthy = result.health.cronStatuses.filter((cronStatus) => cronStatus.status !== 'ok');

    return {
      ok: true,
      startedAt,
      healthy: result.health.healthy,
      cronCount: result.health.cronStatuses.length,
      unhealthyCount: unhealthy.length,
      recovered: result.healed.recovered,
      stillFailed: result.healed.stillFailed,
      adviceCount: result.health.strategicAdvice.length,
      errors: unhealthy.map((status) => `${status.name}: status=${status.status}, consecutive_failures=${status.consecutiveFailures}`),
    };
  } catch (err) {
    const msg = sanitizeDbError(err, 'blog orchestrator failed');
    console.error('[cron/blog-orchestrator] fatal:', msg);
    return { ok: false, startedAt, error: msg, errors: [msg] };
  }
};

export const GET = withCronLogging('blog-orchestrator', handleOrchestrator);
