import { NextRequest, NextResponse } from 'next/server';

import { withAdminGuard } from '@/lib/admin-guard';
import { isSupabaseAdminConfigured, supabaseAdmin } from '@/lib/supabase';
import { startProductRegistrationWorkflowBySourceId } from '@/lib/product-registration-authority/start-workflow';
import { getProductRegistrationV4Job } from '@/lib/product-registration-v4/jobs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_V4_ATTEMPTS = 5;

const postHandler = async (request: NextRequest, context?: { params: Promise<{ jobId: string }> | { jobId: string } }) => {
  if (!isSupabaseAdminConfigured) {
    return NextResponse.json({ success: false, code: 'SUPABASE_ADMIN_UNAVAILABLE' }, { status: 503 });
  }
  const params = context?.params;
  const resolved = params && typeof (params as Promise<unknown>).then === 'function'
    ? await params as { jobId: string }
    : params as { jobId: string } | undefined;
  const jobId = resolved?.jobId;
  if (!jobId) return NextResponse.json({ success: false, code: 'JOB_ID_REQUIRED' }, { status: 400 });

  try {
    const job = await getProductRegistrationV4Job({ supabase: supabaseAdmin, jobId });
    if (!job) return NextResponse.json({ success: false, code: 'JOB_NOT_FOUND' }, { status: 404 });
    if (!job.source_document_id) {
      return NextResponse.json({ success: false, code: 'SOURCE_DOCUMENT_REQUIRED' }, { status: 409 });
    }
    if (!['failed', 'quarantined', 'needs_review'].includes(job.v4_stage) || job.status === 'processing') {
      return NextResponse.json({ success: false, code: 'JOB_NOT_RETRYABLE', stage: job.v4_stage, status: job.status }, { status: 409 });
    }
    if (Number(job.v4_attempt_count ?? 0) >= MAX_V4_ATTEMPTS) {
      return NextResponse.json({ success: false, code: 'JOB_RETRY_LIMIT_REACHED', maxAttempts: MAX_V4_ATTEMPTS }, { status: 409 });
    }
    const { data: source, error: sourceError } = await supabaseAdmin
      .from('product_source_documents')
      .select('status')
      .eq('id', job.source_document_id)
      .maybeSingle();
    if (sourceError) throw sourceError;
    if (!source) return NextResponse.json({ success: false, code: 'SOURCE_DOCUMENT_NOT_FOUND' }, { status: 409 });
    if (source.status === 'quarantined' || source.status === 'deleted') {
      return NextResponse.json({ success: false, code: 'SOURCE_REUPLOAD_REQUIRED', sourceStatus: source.status }, { status: 409 });
    }

    const publicBaseUrl = process.env.NEXT_PUBLIC_BASE_URL
      ?? process.env.NEXT_PUBLIC_SITE_URL
      ?? request.nextUrl.origin;
    const retried = await startProductRegistrationWorkflowBySourceId({
      supabase: supabaseAdmin,
      sourceDocumentId: job.source_document_id,
      tenantId: job.tenant_id,
      requestBaseUrl: request.nextUrl.origin,
      publicBaseUrl,
      sourceChannel: 'admin-retry',
      forceReprocess: false,
    });
    return NextResponse.json({
      success: true,
      code: 'PRODUCT_REGISTRATION_RETRY_ACCEPTED',
      priorJobId: jobId,
      jobId: retried.jobId,
      workflowRunId: retried.workflowRunId,
      state: 'processing',
      dedupeHit: retried.dedupeHit,
    }, { status: 202, headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('[Product Registration V4] job retry failed:', error);
    return NextResponse.json({ success: false, code: 'REGISTRATION_JOB_RETRY_FAILED', error: error instanceof Error ? error.message : String(error) }, { status: 502 });
  }
};

export const POST = withAdminGuard(postHandler);
