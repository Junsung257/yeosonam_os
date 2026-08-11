import type { SupabaseClient } from '@supabase/supabase-js';
import { NextResponse, type NextRequest } from 'next/server';

import { withAdminGuard } from '@/lib/admin-guard';
import { startProductRegistrationWorkflowBySourceId } from '@/lib/product-registration-authority/start-workflow';
import { getProductRegistrationV4Job } from '@/lib/product-registration-v4/jobs';
import { getSupabaseAdmin } from '@/lib/supabase';
import { parseUploadSourceMetadata } from '@/lib/upload-source-metadata';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const postHandler = async (request: NextRequest, context?: { params: Promise<{ jobId: string }> | { jobId: string } }) => {
  const adminClient = getSupabaseAdmin();
  if (!adminClient) return NextResponse.json({ success: false, code: 'SUPABASE_ADMIN_UNAVAILABLE' }, { status: 503 });
  const supabase = adminClient as SupabaseClient;
  const params = context?.params;
  const resolved = params && typeof (params as Promise<unknown>).then === 'function'
    ? await params as { jobId: string }
    : params as { jobId: string } | undefined;
  const priorJobId = resolved?.jobId;
  if (!priorJobId) return NextResponse.json({ success: false, code: 'JOB_ID_REQUIRED' }, { status: 400 });

  const prior = await getProductRegistrationV4Job({ supabase, jobId: priorJobId });
  if (!prior?.source_document_id) return NextResponse.json({ success: false, code: 'SOURCE_DOCUMENT_REQUIRED' }, { status: 409 });
  const { data: source, error: sourceError } = await supabase
    .from('product_source_documents')
    .select('id,tenant_id,original_filename,declared_mime,source_type,sha256,status,metadata')
    .eq('id', prior.source_document_id)
    .eq('tenant_id', prior.tenant_id)
    .single();
  if (sourceError || !source) return NextResponse.json({ success: false, code: 'SOURCE_DOCUMENT_NOT_FOUND' }, { status: 404 });
  if (source.status === 'quarantined' || source.status === 'deleted') {
    return NextResponse.json({ success: false, code: 'SOURCE_REUPLOAD_REQUIRED' }, { status: 409 });
  }
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL ?? process.env.NEXT_PUBLIC_SITE_URL ?? request.nextUrl.origin;
  const metadata = source.metadata && typeof source.metadata === 'object'
    ? source.metadata as Record<string, unknown>
    : {};
  const started = await startProductRegistrationWorkflowBySourceId({
    supabase,
    tenantId: prior.tenant_id,
    sourceDocumentId: source.id,
    requestBaseUrl: request.nextUrl.origin,
    publicBaseUrl: baseUrl,
    uploadSourceMetadata: (metadata.uploadSourceMetadata as Record<string, unknown> | undefined)
      ?? parseUploadSourceMetadata({ fileName: source.original_filename, defaultCommissionRate: 10 }) as unknown as Record<string, unknown>,
    sourceChannel: 'admin-reprocess',
    forceReprocess: true,
  });
  return NextResponse.json({
    success: true,
    code: 'PRODUCT_REGISTRATION_V6_REPROCESS_ACCEPTED',
    priorJobId,
    jobId: started.jobId,
    workflowRunId: started.workflowRunId,
    dedupeHit: started.dedupeHit,
    state: 'processing',
  }, { status: 202, headers: { 'Cache-Control': 'no-store' } });
};

export const POST = withAdminGuard(postHandler);
