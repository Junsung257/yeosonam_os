import { randomUUID } from 'crypto';

import { NextRequest, NextResponse, after as nextAfter } from 'next/server';

import { withAdminGuard } from '@/lib/admin-guard';
import { postAlert } from '@/lib/admin-alerts';
import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';
import { prepareUploadRequestIntake } from '@/lib/product-registration/upload-request-intake';
import { runUploadRegistrationPipeline } from '@/lib/product-registration/upload-registration-pipeline';
import { enqueueUploadTimeoutReplay } from '@/lib/product-registration/upload-timeout-replay-queue';

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
  Math.min(270_000, Number(process.env.UPLOAD_PIPELINE_SOFT_TIMEOUT_MS ?? 240_000)),
);

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
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
      const elapsedMs = Date.now() - startedAt;
      const replay = await enqueueUploadTimeoutReplay({
        supabase: supabaseAdmin,
        isSupabaseConfigured,
        intake,
        uploadRequestId: requestId,
        elapsedMs,
      }).catch(error => ({
        queued: false,
        reason: error instanceof Error ? error.message : String(error),
      }));

      pipelinePromise
        .then(result => {
          console.log('[Upload API] slow pipeline eventually completed:', {
            requestId,
            elapsedMs: Date.now() - startedAt,
            status: result.status,
          });
        })
        .catch(error => {
          console.warn('[Upload API] slow pipeline eventually failed:', {
            requestId,
            elapsedMs: Date.now() - startedAt,
            message: error instanceof Error ? error.message : String(error),
          });
        });

      console.warn('[Upload API] soft timeout -> queued replay:', {
        requestId,
        elapsedMs,
        replayQueued: replay.queued,
        reason: replay.reason ?? null,
      });

      return NextResponse.json(
        {
          success: false,
          code: 'UPLOAD_DEFERRED_FOR_REPLAY',
          error: replay.queued
            ? '상품등록 처리 시간이 길어 자동 재처리 큐에 넣었습니다. 같은 원문은 중복 방지 후 재처리됩니다.'
            : '상품등록 처리 시간이 길어 중단했습니다. 같은 원문을 다시 시도해 주세요.',
          replayQueued: replay.queued,
          replayReason: replay.reason,
          retrySafe: true,
          uploadRequestId: requestId,
        },
        { status: 202, headers: { 'x-upload-request-id': requestId } },
      );
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
