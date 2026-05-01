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

import { getSupabase, supabaseAdmin } from '../supabase';

// ─── V1: 이번 달 KPI ─────────────────────────────────────────

export async function getDashboardStats() {
  try {
    const thisMonthStart = new Date();
    thisMonthStart.setDate(1); thisMonthStart.setHours(0, 0, 0, 0);
    const thisMonthStartStr = thisMonthStart.toISOString().split('T')[0];

    const today = new Date();
    const todayStr = today.toISOString().split('T')[0];
    // D-7 잔금미납: 7일 내 출발 예정 & pending/confirmed & 미수금 있음
    const d7 = new Date(today.getTime() + 7 * 86400000);
    const d7Str = d7.toISOString().split('T')[0];

    const [allBookingsRes, pendingRes, customersRes, d7Res] = await Promise.all([
      // 이번 달 출발일 기준 전체 예약 (삭제 안 된 것)
      supabaseAdmin
        .from('bookings')
        .select('total_cost, total_price, paid_amount, margin, status')
        .or('is_deleted.is.null,is_deleted.eq.false')
        .neq('status', 'cancelled')
        .gte('departure_date', thisMonthStartStr),
      supabaseAdmin
        .from('bookings').select('id')
        .in('status', ['pending', 'confirmed'])
        .or('is_deleted.is.null,is_deleted.eq.false')
        .gte('departure_date', thisMonthStartStr),
      supabaseAdmin.from('customers').select('mileage, passport_expiry'),
      // D-7 잔금미납: 7일 이내 출발, 미완료, paid_amount < total_price
      supabaseAdmin
        .from('bookings')
        .select('id, total_price, paid_amount')
        .in('status', ['pending', 'confirmed'])
        .or('is_deleted.is.null,is_deleted.eq.false')
        .gte('departure_date', todayStr)
        .lte('departure_date', d7Str),
    ]);

    const allBookings = allBookingsRes.data || [];
    // 이번 달 총 판매가 (출발일 기준)
    const totalSales = allBookings.reduce((s: number, b: any) => s + (b.total_price || 0), 0);
    // 원가: 전체 비취소 예약 합산
    const totalCost = allBookings.reduce((s: number, b: any) => s + (b.total_cost || 0), 0);
    // 이번 달 총 입금액
    const totalPaid = allBookings.reduce((s: number, b: any) => s + (b.paid_amount || 0), 0);
    // 미수금 (잔금) = 총 판매가 - 입금액
    const totalOutstanding = Math.max(0, totalSales - totalPaid);
    // 마진: margin 컬럼 기준 (DB 트리거가 자동 계산, completed 한정 아님)
    const margin = allBookings.reduce((s: number, b: any) => s + (b.margin || 0), 0);

    const customers = customersRes.data || [];
    const totalMileage = customers.reduce((s: number, c: any) => s + (c.mileage || 0), 0);
    // 여권 만료: 여행업 실무 기준 6개월 이내 (90일 → 6개월 = 국제 기준)
    const ninetyDaysLater = new Date(today.getTime() + 180 * 86400000);
    const expiringPassports = customers.filter((c: any) =>
      c.passport_expiry && new Date(c.passport_expiry) <= ninetyDaysLater,
    ).length;

    // D-7 잔금미납: 실제 미납(paid < price)인 건만
    const unpaidD7 = (d7Res.data || []).filter(
      (b: any) => (b.paid_amount || 0) < (b.total_price || 0),
    ).length;

    return {
      totalSales,
      totalCost,
      totalPaid,
      totalOutstanding,
      margin,
      activeBookings: pendingRes.data?.length || 0,
      unpaidD7,          // ← 신규: D-7 잔금미납 실제 건수
      totalMonthBookings: allBookings.length,
      totalMileage,
      expiringPassports,
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
  net_margin: number;     // 신규: margins - commission - ad_spend
}

export async function getDashboardStatsV3(months = 6): Promise<MonthlyChartDataV3[]> {
  const supabase = getSupabase();
  if (!supabase) return [];

  try {
    // 전체 기간 계산 (단 2개 쿼리로 통합)
    const now = new Date();
    const startDate = new Date(now.getFullYear(), now.getMonth() - (months - 1), 1);
    const endMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    const fromStr = `${startDate.getFullYear()}-${String(startDate.getMonth() + 1).padStart(2, '0')}-01`;
    const toStr = `${endMonth.getFullYear()}-${String(endMonth.getMonth() + 1).padStart(2, '0')}-${endMonth.getDate()}`;

    // 2개 쿼리 병렬 실행 (기존 12개 → 2개)
    const [{ data: bookings }, { data: snapshots }] = await Promise.all([
      supabase
        .from('bookings')
        .select('departure_date, total_price, margin, influencer_commission, booking_type')
        .gte('departure_date', fromStr)
        .lte('departure_date', toStr)
        .neq('status', 'cancelled')
        .eq('is_deleted', false),
      supabase
        .from('ad_performance_snapshots')
        .select('snapshot_date, spend_krw')
        .gte('snapshot_date', fromStr)
        .lte('snapshot_date', toStr),
    ]);

    // 월별로 그룹핑 (클라이언트 사이드)
    const bookingList = bookings ?? [];
    const snapshotList = snapshots ?? [];

    const result: MonthlyChartDataV3[] = [];
    for (let i = months - 1; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const monthLabel = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;

      const monthBookings = bookingList.filter((b: any) => (b.departure_date ?? '').slice(0, 7) === monthLabel);
      const direct = monthBookings.filter((b: any) => b.booking_type !== 'AFFILIATE');
      const affiliate = monthBookings.filter((b: any) => b.booking_type === 'AFFILIATE');

      const directMargin = direct.reduce((s: number, b: any) => s + (b.margin || 0), 0);
      const affiliateMargin = affiliate.reduce((s: number, b: any) => s + (b.margin || 0), 0);
      const totalCommission = affiliate.reduce((s: number, b: any) => s + (b.influencer_commission || 0), 0);

      const adSpend = snapshotList
        .filter((r: any) => (r.snapshot_date ?? '').slice(0, 7) === monthLabel)
        .reduce((s: number, r: any) => s + (r.spend_krw || 0), 0);

      const netMargin = directMargin + affiliateMargin - totalCommission - adSpend;

      result.push({
        month: monthLabel,
        direct_sales: direct.reduce((s: number, b: any) => s + (b.total_price || 0), 0),
        affiliate_sales: affiliate.reduce((s: number, b: any) => s + (b.total_price || 0), 0),
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
    return [];
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

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
const toKstMonth = (iso: string | null): string | null => {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return null;
  const kst = new Date(t + KST_OFFSET_MS);
  return `${kst.getUTCFullYear()}-${String(kst.getUTCMonth() + 1).padStart(2, '0')}`;
};

const monthKeysFor = (months: number): string[] => {
  const now = new Date();
  const keys: string[] = [];
  for (let i = months - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    keys.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  }
  return keys;
};

/**
 * 월별 확정매출 (출발일 기준, IFRS 15/ASC 606 매출 인식).
 * 출발일 ≤ 오늘 & status ≠ 'cancelled' 만 집계.
 */
export async function getRecognizedRevenueMonthly(months = 6): Promise<RecognizedRevenueMonth[]> {
  const supabase = getSupabase();
  if (!supabase) return [];
  try {
    const today = new Date();
    const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    const startDate = new Date(today.getFullYear(), today.getMonth() - (months - 1), 1);
    const fromStr = `${startDate.getFullYear()}-${String(startDate.getMonth() + 1).padStart(2, '0')}-01`;

    const { data, error } = await supabase
      .from('bookings')
      .select('departure_date, total_price, paid_amount, margin, influencer_commission, status')
      .gte('departure_date', fromStr)
      .lte('departure_date', todayStr)
      .neq('status', 'cancelled')
      .or('is_deleted.is.null,is_deleted.eq.false');

    if (error) throw error;

    const buckets = new Map<string, RecognizedRevenueMonth>();
    for (const m of monthKeysFor(months)) {
      buckets.set(m, { month: m, recognized_bookings: 0, gmv: 0, margin: 0, paid: 0, outstanding: 0, commission: 0 });
    }
    for (const b of (data ?? []) as any[]) {
      const month = (b.departure_date ?? '').slice(0, 7);
      const row = buckets.get(month);
      if (!row) continue;
      const gmv = b.total_price || 0;
      const paid = b.paid_amount || 0;
      row.recognized_bookings += 1;
      row.gmv += gmv;
      row.margin += b.margin || 0;
      row.paid += paid;
      row.outstanding += gmv - paid;
      row.commission += b.influencer_commission || 0;
    }
    return [...buckets.values()];
  } catch (err) {
    console.error('확정매출 월별 조회 실패:', err);
    return [];
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
    const startDate = new Date(now.getFullYear(), now.getMonth() - (months - 1), 1);
    // KST 새벽 0시는 UTC 전날 15시 — 안전하게 1일 buffer
    const fromUtcIso = new Date(startDate.getTime() - KST_OFFSET_MS).toISOString();

    const { data, error } = await supabase
      .from('bookings')
      .select('created_at, departure_date, total_price, status')
      .gte('created_at', fromUtcIso)
      .or('is_deleted.is.null,is_deleted.eq.false');

    if (error) throw error;

    const buckets = new Map<string, NewBookingsMonth & { _leadSum: number; _leadN: number }>();
    for (const m of monthKeysFor(months)) {
      buckets.set(m, {
        month: m, total_bookings: 0, live_bookings: 0, cancelled_bookings: 0,
        gmv_live: 0, gmv_total: 0, avg_lead_time: null, cancellation_rate: 0,
        _leadSum: 0, _leadN: 0,
      });
    }
    for (const b of (data ?? []) as any[]) {
      const month = toKstMonth(b.created_at as string | null);
      if (!month) continue;
      const row = buckets.get(month);
      if (!row) continue;
      const gmv = b.total_price || 0;
      const isCancelled = b.status === 'cancelled';
      row.total_bookings += 1;
      row.gmv_total += gmv;
      if (isCancelled) {
        row.cancelled_bookings += 1;
      } else {
        row.live_bookings += 1;
        row.gmv_live += gmv;
        if (b.departure_date && b.created_at) {
          const dep = new Date(b.departure_date as string).getTime();
          const cre = new Date(b.created_at as string).getTime();
          const days = Math.round((dep - cre) / (24 * 60 * 60 * 1000));
          if (days >= 0 && days < 730) { // 노이즈 가드
            row._leadSum += days;
            row._leadN += 1;
          }
        }
      }
    }
    return [...buckets.values()].map(({ _leadSum, _leadN, ...row }) => ({
      ...row,
      avg_lead_time: _leadN > 0 ? Math.round(_leadSum / _leadN) : null,
      cancellation_rate: row.total_bookings > 0 ? row.cancelled_bookings / row.total_bookings : 0,
    }));
  } catch (err) {
    console.error('신규예약 월별 조회 실패:', err);
    return [];
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
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    const ninetyAgo = new Date(today.getTime() - 90 * 86400000);
    const ninetyAgoIso = new Date(ninetyAgo.getTime() - KST_OFFSET_MS).toISOString();

    const [paceRes, cancellationRes] = await Promise.all([
      // 향후 출발 (취소 제외)
      supabase
        .from('bookings')
        .select('departure_date, total_price')
        .gte('departure_date', todayStr)
        .neq('status', 'cancelled')
        .or('is_deleted.is.null,is_deleted.eq.false'),
      // 최근 90일 생성 예약 (취소 포함)
      supabase
        .from('bookings')
        .select('status')
        .gte('created_at', ninetyAgoIso)
        .or('is_deleted.is.null,is_deleted.eq.false'),
    ]);

    if (paceRes.error) throw paceRes.error;
    if (cancellationRes.error) throw cancellationRes.error;

    const pace = empty.pace.map(b => ({ ...b }));
    const todayMs = today.getTime();
    for (const b of (paceRes.data ?? []) as any[]) {
      if (!b.departure_date) continue;
      const d = new Date(b.departure_date as string).getTime();
      const days = Math.floor((d - todayMs) / 86400000);
      const gmv = b.total_price || 0;
      let idx = 4;
      if (days <= 7) idx = 0;
      else if (days <= 30) idx = 1;
      else if (days <= 90) idx = 2;
      else if (days <= 180) idx = 3;
      pace[idx].bookings += 1;
      pace[idx].gmv += gmv;
    }

    const total = (cancellationRes.data ?? []).length;
    const cancelled = ((cancellationRes.data ?? []) as any[]).filter(b => b.status === 'cancelled').length;

    return {
      pace,
      cancellation_90d: {
        total_in_window: total,
        cancelled_in_window: cancelled,
        rate: total > 0 ? cancelled / total : 0,
      },
    };
  } catch (err) {
    console.error('Booking Pace 조회 실패:', err);
    return empty;
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
}

export async function getAIUsageStats(): Promise<AIUsageStats> {
  const supabase = getSupabase();
  const empty: AIUsageStats = { total_usd_7d: 0, total_usd_30d: 0, total_calls_30d: 0, daily: [], by_model: [] };
  if (!supabase) return empty;
  try {
    const now = Date.now();
    const since30 = new Date(now - 30 * 86400000).toISOString();
    const since7Ms = now - 7 * 86400000;

    const { data, error } = await supabase
      .from('jarvis_cost_ledger')
      .select('created_at, cost_usd, model')
      .gte('created_at', since30);
    if (error) {
      // 테이블 미존재(jarvis V2 미설치) 시 조용히 빈값 반환
      if ((error as any).code === '42P01') return empty;
      throw error;
    }

    const rows = (data ?? []) as any[];
    let total7 = 0, total30 = 0;
    const dailyMap = new Map<string, { cost_usd: number; calls: number }>();
    const modelMap = new Map<string, { cost_usd: number; calls: number }>();
    for (const r of rows) {
      const t = new Date(r.created_at as string).getTime();
      const cost = Number(r.cost_usd) || 0;
      total30 += cost;
      if (t >= since7Ms) total7 += cost;
      // KST 일자 키
      const kst = new Date(t + KST_OFFSET_MS);
      const dateKey = `${kst.getUTCFullYear()}-${String(kst.getUTCMonth() + 1).padStart(2, '0')}-${String(kst.getUTCDate()).padStart(2, '0')}`;
      const dayBucket = dailyMap.get(dateKey) ?? { cost_usd: 0, calls: 0 };
      dayBucket.cost_usd += cost;
      dayBucket.calls += 1;
      dailyMap.set(dateKey, dayBucket);
      const model = (r.model as string) || 'unknown';
      const m = modelMap.get(model) ?? { cost_usd: 0, calls: 0 };
      m.cost_usd += cost;
      m.calls += 1;
      modelMap.set(model, m);
    }
    // 30일 빈 칸 채우기
    const daily: AIUsageStats['daily'] = [];
    for (let i = 29; i >= 0; i--) {
      const t = now - i * 86400000;
      const kst = new Date(t + KST_OFFSET_MS);
      const dateKey = `${kst.getUTCFullYear()}-${String(kst.getUTCMonth() + 1).padStart(2, '0')}-${String(kst.getUTCDate()).padStart(2, '0')}`;
      const bucket = dailyMap.get(dateKey) ?? { cost_usd: 0, calls: 0 };
      daily.push({ date: dateKey, cost_usd: bucket.cost_usd, calls: bucket.calls });
    }
    const by_model = [...modelMap.entries()]
      .map(([model, v]) => ({ model, ...v }))
      .sort((a, b) => b.cost_usd - a.cost_usd)
      .slice(0, 5);

    return {
      total_usd_7d: Math.round(total7 * 10000) / 10000,
      total_usd_30d: Math.round(total30 * 10000) / 10000,
      total_calls_30d: rows.length,
      daily,
      by_model,
    };
  } catch (err) {
    console.error('AI 비용 추이 조회 실패:', err);
    return empty;
  }
}

// ─── 정산 잔여 (Payable to 랜드사 / Receivable from 고객) ───────────────
//
// Payable: 출발 완료된 비취소 예약의 원가 합 - 실제 송금액 (랜드사에 미지급)
// Receivable: 비취소 예약의 (판매가 - 입금액) (고객 미입금)
// Aging: 출발일 기준 30/60/90일 버킷 (오버듀일수록 위험)

export interface SettlementBalances {
  payable: {
    total: number;
    aging: { bucket: '0-30d' | '30-60d' | '60-90d' | '90d+'; amount: number }[];
  };
  receivable: {
    total: number;
    aging: { bucket: '0-30d' | '30-60d' | '60-90d' | '90d+'; amount: number }[];
  };
}

export async function getSettlementBalances(): Promise<SettlementBalances> {
  const supabase = getSupabase();
  const emptyAging = (): SettlementBalances['payable']['aging'] => [
    { bucket: '0-30d', amount: 0 }, { bucket: '30-60d', amount: 0 },
    { bucket: '60-90d', amount: 0 }, { bucket: '90d+', amount: 0 },
  ];
  const empty: SettlementBalances = {
    payable: { total: 0, aging: emptyAging() },
    receivable: { total: 0, aging: emptyAging() },
  };
  if (!supabase) return empty;

  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayMs = today.getTime();

    const { data, error } = await supabase
      .from('bookings')
      .select('total_price, total_cost, paid_amount, total_paid_out, departure_date, status')
      .neq('status', 'cancelled')
      .or('is_deleted.is.null,is_deleted.eq.false');
    if (error) throw error;

    const out: SettlementBalances = {
      payable: { total: 0, aging: emptyAging() },
      receivable: { total: 0, aging: emptyAging() },
    };

    const bucketIdx = (days: number): 0 | 1 | 2 | 3 => {
      if (days <= 30) return 0;
      if (days <= 60) return 1;
      if (days <= 90) return 2;
      return 3;
    };

    for (const b of (data ?? []) as any[]) {
      const totalPrice = b.total_price || 0;
      const paid = b.paid_amount || 0;
      const totalCost = b.total_cost || 0;
      const paidOut = b.total_paid_out || 0;
      const depMs = b.departure_date ? new Date(b.departure_date as string).getTime() : null;
      const departed = depMs != null && depMs <= todayMs;
      // 경과일: 출발 완료 건은 출발일 기준, 출발 전 건은 0 (아직 부채 미확정)
      const overdueDays = departed && depMs != null ? Math.floor((todayMs - depMs) / 86400000) : 0;
      const idx = bucketIdx(overdueDays);

      // Receivable: 모든 진행 예약의 미입금분
      // 출발 전 예약은 0-30d(idx=0), 출발 후는 출발일 경과일 기준
      const recv = Math.max(0, totalPrice - paid);
      if (recv > 0) {
        out.receivable.total += recv;
        out.receivable.aging[idx].amount += recv;
      }
      // Payable: 출발 완료 예약만 — 회계상 부채 확정 (IFRS 15 매출인식 기준)
      if (departed) {
        const pay = Math.max(0, totalCost - paidOut);
        if (pay > 0) {
          out.payable.total += pay;
          out.payable.aging[idx].amount += pay;
        }
      }
    }
    return out;
  } catch (err) {
    console.error('정산 잔여 조회 실패:', err);
    return empty;
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
    const today = new Date();
    const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    // 최근 6개월 출발 완료 예약
    const sixMoAgo = new Date(today.getFullYear(), today.getMonth() - 5, 1);
    const fromStr = `${sixMoAgo.getFullYear()}-${String(sixMoAgo.getMonth() + 1).padStart(2, '0')}-01`;

    const { data, error } = await supabase
      .from('bookings')
      .select('land_operator_id, land_operator, total_price, margin')
      .gte('departure_date', fromStr)
      .lte('departure_date', todayStr)
      .neq('status', 'cancelled')
      .or('is_deleted.is.null,is_deleted.eq.false');
    if (error) throw error;

    const groups = new Map<string, { name: string; bookings: number; gmv: number; margin: number; gmvForRate: number; marginForRate: number }>();
    for (const b of (data ?? []) as any[]) {
      const id = (b.land_operator_id as string | null) ?? 'unknown';
      const name = (b.land_operator as string | null) ?? '미지정';
      const gmv = b.total_price || 0;
      const margin = b.margin || 0;
      const g = groups.get(id) ?? { name, bookings: 0, gmv: 0, margin: 0, gmvForRate: 0, marginForRate: 0 };
      g.bookings += 1;
      g.gmv += gmv;
      g.margin += margin;
      // take_rate 계산엔 gmv>0 & margin>0 모두 갖춘 행만 사용 (데이터 결측 제외)
      if (gmv > 0 && margin > 0) {
        g.gmvForRate += gmv;
        g.marginForRate += margin;
      }
      groups.set(id, g);
    }

    const rows: OperatorTakeRate[] = [...groups.entries()].map(([id, g]) => ({
      operator_id: id === 'unknown' ? null : id,
      operator_name: g.name,
      bookings: g.bookings,
      gmv: g.gmv,
      margin: g.margin,
      take_rate: g.gmvForRate > 0 ? g.marginForRate / g.gmvForRate : null,
    }));
    rows.sort((a, b) => b.gmv - a.gmv);
    return rows.slice(0, limit);
  } catch (err) {
    console.error('Take Rate 조회 실패:', err);
    return [];
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
    const { data, error } = await supabase
      .from('bookings')
      .select('lead_customer_id, total_price')
      .neq('status', 'cancelled')
      .or('is_deleted.is.null,is_deleted.eq.false')
      .not('lead_customer_id', 'is', null);
    if (error) throw error;

    const perCustomer = new Map<string, { count: number; gmv: number }>();
    for (const b of (data ?? []) as any[]) {
      const id = b.lead_customer_id as string;
      const c = perCustomer.get(id) ?? { count: 0, gmv: 0 };
      c.count += 1;
      c.gmv += b.total_price || 0;
      perCustomer.set(id, c);
    }
    const customers = [...perCustomer.values()];
    const total = customers.length;
    const oneTime = customers.filter(c => c.count === 1).length;
    const twoTime = customers.filter(c => c.count === 2).length;
    const threePlus = customers.filter(c => c.count >= 3).length;
    const repeat = twoTime + threePlus;
    const totalGmv = customers.reduce((s, c) => s + c.gmv, 0);
    const repeatGmv = customers.filter(c => c.count >= 2).reduce((s, c) => s + c.gmv, 0);
    const topLtv = customers.length > 0 ? Math.max(...customers.map(c => c.gmv)) : 0;

    return {
      total_customers: total,
      repeat_customers: repeat,
      repeat_rate: total > 0 ? repeat / total : 0,
      repeat_revenue_share: totalGmv > 0 ? repeatGmv / totalGmv : 0,
      top_customer_ltv: topLtv,
      one_time: oneTime,
      two_time: twoTime,
      three_plus: threePlus,
    };
  } catch (err) {
    console.error('Repeat Booking Rate 조회 실패:', err);
    return empty;
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
    const { data, error } = await supabase
      .from('bookings')
      .select('id, total_price, total_cost, paid_amount, margin, status, payment_status, departure_date, departure_region, land_operator_id, lead_customer_id')
      .or('is_deleted.is.null,is_deleted.eq.false')
      .neq('status', 'cancelled');
    if (error) throw error;

    const rows = (data ?? []) as any[];
    const total = rows.length;
    // 예약 0건 = 데이터 없음 (issues 없음, health 100)
    if (total === 0) return { total_live: 0, issues: [], health_score: 100 };

    const cnt = (pred: (b: any) => boolean) => rows.filter(pred).length;

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
        affected: cnt(b => !b.total_price || b.total_price === 0),
        hint: 'GMV / 확정매출 / Take Rate 산출 불가',
      },
      {
        id: 'missing_total_cost',
        label: '원가 (total_cost) 미입력',
        severity: 'critical',
        affected: cnt(b => !b.total_cost || b.total_cost === 0),
        hint: 'Margin / Take Rate / Payable 산출 불가',
      },
      {
        id: 'missing_operator',
        label: '랜드사 (land_operator_id) 미연결',
        severity: 'warning',
        affected: cnt(b => !b.land_operator_id),
        hint: '랜드사별 GMV / 정산 / 신뢰도 점수 분석 불가',
      },
      {
        id: 'missing_region',
        label: '출발 지역 (departure_region) 미입력',
        severity: 'info',
        affected: cnt(b => !b.departure_region),
        hint: '지역별 인기 분석 불가',
      },
      {
        id: 'missing_margin_calc',
        label: '마진 미계산 (price·cost 있는데 margin=0)',
        severity: 'warning',
        affected: cnt(b => (!b.margin || b.margin === 0) && (b.total_price || 0) > 0 && (b.total_cost || 0) > 0),
        hint: 'trg_booking_margin 트리거 점검 필요',
      },
      {
        id: 'payment_status_mismatch',
        label: 'payment_status 불일치 (입금됐는데 미입금 표시)',
        severity: 'critical',
        affected: cnt(b => (b.paid_amount || 0) > 0 && b.payment_status === '미입금'),
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
    return null;
  }
}
