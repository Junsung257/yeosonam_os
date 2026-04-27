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
 */

import { getSupabase, supabaseAdmin } from '../supabase';

// ─── V1: 이번 달 KPI ─────────────────────────────────────────

export async function getDashboardStats() {
  try {
    const thisMonthStart = new Date();
    thisMonthStart.setDate(1); thisMonthStart.setHours(0,0,0,0);

    const [allBookingsRes, pendingRes, customersRes] = await Promise.all([
      // 이번 달 출발일 기준 전체 예약 (삭제 안 된 것)
      supabaseAdmin
        .from('bookings')
        .select('total_cost,total_price,paid_amount,status')
        .or('is_deleted.is.null,is_deleted.eq.false')
        .neq('status', 'cancelled')
        .gte('departure_date', thisMonthStart.toISOString().split('T')[0]),
      supabaseAdmin.from('bookings').select('id').in('status',['pending','confirmed']).or('is_deleted.is.null,is_deleted.eq.false').gte('departure_date', thisMonthStart.toISOString().split('T')[0]),
      supabaseAdmin.from('customers').select('mileage,passport_expiry'),
    ]);

    const allBookings = allBookingsRes.data || [];
    // 이번 달 총 판매가 (출발일 기준)
    const totalSales = allBookings.reduce((s: number, b: any) => s + (b.total_price || 0), 0);
    // 이번 달 원가 (결제완료 건만)
    const completedBookings = allBookings.filter((b: any) => b.status === 'completed');
    const totalCost = completedBookings.reduce((s: number, b: any) => s + (b.total_cost || 0), 0);
    // 이번 달 총 입금액
    const totalPaid = allBookings.reduce((s: number, b: any) => s + (b.paid_amount || 0), 0);
    // 미수금 (잔금) = 총 판매가 - 입금액
    const totalOutstanding = totalSales - totalPaid;

    const customers = customersRes.data || [];
    const totalMileage = customers.reduce((s: number, c: any) => s + (c.mileage || 0), 0);
    const sixMonthsLater = new Date(); sixMonthsLater.setMonth(sixMonthsLater.getMonth() + 6);
    const expiringPassports = customers.filter((c: any) =>
      c.passport_expiry && new Date(c.passport_expiry) <= sixMonthsLater
    ).length;

    return {
      totalSales,       // 이번 달 총 판매가
      totalCost,        // 이번 달 원가 (결제완료)
      totalPaid,        // 이번 달 입금 완료액
      totalOutstanding, // 이번 달 미수금
      margin: completedBookings.reduce((s: number, b: any) => s + ((b.total_price || 0) - (b.total_cost || 0)), 0),
      activeBookings: pendingRes.data?.length || 0,
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
