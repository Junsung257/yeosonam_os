import { NextRequest, NextResponse } from 'next/server';

import { withAdminGuard } from '@/lib/admin-guard';
import { isSupabaseConfigured, supabaseAdmin } from '@/lib/supabase';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type ReplayState = 'pending' | 'resolved' | 'failed' | 'skipped' | 'unknown';

function stringValue(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    : [];
}

function normalizeState(value: unknown): ReplayState {
  const status = String(value ?? '').trim().toLowerCase();
  if (status === 'resolved' || status === 'replayed') return 'resolved';
  if (status === 'failed') return 'failed';
  if (status === 'skipped') return 'skipped';
  if (status === 'pending' || status === 'review') return 'pending';
  return 'unknown';
}

function terminalReplayState(outcome: string | null): ReplayState {
  if (!outcome) return 'pending';
  if (outcome === 'published_verified' || outcome === 'published_degraded'
    || outcome === 'ready_verified_not_published' || outcome === 'ready_degraded_not_published') return 'resolved';
  if (outcome === 'discarded_source_incomplete' || outcome === 'discarded_non_travel'
    || outcome === 'discarded_duplicate_or_consolidated' || outcome === 'archived_all_departures_past') return 'skipped';
  if (outcome === 'blocked_action_required' || outcome.startsWith('quarantined_')) return 'failed';
  return 'unknown';
}

function packageIdsFromKernelState(state: unknown): string[] {
  const record = asRecord(state);
  return [...new Set([
    ...stringArray(record.packageIds),
    ...(stringValue(record.packageId) ? [stringValue(record.packageId)!] : []),
  ])];
}

function kernelRegisterReport(packageIds: string[], terminalOutcome: string | null) {
  const isPublished = terminalOutcome === 'published_verified' || terminalOutcome === 'published_degraded';
  return packageIds.map(packageId => ({
    package_id: packageId,
    short_code: null,
    title: null,
    price: null,
    airline: null,
    status: isPublished ? 'published' : 'review',
    departure_days: null,
    mobile_url: `/packages/${packageId}`,
    lp_url: `/lp/${packageId}`,
    a4_url: `/admin/packages/${packageId}/a4`,
    price_dates_count: null,
    itinerary_days_count: null,
  }));
}

const getHandler = async (request: NextRequest) => {
  if (!isSupabaseConfigured) {
    return NextResponse.json({ success: false, error: 'Supabase is not configured.' }, { status: 503 });
  }

  const queueId = request.nextUrl.searchParams.get('queueId')?.trim();
  const uploadRequestId = request.nextUrl.searchParams.get('uploadRequestId')?.trim();
  if (!queueId && !uploadRequestId) {
    return NextResponse.json(
      { success: false, error: 'queueId or uploadRequestId is required.' },
      { status: 400 },
    );
  }

  let query = supabaseAdmin
    .from('upload_review_queue')
    .select('id,status,error_reason,parsed_draft_json,product_title,updated_at')
    .order('updated_at', { ascending: false })
    .limit(1);
  if (queueId) {
    query = query.eq('id', queueId);
  } else {
    query = query.ilike('error_reason', `%uploadRequestId=${uploadRequestId}%`);
  }

  const { data, error } = await query.maybeSingle();
  if (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json({ success: true, state: 'unknown', queueId, uploadRequestId }, { status: 200 });
  }

  const draft = asRecord(data.parsed_draft_json);
  const replayResult = asRecord(draft.replayResult);
  const jobId = stringValue(replayResult.jobId);
  const workflowRunId = stringValue(replayResult.workflowRunId);
  let terminalOutcome: string | null = null;
  let publicationState: string | null = null;
  let blockers: string[] = [];
  let degradedReasons: string[] = [];
  let packageIds: string[] = [];
  if (jobId) {
    const { data: job, error: jobError } = await supabaseAdmin
      .from('upload_jobs')
      .select('id,v6_workflow_run_id,v6_outcome,v6_publication_state,v6_blockers,v6_degraded_reasons,v4_stage_state')
      .eq('id', jobId)
      .maybeSingle();
    if (jobError) throw new Error(jobError.message);
    if (job) {
      terminalOutcome = stringValue(job.v6_outcome);
      publicationState = stringValue(job.v6_publication_state);
      blockers = stringArray(job.v6_blockers);
      degradedReasons = stringArray(job.v6_degraded_reasons);
      packageIds = packageIdsFromKernelState(job.v4_stage_state);
    }
  }
  const registerReport = kernelRegisterReport(packageIds, terminalOutcome);
  const replayState = jobId ? terminalReplayState(terminalOutcome) : normalizeState(replayResult.status);
  const queueState = normalizeState(data.status);
  const state = replayState === 'unknown' ? queueState : replayState;

  return NextResponse.json({
    success: true,
    queueId: data.id,
    uploadRequestId: uploadRequestId ?? stringValue(draft.uploadRequestId),
    state,
    title: data.product_title ?? null,
    updatedAt: data.updated_at ?? null,
    jobId,
    workflowRunId,
    terminalOutcome,
    publicationState,
    blockers,
    degradedReasons,
    savedIds: packageIds,
    registerReport,
    message: blockers[0] ?? replayResult.reason ?? data.error_reason ?? null,
  });
};

export const GET = withAdminGuard(getHandler);
