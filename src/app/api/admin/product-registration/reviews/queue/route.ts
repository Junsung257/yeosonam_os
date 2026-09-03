import type { NextRequest } from 'next/server';

import { ApiErrors, apiResponse } from '@/lib/api-response';
import { resolveAdminActorId, withAdminGuard } from '@/lib/admin-guard';
import { sanitizeDbError } from '@/lib/error-sanitizer';
import { resolveBenchmarkTenantId } from '@/lib/product-registration-v6/benchmark-admin';
import { callProductReviewRpc } from '@/lib/product-registration-v6/human-review-rpc';
import { getSupabaseAdmin } from '@/lib/supabase';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const getHandler = async (request: NextRequest) => {
  const reviewerId = await resolveAdminActorId(request);
  if (!reviewerId) return ApiErrors.forbidden('검수는 로그인한 관리자 사용자 세션으로만 할 수 있습니다.');
  const supabase = getSupabaseAdmin();
  if (!supabase) return ApiErrors.unavailable('검수 저장소가 연결되지 않았습니다.');
  try {
    const tenantId = await resolveBenchmarkTenantId({ request });
    if (!tenantId) return ApiErrors.notFound('검수할 테넌트를 찾지 못했습니다.');
    const requestedLimit = Number(request.nextUrl.searchParams.get('limit') ?? 10);
    const limit = Number.isInteger(requestedLimit) ? Math.min(50, Math.max(1, requestedLimit)) : 10;
    const data = await callProductReviewRpc<unknown>(supabase, 'get_product_registration_review_queue', {
      p_tenant_id: tenantId,
      p_reviewer_id: reviewerId,
      p_limit: limit,
    });
    return apiResponse({ ok: true, data: { tenantId, items: Array.isArray(data) ? data : [] } }, {
      headers: { 'Cache-Control': 'private, no-store' },
    });
  } catch (error) {
    console.error('[product-review-queue]', error);
    return ApiErrors.internalError(sanitizeDbError(error, '검수 대기열을 불러오지 못했습니다.'));
  }
};

export const GET = withAdminGuard(getHandler);
