/**
 * Dashboard Stats — 어드민 통합 대시보드 통계
 *
 * supabase.ts god 모듈에서 분리 (2026-04-27 단계 1).
 * 호출자는 기존 그대로 `@/lib/supabase` 에서 import 가능 (re-export 유지).
 *
 * V1 (getDashboardStats): 이번 달 판매/입금/미수/마일리지 기본 KPI
 * V3 (getDashboardStatsV3): V2 + 광고비 + 순마진 (광고 ROI 포함)
 *
 * V2 (getDashboardStatsV2)는 affiliate.ts 에 이관됨.
 *
 * V4 (2026-04-28): 매출 인식 기준 분리 — IFRS 15 / ASC 606 표준
 *  - getRecognizedRevenueMonthly(): 출발일 기준 확정매출 (회계)
 *  - getNewBookingsMonthly():       생성일 KST 기준 신규예약 (영업)
 */

import { getSupabaseAdmin, supabaseAdmin } from '../supabase';
import {
  kstMonthKeysFor,
  kstMonthStart,
  toKstDate,
} from '../admin-dashboard-kpi-basis';

// Server-only module. All callers in src/app/api/** routes and admin server pages.
// Uses service_role to bypass RLS so we can drop authenticated `*_all USING true` policies.
const getSupabase = getSupabaseAdmin;

const ADMIN_RPC_TIMEOUT_MS = 2500;

function withAdminQueryTimeout<T>(query: T, timeoutMs = ADMIN_RPC_TIMEOUT_MS): T {
  const candidate = query as T & { abortSignal?: (signal: AbortSignal) => T };
  if (typeof candidate.abortSignal !== 'function' || typeof AbortSignal?.timeout !== 'function') return query;
  return candidate.abortSignal(AbortSignal.timeout(timeoutMs));
}

// ─── V1: 이번 달 KPI ─────────────────────────────────────────

export async function getDashboardStats() {
  try {
    // 서버 집계 RPC를 사용해 PostgREST 기본 1,000행 제한과 다중 왕복을 제거한다.
    const { data, error } = await withAdminQueryTimeout(
      supabaseAdmin.rpc('get_admin_dashboard_stats'),
    );
    if (error) throw error;
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      throw new Error('대시보드 KPI 집계 결과가 올바르지 않습니다.');
    }
    const row = data as Record<string, unknown>;
    const numberValue = (key: string) => Number(row[key]) || 0;
    return {
      totalSales: numberValue('totalSales'),
      totalCost: numberValue('totalCost'),
      totalPaid: numberValue('totalPaid'),
      totalOutstanding: numberValue('totalOutstanding'),
      margin: numberValue('margin'),
      activeBookings: numberValue('activeBookings'),
      unpaidD7: numberValue('unpaidD7'),
      totalMonthBookings: numberValue('totalMonthBookings'),
      totalMileage: numberValue('totalMileage'),
      expiringPassports: numberValue('expiringPassports'),
    };
  } catch (error) { console.error('대시보드 통계 실패:', error); return null; }
}

// ─── V3: 광고비 + 순마진 통합 ────────────────────────────────

export interface MonthlyChartDataV3 {
  month: string;
  direct_sales: number;
  affiliate_sales: number;
  direct_margin: number;
  affiliate_margin: number;
  total_commission: number;
  ad_spend_krw: number;   // 신규
  net_margin: number;     // 신규: DB 순마진 합계 - 광고비 (수수료는 이미 margin에 반영)
}

export async function getDashboardStatsV3(months = 6): Promise<MonthlyChartDataV3[]> {
  const supabase = getSupabase();
  if (!supabase) return [];

  try {
    const now = new Date();
    const monthKeys = kstMonthKeysFor(months, now);
    // 2개 쿼리 병렬 실행 (기존 12개 → 2개)
    const [bookingsResult, snapshotsResult] = await Promise.all([
      withAdminQueryTimeout(supabase
        .from('v_monthly_dashboard_profit')
        .select('month, direct_sales, affiliate_sales, direct_margin, affiliate_margin, total_commission')
        .gte('month', monthKeys[0])
        .lte('month', monthKeys.at(-1)!)),
      withAdminQueryTimeout(supabase
        .from('v_monthly_ad_spend')
        .select('month, ad_spend_krw')
        .gte('month', monthKeys[0])
        .lte('month', monthKeys.at(-1)!)),
    ]);

    if (bookingsResult.error) throw bookingsResult.error;
    if (snapshotsResult.error) throw snapshotsResult.error;
    const bookings = bookingsResult.data;
    const snapshots = snapshotsResult.data;

    // 월별로 그룹핑 (클라이언트 사이드)
    interface ChartProfitRow {
      month: string;
      direct_sales: number | null;
      affiliate_sales: number | null;
      direct_margin: number | null;
      affiliate_margin: number | null;
      total_commission: number | null;
    }
    interface AdSpendRow { month: string; ad_spend_krw: number | null }
    const profitByMonth = new Map(
      ((bookings ?? []) as unknown as ChartProfitRow[]).map(row => [row.month, row]),
    );
    const adSpendByMonth = new Map(
      ((snapshots ?? []) as unknown as AdSpendRow[]).map(row => [row.month, Number(row.ad_spend_krw) || 0]),
    );

    const result: MonthlyChartDataV3[] = [];
    for (const monthLabel of monthKeys) {
      const profit = profitByMonth.get(monthLabel);
      const directMargin = Number(profit?.direct_margin) || 0;
      const affiliateMargin = Number(profit?.affiliate_margin) || 0;
      const totalCommission = Number(profit?.total_commission) || 0;
      const adSpend = adSpendByMonth.get(monthLabel) ?? 0;

      // bookings.margin은 DB 트리거에서 이미 인플루언서 수수료를 차감한 값이다.
      // 표시용 totalCommission을 다시 빼면 제휴 예약 수수료가 이중 차감된다.
      const netMargin = directMargin + affiliateMargin - adSpend;

      result.push({
        month: monthLabel,
        direct_sales: Number(profit?.direct_sales) || 0,
        affiliate_sales: Number(profit?.affiliate_sales) || 0,
        direct_margin: directMargin,
        affiliate_margin: affiliateMargin,
        total_commission: totalCommission,
        ad_spend_krw: adSpend,
        net_margin: netMargin,
      });
    }

    return result;
  } catch (error) {
    console.error('V3 차트 통계 조회 실패:', error);
    throw error;
  }
}

// ─── V4: 매출 인식 기준 분리 (IFRS 15 / ASC 606) ───────────────────────
//
// 사장님 요구사항(2026-04-28):
//   1) 월별 수익/매출 = 출발일 기준 이미 확정된 우리 수익
//   2) 월별 예약     = 생성일 기준, 취소 가능
// 본 두 함수는 향후 v_monthly_recognized_revenue / v_monthly_new_bookings 뷰로
// 갈음 가능 (마이그레이션 20260428000000_v_bookings_kpi_unified_views.sql).

export interface RecognizedRevenueMonth {
  month: string;            // YYYY-MM (출발일 기준)
  recognized_bookings: number;
  gmv: number;              // 총 거래액 (total_price 합)
  margin: number;           // 마진 (margin 컬럼 합)
  paid: number;             // 입금 완료액
  outstanding: number;      // 미수금
  commission: number;       // 어필리에이트 수수료
}

export interface NewBookingsMonth {
  month: string;            // YYYY-MM (생성일 KST 기준)
  total_bookings: number;
  live_bookings: number;
  cancelled_bookings: number;
  gmv_live: number;
  gmv_total: number;
  avg_lead_time: number | null;
  cancellation_rate: number; // 0~1
}

/**
 * 월별 확정매출 (출발일 기준, IFRS 15/ASC 606 매출 인식).
 * 출발일 ≤ 오늘 & status ≠ 'cancelled' 만 집계.
 */
export async function getRecognizedRevenueMonthly(months = 6): Promise<RecognizedRevenueMonth[]> {
  const supabase = getSupabase();
  if (!supabase) return [];
  try {
    const now = new Date();
    const todayStr = toKstDate(now);
    const fromStr = kstMonthStart(now, -(months - 1));

    const { data, error } = await supabase
      .from('v_monthly_recognized_revenue')
      .select('month, recognized_bookings, gmv, margin, paid, outstanding, commission')
      .gte('month', fromStr.slice(0, 7))
      .lte('month', todayStr.slice(0, 7));

    if (error) throw error;

    const buckets = new Map<string, RecognizedRevenueMonth>();
    for (const m of kstMonthKeysFor(months)) {
      buckets.set(m, { month: m, recognized_bookings: 0, gmv: 0, margin: 0, paid: 0, outstanding: 0, commission: 0 });
    }
    for (const b of (data ?? []) as Array<Record<string, unknown>>) {
      const month = (b.month as string) ?? '';
      const row = buckets.get(month);
      if (!row) continue;
      row.recognized_bookings = Number(b.recognized_bookings) || 0;
      row.gmv = Number(b.gmv) || 0;
      row.margin = Number(b.margin) || 0;
      row.paid = Number(b.paid) || 0;
      row.outstanding = Number(b.outstanding) || 0;
      row.commission = Number(b.commission) || 0;
    }
    return [...buckets.values()];
  } catch (err) {
    console.error('확정매출 월별 조회 실패:', err);
    throw err;
  }
}

/**
 * 월별 신규예약 (생성일 KST 기준). 취소 포함, 취소율도 같이 반환.
 */
export async function getNewBookingsMonthly(months = 6): Promise<NewBookingsMonth[]> {
  const supabase = getSupabase();
  if (!supabase) return [];
  try {
    const now = new Date();
    const monthKeys = kstMonthKeysFor(months, now);

    const { data, error } = await supabase
      .from('v_monthly_new_bookings')
      .select('month, total_bookings, live_bookings, cancelled_bookings, gmv_live, gmv_total, avg_lead_time')
      .gte('month', monthKeys[0])
      .lte('month', monthKeys.at(-1)!);

    if (error) throw error;

    const buckets = new Map<string, NewBookingsMonth>();
    for (const m of monthKeys) {
      buckets.set(m, {
        month: m, total_bookings: 0, live_bookings: 0, cancelled_bookings: 0,
        gmv_live: 0, gmv_total: 0, avg_lead_time: null, cancellation_rate: 0,
      });
    }
    for (const b of (data ?? []) as Array<Record<string, unknown>>) {
      const month = b.month as string | null;
      if (!month) continue;
      const row = buckets.get(month);
      if (!row) continue;
      row.total_bookings = Number(b.total_bookings) || 0;
      row.live_bookings = Number(b.live_bookings) || 0;
      row.cancelled_bookings = Number(b.cancelled_bookings) || 0;
      row.gmv_live = Number(b.gmv_live) || 0;
      row.gmv_total = Number(b.gmv_total) || 0;
      const avgLeadTime = b.avg_lead_time == null ? null : Number(b.avg_lead_time);
      row.avg_lead_time = avgLeadTime != null && Number.isFinite(avgLeadTime) ? Math.round(avgLeadTime) : null;
    }
    return [...buckets.values()].map(row => ({
      ...row,
      avg_lead_time: row.avg_lead_time,
      cancellation_rate: row.total_bookings > 0 ? row.cancelled_bookings / row.total_bookings : 0,
    }));
  } catch (err) {
    console.error('신규예약 월별 조회 실패:', err);
    throw err;
  }
}

// ─── Booking Pace + 90일 취소율 (Booking.com / Airbnb 식 표준 KPI) ─────
//
// Booking Pace: 향후 출발 예정 예약의 D-N 버킷별 분포. 영업 건강 신호.
// 90일 Cancellation Rate: 최근 90일 생성 예약 중 취소 비율. Booking.com 파트너 표준.

export interface BookingPaceBucket {
  bucket: 'D-7' | 'D-30' | 'D-90' | 'D-180' | 'D+';
  bookings: number;
  gmv: number;
}

export interface PaceAndCancellation {
  pace: BookingPaceBucket[];
  cancellation_90d: {
    total_in_window: number;
    cancelled_in_window: number;
    rate: number;          // 0~1
  };
}

export async function getBookingPaceAndCancellation(): Promise<PaceAndCancellation> {
  const supabase = getSupabase();
  const empty: PaceAndCancellation = {
    pace: [
      { bucket: 'D-7', bookings: 0, gmv: 0 },
      { bucket: 'D-30', bookings: 0, gmv: 0 },
      { bucket: 'D-90', bookings: 0, gmv: 0 },
      { bucket: 'D-180', bookings: 0, gmv: 0 },
      { bucket: 'D+', bookings: 0, gmv: 0 },
    ],
    cancellation_90d: { total_in_window: 0, cancelled_in_window: 0, rate: 0 },
  };
  if (!supabase) return empty;

  try {
    const { data, error } = await withAdminQueryTimeout(
      supabase.rpc('get_admin_booking_pace_and_cancellation'),
    );
    if (error) throw error;
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Booking Pace 집계 결과가 올바르지 않습니다.');
    return data as unknown as PaceAndCancellation;
  } catch (err) {
    console.error('Booking Pace 조회 실패:', err);
    throw err;
  }
}

// ─── AI 비용 추이 (jarvis_cost_ledger 기반) ────────────────────────────
//
// 자비스 V2 인프라 (project_jarvis_v2_design.md) 의 cost_tracker 가 모든 LLM
// 호출 비용을 ledger 에 기록한다. 대시보드에선 7일/30일 합계 + 일별 sparkline 만 표시.

export interface AIUsageStats {
  total_usd_7d: number;
  total_usd_30d: number;
  total_calls_30d: number;
  daily: { date: string; cost_usd: number; calls: number }[]; // 30일
  by_model: { model: string; cost_usd: number; calls: number }[]; // top 5
  by_provider: {
    provider: 'deepseek' | 'gemini' | 'anthropic' | 'unknown';
    cost_usd: number;
    calls: number;
    cache_hit_rate: number; // cache_read_tokens / input_tokens
  }[];
}

export async function getAIUsageStats(): Promise<AIUsageStats> {
  const supabase = getSupabase();
  const empty: AIUsageStats = { total_usd_7d: 0, total_usd_30d: 0, total_calls_30d: 0, daily: [], by_model: [], by_provider: [] };
  if (!supabase) return empty;
  try {
    const { data, error } = await supabase.rpc('get_admin_ai_usage_stats');
    if (error) throw error;
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('AI 비용 집계 결과가 올바르지 않습니다.');
    return data as unknown as AIUsageStats;
  } catch (err) {
    console.error('AI 비용 추이 조회 실패:', err);
    throw err;
  }
}

// ─── 정산 잔여 (Payable to 랜드사 / Receivable from 고객) ───────────────
//
// Payable: 출발 완료된 비취소 예약의 원가 합 - 실제 송금액 (랜드사에 미지급)
// Receivable: 비취소 예약의 (판매가 - 입금액) (고객 미입금)
// Aging: 출발일 기준 30/60/90일 버킷 (오버듀일수록 위험)

export interface SettlementBalances {
  cash: {
    received: number;
    paid_out: number;
    balance: number;
    basis: 'all_time_non_deleted_bookings';
  };
  payable: {
    total: number;
    aging: { bucket: 'not_due' | '0-30d' | '30-60d' | '60-90d' | '90d+'; amount: number }[];
  };
  receivable: {
    total: number;
    aging: { bucket: 'not_due' | '0-30d' | '30-60d' | '60-90d' | '90d+'; amount: number }[];
  };
}

export async function getSettlementBalances(): Promise<SettlementBalances> {
  const supabase = getSupabase();
  if (!supabase) throw new Error('정산 DB 연결을 사용할 수 없습니다.');

  try {
    const { data, error } = await supabase.rpc('get_admin_settlement_balances');
    if (error) throw error;
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('정산 집계 결과가 올바르지 않습니다.');
    return data as unknown as SettlementBalances;
  } catch (err) {
    console.error('정산 잔여 조회 실패:', err);
    throw err;
  }
}

// ─── 랜드사별 Take Rate (Tufte Small Multiples) ────────────────────────
//
// Take Rate = margin / total_price. SaaS/플랫폼 사업의 핵심 KPI (Stripe, Booking.com).
// 출발일 기준 확정 매출만 사용 (회계 일관성). margin=0 행은 take_rate 계산에서 제외.

export interface OperatorTakeRate {
  operator_id: string | null;
  operator_name: string;
  bookings: number;
  gmv: number;
  margin: number;
  take_rate: number | null; // 0~1, null = 데이터 부족
}

export async function getOperatorTakeRates(limit = 8): Promise<OperatorTakeRate[]> {
  const supabase = getSupabase();
  if (!supabase) return [];
  try {
    const rpc = supabase.rpc.bind(supabase) as unknown as (
      functionName: string,
      args?: Record<string, unknown>,
    ) => Promise<{ data: unknown; error: unknown }>;
    const { data, error } = await rpc('get_admin_operator_take_rates', { p_limit: limit });
    if (error) throw error;
    if (!Array.isArray(data)) return [];
    return data.map((row: Record<string, unknown>) => ({
      operator_id: typeof row.operator_id === 'string' ? row.operator_id : null,
      operator_name: String(row.operator_name || '미지정'),
      bookings: Number(row.bookings) || 0,
      gmv: Number(row.gmv) || 0,
      margin: Number(row.margin) || 0,
      take_rate: row.take_rate == null ? null : Number(row.take_rate),
    }));
  } catch (err) {
    console.error('Take Rate 조회 실패:', err);
    throw err;
  }
}

// ─── Repeat Booking Rate + 고객 분포 (Retention KPI) ───────────────────
//
// 핵심 신호:
//  - repeat_rate: 2회 이상 예약한 고객 비율 (0~1)
//  - repeat_revenue_share: 재방문 고객이 차지하는 매출 비중
//  - top_customer_ltv: 누적 매출 1위 고객의 평생 GMV (잠재 LTV 신호)

export interface RepeatBookingStats {
  total_customers: number;
  repeat_customers: number;       // 2회 이상
  repeat_rate: number;            // 0~1
  repeat_revenue_share: number;   // 0~1
  top_customer_ltv: number;       // KRW
  one_time: number;
  two_time: number;
  three_plus: number;
}

export async function getRepeatBookingStats(): Promise<RepeatBookingStats> {
  const supabase = getSupabase();
  const empty: RepeatBookingStats = {
    total_customers: 0, repeat_customers: 0, repeat_rate: 0,
    repeat_revenue_share: 0, top_customer_ltv: 0,
    one_time: 0, two_time: 0, three_plus: 0,
  };
  if (!supabase) return empty;
  try {
    const { data, error } = await supabase.rpc('get_admin_repeat_booking_stats');
    if (error) throw error;
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('재구매 집계 결과가 올바르지 않습니다.');
    return data as unknown as RepeatBookingStats;
  } catch (err) {
    console.error('Repeat Booking Rate 조회 실패:', err);
    throw err;
  }
}

// ─── 데이터 품질 모니터 (Data Hygiene KPI) ──────────────────────────────
//
// 다른 KPI 신뢰성의 전제조건. 결측 데이터가 누적되면 Take Rate, GMV, 마진 등
// 모든 산식이 의미를 잃는다. OS 유기적 통합의 기초 — 한 모듈의 입력 누락이
// 다른 모듈 KPI를 망가뜨리지 않도록 즉시 감지.
//
// 각 issue는 개별 drilldown URL을 제공. /admin/bookings 의 ?dq= 쿼리파라미터로 필터.

export type DataQualityIssueId =
  | 'missing_total_price'
  | 'missing_total_cost'
  | 'missing_operator'
  | 'missing_region'
  | 'missing_margin_calc'
  | 'payment_status_mismatch';

export interface DataQualityIssue {
  id: DataQualityIssueId;
  label: string;
  severity: 'critical' | 'warning' | 'info';
  affected: number;
  total: number;
  pct: number;
  hint: string;       // 어떤 KPI 가 영향 받는지
  drilldown: string;  // /admin/bookings?dq=...
}

export interface DataQualityReport {
  total_live: number;
  issues: DataQualityIssue[];
  health_score: number; // 0~100, 높을수록 좋음
}

export async function getDataQualityIssues(): Promise<DataQualityReport | null> {
  const supabase = getSupabase();
  if (!supabase) return null;

  try {
    const { data, error } = await supabase.rpc('get_admin_data_quality_counts');
    if (error) throw error;
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('데이터 품질 집계 결과가 올바르지 않습니다.');
    const counts = data as Record<string, unknown>;
    const total = Number(counts.total_live) || 0;
    // 예약 0건 = 데이터 없음 (issues 없음, health 100)
    if (total === 0) return { total_live: 0, issues: [], health_score: 100 };

    const checks: Array<{
      id: DataQualityIssueId;
      label: string;
      severity: DataQualityIssue['severity'];
      affected: number;
      hint: string;
    }> = [
      {
        id: 'missing_total_price',
        label: '판매가 (total_price) 미입력',
        severity: 'critical',
        affected: Number(counts.missing_total_price) || 0,
        hint: 'GMV / 확정매출 / Take Rate 산출 불가',
      },
      {
        id: 'missing_total_cost',
        label: '원가 (total_cost) 미입력',
        severity: 'critical',
        affected: Number(counts.missing_total_cost) || 0,
        hint: 'Margin / Take Rate / Payable 산출 불가',
      },
      {
        id: 'missing_operator',
        label: '랜드사 (land_operator_id) 미연결',
        severity: 'warning',
        affected: Number(counts.missing_operator) || 0,
        hint: '랜드사별 GMV / 정산 / 신뢰도 점수 분석 불가',
      },
      {
        id: 'missing_region',
        label: '출발 지역 (departure_region) 미입력',
        severity: 'info',
        affected: Number(counts.missing_region) || 0,
        hint: '지역별 인기 분석 불가',
      },
      {
        id: 'missing_margin_calc',
        label: '마진 미계산 (price·cost 있는데 margin=0)',
        severity: 'warning',
        affected: Number(counts.missing_margin_calc) || 0,
        hint: 'trg_booking_margin 트리거 점검 필요',
      },
      {
        id: 'payment_status_mismatch',
        label: 'payment_status 불일치 (입금됐는데 미입금 표시)',
        severity: 'critical',
        affected: Number(counts.payment_status_mismatch) || 0,
        hint: 'trg_payment_status 트리거 점검 필요. ActionBoard 미수금 카운트 왜곡',
      },
    ];

    const issues: DataQualityIssue[] = checks
      .filter(c => c.affected > 0)
      .map(c => ({
        ...c,
        total,
        pct: Math.round((c.affected / total) * 1000) / 10,
        drilldown: `/admin/bookings?dq=${c.id}`,
      }));

    // 건강도 점수: critical = -25, warning = -10, info = -3 (각 항목당 1회)
    let score = 100;
    for (const i of issues) {
      const weight = i.severity === 'critical' ? 25 : i.severity === 'warning' ? 10 : 3;
      // 비율 가중 — 비율 높을수록 감점 폭 큼
      score -= weight * Math.min(1, i.pct / 50);
    }
    return { total_live: total, issues, health_score: Math.max(0, Math.round(score)) };
  } catch (err) {
    console.error('데이터 품질 조회 실패:', err);
    throw err;
  }
}
