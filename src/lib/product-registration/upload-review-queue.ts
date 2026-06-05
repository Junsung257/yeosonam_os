import type { SupabaseClient } from '@supabase/supabase-js';
import { safeRawTextExcerpt } from '@/lib/raw-text-privacy';

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

export function scheduleUploadReviewInsert(input: ScheduleUploadReviewQueueInput): void {
  if (!input.isSupabaseConfigured) return;

  const rawTextChunk = input.rawText != null
    ? safeRawTextExcerpt(input.rawText, input.rawTextLimit ?? 12000)
    : input.rawTextChunk ?? null;

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
      parsed_draft_json: input.parsedDraftJson ?? null,
      product_title: input.productTitle ?? null,
      land_operator_id: input.landOperatorId ?? null,
    })
    .then(({ error }: { error: { message: string } | null }) => {
      if (error) console.warn('[Upload API] upload_review_queue enqueue failed (non-blocking):', error.message);
    });
}
