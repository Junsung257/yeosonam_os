import type { SupabaseClient } from '@supabase/supabase-js';
import type { UploadInputAnalysis } from '@/lib/product-registration-input-guard';
import { rawTextHash, safeRawTextExcerpt } from '@/lib/raw-text-privacy';
import { summarizeProductRegistrationFailures } from './failure-diagnostics';

export type UploadReviewQueueRowInput = {
  severity?: string;
  status?: string;
  errorReason?: string | null;
  sourceFilename?: string | null;
  fileHash?: string | null;
  normalizedContentHash?: string | null;
  rawText?: string | null;
  rawTextChunk?: string | null;
  rawTextLimit?: number;
  originalRawText?: string | null;
  parserRawText?: string | null;
  documentRawText?: string | null;
  sectionRawText?: string | null;
  analysisNormalizedText?: string | null;
  parsedDraftJson?: Record<string, unknown> | null;
  productTitle?: string | null;
  landOperatorId?: string | null;
  inputAnalysis?: UploadInputAnalysis | null;
};

export type ScheduleUploadReviewQueueInput = UploadReviewQueueRowInput & {
  supabase: SupabaseClient;
  isSupabaseConfigured: boolean;
};

export const DEFAULT_UPLOAD_REVIEW_REPLAY_RAW_TEXT_LIMIT = 80_000;

const SOURCE_TEXT_EVIDENCE_EXCERPT_LIMIT = 20_000;

function sourceTextEvidenceDocument(sourceId: string, rawText: string | null | undefined) {
  const hash = rawTextHash(rawText);
  if (!hash) return null;
  const value = String(rawText ?? '').trim();
  const excerpt = safeRawTextExcerpt(value, SOURCE_TEXT_EVIDENCE_EXCERPT_LIMIT);
  return {
    sourceId,
    rawTextHash: hash,
    rawTextLength: value.length,
    excerpt,
    excerptLength: excerpt?.length ?? 0,
    truncated: Boolean(excerpt && excerpt.length < value.length),
  };
}

function buildSourceTextEvidence(input: UploadReviewQueueRowInput) {
  const documents = [
    sourceTextEvidenceDocument('original_raw', input.originalRawText),
    sourceTextEvidenceDocument('parser_raw', input.parserRawText),
    sourceTextEvidenceDocument('document_raw', input.documentRawText),
    sourceTextEvidenceDocument('section_raw', input.sectionRawText ?? input.rawText),
    sourceTextEvidenceDocument('analysis_normalized', input.analysisNormalizedText),
  ].filter((document): document is NonNullable<ReturnType<typeof sourceTextEvidenceDocument>> => Boolean(document));

  const seen = new Set<string>();
  return {
    version: 2,
    documents: documents.filter(document => {
      const key = `${document.sourceId}:${document.rawTextHash}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }),
  };
}

export function scheduleUploadReviewInsert(input: ScheduleUploadReviewQueueInput): void {
  if (!input.isSupabaseConfigured) return;

  const rawTextLimit = input.rawTextLimit ?? DEFAULT_UPLOAD_REVIEW_REPLAY_RAW_TEXT_LIMIT;
  const rawTextChunk = input.rawText != null
    ? safeRawTextExcerpt(input.rawText, rawTextLimit)
    : input.rawTextChunk ?? null;
  const rawTextOriginalLength = input.rawText?.trim().length ?? null;
  const rawTextStoredLength = rawTextChunk?.length ?? null;
  const failureDiagnostics = summarizeProductRegistrationFailures([input.errorReason]);
  const sourceTextEvidence = buildSourceTextEvidence(input);
  const parsedDraftJson = {
    ...(input.parsedDraftJson ?? {}),
    rawTextOriginalLength,
    rawTextStoredLength,
    rawTextTruncated:
      typeof rawTextOriginalLength === 'number' &&
      typeof rawTextStoredLength === 'number' &&
      rawTextStoredLength < rawTextOriginalLength,
    _product_registration_failure_diagnostics: {
      codes: failureDiagnostics.codes,
      diagnostics: failureDiagnostics.diagnostics,
      hasCritical: failureDiagnostics.hasCritical,
      nextAction: failureDiagnostics.nextAction,
    },
    ...(sourceTextEvidence.documents.length > 0 ? {
      _source_text_evidence_v2: sourceTextEvidence,
    } : {}),
    ...(input.inputAnalysis?.preprocessing ? {
      _input_text_preprocessing: {
        originalHash: input.inputAnalysis.preprocessing.originalHash,
        normalizedHash: input.inputAnalysis.preprocessing.normalizedHash,
        changed: input.inputAnalysis.preprocessing.changed,
        originalLength: input.inputAnalysis.preprocessing.originalLength,
        normalizedLength: input.inputAnalysis.preprocessing.normalizedLength,
        lineCount: input.inputAnalysis.preprocessing.lineCount,
        normalizedLineCount: input.inputAnalysis.preprocessing.normalizedLineCount,
        tableLikeLineCount: input.inputAnalysis.preprocessing.tableLikeLineCount,
        itineraryHeaderCount: input.inputAnalysis.preprocessing.itineraryHeaderCount,
        currencyTokenCount: input.inputAnalysis.preprocessing.currencyTokenCount,
        dateTokenCount: input.inputAnalysis.preprocessing.dateTokenCount,
        changes: input.inputAnalysis.preprocessing.changes,
        inputIssues: input.inputAnalysis.issues.map(issue => issue.code),
      },
    } : {}),
  };

  void input.supabase
    .from('upload_review_queue')
    .insert({
      severity: input.severity,
      status: input.status,
      error_reason: input.errorReason ?? null,
      source_filename: input.sourceFilename ?? null,
      file_hash: input.fileHash ?? null,
      normalized_content_hash: input.normalizedContentHash ?? null,
      raw_text_chunk: rawTextChunk,
      parsed_draft_json: parsedDraftJson,
      product_title: input.productTitle ?? null,
      land_operator_id: input.landOperatorId ?? null,
    })
    .then(({ error }: { error: { message: string } | null }) => {
      if (error) console.warn('[Upload API] upload_review_queue enqueue failed (non-blocking):', error.message);
    });
}
