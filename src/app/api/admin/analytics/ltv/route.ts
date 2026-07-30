import { type NextResponse } from 'next/server';
import { supabaseAdmin, isSupabaseAdminConfigured } from '@/lib/supabase';
import { ADMIN_CACHE } from '@/lib/admin-cache';
import { withAdminGuard } from '@/lib/admin-guard';
import { apiResponse } from '@/lib/api-response';
import { sanitizeDbError } from '@/lib/error-sanitizer';

// LTV 코호트 분석 — UTM 채널별 평생 결제액 집계
// bookings.utm_source 기준으로 cohort 분류
//
// 감사: docs/audits/2026-05-11-admin-perf-audit.md
// 개선: 전체 적격 예약을 DB에서 집계하고 CDN 5분 캐시. 코호트는 실시간 지표가 아니므로 5분 stale 허용.

const CACHE_HEADERS = ADMIN_CACHE.analytics;
const LTV_RPC_TIMEOUT_MS = 2500;

function withTimeout<T>(query: T): T {
  const candidate = query as T & { abortSignal?: (signal: AbortSignal) => T };
  return typeof candidate.abortSignal === 'function' && typeof AbortSignal?.timeout === 'function'
    ? candidate.abortSignal(AbortSignal.timeout(LTV_RPC_TIMEOUT_MS))
    : query;
}

interface MarketingLtvCohort {
  channel: string;
  customerCount: number;
  totalRevenue: number;
  avgLtv: number;
  avgBookingsPerCustomer: number;
  totalBookings: number;
}

const getHandler = async (): Promise<NextResponse> => {
  if (!isSupabaseAdminConfigured) {
    return apiResponse({ error: 'Supabase admin connection is not configured.' }, { status: 503 });
  }

  try {
    const { data, error } = await withTimeout(
      supabaseAdmin.rpc('get_admin_marketing_ltv_summary'),
    );

    if (error) throw error;
    const cohorts: MarketingLtvCohort[] = (data ?? []).map((row: Record<string, unknown>) => ({
      channel: String(row.channel || 'direct'),
      customerCount: Number(row.customer_count) || 0,
      totalRevenue: Number(row.total_revenue) || 0,
      avgLtv: Number(row.avg_ltv) || 0,
      avgBookingsPerCustomer: Number(row.avg_bookings_per_customer) || 0,
      totalBookings: Number(row.total_bookings) || 0,
    }));

    return apiResponse(
      {
        cohorts,
        totalCustomers: cohorts.reduce((sum, cohort) => sum + cohort.customerCount, 0),
        totalBookings: cohorts.reduce((sum, cohort) => sum + cohort.totalBookings, 0),
        basis: 'all_eligible_bookings',
      },
      { headers: CACHE_HEADERS },
    );
  } catch (err) {
    return apiResponse({
      cohorts: [],
      totalCustomers: 0,
      totalBookings: 0,
      basis: 'unavailable',
      data_status: 'unavailable' as const,
      status_detail: `LTV 원천을 조회할 수 없습니다: ${sanitizeDbError(err)}`,
    });
  }
}

export const GET = withAdminGuard(getHandler);
