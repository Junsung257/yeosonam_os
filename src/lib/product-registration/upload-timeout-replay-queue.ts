import type { SupabaseClient } from '@supabase/supabase-js';

import { safeRawTextExcerpt } from '@/lib/raw-text-privacy';
import { getSecret } from '@/lib/secret-registry';
import type { UploadRequestIntakeSuccess } from './upload-request-intake';

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
}): Promise<UploadTimeoutReplayQueueResult> {
  if (!input.isSupabaseConfigured) return { queued: false, reason: 'Supabase is not configured.' };

  const rawText = input.intake.directRawText?.trim();
  if (!rawText || rawText.length < 50) {
    return { queued: false, reason: 'No replayable raw text was available.' };
  }

  const { data, error } = await input.supabase
    .from('upload_review_queue')
    .insert({
      severity: 'high',
      status: 'pending',
      error_reason: `UPLOAD_PIPELINE_SOFT_TIMEOUT: uploadRequestId=${input.uploadRequestId} elapsedMs=${input.elapsedMs}`,
      source_filename: input.intake.fileName,
      file_hash: input.intake.fileHash,
      normalized_content_hash: null,
      raw_text_chunk: safeRawTextExcerpt(rawText, 12000),
      parsed_draft_json: {
        code: 'UPLOAD_PIPELINE_SOFT_TIMEOUT',
        uploadRequestId: input.uploadRequestId,
        elapsedMs: input.elapsedMs,
        retryPolicy: 'safe_duplicate_guard',
      },
      product_title: input.intake.fileName,
      land_operator_id: null,
    })
    .select('id')
    .maybeSingle();

  if (error) return { queued: false, reason: error.message };
  return { queued: true, queueId: typeof data?.id === 'string' ? data.id : undefined };
}
