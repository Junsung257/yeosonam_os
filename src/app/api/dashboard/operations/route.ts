import { NextRequest, NextResponse } from 'next/server';
import { withAdminGuard } from '@/lib/admin-guard';
import {
  getAIUsageStats,
  getSettlementBalances,
  getOperatorTakeRates,
  getRepeatBookingStats,
  getDataQualityIssues,
  isSupabaseConfigured,
} from '@/lib/supabase';

function withTimeout<T>(promise: Promise<T>, fallback: T, ms: number): Promise<T> {
  return Promise.race([
    promise.catch(() => fallback),
    new Promise<T>((resolve) => setTimeout(() => resolve(fallback), ms)),
  ]);
}

type MetricLoadResult<T> =
  | { status: 'ok'; data: T }
  | { status: 'error' | 'timeout'; data: null };

function withLoadStatus<T>(promise: Promise<T>, ms: number): Promise<MetricLoadResult<T>> {
  return Promise.race([
    promise
      .then((data): MetricLoadResult<T> => ({ status: 'ok', data }))
      .catch((): MetricLoadResult<T> => ({ status: 'error', data: null })),
    new Promise<MetricLoadResult<T>>((resolve) =>
      setTimeout(() => resolve({ status: 'timeout', data: null }), ms),
    ),
  ]);
}

const PRIVATE_NO_STORE = { 'Cache-Control': 'private, no-store' };

/**
 * Dashboard V4 — 운영 KPI 통합 엔드포인트
 *
 * /admin 메인의 OS 유기적 통합용:
 *  - aiUsage: 자비스 V2 cost_ledger 기반 7일/30일
 *  - settlement: Payable + Receivable + 30/60/90일 aging
 *  - takeRates: 랜드사별 GMV/Margin/Take Rate (Tufte small multiples)
 *  - repeat: Repeat Booking Rate + LTV 신호
 *  - dataQuality: 데이터 결측·모순 자동 감지 (다른 KPI 신뢰성의 전제)
 */
const getHandler = async (request: NextRequest) => {
  if (!isSupabaseConfigured) {
    return NextResponse.json(
      {
        aiUsage: null,
        settlement: null,
        settlementStatus: 'unconfigured',
        takeRates: [],
        repeat: null,
        dataQuality: null,
      },
      { headers: PRIVATE_NO_STORE },
    );
  }
  try {
    const { searchParams } = new URL(request.url);
    const dashboardMode = searchParams.get('mode') === 'dashboard';
    const budgetMs = dashboardMode ? 1800 : 10000;
    const [aiUsage, settlementResult, takeRates, repeat, dataQuality] = await Promise.all([
      withTimeout(getAIUsageStats(), null, budgetMs),
      withLoadStatus(getSettlementBalances(), budgetMs),
      withTimeout(getOperatorTakeRates(8), [], budgetMs),
      withTimeout(getRepeatBookingStats(), null, dashboardMode ? 900 : budgetMs),
      withTimeout(getDataQualityIssues(), null, dashboardMode ? 900 : budgetMs),
    ]);
    return NextResponse.json(
      {
        aiUsage,
        settlement: settlementResult.data,
        settlementStatus: settlementResult.status,
        takeRates,
        repeat,
        dataQuality,
      },
      { headers: PRIVATE_NO_STORE },
    );
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : '운영 KPI 조회 실패' },
      { status: 500, headers: PRIVATE_NO_STORE },
    );
  }
};

export const dynamic = 'force-dynamic';
export const GET = withAdminGuard(getHandler);
