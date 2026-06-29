import { randomUUID } from 'crypto';

import { after as nextAfter, NextRequest, NextResponse } from 'next/server';

import { withAdminGuard } from '@/lib/admin-guard';
import { postAlert } from '@/lib/admin-alerts';
import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';
import { analyzeUploadInputText } from '@/lib/product-registration-input-guard';
import { parseUploadSourceMetadata } from '@/lib/upload-source-metadata';
import { runUploadRegistrationPipeline } from '@/lib/product-registration/upload-registration-pipeline';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

type ReplayBody = {
  queueId?: unknown;
  forceReprocess?: unknown;
  sourceLabel?: unknown;
  commissionRate?: unknown;
};

function safeAfter(task: () => Promise<void> | void): void {
  try {
    nextAfter(task);
  } catch (error) {
    if (error instanceof Error && error.message.includes('outside a request scope')) {
      void Promise.resolve()
        .then(task)
        .catch(err => console.warn('[upload-review-replay] deferred task failed:', err instanceof Error ? err.message : err));
      return;
    }
    throw error;
  }
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

const postHandler = async (request: NextRequest) => {
  if (!isSupabaseConfigured) {
    return NextResponse.json({ success: false, error: 'Supabase is not configured.' }, { status: 503 });
  }

  const requestId = randomUUID();
  let body: ReplayBody;
  try {
    body = await request.json() as ReplayBody;
  } catch {
    return NextResponse.json(
      { success: false, error: 'JSON body is required.', uploadRequestId: requestId },
      { status: 400 },
    );
  }

  const queueId = stringValue(body.queueId);
  if (!queueId) {
    return NextResponse.json(
      { success: false, error: 'queueId is required.', uploadRequestId: requestId },
      { status: 400 },
    );
  }

  const { data: queueRow, error: queueError } = await supabaseAdmin
    .from('upload_review_queue')
    .select('id, raw_text_chunk, source_filename, product_title, file_hash, normalized_content_hash, parsed_draft_json')
    .eq('id', queueId)
    .maybeSingle();

  if (queueError) {
    return NextResponse.json(
      { success: false, error: queueError.message, uploadRequestId: requestId },
      { status: 500 },
    );
  }
  if (!queueRow) {
    return NextResponse.json(
      { success: false, error: 'upload review queue row was not found.', uploadRequestId: requestId },
      { status: 404 },
    );
  }

  const rawText = stringValue((queueRow as { raw_text_chunk?: unknown }).raw_text_chunk);
  if (!rawText || rawText.length < 50) {
    return NextResponse.json(
      { success: false, error: 'Saved review-queue raw text is missing or too short.', uploadRequestId: requestId },
      { status: 422 },
    );
  }

  const sourceLabel =
    stringValue(body.sourceLabel)
    ?? stringValue((queueRow as { source_filename?: unknown }).source_filename)
    ?? stringValue((queueRow as { product_title?: unknown }).product_title)
    ?? 'review-queue-replay.txt';
  const parsedDraftJson = (queueRow as { parsed_draft_json?: unknown }).parsed_draft_json;
  const sourceTextEvidence = parsedDraftJson && typeof parsedDraftJson === 'object' && !Array.isArray(parsedDraftJson)
    ? (parsedDraftJson as { _source_text_evidence_v2?: unknown })._source_text_evidence_v2
    : null;
  const evidenceDocuments = sourceTextEvidence && typeof sourceTextEvidence === 'object' && !Array.isArray(sourceTextEvidence)
    ? (sourceTextEvidence as { documents?: unknown }).documents
    : null;
  const evidenceExcerptBySourceId = new Map<string, string>();
  if (Array.isArray(evidenceDocuments)) {
    for (const document of evidenceDocuments) {
      if (!document || typeof document !== 'object' || Array.isArray(document)) continue;
      const record = document as { sourceId?: unknown; excerpt?: unknown };
      const sourceId = stringValue(record.sourceId);
      const excerpt = stringValue(record.excerpt);
      if (sourceId && excerpt) evidenceExcerptBySourceId.set(sourceId, excerpt);
    }
  }
  const replayOriginalRawText = evidenceExcerptBySourceId.get('original_raw') ?? rawText;
  const replayParserRawText = evidenceExcerptBySourceId.get('parser_raw') ?? rawText;
  const replayDocumentRawText =
    evidenceExcerptBySourceId.get('document_raw')
    ?? evidenceExcerptBySourceId.get('parser_raw')
    ?? rawText;
  const commissionRate = Number(body.commissionRate);
  const metadata = parseUploadSourceMetadata({
    rawText: replayOriginalRawText,
    sourceLabel,
    explicitCommissionRate: Number.isFinite(commissionRate) ? commissionRate : undefined,
    defaultCommissionRate: 10,
  });

  const fileHash = stringValue((queueRow as { file_hash?: unknown }).file_hash) ?? randomUUID();
  const inputAnalysisForTrust = analyzeUploadInputText(replayOriginalRawText);
  if (inputAnalysisForTrust.blocked) {
    return NextResponse.json(
      {
        success: false,
        error: 'Saved source text did not pass upload input quality checks.',
        inputQuality: inputAnalysisForTrust,
        uploadRequestId: requestId,
      },
      { status: 422 },
    );
  }

  const result = await runUploadRegistrationPipeline({
    intake: {
      ok: true,
      buffer: Buffer.from(rawText, 'utf8'),
      fileHash,
      fileName: sourceLabel,
      directRawText: rawText,
      originalRawText: replayOriginalRawText,
      parserRawText: metadata.parserRawText ?? replayParserRawText,
      documentRawText: replayDocumentRawText,
      analysisNormalizedText: inputAnalysisForTrust.normalizedText,
      uploadSourceMetadata: metadata,
      inputAnalysisForTrust,
      archiveMode: false,
      bulkMode: false,
      forceReprocess: body.forceReprocess !== false,
    },
    supabase: supabaseAdmin,
    isSupabaseConfigured,
    safeAfter,
    postAlert,
    requestBaseUrl: request.nextUrl.origin,
    publicBaseUrl: process.env.NEXT_PUBLIC_BASE_URL ?? process.env.NEXT_PUBLIC_SITE_URL ?? '',
  });

  const payload = result.payload as Record<string, unknown>;
  const savedIds = Array.isArray(payload.dbIds)
    ? payload.dbIds.filter((id): id is string => typeof id === 'string')
    : typeof payload.dbId === 'string'
      ? [payload.dbId]
      : [];

  if (savedIds.length > 0) {
    await supabaseAdmin
      .from('upload_review_queue')
      .update({
        status: 'resolved',
        updated_at: new Date().toISOString(),
      })
      .eq('id', queueId);
  }

  return NextResponse.json(
    {
      ...payload,
      replayed: true,
      queueId,
      uploadRequestId: requestId,
    },
    { status: result.status },
  );
};

export const POST = withAdminGuard(postHandler);
