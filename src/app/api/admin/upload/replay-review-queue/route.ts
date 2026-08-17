import { randomUUID } from 'crypto';

import { NextRequest, NextResponse } from 'next/server';

import { withAdminGuard } from '@/lib/admin-guard';
import { analyzeUploadInputText } from '@/lib/product-registration-input-guard';
import {
  startProductRegistrationTextWorkflow,
  startProductRegistrationWorkflowBySourceId,
} from '@/lib/product-registration-authority/start-workflow';
import { parseProductRegistrationTenantId } from '@/lib/product-registration-authority/types';
import { getProductRegistrationV6RuntimeConfig } from '@/lib/product-registration-v6/runtime-config';
import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';
import { DEFAULT_PRODUCT_REGISTRATION_COMMISSION_RATE, parseUploadSourceMetadata } from '@/lib/upload-source-metadata';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

type ReplayBody = {
  queueId?: unknown;
  forceReprocess?: unknown;
  sourceLabel?: unknown;
  commissionRate?: unknown;
};

function stringValue(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

const postHandler = async (request: NextRequest) => {
  if (!isSupabaseConfigured) {
    return NextResponse.json({ success: false, error: 'Supabase is not configured.' }, { status: 503 });
  }
  if (!getProductRegistrationV6RuntimeConfig().workflowEnabled) {
    return NextResponse.json({
      success: false,
      code: 'REGISTRATION_KERNEL_WORKFLOW_DISABLED',
      error: '통합 상품등록 Workflow가 비활성 상태라 구형 저장 엔진으로 우회하지 않았습니다.',
    }, { status: 503 });
  }

  const requestId = randomUUID();
  let body: ReplayBody;
  try {
    body = await request.json() as ReplayBody;
  } catch {
    return NextResponse.json(
      { success: false, error: 'JSON body is required.', uploadRequestId: requestId },
      { status: 400 },
    );
  }

  const queueId = stringValue(body.queueId);
  if (!queueId) {
    return NextResponse.json(
      { success: false, error: 'queueId is required.', uploadRequestId: requestId },
      { status: 400 },
    );
  }

  const { data: queueRow, error: queueError } = await supabaseAdmin
    .from('upload_review_queue')
    .select('id, tenant_id, source_document_id, upload_job_id, raw_text_chunk, source_filename, product_title, parsed_draft_json')
    .eq('id', queueId)
    .maybeSingle();

  if (queueError) {
    return NextResponse.json(
      { success: false, error: queueError.message, uploadRequestId: requestId },
      { status: 500 },
    );
  }
  if (!queueRow) {
    return NextResponse.json(
      { success: false, error: 'upload review queue row was not found.', uploadRequestId: requestId },
      { status: 404 },
    );
  }

  const tenantId = parseProductRegistrationTenantId(
    stringValue((queueRow as { tenant_id?: unknown }).tenant_id),
  );
  if (!tenantId) {
    return NextResponse.json(
      {
        success: false,
        code: 'REGISTRATION_REPLAY_TENANT_REQUIRED',
        error: '이 오래된 대기 항목은 tenant 소유권이 확인되지 않아 자동 재처리하지 않았습니다.',
        uploadRequestId: requestId,
      },
      { status: 409 },
    );
  }

  const rawText = stringValue((queueRow as { raw_text_chunk?: unknown }).raw_text_chunk);
  const sourceDocumentId = stringValue((queueRow as { source_document_id?: unknown }).source_document_id);
  if (!sourceDocumentId && (!rawText || rawText.length < 50)) {
    return NextResponse.json(
      { success: false, error: '재처리할 불변 원문 또는 원문 텍스트가 없습니다.', uploadRequestId: requestId },
      { status: 422 },
    );
  }

  const sourceLabel =
    stringValue(body.sourceLabel)
    ?? stringValue((queueRow as { source_filename?: unknown }).source_filename)
    ?? stringValue((queueRow as { product_title?: unknown }).product_title)
    ?? 'review-queue-replay.txt';
  const parsedDraftJson = (queueRow as { parsed_draft_json?: unknown }).parsed_draft_json;
  const parsedDraft = asRecord(parsedDraftJson);
  if (!sourceDocumentId && parsedDraft.rawTextTruncated === true) {
    return NextResponse.json({
      success: false,
      code: 'REGISTRATION_REPLAY_IMMUTABLE_SOURCE_REQUIRED',
      error: '저장된 텍스트가 잘린 오래된 항목이라 원본 파일 없이는 정확하게 재처리할 수 없습니다.',
      uploadRequestId: requestId,
    }, { status: 409 });
  }
  const sourceTextEvidence = parsedDraftJson && typeof parsedDraftJson === 'object' && !Array.isArray(parsedDraftJson)
    ? (parsedDraftJson as { _source_text_evidence_v2?: unknown })._source_text_evidence_v2
    : null;
  const evidenceDocuments = sourceTextEvidence && typeof sourceTextEvidence === 'object' && !Array.isArray(sourceTextEvidence)
    ? (sourceTextEvidence as { documents?: unknown }).documents
    : null;
  const evidenceExcerptBySourceId = new Map<string, string>();
  if (Array.isArray(evidenceDocuments)) {
    for (const document of evidenceDocuments) {
      if (!document || typeof document !== 'object' || Array.isArray(document)) continue;
      const record = document as { sourceId?: unknown; excerpt?: unknown };
      const sourceId = stringValue(record.sourceId);
      const excerpt = stringValue(record.excerpt);
      if (sourceId && excerpt) evidenceExcerptBySourceId.set(sourceId, excerpt);
    }
  }
  const replayOriginalRawText = evidenceExcerptBySourceId.get('original_raw') ?? rawText ?? '';
  const commissionRate = Number(body.commissionRate);
  const metadata = parseUploadSourceMetadata({
    rawText: replayOriginalRawText,
    sourceLabel,
    explicitCommissionRate: Number.isFinite(commissionRate) ? commissionRate : undefined,
    defaultCommissionRate: DEFAULT_PRODUCT_REGISTRATION_COMMISSION_RATE,
  });

  const inputAnalysisForTrust = analyzeUploadInputText(replayOriginalRawText);
  if (!sourceDocumentId && inputAnalysisForTrust.blocked) {
    return NextResponse.json(
      {
        success: false,
        error: 'Saved source text did not pass upload input quality checks.',
        inputQuality: inputAnalysisForTrust,
        uploadRequestId: requestId,
      },
      { status: 422 },
    );
  }

  const publicBaseUrl = process.env.NEXT_PUBLIC_BASE_URL
    ?? process.env.NEXT_PUBLIC_SITE_URL
    ?? request.nextUrl.origin;
  const started = sourceDocumentId
    ? await startProductRegistrationWorkflowBySourceId({
        supabase: supabaseAdmin,
        tenantId,
        sourceDocumentId,
        requestId,
        requestBaseUrl: request.nextUrl.origin,
        publicBaseUrl,
        uploadSourceMetadata: metadata as unknown as Record<string, unknown>,
        sourceChannel: 'admin-review-replay',
        forceReprocess: body.forceReprocess === true,
      })
    : await startProductRegistrationTextWorkflow({
        supabase: supabaseAdmin,
        tenantId,
        rawText: replayOriginalRawText,
        fileName: sourceLabel,
        requestId,
        requestBaseUrl: request.nextUrl.origin,
        publicBaseUrl,
        uploadSourceMetadata: metadata as unknown as Record<string, unknown>,
        sourceChannel: 'admin-review-replay',
        forceReprocess: body.forceReprocess === true,
        metadata: { replayQueueId: queueId },
      });

  await supabaseAdmin
    .from('upload_review_queue')
    .update({
      status: 'resolved',
      parsed_draft_json: {
        ...parsedDraft,
        replayResult: {
          status: 'pending',
          reason: '통합 상품등록 Workflow로 안전하게 인계했습니다.',
          jobId: started.jobId,
          workflowRunId: started.workflowRunId,
          sourceDocumentId: started.sourceDocumentId,
          replayedAt: new Date().toISOString(),
        },
      },
      updated_at: new Date().toISOString(),
    })
    .eq('id', queueId);

  return NextResponse.json(
    {
      success: true,
      code: 'PRODUCT_REGISTRATION_REPLAY_ACCEPTED',
      state: 'processing',
      ...started,
      replayed: true,
      queueId,
      replayResolved: true,
      uploadRequestId: requestId,
    },
    { status: 202 },
  );
};

export const POST = withAdminGuard(postHandler);
