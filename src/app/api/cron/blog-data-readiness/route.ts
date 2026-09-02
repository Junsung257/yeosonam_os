import { NextRequest } from 'next/server';
import { apiResponse } from '@/lib/api-response';
import { withCronGuard } from '@/lib/cron-auth';
import { supabaseAdmin } from '@/lib/supabase';
import { evaluateBlogDataReadinessV3 } from '@/lib/blog-data-readiness-v3';
import { readBlogAutopublishPolicyV3 } from '@/lib/blog-autopublish-policy-v3';
import { probeBlogRuntimeSchemaWithSupabaseV3 } from '@/lib/blog-runtime-readiness-v3';
import { logError } from '@/lib/sentry-logger';
import { PUBLIC_BLOG_READ_SOURCE } from '@/lib/blog-public-eligibility';
import { buildBlogPublicSnapshotParityDiagnosticsV3 } from '@/lib/blog-public-snapshot-parity-v3';
import { readImmutableRemoteSnapshotConfigV3 } from '@/lib/blog-public-remote-snapshot-v3';
import {
  inngest,
  inngestFunctions,
  MINIMUM_INNGEST_FUNCTION_COUNT,
} from '@/inngest';
import { isInngestBlogAutopilotConfigured } from '@/inngest/runtime-policy';

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
  const [search, engagement, serverEvents, syntheticServerEvents, recentSyntheticCanary, rum, snapshots, dead, ready, liveSlugs, snapshotSlugs] = await Promise.all([
    supabaseAdmin.from('blog_search_performance').select('id', { count: 'exact', head: true }).gte('metric_date', daysAgo(30).slice(0, 10)),
    supabaseAdmin.from('blog_engagement_logs').select('id', { count: 'exact', head: true }).gte('created_at', daysAgo(7)),
    supabaseAdmin.from('analytics_server_events').select('id', { count: 'exact', head: true }).gte('occurred_at', daysAgo(30)),
    supabaseAdmin.from('analytics_server_events').select('id', { count: 'exact', head: true })
      .gte('occurred_at', daysAgo(30)).contains('event_payload', { __synthetic: true }),
    supabaseAdmin.from('analytics_server_events').select('id', { count: 'exact', head: true })
      .gte('occurred_at', daysAgo(1)).contains('event_payload', { __synthetic: true }),
    supabaseAdmin.from('web_vitals').select('id', { count: 'exact', head: true }).gte('created_at', daysAgo(7)),
    supabaseAdmin.from('blog_public_snapshots').select('creative_id', { count: 'exact', head: true }).eq('is_current', true),
    supabaseAdmin.from('analytics_server_event_outbox').select('id', { count: 'exact', head: true }).eq('status', 'dead'),
    supabaseAdmin.from('analytics_server_event_outbox').select('id', { count: 'exact', head: true }).in('status', ['pending', 'failed', 'processing']),
    supabaseAdmin.from(PUBLIC_BLOG_READ_SOURCE).select('id,slug').order('slug').limit(1000),
    supabaseAdmin.from('blog_public_snapshots').select('creative_id,slug').eq('is_current', true).order('slug').limit(1000),
  ]);
  const snapshotParity = liveSlugs.error || snapshotSlugs.error
    ? null
    : buildBlogPublicSnapshotParityDiagnosticsV3({
      live: liveSlugs.data || [],
      snapshot: snapshotSlugs.data || [],
    });
  const remoteSnapshots = {
    catalog: Boolean(readImmutableRemoteSnapshotConfigV3({
      url: process.env.BLOG_PUBLIC_CATALOG_LKG_URL,
      sha256: process.env.BLOG_PUBLIC_CATALOG_LKG_SHA256,
    })),
    detail: Boolean(readImmutableRemoteSnapshotConfigV3({
      url: process.env.BLOG_PUBLIC_DETAIL_LKG_URL,
      sha256: process.env.BLOG_PUBLIC_DETAIL_LKG_SHA256,
    })),
  };
  const automation = {
    endpointPath: '/api/inngest',
    mode: inngest.mode,
    hasEventKey: Boolean(String(process.env.INNGEST_EVENT_KEY || '').trim()),
    hasSigningKey: Boolean(String(process.env.INNGEST_SIGNING_KEY || '').trim()),
    functionCount: inngestFunctions.length,
    minimumFunctionCount: MINIMUM_INNGEST_FUNCTION_COUNT,
    configured: isInngestBlogAutopilotConfigured(),
  };
  const report = evaluateBlogDataReadinessV3({
    searchPerformance30d: countOrNull(search),
    engagement7d: countOrNull(engagement),
    serverEvents30d: serverEvents.error || syntheticServerEvents.error
      ? null
      : Math.max(0, Number(serverEvents.count || 0) - Number(syntheticServerEvents.count || 0)),
    rum7d: countOrNull(rum),
    currentSnapshots: countOrNull(snapshots),
    outboxDead: countOrNull(dead),
    outboxReady: countOrNull(ready),
  }, now);
  const critical = report.status === 'critical'
    || !schemaReadiness.fullyReady
    || !policy.deploymentProvenance.passed
    || snapshotParity?.parity !== true
    || !remoteSnapshots.catalog
    || !remoteSnapshots.detail
    || !automation.configured
    || automation.mode !== 'cloud'
    || automation.functionCount < automation.minimumFunctionCount
    || recentSyntheticCanary.error
    || Number(recentSyntheticCanary.count || 0) === 0;
  if (critical) {
    logError('[blog-data-readiness] critical measurement or delivery gap', undefined, {
      checks: report.checks,
      missingSchemaResources: schemaReadiness.missing,
      deploymentProvenance: policy.deploymentProvenance,
      snapshotParity,
      remoteSnapshots,
      automation,
      analyticsCanary24h: countOrNull(recentSyntheticCanary),
    });
  }
  return apiResponse({
    ok: !critical,
    ...report,
    schemaReadiness,
    snapshotParity,
    remoteSnapshots,
    automation,
    analyticsCanary24h: countOrNull(recentSyntheticCanary),
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
