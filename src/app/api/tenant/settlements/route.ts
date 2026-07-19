import { type NextRequest } from 'next/server';
import { apiResponse } from '@/lib/api-response';
import { sanitizeDbError } from '@/lib/error-sanitizer';
import { getTenantSettlements, isSupabaseAdminConfigured } from '@/lib/supabase';
import {
  isTenantPortalAuthError,
  requireTenantPortalRequest,
} from '@/lib/tenant-portal-auth';

// GET /api/tenant/settlements?tenant_id=&month=YYYY-MM
export async function GET(request: NextRequest) {
  const requestedTenantId = request.nextUrl.searchParams.get('tenant_id') ?? '';
  const authorization = await requireTenantPortalRequest(request, requestedTenantId);
  if (isTenantPortalAuthError(authorization)) return authorization;
  if (!isSupabaseAdminConfigured) {
    return apiResponse({ error: '테넌트 저장소를 사용할 수 없습니다.' }, { status: 503 });
  }

  const month = request.nextUrl.searchParams.get('month') ?? new Date().toISOString().slice(0, 7);
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
    return apiResponse({ error: 'month는 YYYY-MM 형식이어야 합니다.' }, { status: 400 });
  }

  try {
    const { rows, total_cost } = await getTenantSettlements(authorization.tenantId, month);
    return apiResponse(
      { rows, total_cost, month },
      { headers: { 'Cache-Control': 'private, no-store' } },
    );
  } catch (error) {
    console.error('[tenant/settlements] lookup failed', sanitizeDbError(error));
    return apiResponse(
      { error: '정산 조회에 실패했습니다.' },
      {
        status: 500,
        headers: { 'Cache-Control': 'private, no-store' },
      },
    );
  }
}
