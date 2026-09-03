import type { NextRequest } from 'next/server';

import { ApiErrors, apiResponse } from '@/lib/api-response';
import { resolveAdminActorId } from '@/lib/admin-guard';
import { sanitizeDbError } from '@/lib/error-sanitizer';
import { createReviewReceipt, type ProductReviewDecision, type ReviewEvidenceRefV1 } from './human-review';
import { callProductReviewRpc } from './human-review-rpc';
import { getSupabaseAdmin } from '@/lib/supabase';

type ReviewRouteContext = { params: Promise<{ caseId: string }> | { caseId: string } };

async function readCaseId(context?: ReviewRouteContext): Promise<string | null> {
  const params = context?.params;
  if (!params) return null;
  const value = typeof (params as Promise<unknown>).then === 'function' ? await params : params;
  const id = (value as { caseId?: unknown }).caseId;
  return typeof id === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(id) ? id : null;
}

/** Shared implementation for the normal and adjudicator Receipt routes. */
export async function submitReviewReceipt(request: NextRequest, context: ReviewRouteContext | undefined, forcedSlot?: 'adjudicator') {
  const reviewerId = await resolveAdminActorId(request);
  if (!reviewerId) return ApiErrors.forbidden('검수 결과는 로그인한 관리자 사용자 세션으로만 제출할 수 있습니다.');
  const id = await readCaseId(context);
  if (!id) return ApiErrors.badRequest('검수 케이스 ID가 올바르지 않습니다.');
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const raw = body?.receipt && typeof body.receipt === 'object' && !Array.isArray(body.receipt)
    ? body.receipt as Record<string, unknown>
    : body;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return ApiErrors.badRequest('검수 Receipt 형식이 올바르지 않습니다.');
  try {
    const reviewerSlot = forcedSlot ?? raw.reviewerSlot;
    if (reviewerSlot !== 'first' && reviewerSlot !== 'second' && reviewerSlot !== 'adjudicator') return ApiErrors.badRequest('검수 순서가 올바르지 않습니다.');
    const receipt = createReviewReceipt({
      caseId: id,
      reviewerUserId: reviewerId,
      reviewerSessionId: raw.reviewerSessionId as string,
      reviewerSlot,
      packetHash: raw.packetHash as string,
      sourceHash: raw.sourceHash as string,
      parentExtractionHash: raw.parentExtractionHash as string,
      candidateAxisSetHash: raw.candidateAxisSetHash as string,
      decision: raw.decision as ProductReviewDecision,
      decisionPayload: raw.decisionPayload as Record<string, unknown>,
      evidence: raw.evidence as ReviewEvidenceRefV1[],
      reason: raw.reason as string,
      createdAt: typeof raw.createdAt === 'string' ? raw.createdAt : undefined,
    });
    const supabase = getSupabaseAdmin();
    if (!supabase) return ApiErrors.unavailable('검수 저장소가 연결되지 않았습니다.');
    const data = await callProductReviewRpc<unknown>(supabase, 'submit_product_registration_review_receipt', { p_payload: { receipt } });
    return apiResponse({ ok: true, data }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    console.error('[product-review-receipt]', error);
    const message = sanitizeDbError(error, '검수 결과를 저장하지 못했습니다.');
    if (/INVALID|REQUIRED|MISMATCH|STALE|SESSION|INDEPENDENT|ALREADY|NOT_FOUND|NOT_REVIEWABLE/iu.test(message)) return ApiErrors.conflict(message);
    return ApiErrors.internalError(message);
  }
}
