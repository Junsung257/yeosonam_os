/**
 * Net ROAS 계산기 — 라스트 클릭 귀속 알고리즘
 *
 * 귀속 규칙:
 * - booking.utm_attributed_campaign_id = campaignId → 광고 귀속 (라스트 클릭)
 * - 어필리에이트 + UTM 동시 존재 → UTM 우선 (수수료는 계속 지급, 마진 크레딧만 광고에)
 * - booking.margin = total_price - total_cost - influencer_commission (DB 트리거 계산값)
 */

import { createClient } from '@supabase/supabase-js';
import type { RoasResult, MonthlyAdStats } from '@/types/meta-ads';

function getSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  return createClient(url, key);
}

/**
 * 특정 캠페인의 특정 기간 Net ROAS 계산
 * dateFrom/dateTo: YYYY-MM-DD
 */
export async function calculateCampaignRoas(
  campaignId: string,
  dateFrom: string,
  dateTo: string
): Promise<RoasResult> {
  const supabase = getSupabase();

  // 1. 캠페인 기본 정보
  const { data: campaign } = await supabase
    .from('ad_campaigns')
    .select('id, name, total_spend_krw')
    .eq('id', campaignId)
    .single();

  if (!campaign) throw new Error(`캠페인을 찾을 수 없습니다: ${campaignId}`);

  // 2. UTM 귀속 예약 조회 (라스트 클릭)
  const { data: bookings } = await supabase
    .from('bookings')
    .select('id, margin, affiliate_id, influencer_commission, utm_attributed_campaign_id')
    .eq('utm_attributed_campaign_id', campaignId)
    .neq('status', 'cancelled')
    .eq('is_deleted', false)
    .gte('departure_date', dateFrom)
    .lte('departure_date', dateTo);

  const attributed = bookings ?? [];

  // 3. 라스트 클릭 충돌 카운트 (UTM + affiliate 동시)
  const lastClickOverrides = attributed.filter(
    (b) => b.affiliate_id !== null && b.utm_attributed_campaign_id === campaignId
  ).length;

  // 4. 귀속 마진 합계 (margin은 이미 influencer_commission 차감된 값)
  const attributedMargin = attributed.reduce((sum, b) => sum + (b.margin ?? 0), 0);

  // 5. Net ROAS 계산
  const netRoasPct =
    campaign.total_spend_krw > 0
      ? Math.round((attributedMargin / campaign.total_spend_krw) * 10000) / 100
      : 0;

  return {
    campaign_id: campaignId,
    campaign_name: campaign.name,
    total_spend_krw: campaign.total_spend_krw,
    attributed_margin: attributedMargin,
    net_roas_pct: netRoasPct,
    attributed_booking_count: attributed.length,
    last_click_override_count: lastClickOverrides,
  };
}

/**
 * 7일 롤링 ROAS 계산 (자동 최적화용)
 * ad_performance_snapshots 기반
 */
export async function getRolling7DayRoas(campaignId: string): Promise<{
  rolling_spend: number;
  rolling_margin: number;
  rolling_roas_pct: number;
  avg_cpc_krw: number;
}> {
  const supabase = getSupabase();

  const dateTo = new Date();
  const dateFrom = new Date();
  dateFrom.setDate(dateFrom.getDate() - 7);

  const { data: snapshots } = await supabase
    .from('ad_performance_snapshots')
    .select('spend_krw, attributed_margin, cpc_krw')
    .eq('campaign_id', campaignId)
    .gte('snapshot_date', dateFrom.toISOString().slice(0, 10))
    .lte('snapshot_date', dateTo.toISOString().slice(0, 10));

  const rows = snapshots ?? [];
  const rollingSpend = rows.reduce((s, r) => s + (r.spend_krw ?? 0), 0);
  const rollingMargin = rows.reduce((s, r) => s + (r.attributed_margin ?? 0), 0);
  const avgCpc =
    rows.length > 0
      ? Math.round(rows.reduce((s, r) => s + (r.cpc_krw ?? 0), 0) / rows.length)
      : 0;

  const roasPct =
    rollingSpend > 0
      ? Math.round((rollingMargin / rollingSpend) * 10000) / 100
      : 0;

  return {
    rolling_spend: rollingSpend,
    rolling_margin: rollingMargin,
    rolling_roas_pct: roasPct,
    avg_cpc_krw: avgCpc,
  };
}

/**
 * 월별 광고 통계 집계 (대시보드 LineChart용)
 * 최근 N개월
 */
export async function getMonthlyAdStats(months = 6): Promise<MonthlyAdStats[]> {
  const supabase = getSupabase();

  const fromDate = new Date();
  fromDate.setMonth(fromDate.getMonth() - months + 1);
  fromDate.setDate(1);

  const { data: snapshots } = await supabase
    .from('ad_performance_snapshots')
    .select('campaign_id, snapshot_date, spend_krw, attributed_margin, impressions, clicks')
    .gte('snapshot_date', fromDate.toISOString().slice(0, 10))
    .order('snapshot_date', { ascending: true });

  const rows = snapshots ?? [];

  // 월별 집계
  const byMonth = new Map<
    string,
    { spend: number; margin: number; impressions: number; clicks: number }
  >();

  for (const row of rows) {
    const month = row.snapshot_date.slice(0, 7); // "2026-03"
    const existing = byMonth.get(month) ?? { spend: 0, margin: 0, impressions: 0, clicks: 0 };
    byMonth.set(month, {
      spend: existing.spend + (row.spend_krw ?? 0),
      margin: existing.margin + (row.attributed_margin ?? 0),
      impressions: existing.impressions + (row.impressions ?? 0),
      clicks: existing.clicks + (row.clicks ?? 0),
    });
  }

  return Array.from(byMonth.entries()).map(([month, stats]) => ({
    month,
    total_spend_krw: stats.spend,
    total_attributed_margin: stats.margin,
    net_roas_pct:
      stats.spend > 0
        ? Math.round((stats.margin / stats.spend) * 10000) / 100
        : 0,
    total_impressions: stats.impressions,
    total_clicks: stats.clicks,
  }));
}

/**
 * Net ROAS 기반 성과 등급 반환
 */
export function getRoasGrade(roasPct: number): {
  label: string;
  color: string;
  bgColor: string;
} {
  if (roasPct >= 200) return { label: '우수', color: 'text-green-700', bgColor: 'bg-green-100' };
  if (roasPct >= 100) return { label: '보통', color: 'text-yellow-700', bgColor: 'bg-yellow-100' };
  return { label: '저조', color: 'text-red-700', bgColor: 'bg-red-100' };
}
