import { type NextRequest } from 'next/server';

import { ApiErrors, apiResponse } from '@/lib/api-response';
import { resolveAdminActorId, withAdminGuard } from '@/lib/admin-guard';
import { sanitizeDbError } from '@/lib/error-sanitizer';
import { isSupabaseAdminConfigured, supabaseAdmin } from '@/lib/supabase';
import { resolveBenchmarkTenantId } from '@/lib/product-registration-v6/benchmark-admin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const getHandler = async (request: NextRequest) => {
  if (!isSupabaseAdminConfigured) return ApiErrors.unavailable('검수 저장소가 연결되지 않았습니다.');
  const reviewerId = await resolveAdminActorId(request);
  if (!reviewerId) return ApiErrors.forbidden('이중 검수는 로그인한 관리자 계정으로만 할 수 있습니다.');
  try {
    const tenantId = await resolveBenchmarkTenantId({ request });
    if (!tenantId) return ApiErrors.notFound('검수할 테넌트를 찾지 못했습니다.');
    const requestedLimit = Number(request.nextUrl.searchParams.get('limit') ?? 10);
    const limit = Number.isInteger(requestedLimit) ? Math.min(50, Math.max(1, requestedLimit)) : 10;
    const { data, error } = await supabaseAdmin.rpc('get_product_registration_benchmark_review_queue', {
      p_tenant_id: tenantId,
      p_reviewer_id: reviewerId,
      p_limit: limit,
    });
    if (error) throw error;
    return apiResponse({ ok: true, data: { tenantId, items: data ?? [] } }, {
      headers: { 'Cache-Control': 'private, no-store' },
    });
  } catch (error) {
    console.error('[benchmark-review-queue]', error);
    return ApiErrors.internalError(sanitizeDbError(error, '검수 대기열을 불러오지 못했습니다.'));
  }
};

export const GET = withAdminGuard(getHandler);
