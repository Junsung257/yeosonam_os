import { NextResponse } from 'next/server';
import {
  getAIUsageStats,
  getSettlementBalances,
  getOperatorTakeRates,
  getRepeatBookingStats,
  getDataQualityIssues,
  isSupabaseConfigured,
} from '@/lib/supabase';

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
export async function GET() {
  if (!isSupabaseConfigured) {
    return NextResponse.json({
      aiUsage: null, settlement: null, takeRates: [], repeat: null, dataQuality: null,
    });
  }
  try {
    const [aiUsage, settlement, takeRates, repeat, dataQuality] = await Promise.all([
      getAIUsageStats(),
      getSettlementBalances(),
      getOperatorTakeRates(8),
      getRepeatBookingStats(),
      getDataQualityIssues(),
    ]);
    return NextResponse.json({ aiUsage, settlement, takeRates, repeat, dataQuality });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : '운영 KPI 조회 실패' },
      { status: 500 },
    );
  }
}
