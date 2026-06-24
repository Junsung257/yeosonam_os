import { randomUUID } from 'crypto';

import { NextRequest, NextResponse, after as nextAfter } from 'next/server';

import { withAdminGuard } from '@/lib/admin-guard';
import { postAlert } from '@/lib/admin-alerts';
import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';
import { prepareUploadRequestIntake } from '@/lib/product-registration/upload-request-intake';
import { runUploadRegistrationPipeline } from '@/lib/product-registration/upload-registration-pipeline';
import {
  enqueueUploadTimeoutReplay,
  scheduleImmediateUploadTimeoutReplay,
  type UploadTimeoutReplayQueueResult,
} from '@/lib/product-registration/upload-timeout-replay-queue';

function safeAfter(task: () => Promise<void> | void): void {
  try {
    nextAfter(task);
  } catch (e) {
    if (e instanceof Error && e.message.includes('outside a request scope')) {
      void Promise.resolve()
        .then(task)
        .catch(err => console.warn('[Upload API] deferred task failed:', err instanceof Error ? err.message : err));
      return;
    }
    throw e;
  }
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const UPLOAD_PIPELINE_SOFT_TIMEOUT_MS = Math.max(
  30_000,
  Math.min(120_000, Number(process.env.UPLOAD_PIPELINE_SOFT_TIMEOUT_MS ?? 45_000)),
);
const UPLOAD_QUEUE_FIRST_TEXT_LENGTH = Math.max(
  5_000,
  Math.min(100_000, Number(process.env.UPLOAD_QUEUE_FIRST_TEXT_LENGTH ?? 18_000)),
);

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function countLikelyPackageSections(rawText: string | null): number {
  if (!rawText) return 0;
  const matches = rawText.match(/(?:^|\n)[^\n]{0,80}(?:PKG|Package|PACKAGE)[^\n]{0,80}/gmu);
  return matches?.length ?? 0;
}

function shouldQueueFirst(rawText: string | null): boolean {
  if (!rawText) return false;
  if (rawText.length >= UPLOAD_QUEUE_FIRST_TEXT_LENGTH) return true;
  return countLikelyPackageSections(rawText) >= 4;
}

async function deferUploadForReplay(input: {
  intake: Extract<Awaited<ReturnType<typeof prepareUploadRequestIntake>>, { ok: true }>;
  requestId: string;
  startedAt: number;
  requestBaseUrl: string;
  reasonCode: string;
}) {
  const elapsedMs = Date.now() - input.startedAt;
  const replay = await enqueueUploadTimeoutReplay({
    supabase: supabaseAdmin,
    isSupabaseConfigured,
    intake: input.intake,
    uploadRequestId: input.requestId,
    elapsedMs,
    reasonCode: input.reasonCode,
    timeoutMs: 8_000,
  }).catch((error): UploadTimeoutReplayQueueResult => ({
    queued: false,
    reason: error instanceof Error ? error.message : String(error),
  }));

  if (replay.queued) {
    scheduleImmediateUploadTimeoutReplay({
      safeAfter,
      requestBaseUrl: input.requestBaseUrl,
      queueId: replay.queueId,
      uploadRequestId: input.requestId,
    });
  }

  return NextResponse.json(
    {
      success: false,
      code: 'UPLOAD_DEFERRED_FOR_REPLAY',
      error: replay.queued
        ? '상품등록 처리 시간이 길어 자동 재처리 큐에 넣었습니다. 같은 원문은 중복 방지 후 재처리됩니다.'
        : '상품등록 처리 시간이 길어 중단했습니다. 같은 원문을 다시 시도해 주세요.',
      replayQueued: replay.queued,
      replayQueueId: replay.queueId,
      replayReason: replay.reason,
      retrySafe: true,
      uploadRequestId: input.requestId,
    },
    { status: 202, headers: { 'x-upload-request-id': input.requestId } },
  );
}

const postHandler = async (request: NextRequest) => {
  const requestId = randomUUID();
  const startedAt = Date.now();
  try {
    console.log('[Upload API] request start:', {
      requestId,
      at: new Date(startedAt).toISOString(),
      contentType: request.headers.get('content-type') || null,
    });

    if (!isSupabaseConfigured) {
      console.warn('[Upload API] Supabase env is not configured; DB writes disabled');
    }

    const intake = await prepareUploadRequestIntake(request);
    console.log('[Upload API] intake complete:', { requestId, elapsedMs: Date.now() - startedAt, ok: intake.ok });
    if (!intake.ok) {
      return NextResponse.json(
        { ...intake.payload, uploadRequestId: requestId },
        { status: intake.status, headers: { 'x-upload-request-id': requestId } },
      );
    }
    if (shouldQueueFirst(intake.directRawText)) {
      console.warn('[Upload API] queue-first replay for heavy upload:', {
        requestId,
        rawTextLength: intake.directRawText?.length ?? 0,
        likelyPackageSections: countLikelyPackageSections(intake.directRawText),
      });
      return deferUploadForReplay({
        intake,
        requestId,
        startedAt,
        requestBaseUrl: request.nextUrl.origin,
        reasonCode: 'UPLOAD_PIPELINE_DEFERRED_FOR_REPLAY',
      });
    }

    const pipelinePromise = runUploadRegistrationPipeline({
      intake,
      supabase: supabaseAdmin,
      isSupabaseConfigured,
      safeAfter,
      postAlert,
      requestBaseUrl: request.nextUrl.origin,
      publicBaseUrl: process.env.NEXT_PUBLIC_BASE_URL ?? process.env.NEXT_PUBLIC_SITE_URL ?? '',
    });
    const raced = await Promise.race([
      pipelinePromise.then(result => ({ kind: 'result' as const, result })),
      delay(UPLOAD_PIPELINE_SOFT_TIMEOUT_MS).then(() => ({ kind: 'timeout' as const })),
    ]);

    if (raced.kind === 'timeout') {
      return deferUploadForReplay({
        intake,
        requestId,
        startedAt,
        requestBaseUrl: request.nextUrl.origin,
        reasonCode: 'UPLOAD_PIPELINE_SOFT_TIMEOUT',
      });
    }

    const { result } = raced;

    console.log('[Upload API] request complete:', {
      requestId,
      elapsedMs: Date.now() - startedAt,
      status: result.status,
    });

    return NextResponse.json(
      { ...result.payload, uploadRequestId: requestId },
      { status: result.status, headers: { 'x-upload-request-id': requestId } },
    );
  } catch (error) {
    console.error('[Upload API] fatal error:', {
      requestId,
      elapsedMs: Date.now() - startedAt,
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : '파일 처리에 실패했습니다.',
        details: process.env.NODE_ENV === 'development' ? String(error) : undefined,
        uploadRequestId: requestId,
      },
      { status: 500, headers: { 'x-upload-request-id': requestId } },
    );
  }
};

export const POST = withAdminGuard(postHandler);
