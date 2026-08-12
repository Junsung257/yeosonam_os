import { NextRequest } from 'next/server';
import { apiResponse } from '@/lib/api-response';
import { withCronGuard } from '@/lib/cron-auth';
import { supabaseAdmin } from '@/lib/supabase';
import { evaluateBlogDataReadinessV3 } from '@/lib/blog-data-readiness-v3';
import { readBlogAutopublishPolicyV3 } from '@/lib/blog-autopublish-policy-v3';
import { probeBlogRuntimeSchemaWithSupabaseV3 } from '@/lib/blog-runtime-readiness-v3';
import { logError } from '@/lib/sentry-logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const countOrNull = (result: { count: number | null; error: unknown }): number | null => (
  result.error ? null : Number(result.count ?? 0)
);

const handler = async (_request: NextRequest) => {
  const now = new Date();
  const policy = readBlogAutopublishPolicyV3();
  const schemaReadiness = await probeBlogRuntimeSchemaWithSupabaseV3(supabaseAdmin, now);
  const daysAgo = (days: number) => new Date(now.getTime() - days * 24 * 60 * 60_000).toISOString();
  const [search, engagement, serverEvents, rum, snapshots, dead, ready] = await Promise.all([
    supabaseAdmin.from('blog_search_performance').select('id', { count: 'exact', head: true }).gte('metric_date', daysAgo(30).slice(0, 10)),
    supabaseAdmin.from('blog_engagement_logs').select('id', { count: 'exact', head: true }).gte('created_at', daysAgo(7)),
    supabaseAdmin.from('analytics_server_events').select('id', { count: 'exact', head: true }).gte('occurred_at', daysAgo(30)),
    supabaseAdmin.from('web_vitals').select('id', { count: 'exact', head: true }).gte('created_at', daysAgo(7)),
    supabaseAdmin.from('blog_public_snapshots').select('creative_id', { count: 'exact', head: true }).eq('is_current', true),
    supabaseAdmin.from('analytics_server_event_outbox').select('id', { count: 'exact', head: true }).eq('status', 'dead'),
    supabaseAdmin.from('analytics_server_event_outbox').select('id', { count: 'exact', head: true }).in('status', ['pending', 'failed', 'processing']),
  ]);
  const report = evaluateBlogDataReadinessV3({
    searchPerformance30d: countOrNull(search),
    engagement7d: countOrNull(engagement),
    serverEvents30d: countOrNull(serverEvents),
    rum7d: countOrNull(rum),
    currentSnapshots: countOrNull(snapshots),
    outboxDead: countOrNull(dead),
    outboxReady: countOrNull(ready),
  }, now);
  const critical = report.status === 'critical'
    || !schemaReadiness.fullyReady
    || !policy.deploymentProvenance.passed;
  if (critical) {
    logError('[blog-data-readiness] critical measurement or delivery gap', undefined, {
      checks: report.checks,
      missingSchemaResources: schemaReadiness.missing,
      deploymentProvenance: policy.deploymentProvenance,
    });
  }
  return apiResponse({
    ok: !critical,
    ...report,
    schemaReadiness,
    autopublish: {
      requestedMode: policy.requestedMode,
      effectiveMode: policy.mode,
      deploymentProvenance: policy.deploymentProvenance,
    },
  }, {
    status: critical ? 503 : 200,
  });
};

export const GET = withCronGuard(handler);
