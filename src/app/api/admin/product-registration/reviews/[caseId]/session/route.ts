import type { NextRequest } from 'next/server';

import { ApiErrors, apiResponse } from '@/lib/api-response';
import { resolveAdminActorId, withAdminGuard } from '@/lib/admin-guard';
import { sanitizeDbError } from '@/lib/error-sanitizer';
import { getSupabaseAdmin } from '@/lib/supabase';
import { callProductReviewRpc } from '@/lib/product-registration-v6/human-review-rpc';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Context = { params: Promise<{ caseId: string }> | { caseId: string } };

async function caseId(context?: Context): Promise<string | null> {
  const params = context?.params;
  if (!params) return null;
  const value = typeof (params as Promise<unknown>).then === 'function' ? await params : params;
  const id = (value as { caseId?: unknown }).caseId;
  return typeof id === 'string' && /^[0-9a-f-]{36}$/iu.test(id) ? id : null;
}

const postHandler = async (request: NextRequest, context?: Context) => {
  const reviewerId = await resolveAdminActorId(request);
  if (!reviewerId) return ApiErrors.forbidden('검수 세션은 로그인한 관리자 사용자 세션으로만 열 수 있습니다.');
  const id = await caseId(context);
  if (!id) return ApiErrors.badRequest('검수 케이스 ID가 올바르지 않습니다.');
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const slot = body?.reviewerSlot;
  if (slot !== 'first' && slot !== 'second' && slot !== 'adjudicator') {
    return ApiErrors.badRequest('검수 순서가 올바르지 않습니다.');
  }
  const supabase = getSupabaseAdmin();
  if (!supabase) return ApiErrors.unavailable('검수 저장소가 연결되지 않았습니다.');
  try {
    const data = await callProductReviewRpc<unknown>(supabase, 'begin_product_registration_review_session', {
      p_case_id: id,
      p_reviewer_id: reviewerId,
      p_reviewer_slot: slot,
    });
    return apiResponse({ ok: true, data }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    console.error('[product-review-session]', error);
    const message = sanitizeDbError(error, '검수 세션을 열지 못했습니다.');
    if (/STALE|ALREADY|INDEPENDENT|MEMBERSHIP|NOT_FOUND|IN_PROGRESS/iu.test(message)) return ApiErrors.conflict(message);
    return ApiErrors.internalError(message);
  }
};

export const POST = withAdminGuard(postHandler);
