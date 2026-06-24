import type { SupabaseClient } from '@supabase/supabase-js';
import { safeRawTextExcerpt } from '@/lib/raw-text-privacy';
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
  parsedDraftJson?: Record<string, unknown> | null;
  productTitle?: string | null;
  landOperatorId?: string | null;
};

export type ScheduleUploadReviewQueueInput = UploadReviewQueueRowInput & {
  supabase: SupabaseClient;
  isSupabaseConfigured: boolean;
};

export const DEFAULT_UPLOAD_REVIEW_REPLAY_RAW_TEXT_LIMIT = 80_000;

export function scheduleUploadReviewInsert(input: ScheduleUploadReviewQueueInput): void {
  if (!input.isSupabaseConfigured) return;

  const rawTextLimit = input.rawTextLimit ?? DEFAULT_UPLOAD_REVIEW_REPLAY_RAW_TEXT_LIMIT;
  const rawTextChunk = input.rawText != null
    ? safeRawTextExcerpt(input.rawText, rawTextLimit)
    : input.rawTextChunk ?? null;
  const rawTextOriginalLength = input.rawText?.trim().length ?? null;
  const rawTextStoredLength = rawTextChunk?.length ?? null;
  const failureDiagnostics = summarizeProductRegistrationFailures([input.errorReason]);
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
