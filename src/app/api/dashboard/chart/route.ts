import { NextRequest } from 'next/server';
import { withAdminGuard } from '@/lib/admin-guard';
import { getDashboardStatsV3, isSupabaseAdminConfigured } from '@/lib/supabase';
import { apiResponse } from '@/lib/api-response';

const PRIVATE_NO_STORE = { 'Cache-Control': 'private, no-store' };

const getHandler = async (request: NextRequest) => {
  if (!isSupabaseAdminConfigured) {
    return apiResponse(
      { error: 'Supabase가 설정되지 않았습니다.' },
      { status: 503, headers: PRIVATE_NO_STORE },
    );
  }
  const { searchParams } = new URL(request.url);
  const requestedMonths = Number.parseInt(searchParams.get('months') || '6', 10);
  const months = Number.isFinite(requestedMonths) ? Math.min(24, Math.max(1, requestedMonths)) : 6;
  try {
    const data = await getDashboardStatsV3(months);
    return apiResponse({ data, data_status: 'ok' }, { headers: PRIVATE_NO_STORE });
  } catch (err) {
    console.error('대시보드 차트 조회 실패:', err);
    return apiResponse(
      { data: [], data_status: 'unavailable', status_detail: '대시보드 차트 데이터 소스가 아직 활성화되지 않았습니다.' },
      { status: 206, headers: PRIVATE_NO_STORE },
    );
  }
};

export const dynamic = 'force-dynamic';
export const GET = withAdminGuard(getHandler);
