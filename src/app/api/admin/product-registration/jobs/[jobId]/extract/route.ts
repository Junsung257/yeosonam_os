import { NextRequest, NextResponse } from 'next/server';

import { withAdminGuard } from '@/lib/admin-guard';
import { isSupabaseAdminConfigured, supabaseAdmin } from '@/lib/supabase';
import { startProductRegistrationWorkflowBySourceId } from '@/lib/product-registration-authority/start-workflow';
import { getProductRegistrationV4Job } from '@/lib/product-registration-v4/jobs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

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
    const prior = await getProductRegistrationV4Job({ supabase: supabaseAdmin, jobId });
    if (!prior?.source_document_id) {
      return NextResponse.json({ success: false, code: 'SOURCE_DOCUMENT_REQUIRED' }, { status: 409 });
    }
    const publicBaseUrl = process.env.NEXT_PUBLIC_BASE_URL
      ?? process.env.NEXT_PUBLIC_SITE_URL
      ?? request.nextUrl.origin;
    const started = await startProductRegistrationWorkflowBySourceId({
      supabase: supabaseAdmin,
      sourceDocumentId: prior.source_document_id,
      tenantId: prior.tenant_id,
      requestBaseUrl: request.nextUrl.origin,
      publicBaseUrl,
      uploadSourceMetadata: prior.v4_stage_state.sourceDepartureYearContext
        ? { sourceDepartureYearContext: prior.v4_stage_state.sourceDepartureYearContext }
        : undefined,
      sourceChannel: 'admin-extract',
    });
    return NextResponse.json({
      success: true,
      code: 'DIRECT_EXTRACTION_RETIRED_WORKFLOW_ACCEPTED',
      priorJobId: jobId,
      jobId: started.jobId,
      workflowRunId: started.workflowRunId,
      state: 'processing',
    }, { status: 202, headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[Product Registration V4] extraction failed:', message);
    return NextResponse.json({ success: false, code: 'EXTRACTION_FAILED', error: message }, { status: 502 });
  }
};

export const POST = withAdminGuard(postHandler);
