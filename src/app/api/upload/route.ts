import { randomUUID } from 'crypto';

import { NextRequest, NextResponse, after as nextAfter } from 'next/server';

import { withAdminGuard } from '@/lib/admin-guard';
import { postAlert } from '@/lib/admin-alerts';
import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';
import { prepareUploadRequestIntake } from '@/lib/product-registration/upload-request-intake';
import { runUploadRegistrationPipeline } from '@/lib/product-registration/upload-registration-pipeline';

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

    const result = await runUploadRegistrationPipeline({
      intake,
      supabase: supabaseAdmin,
      isSupabaseConfigured,
      safeAfter,
      postAlert,
      requestBaseUrl: request.nextUrl.origin,
      publicBaseUrl: process.env.NEXT_PUBLIC_BASE_URL ?? process.env.NEXT_PUBLIC_SITE_URL ?? '',
    });

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
