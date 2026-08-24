import { randomUUID } from 'node:crypto';

import { NextRequest } from 'next/server';

import { withAdminGuard } from '@/lib/admin-guard';
import { apiResponse } from '@/lib/api-response';
import { startProductRegistrationWorkflowBySourceId } from '@/lib/product-registration-authority/start-workflow';
import { parseProductRegistrationTenantId } from '@/lib/product-registration-authority/types';
import { prepareUploadRequestIntake } from '@/lib/product-registration/upload-request-intake';
import { ensureSourceDocumentStored } from '@/lib/product-registration-v4/source-documents';
import { getProductRegistrationV6RuntimeConfig } from '@/lib/product-registration-v6/runtime-config';
import { isSupabaseConfigured, supabaseAdmin } from '@/lib/supabase';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

function configuredPlatformRegistrationTenantId(): string | null {
  return parseProductRegistrationTenantId(process.env.PRODUCT_REGISTRATION_PLATFORM_TENANT_ID);
}

function responseHeaders(requestId: string): HeadersInit {
  return { 'x-upload-request-id': requestId };
}

function describeUploadError(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (error && typeof error === 'object') {
    const candidate = error as Record<string, unknown>;
    const fields = ['code', 'message', 'details', 'hint'] as const;
    const diagnostic = Object.fromEntries(
      fields
        .map(field => [field, candidate[field]])
        .filter(([, value]) => value !== undefined && value !== null && value !== ''),
    );
    if (Object.keys(diagnostic).length > 0) return JSON.stringify(diagnostic);
    try {
      return JSON.stringify(error);
    } catch {
      return 'Unknown non-Error upload failure';
    }
  }
  return String(error);
}

const postHandler = async (request: NextRequest) => {
  const requestId = randomUUID();
  try {
    const intake = await prepareUploadRequestIntake(request);
    if (!intake.ok) {
      return apiResponse(
        { ...intake.payload, uploadRequestId: requestId },
        { status: intake.status, headers: responseHeaders(requestId) },
      );
    }

    if (!isSupabaseConfigured) {
      return apiResponse({
        success: false,
        code: 'REGISTRATION_DATABASE_UNAVAILABLE',
        error: '상품등록 저장소가 연결되지 않아 업로드를 시작하지 않았습니다.',
        uploadRequestId: requestId,
      }, { status: 503, headers: responseHeaders(requestId) });
    }

    const runtimeConfig = getProductRegistrationV6RuntimeConfig();
    if (!runtimeConfig.workflowEnabled) {
      return apiResponse({
        success: false,
        code: 'REGISTRATION_KERNEL_WORKFLOW_DISABLED',
        error: '통합 상품등록 엔진이 비활성 상태라 레거시 등록으로 우회하지 않고 안전하게 중단했습니다.',
        uploadRequestId: requestId,
      }, { status: 503, headers: responseHeaders(requestId) });
    }
    if (!intake.sourceType) {
      return apiResponse({
        success: false,
        code: 'REGISTRATION_SOURCE_TYPE_REQUIRED',
        error: '처리할 수 있는 원문 유형을 확인하지 못했습니다.',
        uploadRequestId: requestId,
      }, { status: 400, headers: responseHeaders(requestId) });
    }

    const tenantId = configuredPlatformRegistrationTenantId();
    if (!tenantId) {
      return apiResponse({
        success: false,
        code: 'REGISTRATION_TENANT_REQUIRED',
        error: '상품등록 플랫폼 tenant 설정이 없어 원문을 저장하지 않았습니다.',
        uploadRequestId: requestId,
      }, { status: 503, headers: responseHeaders(requestId) });
    }

    let sourceDocumentId = intake.sourceDocumentId;
    let dedupeHit = false;
    if (!sourceDocumentId) {
      const { data: existing, error: existingError } = await supabaseAdmin
        .from('product_source_documents')
        .select('id')
        .eq('tenant_id', tenantId)
        .eq('sha256', intake.fileHash)
        .eq('byte_size', intake.buffer.byteLength)
        .maybeSingle();
      if (existingError) throw existingError;
      dedupeHit = Boolean(existing?.id);

      const source = await ensureSourceDocumentStored({
        supabase: supabaseAdmin,
        buffer: intake.buffer,
        filename: intake.fileName,
        declaredMime: intake.declaredMime,
        sourceType: intake.sourceType,
        tenantId,
        metadata: {
          sourceChannel: 'upload',
          uploadSourceMetadata: {
            ...(intake.uploadSourceMetadata as unknown as Record<string, unknown>),
            sourceBatch: intake.sourceBatch,
            sourceDepartureYearContext: intake.sourceDepartureYearContext,
          },
          sourceBatch: intake.sourceBatch,
          sourceDepartureYearContext: intake.sourceDepartureYearContext,
          sourceLineage: intake.directRawText ? {
            origin: 'operational_admin_paste',
            normalizedTextHash: intake.sourceLineageHash,
            capturedAt: new Date().toISOString(),
          } : null,
          ownership: 'platform',
        },
        requestKey: requestId,
        sourceChannel: 'upload',
      });
      sourceDocumentId = source.id;
    }

    const publicBaseUrl = process.env.NEXT_PUBLIC_BASE_URL
      ?? process.env.NEXT_PUBLIC_SITE_URL
      ?? request.nextUrl.origin;
    const started = await startProductRegistrationWorkflowBySourceId({
      supabase: supabaseAdmin,
      sourceDocumentId,
      tenantId,
      requestId,
      requestBaseUrl: request.nextUrl.origin,
      publicBaseUrl,
      uploadSourceMetadata: {
        ...(intake.uploadSourceMetadata as unknown as Record<string, unknown>),
        sourceBatch: intake.sourceBatch,
        sourceDepartureYearContext: intake.sourceDepartureYearContext,
        sourceLineageHash: intake.sourceLineageHash,
      },
      sourceChannel: 'upload',
      forceReprocess: intake.forceReprocess,
      archiveMode: intake.archiveMode,
      bulkMode: intake.bulkMode,
      dedupeHit,
      operationKey: request.headers.get('idempotency-key')?.trim()
        || request.headers.get('x-operation-key')?.trim()
        || null,
    });

    return apiResponse({
      success: true,
      code: 'PRODUCT_REGISTRATION_V6_ACCEPTED',
      jobId: started.jobId,
      workflowRunId: started.workflowRunId,
      sourceDocumentId: started.sourceDocumentId,
      inputKind: intake.sourceType,
      currentStage: started.currentStage,
      jobState: started.jobState,
      terminalOutcome: started.terminalOutcome,
      statusUrl: `/api/admin/product-registration/jobs/${started.jobId}`,
      workflowVersion: started.workflowVersion,
      dedupeHit: started.dedupeHit,
      sourceBatch: intake.sourceBatch,
      sourceDepartureYearContext: intake.sourceDepartureYearContext,
      uploadRequestId: requestId,
    }, { status: 202, headers: responseHeaders(requestId) });
  } catch (error) {
    const detail = describeUploadError(error);
    const operationKeyConflict = detail.includes('REGISTRATION_JOB_OPERATION_KEY_REUSED');
    const tenantMismatch = detail.includes('REGISTRATION_SOURCE_DOCUMENT_NOT_FOUND');
    const malformedRequest = error instanceof SyntaxError;
    console.error('[Upload API] kernel intake failed:', { requestId, detail });
    return apiResponse({
      success: false,
      code: operationKeyConflict
        ? 'REGISTRATION_OPERATION_KEY_REUSED'
        : tenantMismatch
          ? 'REGISTRATION_SOURCE_TENANT_MISMATCH'
          : malformedRequest
            ? 'REGISTRATION_REQUEST_INVALID'
            : 'PRODUCT_REGISTRATION_INTAKE_FAILED',
      error: '상품등록 원문 접수에 실패했습니다. 고객 공개나 레거시 등록은 실행하지 않았습니다.',
      details: process.env.NODE_ENV === 'development' ? detail : undefined,
      uploadRequestId: requestId,
    }, {
      status: operationKeyConflict ? 409 : tenantMismatch ? 403 : malformedRequest ? 400 : 500,
      headers: responseHeaders(requestId),
    });
  }
};

export const POST = withAdminGuard(postHandler);
