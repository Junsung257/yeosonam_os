import type { SupabaseClient } from '@supabase/supabase-js';

import { safeRawTextExcerpt } from '@/lib/raw-text-privacy';
import { getSecret } from '@/lib/secret-registry';
import type { UploadRequestIntakeSuccess } from './upload-request-intake';
import { DEFAULT_UPLOAD_REVIEW_REPLAY_RAW_TEXT_LIMIT } from './upload-review-queue';

export type UploadTimeoutReplayQueueResult = {
  queued: boolean;
  reason?: string;
  queueId?: string;
};

export function scheduleImmediateUploadTimeoutReplay(input: {
  safeAfter: (task: () => Promise<void> | void) => void;
  requestBaseUrl: string;
  queueId?: string;
  uploadRequestId: string;
}): void {
  if (!input.queueId) return;
  input.safeAfter(async () => {
    const secret = getSecret('CRON_SECRET');
    const url = new URL('/api/cron/upload-review-auto-replay', input.requestBaseUrl);
    url.searchParams.set('queueId', input.queueId!);
    url.searchParams.set('limit', '1');
    url.searchParams.set('force', 'true');

    const response = await fetch(url, {
      method: 'GET',
      cache: 'no-store',
      headers: secret ? { authorization: `Bearer ${secret}` } : undefined,
    });

    if (!response.ok) {
      console.warn('[Upload API] immediate replay wake failed:', {
        requestId: input.uploadRequestId,
        queueId: input.queueId,
        status: response.status,
      });
    }
  });
}

export async function enqueueUploadTimeoutReplay(input: {
  supabase: SupabaseClient;
  isSupabaseConfigured: boolean;
  intake: UploadRequestIntakeSuccess;
  uploadRequestId: string;
  elapsedMs: number;
  reasonCode?: string;
  timeoutMs?: number;
}): Promise<UploadTimeoutReplayQueueResult> {
  if (!input.isSupabaseConfigured) return { queued: false, reason: 'Supabase is not configured.' };

  const rawText = input.intake.directRawText?.trim();
  if (!rawText || rawText.length < 50) {
    return { queued: false, reason: 'No replayable raw text was available.' };
  }
  const rawTextChunk = safeRawTextExcerpt(rawText, DEFAULT_UPLOAD_REVIEW_REPLAY_RAW_TEXT_LIMIT);
  const rawTextStoredLength = rawTextChunk?.length ?? 0;
  const reasonCode = input.reasonCode || 'UPLOAD_PIPELINE_SOFT_TIMEOUT';
  const timeoutMs = Math.max(1_000, Math.min(20_000, input.timeoutMs ?? 8_000));

  const insertPromise = input.supabase
    .from('upload_review_queue')
    .insert({
      severity: 'high',
      status: 'pending',
      error_reason: `${reasonCode}: uploadRequestId=${input.uploadRequestId} elapsedMs=${input.elapsedMs}`,
      source_filename: input.intake.fileName,
      file_hash: input.intake.fileHash,
      normalized_content_hash: null,
      raw_text_chunk: rawTextChunk,
      parsed_draft_json: {
        code: reasonCode,
        uploadRequestId: input.uploadRequestId,
        elapsedMs: input.elapsedMs,
        retryPolicy: 'safe_duplicate_guard',
        rawTextOriginalLength: rawText.length,
        rawTextStoredLength,
        rawTextTruncated: rawTextStoredLength < rawText.length,
      },
      product_title: input.intake.fileName,
      land_operator_id: null,
    })
    .select('id')
    .maybeSingle();
  const timeoutPromise = new Promise<{ data: null; error: { message: string } }>(resolve => {
    setTimeout(() => resolve({ data: null, error: { message: `upload replay queue insert timed out after ${timeoutMs}ms` } }), timeoutMs);
  });
  const { data, error } = await Promise.race([insertPromise, timeoutPromise]);

  if (error) return { queued: false, reason: error.message };
  return { queued: true, queueId: typeof data?.id === 'string' ? data.id : undefined };
}
