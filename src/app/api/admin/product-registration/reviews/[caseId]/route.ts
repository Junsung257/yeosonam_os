import type { NextRequest } from 'next/server';

import { ApiErrors, apiResponse } from '@/lib/api-response';
import { resolveAdminActorId, withAdminGuard } from '@/lib/admin-guard';
import { sanitizeDbError } from '@/lib/error-sanitizer';
import { callProductReviewRpc } from '@/lib/product-registration-v6/human-review-rpc';
import { getSupabaseAdmin } from '@/lib/supabase';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Context = { params: Promise<{ caseId: string }> | { caseId: string } };

async function readCaseId(context?: Context): Promise<string | null> {
  const params = context?.params;
  if (!params) return null;
  const value = typeof (params as Promise<unknown>).then === 'function' ? await params : params;
  const id = (value as { caseId?: unknown }).caseId;
  return typeof id === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(id)
    ? id
    : null;
}

const getHandler = async (_request: NextRequest, context?: Context) => {
  const reviewerId = await resolveAdminActorId(_request);
  if (!reviewerId) return ApiErrors.forbidden('검수 원문은 로그인한 관리자 사용자 세션으로만 볼 수 있습니다.');
  const caseId = await readCaseId(context);
  if (!caseId) return ApiErrors.badRequest('검수 케이스 ID가 올바르지 않습니다.');
  const supabase = getSupabaseAdmin();
  if (!supabase) return ApiErrors.unavailable('검수 저장소가 연결되지 않았습니다.');

  try {
    const data = await callProductReviewRpc<unknown>(supabase, 'get_product_registration_review_case', {
      p_case_id: caseId,
      p_reviewer_id: reviewerId,
    });
    return apiResponse({ ok: true, data }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    console.error('[product-review-case-read]', error);
    const message = sanitizeDbError(error, '검수 원문을 불러오지 못했습니다.');
    if (/NOT_FOUND|MEMBERSHIP|LINEAGE|INPUT_INVALID/iu.test(message)) return ApiErrors.conflict(message);
    return ApiErrors.internalError(message);
  }
};

export const GET = withAdminGuard(getHandler);
