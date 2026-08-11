import { randomUUID } from 'node:crypto';

import type { SupabaseClient } from '@supabase/supabase-js';
import { NextResponse, type NextRequest } from 'next/server';
import { start } from 'workflow/api';

import { withAdminGuard } from '@/lib/admin-guard';
import { createProductRegistrationV4Job, getProductRegistrationV4Job } from '@/lib/product-registration-v4/jobs';
import {
  PRODUCT_REGISTRATION_V6_POLICY_VERSION,
  type ProductRegistrationV6WorkflowInput,
} from '@/lib/product-registration-v6/types';
import { getSupabaseAdmin } from '@/lib/supabase';
import { parseUploadSourceMetadata } from '@/lib/upload-source-metadata';
import { productRegistrationV6Workflow } from '@/workflows/product-registration-v6';

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
  const job = await createProductRegistrationV4Job({
    supabase,
    sourceType: source.source_type === 'text' ? 'text' : 'file',
    sourceDocumentId: source.id,
    normalizedHash: source.sha256,
    tenantId: prior.tenant_id,
  });
  const { data: claim, error: claimError } = await supabase.rpc('claim_product_registration_v6_workflow', { p_job_id: job.id });
  if (claimError) throw claimError;
  const fencingToken = Number((claim as { fencing_token?: unknown } | null)?.fencing_token);
  const requestId = randomUUID();
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL ?? process.env.NEXT_PUBLIC_SITE_URL ?? request.nextUrl.origin;
  const metadata = source.metadata && typeof source.metadata === 'object'
    ? source.metadata as Record<string, unknown>
    : {};
  const workflowInput: ProductRegistrationV6WorkflowInput = {
    jobId: job.id,
    tenantId: prior.tenant_id,
    sourceDocumentId: source.id,
    requestId,
    requestBaseUrl: request.nextUrl.origin,
    publicBaseUrl: baseUrl,
    sourceType: source.source_type,
    fileName: source.original_filename,
    declaredMime: source.declared_mime,
    fileHash: source.sha256,
    directRawText: null,
    originalRawText: null,
    parserRawText: null,
    analysisNormalizedText: null,
    uploadSourceMetadata: (metadata.uploadSourceMetadata as Record<string, unknown> | undefined)
      ?? parseUploadSourceMetadata({ fileName: source.original_filename, defaultCommissionRate: 10 }) as unknown as Record<string, unknown>,
    archiveMode: false,
    bulkMode: false,
    forceReprocess: true,
    fencingToken,
    policyVersion: PRODUCT_REGISTRATION_V6_POLICY_VERSION,
  };
  const run = await start(productRegistrationV6Workflow, [workflowInput]);
  return NextResponse.json({
    success: true,
    code: 'PRODUCT_REGISTRATION_V6_REPROCESS_ACCEPTED',
    priorJobId,
    jobId: job.id,
    workflowRunId: run.runId,
    state: 'processing',
  }, { status: 202, headers: { 'Cache-Control': 'no-store' } });
};

export const POST = withAdminGuard(postHandler);
