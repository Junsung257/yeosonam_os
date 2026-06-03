/**
 * GET /api/ops/cron-health
 *
 * Returns recent cron health and the last 24h failure history for the ops dashboard.
 * Access is protected by middleware; CRON_SECRET Bearer is recognized for server-to-server callers
 * that are allowed through the platform layer.
 */
import { type NextRequest } from 'next/server';
import { apiResponse } from '@/lib/api-response';
import { sanitizeDbError } from '@/lib/error-sanitizer';
import { getSecret } from '@/lib/secret-registry';
import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';
import { safeEqualString } from '@/lib/timing-safe';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  const cronSecret = getSecret('CRON_SECRET');
  const accessMode = cronSecret && safeEqualString(authHeader, `Bearer ${cronSecret}`)
    ? 'cron'
    : 'admin';

  if (!isSupabaseConfigured) {
    return apiResponse({ error: 'DB가 설정되지 않았습니다.' }, { status: 503 });
  }

  try {
    const { data: health, error: healthErr } = await supabaseAdmin
      .from('cron_health')
      .select('*');
    if (healthErr) throw healthErr;

    const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { data: recentFailures, error: failErr } = await supabaseAdmin
      .from('cron_run_logs')
      .select('cron_name, status, started_at, elapsed_ms, error_count, error_messages, alerted')
      .neq('status', 'success')
      .gte('started_at', dayAgo)
      .order('started_at', { ascending: false })
      .limit(50);
    if (failErr) throw failErr;

    const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const { data: weekRuns } = await supabaseAdmin
      .from('cron_run_logs')
      .select('cron_name, status')
      .gte('started_at', weekAgo);

    const statsByName: Record<string, { total: number; success: number; error: number }> = {};
    for (const run of (weekRuns ?? []) as Array<{ cron_name: string; status: string }>) {
      const stats = statsByName[run.cron_name] ??= { total: 0, success: 0, error: 0 };
      stats.total += 1;
      if (run.status === 'success') stats.success += 1;
      else if (run.status === 'error') stats.error += 1;
    }

    const successRate7d: Record<string, number> = {};
    for (const [name, stats] of Object.entries(statsByName)) {
      successRate7d[name] = stats.total > 0
        ? Math.round((stats.success / stats.total) * 1000) / 10
        : 0;
    }

    return apiResponse({
      health,
      recent_failures_24h: recentFailures,
      success_rate_7d_percent: successRate7d,
      generated_at: new Date().toISOString(),
      access_mode: accessMode,
    });
  } catch (err) {
    console.error('[ops/cron-health] failed:', sanitizeDbError(err));
    return apiResponse(
      { error: '크론 상태 조회에 실패했습니다.' },
      { status: 500 },
    );
  }
}
