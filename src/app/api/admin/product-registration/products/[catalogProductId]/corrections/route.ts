import { randomUUID } from 'node:crypto';

import type { SupabaseClient } from '@supabase/supabase-js';
import { NextResponse, type NextRequest } from 'next/server';

import { withAdminGuard } from '@/lib/admin-guard';
import { startProductRegistrationWorkflowBySourceId } from '@/lib/product-registration-authority/start-workflow';
import { getSupabaseAdmin } from '@/lib/supabase';
import { DEFAULT_PRODUCT_REGISTRATION_COMMISSION_RATE, parseUploadSourceMetadata } from '@/lib/upload-source-metadata';
import { productRegistrationV6Workflow } from '@/workflows/product-registration-v6';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type CorrectionRequest = {
  baseRevisionId?: string;
  replacementSourceDocumentId?: string;
  requestedChanges?: Array<Record<string, unknown>>;
  reason?: string;
  operationKey?: string;
};

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

const postHandler = async (
  request: NextRequest,
  context?: { params: Promise<{ catalogProductId: string }> | { catalogProductId: string } },
) => {
  const adminClient = getSupabaseAdmin();
  if (!adminClient) return NextResponse.json({ success: false, code: 'SUPABASE_ADMIN_UNAVAILABLE' }, { status: 503 });
  const supabase = adminClient as SupabaseClient;
  const params = context?.params;
  const resolved = params && typeof (params as Promise<unknown>).then === 'function'
    ? await params as { catalogProductId: string }
    : params as { catalogProductId: string } | undefined;
  const catalogProductId = resolved?.catalogProductId;
  if (!catalogProductId) return NextResponse.json({ success: false, code: 'CATALOG_PRODUCT_ID_REQUIRED' }, { status: 400 });

  const body = await request.json().catch(() => ({})) as CorrectionRequest;
  const requestedChanges = Array.isArray(body.requestedChanges) ? body.requestedChanges : [];
  const reason = body.reason?.trim() ?? '';
  if (!body.baseRevisionId || !body.replacementSourceDocumentId || !reason || requestedChanges.length === 0) {
    return NextResponse.json({
      success: false,
      code: 'CORRECTION_SOURCE_AND_REASON_REQUIRED',
      error: '사실 수정은 변경된 원문 sourceDocument, baseRevision, 변경 목록과 사유가 모두 필요합니다.',
    }, { status: 400 });
  }
  if (requestedChanges.length > 100) {
    return NextResponse.json({ success: false, code: 'CORRECTION_CHANGE_LIMIT_EXCEEDED' }, { status: 413 });
  }

  const { data: baseRevision, error: baseError } = await supabase
    .from('product_registration_v5_revisions')
    .select('id,tenant_id,catalog_product_id')
    .eq('id', body.baseRevisionId)
    .eq('catalog_product_id', catalogProductId)
    .single();
  if (baseError || !baseRevision?.tenant_id) {
    return NextResponse.json({ success: false, code: 'CORRECTION_BASE_REVISION_NOT_FOUND' }, { status: 404 });
  }

  const { data: source, error: sourceError } = await supabase
    .from('product_source_documents')
    .select('id,tenant_id,original_filename,declared_mime,source_type,sha256,status,metadata')
    .eq('id', body.replacementSourceDocumentId)
    .eq('tenant_id', baseRevision.tenant_id)
    .single();
  if (sourceError || !source || source.status === 'quarantined' || source.status === 'deleted') {
    return NextResponse.json({ success: false, code: 'CORRECTION_SOURCE_NOT_AVAILABLE' }, { status: 409 });
  }

  const operationKey = body.operationKey?.trim() || `correction:${catalogProductId}:${randomUUID()}`;
  const { data: correctionData, error: correctionError } = await supabase.rpc('enqueue_product_registration_correction', {
    p_payload: {
      tenant_id: baseRevision.tenant_id,
      catalog_product_id: catalogProductId,
      base_revision_id: body.baseRevisionId,
      source_document_id: body.replacementSourceDocumentId,
      requested_changes: requestedChanges,
      reason,
      operation_key: operationKey,
    },
  });
  if (correctionError) {
    return NextResponse.json({ success: false, code: 'CORRECTION_ENQUEUE_FAILED', error: correctionError.message }, { status: 409 });
  }
  const correction = object(correctionData);
  const correctionJobId = String(correction.correction_job_id ?? '');
  const productKey = String(correction.product_key ?? '');
  if (!correctionJobId || !productKey) throw new Error('CORRECTION_AUTHORITY_RESPONSE_INVALID');

  let workflowJobId: string | null = null;
  try {
    const sourceMetadata = object(source.metadata);
    const baseUrl = process.env.NEXT_PUBLIC_BASE_URL ?? process.env.NEXT_PUBLIC_SITE_URL ?? request.nextUrl.origin;
    const started = await startProductRegistrationWorkflowBySourceId({
      supabase,
      tenantId: baseRevision.tenant_id,
      sourceDocumentId: source.id,
      requestBaseUrl: request.nextUrl.origin,
      publicBaseUrl: baseUrl,
      uploadSourceMetadata: object(sourceMetadata.uploadSourceMetadata).landOperator
        ? object(sourceMetadata.uploadSourceMetadata)
        : parseUploadSourceMetadata({
            fileName: source.original_filename,
            defaultCommissionRate: DEFAULT_PRODUCT_REGISTRATION_COMMISSION_RATE,
          }) as unknown as Record<string, unknown>,
      sourceChannel: 'admin-correction',
      forceReprocess: true,
      correction: {
        correctionJobId,
        catalogProductId,
        baseRevisionId: body.baseRevisionId,
        productKey,
        operationKey,
      },
    });
    workflowJobId = started.jobId;
    return NextResponse.json({
      success: true,
      code: 'PRODUCT_REGISTRATION_CORRECTION_ACCEPTED',
      correctionJobId,
      jobId: started.jobId,
      workflowRunId: started.workflowRunId,
      state: 'processing',
    }, { status: 202, headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    await supabase.rpc('finalize_product_registration_correction', {
      p_payload: {
        correction_job_id: correctionJobId,
        workflow_job_id: workflowJobId,
        status: 'failed',
        resulting_revision_id: null,
      },
    });
    throw error;
  }
};

export const POST = withAdminGuard(postHandler);
