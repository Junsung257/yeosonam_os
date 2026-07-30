import { NextRequest } from 'next/server';
import { withAdminGuard } from '@/lib/admin-guard';
import { getDashboardStats, isSupabaseAdminConfigured } from '@/lib/supabase';
import { apiResponse } from '@/lib/api-response';

const PRIVATE_NO_STORE = { 'Cache-Control': 'private, no-store' };

const getHandler = async (_request: NextRequest) => {
  if (!isSupabaseAdminConfigured) {
    return apiResponse(
      { error: 'Supabase가 설정되지 않았습니다.' },
      { status: 503, headers: PRIVATE_NO_STORE },
    );
  }
  // 월별 확정매출과 같은 v_bookings_kpi/KST 경계를 사용한다.
  // 배포 환경마다 함수 버전이 어긋나면 취소 예약이 포함될 수 있으므로,
  // 첫 화면 KPI도 단일 구현에서 계산해 카드 간 숫자 불일치를 막는다.
  const stats = await getDashboardStats();
  if (!stats) {
    return apiResponse(
      { error: '대시보드 KPI를 집계하지 못했습니다.', stats: null },
      { status: 503, headers: PRIVATE_NO_STORE },
    );
  }
  return apiResponse(
    { stats },
    { headers: PRIVATE_NO_STORE },
  );
};

export const GET = withAdminGuard(getHandler);
