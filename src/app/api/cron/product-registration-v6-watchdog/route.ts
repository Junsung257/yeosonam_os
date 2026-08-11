import { randomUUID } from 'node:crypto';

import type { SupabaseClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';
import { getRun } from 'workflow/api';

import { withCronGuard } from '@/lib/cron-auth';
import { startProductRegistrationWorkflowBySourceId } from '@/lib/product-registration-authority/start-workflow';
import { getSupabaseAdmin } from '@/lib/supabase';
import { PRODUCT_REGISTRATION_V6_POLICY_VERSION } from '@/lib/product-registration-v6/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

type StaleJob = {
  id: string;
  tenant_id: string;
  source_document_id: string;
  v6_workflow_run_id: string | null;
  v6_fencing_token: number;
  v6_last_heartbeat_at: string | null;
  created_at: string;
};

async function terminallyQuarantine(input: {
  supabase: SupabaseClient;
  job: StaleJob;
  reason: string;
}) {
  if (input.job.v6_workflow_run_id) {
    await getRun(input.job.v6_workflow_run_id).cancel().catch(() => undefined);
  }
  await input.supabase.rpc('record_product_registration_v6_dead_letter', {
    p_payload: {
      tenant_id: input.job.tenant_id,
      job_id: input.job.id,
      workflow_run_id: input.job.v6_workflow_run_id,
      failed_stage: 'watchdog',
      operation_key: `${input.job.id}:${input.job.v6_fencing_token}:watchdog-timeout`,
      error_code: 'V6_WORKFLOW_MAX_AGE_EXCEEDED',
      error_detail: input.reason,
      payload: {},
    },
  });
  const { error } = await input.supabase.rpc('record_product_registration_v6_terminal_state', {
    p_payload: {
      job_id: input.job.id,
      tenant_id: input.job.tenant_id,
      workflow_run_id: input.job.v6_workflow_run_id ?? `watchdog:${randomUUID()}`,
      expected_fencing_token: input.job.v6_fencing_token,
      analysis_outcome: 'blocked',
      publication_state: 'not_requested',
      compatibility_outcome: 'blocked_action_required',
      policy_version: PRODUCT_REGISTRATION_V6_POLICY_VERSION,
      degraded_reasons: [],
      blockers: ['V6_WORKFLOW_MAX_AGE_EXCEEDED'],
    },
  });
  if (error) throw error;
}

async function restartStaleJob(input: {
  supabase: SupabaseClient;
  job: StaleJob;
  baseUrl: string;
}): Promise<{ jobId: string; workflowRunId: string }> {
  if (input.job.v6_workflow_run_id) {
    const run = getRun(input.job.v6_workflow_run_id);
    await run.cancel().catch(() => undefined);
  }
  const { error: terminalError } = await input.supabase.rpc('record_product_registration_v6_terminal_state', {
    p_payload: {
      job_id: input.job.id,
      tenant_id: input.job.tenant_id,
      workflow_run_id: input.job.v6_workflow_run_id ?? `watchdog-restart:${randomUUID()}`,
      expected_fencing_token: input.job.v6_fencing_token,
      analysis_outcome: 'blocked',
      publication_state: 'not_requested',
      compatibility_outcome: 'blocked_action_required',
      policy_version: PRODUCT_REGISTRATION_V6_POLICY_VERSION,
      degraded_reasons: [],
      blockers: ['V6_WORKFLOW_REPLACED_BY_WATCHDOG'],
    },
  });
  if (terminalError) throw terminalError;
  const started = await startProductRegistrationWorkflowBySourceId({
    supabase: input.supabase,
    tenantId: input.job.tenant_id,
    sourceDocumentId: input.job.source_document_id,
    requestBaseUrl: input.baseUrl,
    publicBaseUrl: input.baseUrl,
    sourceChannel: 'v6-watchdog-recovery',
    forceReprocess: true,
  });
  return { jobId: started.jobId, workflowRunId: started.workflowRunId };
}

async function handler(): Promise<NextResponse> {
  const adminClient = getSupabaseAdmin();
  if (!adminClient) return NextResponse.json({ success: false, code: 'SUPABASE_ADMIN_UNAVAILABLE' }, { status: 503 });
  const supabase = adminClient as SupabaseClient;
  const now = Date.now();
  const staleBefore = new Date(now - 30 * 60_000).toISOString();
  const { data, error } = await supabase
    .from('upload_jobs')
    .select('id,tenant_id,source_document_id,v6_workflow_run_id,v6_fencing_token,v6_last_heartbeat_at,created_at')
    .is('v6_outcome', null)
    .not('source_document_id', 'is', null)
    .lt('v6_last_heartbeat_at', staleBefore)
    .order('v6_last_heartbeat_at', { ascending: true })
    .limit(20);
  if (error) throw error;
  const jobs = (data ?? []) as StaleJob[];
  const results: Array<Record<string, unknown>> = [];
  const baseUrl = (process.env.NEXT_PUBLIC_BASE_URL ?? process.env.NEXT_PUBLIC_SITE_URL ?? 'https://www.yeosonam.com').replace(/\/$/, '');
  for (const job of jobs) {
    const ageMs = now - new Date(job.created_at).getTime();
    try {
      if (ageMs >= 2 * 60 * 60_000) {
        await terminallyQuarantine({ supabase, job, reason: `job age ${Math.round(ageMs / 60_000)}m` });
        results.push({ jobId: job.id, action: 'quarantined', ok: true });
        continue;
      }
      const restarted = await restartStaleJob({
        supabase,
        job,
        baseUrl,
      });
      results.push({
        jobId: job.id,
        replacementJobId: restarted.jobId,
        action: 'restarted',
        workflowRunId: restarted.workflowRunId,
        ok: true,
      });
    } catch (jobError) {
      results.push({ jobId: job.id, action: 'error', ok: false, error: jobError instanceof Error ? jobError.message : String(jobError) });
    }
  }
  return NextResponse.json({ success: true, checked: jobs.length, results }, { headers: { 'Cache-Control': 'no-store' } });
}

export const GET = withCronGuard(handler);
