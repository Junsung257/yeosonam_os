import { NextRequest, NextResponse } from 'next/server';
import { buildDataQualitySnapshot } from '@/lib/ad-os-v41-v60';
import { withAdminGuard } from '@/lib/admin-guard';
import { isSupabaseConfigured, supabaseAdmin } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

function daysAgo(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return date.toISOString();
}

export const GET = withAdminGuard(async (request: NextRequest) => {
  if (!isSupabaseConfigured) {
    return NextResponse.json({ ok: false, error: 'Supabase not configured' }, { status: 503 });
  }

  const days = Math.min(Math.max(Number(request.nextUrl.searchParams.get('days') || 14), 1), 90);
  const tenantId = request.nextUrl.searchParams.get('tenant_id');
  const since = daysAgo(days);
  const periodStart = since.slice(0, 10);
  const periodEnd = new Date().toISOString().slice(0, 10);

  let eventsQuery = supabaseAdmin
    .from('ad_os_conversion_events')
    .select('*')
    .gte('event_time', since)
    .order('event_time', { ascending: false })
    .limit(2000);
  let uploadJobsQuery = supabaseAdmin
    .from('ad_os_conversion_upload_jobs')
    .select('*')
    .gte('created_at', since)
    .order('created_at', { ascending: false })
    .limit(2000);
  let factsQuery = supabaseAdmin
    .from('ad_os_performance_facts')
    .select('*')
    .gte('event_date', periodStart)
    .order('event_date', { ascending: false })
    .limit(2000);
  let latestSnapshotsQuery = supabaseAdmin
    .from('ad_os_data_quality_snapshots')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(12);

  if (tenantId) {
    eventsQuery = eventsQuery.eq('tenant_id', tenantId);
    uploadJobsQuery = uploadJobsQuery.eq('tenant_id', tenantId);
    factsQuery = factsQuery.eq('tenant_id', tenantId);
    latestSnapshotsQuery = latestSnapshotsQuery.eq('tenant_id', tenantId);
  }

  const [eventsRes, uploadJobsRes, factsRes, latestSnapshotsRes] = await Promise.all([
    eventsQuery,
    uploadJobsQuery,
    factsQuery,
    latestSnapshotsQuery,
  ]);
  const firstError = eventsRes.error || uploadJobsRes.error || factsRes.error || latestSnapshotsRes.error;
  if (firstError) return NextResponse.json({ ok: false, error: firstError.message }, { status: 500 });

  const snapshot = buildDataQualitySnapshot({
    events: eventsRes.data || [],
    uploadJobs: uploadJobsRes.data || [],
    performanceFacts: factsRes.data || [],
    periodStart,
    periodEnd,
    tenantId,
  });

  return NextResponse.json({
    ok: true,
    snapshot,
    latest_snapshots: latestSnapshotsRes.data || [],
    summary: {
      status: snapshot.status,
      event_collection_rate: snapshot.events_total > 0 ? 1 : 0,
      clean_conversion_rate: snapshot.events_total > 0 ? snapshot.clean_events / snapshot.events_total : 0,
      uploadable_conversions: snapshot.upload_ready_events,
      blocked_conversions: snapshot.blocked_upload_events,
      attribution_coverage: snapshot.attribution_coverage_pct / 100,
    },
  });
});
