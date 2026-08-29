import { randomUUID } from 'crypto';

import { NextRequest, NextResponse } from 'next/server';

import { cronUnauthorizedResponse, isCronAuthorized } from '@/lib/cron-auth';
import { maybeSkipNonCriticalCron } from '@/lib/cron-resource-saver';
import { analyzeUploadInputText } from '@/lib/product-registration-input-guard';
import {
  startProductRegistrationTextWorkflow,
  startProductRegistrationWorkflowBySourceId,
} from '@/lib/product-registration-authority/start-workflow';
import { parseProductRegistrationTenantId } from '@/lib/product-registration-authority/types';
import type { UploadReviewQueueFixtureRow } from '@/lib/product-registration/review-queue-fixture-candidates';
import { buildUploadReviewRegressionReport } from '@/lib/product-registration/upload-review-regression-verifier';
import { getProductRegistrationV6RuntimeConfig } from '@/lib/product-registration-v6/runtime-config';
import { isSupabaseConfigured, supabaseAdmin } from '@/lib/supabase';
import { runSupabaseQueryWithTimeout } from '@/lib/supabase-query-guard';
import { DEFAULT_PRODUCT_REGISTRATION_COMMISSION_RATE, parseUploadSourceMetadata } from '@/lib/upload-source-metadata';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 300;

type ReplaySummary = {
  id: string;
  title: string | null;
  status: 'replayed' | 'skipped' | 'failed';
  reason: string;
  httpStatus?: number;
  savedIds?: string[];
  jobId?: string;
  workflowRunId?: string;
};

const RECOVERABLE_REASON_PATTERNS = [
  /itinerary duplicate day/i,
  /duration overflow/i,
  /product_prices missing/i,
  /price_dates missing/i,
  /price date disagreement/i,
  /price amount disagreement/i,
  /model-derived price source/i,
  /Too Many Requests/i,
  /flight time source mismatch/i,
  /destination code unresolved/i,
  /Destination resolution failed/i,
  /destination_code:UNK/i,
  /catalog split/i,
  /PRODUCT_COUNT_MISMATCH/i,
  /UPLOAD_PIPELINE_SOFT_TIMEOUT/i,
  /UPLOAD_PIPELINE_DEFERRED_FOR_REPLAY/i,
];

function clampLimit(value: string | null): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 10;
  return Math.max(1, Math.min(10, Math.trunc(parsed)));
}

function replayFetchLimit(limit: number): number {
  return Math.min(25, Math.max(limit, limit * 5));
}

function isRecoverableReviewQueueReason(errorReason: string | null | undefined): boolean {
  if (!errorReason) return false;
  return RECOVERABLE_REASON_PATTERNS.some(pattern => pattern.test(errorReason));
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

async function replayRow(row: UploadReviewQueueFixtureRow, request: NextRequest): Promise<ReplaySummary> {
  const rawText = row.raw_text_chunk?.trim() ?? '';
  const tenantId = parseProductRegistrationTenantId(row.tenant_id);
  if (!tenantId) {
    return {
      id: row.id,
      title: row.product_title,
      status: 'skipped',
      reason: 'tenant ownership is missing; automatic replay is not allowed',
    };
  }
  const sourceDocumentId = row.source_document_id?.trim() || null;
  const parsedDraftJson = asRecord(row.parsed_draft_json);
  if (!sourceDocumentId && rawText.length < 50) {
    return {
      id: row.id,
      title: row.product_title,
      status: 'skipped',
      reason: 'immutable source and replayable raw text are both missing',
    };
  }
  if (!sourceDocumentId && parsedDraftJson.rawTextTruncated === true) {
    return {
      id: row.id,
      title: row.product_title,
      status: 'skipped',
      reason: 'legacy replay text is truncated; immutable source is required',
    };
  }

  const report = buildUploadReviewRegressionReport({ rows: [row] });
  const check = report.checks[0];
  if (!check || !check.supported || check.status !== 'passed') {
    return {
      id: row.id,
      title: row.product_title,
      status: 'skipped',
      reason: check?.reason ?? 'no deterministic replay checker accepted this row',
    };
  }

  const inputAnalysisForTrust = analyzeUploadInputText(rawText);
  if (!sourceDocumentId && inputAnalysisForTrust.blocked) {
    return {
      id: row.id,
      title: row.product_title,
      status: 'skipped',
      reason: 'saved source text did not pass upload input quality checks',
    };
  }

  const sourceLabel = row.source_filename?.trim() || row.product_title?.trim() || 'upload-review-auto-replay.txt';
  const metadata = parseUploadSourceMetadata({
    rawText,
    sourceLabel,
    defaultCommissionRate: DEFAULT_PRODUCT_REGISTRATION_COMMISSION_RATE,
  });

  const shouldUseDuplicateGuard = row.error_reason?.includes('UPLOAD_PIPELINE_SOFT_TIMEOUT') ?? false;
  const requestId = randomUUID();
  const publicBaseUrl = process.env.NEXT_PUBLIC_BASE_URL
    ?? process.env.NEXT_PUBLIC_SITE_URL
    ?? request.nextUrl.origin;
  const started = sourceDocumentId
    ? await startProductRegistrationWorkflowBySourceId({
        supabase: supabaseAdmin,
        tenantId,
        sourceDocumentId,
        requestId,
        requestBaseUrl: request.nextUrl.origin,
        publicBaseUrl,
        uploadSourceMetadata: metadata as unknown as Record<string, unknown>,
        sourceChannel: 'cron-review-replay',
        forceReprocess: !shouldUseDuplicateGuard,
      })
    : await startProductRegistrationTextWorkflow({
        supabase: supabaseAdmin,
        tenantId,
        rawText,
        fileName: sourceLabel,
        requestId,
        requestBaseUrl: request.nextUrl.origin,
        publicBaseUrl,
        uploadSourceMetadata: metadata as unknown as Record<string, unknown>,
        sourceChannel: 'cron-review-replay',
        forceReprocess: !shouldUseDuplicateGuard,
        metadata: { replayQueueId: row.id },
      });
  await supabaseAdmin
    .from('upload_review_queue')
    .update({
      status: 'resolved',
      parsed_draft_json: {
        ...parsedDraftJson,
        replayResult: {
          status: 'pending',
          reason: check.reason,
          jobId: started.jobId,
          workflowRunId: started.workflowRunId,
          sourceDocumentId: started.sourceDocumentId,
          replayedAt: new Date().toISOString(),
        },
      },
      updated_at: new Date().toISOString(),
    })
    .eq('id', row.id);

  return {
    id: row.id,
    title: row.product_title,
    status: 'replayed',
    reason: check.reason,
    httpStatus: 202,
    jobId: started.jobId,
    workflowRunId: started.workflowRunId ?? undefined,
  };
}

export async function GET(request: NextRequest) {
  if (!isCronAuthorized(request)) return cronUnauthorizedResponse();
  const resourceSaver = maybeSkipNonCriticalCron(request, 'upload-review-auto-replay');
  if (resourceSaver) return resourceSaver;

  if (!isSupabaseConfigured) {
    return NextResponse.json({ ok: false, error: 'Supabase is not configured.' }, { status: 503 });
  }
  if (!getProductRegistrationV6RuntimeConfig().workflowEnabled) {
    return NextResponse.json({
      ok: false,
      code: 'REGISTRATION_KERNEL_WORKFLOW_DISABLED',
      error: '통합 상품등록 Workflow가 비활성 상태라 구형 저장 엔진으로 우회하지 않았습니다.',
    }, { status: 503 });
  }

  const limit = clampLimit(request.nextUrl.searchParams.get('limit'));
  const queueId = request.nextUrl.searchParams.get('queueId')?.trim();
  let query = supabaseAdmin
    .from('upload_review_queue')
    .select('id,tenant_id,source_document_id,upload_job_id,created_at,status,severity,error_reason,source_filename,file_hash,normalized_content_hash,raw_text_chunk,parsed_draft_json,product_title,land_operator_id')
    .eq('status', 'pending')
    .in('severity', ['critical', 'high'])
    .not('tenant_id', 'is', null);

  if (queueId) {
    query = query.eq('id', queueId);
  } else {
    query = query
      .order('created_at', { ascending: false })
      .limit(replayFetchLimit(limit));
  }

  const { data, error } = await runSupabaseQueryWithTimeout(query, {
    label: 'cron.upload-review-auto-replay.pick',
    timeoutMs: 4000,
  });

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  const fetchedRows = (data ?? []) as UploadReviewQueueFixtureRow[];
  const rows = queueId
    ? fetchedRows
    : fetchedRows.filter(row => isRecoverableReviewQueueReason(row.error_reason)).slice(0, limit);
  const results: ReplaySummary[] = [];
  for (const row of rows) {
    try {
      results.push(await replayRow(row, request));
    } catch (err) {
      results.push({
        id: row.id,
        title: row.product_title,
        status: 'failed',
        reason: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return NextResponse.json({
    ok: results.every(result => result.status !== 'failed'),
    picked: rows.length,
    replayed: results.filter(result => result.status === 'replayed').length,
    skipped: results.filter(result => result.status === 'skipped').length,
    failed: results.filter(result => result.status === 'failed').length,
    results,
  });
}
