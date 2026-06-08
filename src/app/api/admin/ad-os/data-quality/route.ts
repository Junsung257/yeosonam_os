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

function snapshotSummary(snapshot: ReturnType<typeof buildDataQualitySnapshot>) {
  return {
    status: snapshot.status,
    event_collection_rate: snapshot.events_total > 0 ? 1 : 0,
    clean_conversion_rate: snapshot.events_total > 0 ? snapshot.clean_events / snapshot.events_total : 0,
    uploadable_conversions: snapshot.upload_ready_events,
    blocked_conversions: snapshot.blocked_upload_events,
    attribution_coverage: snapshot.attribution_coverage_pct / 100,
  };
}

async function buildSnapshot(days: number, tenantId: string | null) {
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
  if (firstError) throw firstError;

  const snapshot = buildDataQualitySnapshot({
    events: eventsRes.data || [],
    uploadJobs: uploadJobsRes.data || [],
    performanceFacts: factsRes.data || [],
    periodStart,
    periodEnd,
    tenantId,
  });

  return {
    snapshot,
    latestSnapshots: latestSnapshotsRes.data || [],
  };
}

export const GET = withAdminGuard(async (request: NextRequest) => {
  if (!isSupabaseConfigured) {
    return NextResponse.json({ ok: false, error: 'Supabase not configured' }, { status: 503 });
  }

  const days = Math.min(Math.max(Number(request.nextUrl.searchParams.get('days') || 14), 1), 90);
  const tenantId = request.nextUrl.searchParams.get('tenant_id');

  try {
    const { snapshot, latestSnapshots } = await buildSnapshot(days, tenantId);
    return NextResponse.json({
      ok: true,
      snapshot,
      latest_snapshots: latestSnapshots,
      summary: snapshotSummary(snapshot),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'data quality load failed';
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
});

export const POST = withAdminGuard(async (request: NextRequest) => {
  if (!isSupabaseConfigured) {
    return NextResponse.json({ ok: false, error: 'Supabase not configured' }, { status: 503 });
  }

  const body = await request.json().catch(() => ({}));
  const apply = body.apply === true;
  const days = Math.min(Math.max(Number(body.days || 14), 1), 90);
  const tenantId = body.tenant_id ? String(body.tenant_id) : null;

  const { data: run, error: runError } = await supabaseAdmin
    .from('ad_os_automation_runs')
    .insert({
      run_type: 'data_quality_snapshot',
      mode: apply ? 'guarded' : 'dry_run',
      status: 'running',
      summary: { apply, days, tenant_id: tenantId, external_api_write: false },
    })
    .select('id')
    .single();

  if (runError || !run) {
    return NextResponse.json({ ok: false, error: runError?.message || 'run create failed' }, { status: 500 });
  }

  try {
    const { snapshot, latestSnapshots } = await buildSnapshot(days, tenantId);
    let savedSnapshotId: string | null = null;

    if (apply) {
      const { data, error } = await supabaseAdmin
        .from('ad_os_data_quality_snapshots')
        .insert(snapshot as never)
        .select('id')
        .single();
      if (error) throw error;
      savedSnapshotId = data?.id || null;
    }

    const summary = {
      ...snapshotSummary(snapshot),
      apply,
      days,
      saved_snapshot_id: savedSnapshotId,
      latest_snapshot_count: latestSnapshots.length,
      external_api_write: false,
    };

    await supabaseAdmin
      .from('ad_os_automation_runs')
      .update({ status: 'completed', finished_at: new Date().toISOString(), summary })
      .eq('id', run.id);

    return NextResponse.json({
      ok: true,
      run_id: run.id,
      snapshot,
      saved_snapshot_id: savedSnapshotId,
      latest_snapshots: latestSnapshots,
      summary,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'data quality snapshot failed';
    await supabaseAdmin
      .from('ad_os_automation_runs')
      .update({ status: 'failed', finished_at: new Date().toISOString(), errors: [{ message }] })
      .eq('id', run.id);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
});
