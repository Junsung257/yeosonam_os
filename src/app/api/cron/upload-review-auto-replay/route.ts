import { randomUUID } from 'crypto';

import { after as nextAfter, NextRequest, NextResponse } from 'next/server';

import { postAlert } from '@/lib/admin-alerts';
import { cronUnauthorizedResponse, isCronAuthorized } from '@/lib/cron-auth';
import { maybeSkipNonCriticalCron } from '@/lib/cron-resource-saver';
import { analyzeUploadInputText } from '@/lib/product-registration-input-guard';
import type { UploadReviewQueueFixtureRow } from '@/lib/product-registration/review-queue-fixture-candidates';
import { buildUploadReviewRegressionReport } from '@/lib/product-registration/upload-review-regression-verifier';
import { runUploadRegistrationPipeline } from '@/lib/product-registration/upload-registration-pipeline';
import { isSupabaseConfigured, supabaseAdmin } from '@/lib/supabase';
import { runSupabaseQueryWithTimeout } from '@/lib/supabase-query-guard';
import { parseUploadSourceMetadata } from '@/lib/upload-source-metadata';

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

function safeAfter(task: () => Promise<void> | void): void {
  try {
    nextAfter(task);
  } catch (error) {
    if (error instanceof Error && error.message.includes('outside a request scope')) {
      void Promise.resolve()
        .then(task)
        .catch(err => console.warn('[upload-review-auto-replay] deferred task failed:', err instanceof Error ? err.message : err));
      return;
    }
    throw error;
  }
}

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

function extractSavedIds(payload: Record<string, unknown>): string[] {
  if (Array.isArray(payload.dbIds)) {
    return payload.dbIds.filter((id): id is string => typeof id === 'string' && id.trim().length > 0);
  }
  return typeof payload.dbId === 'string' && payload.dbId.trim() ? [payload.dbId] : [];
}

function extractDuplicateInternalCode(payload: Record<string, unknown>): string | null {
  if (payload.duplicate !== true) return null;
  return typeof payload.internal_code === 'string' && payload.internal_code.trim()
    ? payload.internal_code.trim()
    : null;
}

async function replayRow(row: UploadReviewQueueFixtureRow, request: NextRequest): Promise<ReplaySummary> {
  const rawText = row.raw_text_chunk?.trim() ?? '';
  if (rawText.length < 50) {
    return {
      id: row.id,
      title: row.product_title,
      status: 'skipped',
      reason: 'saved raw text is missing or too short',
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
  if (inputAnalysisForTrust.blocked) {
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
    defaultCommissionRate: 10,
  });

  const shouldUseDuplicateGuard = row.error_reason?.includes('UPLOAD_PIPELINE_SOFT_TIMEOUT') ?? false;
  const result = await runUploadRegistrationPipeline({
    intake: {
      ok: true,
      buffer: Buffer.from(rawText, 'utf8'),
      fileHash: row.file_hash || randomUUID(),
      fileName: sourceLabel,
      directRawText: rawText,
      originalRawText: rawText,
      parserRawText: metadata.parserRawText ?? rawText,
      documentRawText: rawText,
      analysisNormalizedText: inputAnalysisForTrust.normalizedText,
      uploadSourceMetadata: metadata,
      inputAnalysisForTrust,
      archiveMode: false,
      bulkMode: false,
      forceReprocess: !shouldUseDuplicateGuard,
    },
    supabase: supabaseAdmin,
    isSupabaseConfigured,
    safeAfter,
    postAlert,
    requestBaseUrl: request.nextUrl.origin,
    publicBaseUrl: process.env.NEXT_PUBLIC_BASE_URL ?? process.env.NEXT_PUBLIC_SITE_URL ?? '',
  });

  const payload = result.payload as Record<string, unknown>;
  const savedIds = extractSavedIds(payload);
  const duplicateInternalCode = extractDuplicateInternalCode(payload);
  if (result.status >= 200 && result.status < 300 && (savedIds.length > 0 || duplicateInternalCode)) {
    await supabaseAdmin
      .from('upload_review_queue')
      .update({
        status: 'resolved',
        updated_at: new Date().toISOString(),
      })
      .eq('id', row.id);

    return {
      id: row.id,
      title: row.product_title,
      status: 'replayed',
      reason: duplicateInternalCode ? `duplicate already processed: ${duplicateInternalCode}` : check.reason,
      httpStatus: result.status,
      savedIds,
    };
  }

  return {
    id: row.id,
    title: row.product_title,
    status: 'failed',
    reason: typeof payload.error === 'string' ? payload.error : 'replay did not save a product',
    httpStatus: result.status,
    savedIds,
  };
}

export async function GET(request: NextRequest) {
  if (!isCronAuthorized(request)) return cronUnauthorizedResponse();
  const resourceSaver = maybeSkipNonCriticalCron(request, 'upload-review-auto-replay');
  if (resourceSaver) return resourceSaver;

  if (!isSupabaseConfigured) {
    return NextResponse.json({ ok: false, error: 'Supabase is not configured.' }, { status: 503 });
  }

  const limit = clampLimit(request.nextUrl.searchParams.get('limit'));
  const queueId = request.nextUrl.searchParams.get('queueId')?.trim();
  let query = supabaseAdmin
    .from('upload_review_queue')
    .select('id,created_at,status,severity,error_reason,source_filename,file_hash,normalized_content_hash,raw_text_chunk,parsed_draft_json,product_title,land_operator_id')
    .eq('status', 'pending')
    .in('severity', ['critical', 'high'])
    .not('raw_text_chunk', 'is', null);

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
