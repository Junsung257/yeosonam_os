import { randomUUID } from 'node:crypto';

import type { SupabaseClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';
import { getRun, start } from 'workflow/api';

import { withCronGuard } from '@/lib/cron-auth';
import { getSupabaseAdmin } from '@/lib/supabase';
import { parseUploadSourceMetadata } from '@/lib/upload-source-metadata';
import {
  PRODUCT_REGISTRATION_V6_POLICY_VERSION,
  type ProductRegistrationV6WorkflowInput,
} from '@/lib/product-registration-v6/types';
import { productRegistrationV6Workflow } from '@/workflows/product-registration-v6';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

type StaleJob = {
  id: string;
  source_document_id: string;
  v6_workflow_run_id: string | null;
  v6_fencing_token: number;
  v6_last_heartbeat_at: string | null;
  created_at: string;
};

type SourceDocument = {
  id: string;
  original_filename: string;
  declared_mime: string | null;
  source_type: ProductRegistrationV6WorkflowInput['sourceType'];
  sha256: string;
  metadata: Record<string, unknown> | null;
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
      tenant_id: null,
      job_id: input.job.id,
      workflow_run_id: input.job.v6_workflow_run_id,
      failed_stage: 'watchdog',
      operation_key: `${input.job.id}:${input.job.v6_fencing_token}:watchdog-timeout`,
      error_code: 'V6_WORKFLOW_MAX_AGE_EXCEEDED',
      error_detail: input.reason,
      payload: {},
    },
  });
  const { error } = await input.supabase.rpc('record_product_registration_v6_terminal_outcome', {
    p_job_id: input.job.id,
    p_workflow_run_id: input.job.v6_workflow_run_id ?? `watchdog:${randomUUID()}`,
    p_expected_fencing_token: input.job.v6_fencing_token,
    p_outcome: 'blocked_action_required',
    p_policy_version: PRODUCT_REGISTRATION_V6_POLICY_VERSION,
    p_degraded_reasons: [],
    p_blockers: ['V6_WORKFLOW_MAX_AGE_EXCEEDED'],
  });
  if (error) throw error;
}

async function restartStaleJob(input: {
  supabase: SupabaseClient;
  job: StaleJob;
  source: SourceDocument;
  baseUrl: string;
}): Promise<string> {
  if (input.job.v6_workflow_run_id) {
    const run = getRun(input.job.v6_workflow_run_id);
    await run.cancel().catch(() => undefined);
  }
  const { data: claim, error: claimError } = await input.supabase.rpc('claim_product_registration_v6_workflow', {
    p_job_id: input.job.id,
  });
  if (claimError) throw claimError;
  const fencingToken = Number((claim as { fencing_token?: unknown } | null)?.fencing_token);
  if (!Number.isInteger(fencingToken) || fencingToken <= input.job.v6_fencing_token) {
    throw new Error('V6_WATCHDOG_FENCING_TOKEN_INVALID');
  }
  const uploadMetadata = input.source.metadata?.uploadSourceMetadata;
  const workflowInput: ProductRegistrationV6WorkflowInput = {
    jobId: input.job.id,
    sourceDocumentId: input.source.id,
    requestId: randomUUID(),
    requestBaseUrl: input.baseUrl,
    publicBaseUrl: input.baseUrl,
    sourceType: input.source.source_type,
    fileName: input.source.original_filename,
    declaredMime: input.source.declared_mime,
    fileHash: input.source.sha256,
    directRawText: null,
    originalRawText: null,
    parserRawText: null,
    analysisNormalizedText: null,
    uploadSourceMetadata: uploadMetadata && typeof uploadMetadata === 'object' && !Array.isArray(uploadMetadata)
      ? uploadMetadata as Record<string, unknown>
      : parseUploadSourceMetadata({ fileName: input.source.original_filename, defaultCommissionRate: 10 }) as unknown as Record<string, unknown>,
    archiveMode: false,
    bulkMode: false,
    forceReprocess: true,
    fencingToken,
    policyVersion: PRODUCT_REGISTRATION_V6_POLICY_VERSION,
  };
  const run = await start(productRegistrationV6Workflow, [workflowInput]);
  return run.runId;
}

async function handler(): Promise<NextResponse> {
  const adminClient = getSupabaseAdmin();
  if (!adminClient) return NextResponse.json({ success: false, code: 'SUPABASE_ADMIN_UNAVAILABLE' }, { status: 503 });
  const supabase = adminClient as SupabaseClient;
  const now = Date.now();
  const staleBefore = new Date(now - 30 * 60_000).toISOString();
  const { data, error } = await supabase
    .from('upload_jobs')
    .select('id,source_document_id,v6_workflow_run_id,v6_fencing_token,v6_last_heartbeat_at,created_at')
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
      const { data: source, error: sourceError } = await supabase
        .from('product_source_documents')
        .select('id,original_filename,declared_mime,source_type,sha256,metadata')
        .eq('id', job.source_document_id)
        .single();
      if (sourceError || !source) throw sourceError ?? new Error('V6_WATCHDOG_SOURCE_MISSING');
      const workflowRunId = await restartStaleJob({
        supabase,
        job,
        source: source as SourceDocument,
        baseUrl,
      });
      results.push({ jobId: job.id, action: 'restarted', workflowRunId, ok: true });
    } catch (jobError) {
      results.push({ jobId: job.id, action: 'error', ok: false, error: jobError instanceof Error ? jobError.message : String(jobError) });
    }
  }
  return NextResponse.json({ success: true, checked: jobs.length, results }, { headers: { 'Cache-Control': 'no-store' } });
}

export const GET = withCronGuard(handler);
