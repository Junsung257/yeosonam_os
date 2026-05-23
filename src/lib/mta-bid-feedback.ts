/**
 * MTA → 입찰 피드백 루프
 *
 * attribution_summary 데이터를 읽어 채널별 예산 효율성을 분석하고
 * 예산 재할당 추천을 생성한다.
 *
 * 파이프라인:
 *   attribution_summary → generateBidRecommendations → predictive_insights 저장
 *   → applyBidRecommendation (광고 API 호출 stub)
 */

import { supabaseAdmin } from '@/lib/supabase';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AttributionSummaryRow {
  channel: string;
  creative_id: string | null;
  campaign_id: string | null;
  first_touch_conversions: number;
  last_touch_conversions: number;
  linear_conversions: number;
  time_decay_conversions: number;
  position_based_conversions: number;
  total_cost: number;
  attributed_revenue: number;
  attributed_profit: number;
  computed_at: string;
}

export interface BidRecommendation {
  channel: string;
  /** 매출/비용 비율 (효율성 점수) */
  efficiency: number;
  /** 사람이 읽을 수 있는 추천 문구 */
  recommendation: string;
  /** 실행 가능한 액션 */
  suggestedAction: string;
  /** 우선순위 (1=가장 긴급) */
  priority: number;
}

interface InsightInsert {
  insight_type: string;
  title: string;
  description: string;
  keyword: string;
  destination: string | null;
  trend_direction: string;
  change_percent: number;
  recommendation: string;
  suggested_action: string;
  estimated_impact: string;
  priority: number;
  status: string;
  created_at: string;
  meta?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Budget Efficiency Analysis
// ---------------------------------------------------------------------------

/**
 * attribution_summary 데이터를 채널별로 집계하고 예산 효율성 점수를 계산한다.
 *
 * 효율성 점수 = attributed_revenue / NULLIF(total_cost, 0)
 */
async function fetchChannelEfficiencies(): Promise<
  Array<{
    channel: string;
    totalCost: number;
    totalRevenue: number;
    positionBasedConversions: number;
    efficiency: number;
  }>
> {
  const { data: rows, error } = await supabaseAdmin
    .from('attribution_summary')
    .select('channel, total_cost, attributed_revenue, position_based_conversions')
    .order('position_based_conversions', { ascending: false });

  if (error) {
    throw new Error(`attribution_summary 조회 실패: ${error.message}`);
  }

  const raw = (rows ?? []) as Array<{
    channel: string;
    total_cost: number;
    attributed_revenue: number;
    position_based_conversions: number;
  }>;

  // 채널별 집계
  const channelMap = new Map<
    string,
    { cost: number; revenue: number; conversions: number }
  >();

  for (const row of raw) {
    const existing = channelMap.get(row.channel) ?? {
      cost: 0,
      revenue: 0,
      conversions: 0,
    };
    existing.cost += Number(row.total_cost) || 0;
    existing.revenue += Number(row.attributed_revenue) || 0;
    existing.conversions += row.position_based_conversions || 0;
    channelMap.set(row.channel, existing);
  }

  const results: Array<{
    channel: string;
    totalCost: number;
    totalRevenue: number;
    positionBasedConversions: number;
    efficiency: number;
  }> = [];

  for (const [channel, agg] of channelMap) {
    const efficiency =
      agg.cost > 0 ? agg.revenue / agg.cost : agg.revenue > 0 ? Infinity : 0;
    results.push({
      channel,
      totalCost: agg.cost,
      totalRevenue: agg.revenue,
      positionBasedConversions: agg.conversions,
      efficiency: Math.round(efficiency * 100) / 100,
    });
  }

  return results.sort((a, b) => b.efficiency - a.efficiency);
}

/**
 * 채널 효율성 데이터를 기반으로 예산 재할당 추천을 생성한다.
 *
 * 추천 기준:
 *   - 효율성 > 5x + 낮은 비용 → 예산 증액
 *   - 효율성 < 1x → 예산 감축 또는 일시 중단
 *   - 비용 = 0 + 전환 > 0 → 무료 채널, 콘텐츠 투자 확대
 */
function generateChannelRecommendation(params: {
  channel: string;
  efficiency: number;
  totalCost: number;
  positionBasedConversions: number;
}): Omit<BidRecommendation, 'priority'> {
  const { channel, efficiency, totalCost, positionBasedConversions } = params;

  // 비용이 0인데 전환이 있는 경우 (유기 채널)
  if (totalCost === 0 && positionBasedConversions > 0) {
    return {
      channel,
      efficiency,
      recommendation: `'${channel}' 채널은 무료 트래픽 채널입니다(비용 0원). 콘텐츠 투자를 늘리면 추가 전환이 예상됩니다.`,
      suggestedAction: 'increase_content_investment',
    };
  }

  // 효율성 5배 이상 → 예산 증액
  if (efficiency > 5) {
    const message =
      efficiency > 20
        ? `'${channel}' 채널 효율성이 ${efficiency.toFixed(1)}배로 매우 높습니다. 예산 증액을 적극 검토하세요.`
        : `'${channel}' 채널 효율성이 ${efficiency.toFixed(1)}배입니다. 예산 증액을 검토하세요.`;
    return {
      channel,
      efficiency,
      recommendation: message,
      suggestedAction: 'increase_budget',
    };
  }

  // 효율성 1배 미만 → 예산 감축 또는 일시 중단
  if (efficiency < 1) {
    const message =
      efficiency < 0.5
        ? `'${channel}' 채널 효율성이 ${efficiency.toFixed(2)}배로 매우 낮습니다. 예산을 감축하거나 일시 중단하세요.`
        : `'${channel}' 채널 효율성이 ${efficiency.toFixed(2)}배입니다. 예산 감축을 검토하세요.`;
    return {
      channel,
      efficiency,
      recommendation: message,
      suggestedAction: 'reduce_budget_or_pause',
    };
  }

  // 1~5배 사이: 적정 수준
  return {
    channel,
    efficiency,
    recommendation: `'${channel}' 채널 효율성이 ${efficiency.toFixed(1)}배로 적정 수준을 유지하고 있습니다.`,
    suggestedAction: 'maintain',
  };
}

/**
 * 채널의 예산 규모를 평가한다 (상대적 기준).
 * 전체 채널 중 totalCost 순위로 low/mid/high 판단.
 */
function assessBudgetLevel(
  cost: number,
  allCosts: number[],
): 'low' | 'mid' | 'high' {
  if (allCosts.length === 0) return 'mid';
  const sorted = [...allCosts].sort((a, b) => b - a);
  const median = sorted[Math.floor(sorted.length / 2)];
  if (cost < median * 0.3) return 'low';
  if (cost > median * 2) return 'high';
  return 'mid';
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * attribution_summary 데이터를 읽고 채널별 예산 재할당 추천을 생성한다.
 *
 * 1. 채널별 효율성 점수 계산
 * 2. 추천 생성 (증액/감축/유지)
 * 3. predictive_insights 테이블에 ad_optimization 타입으로 저장
 *
 * @returns 생성된 추천 목록
 */
export async function generateBidRecommendations(): Promise<
  BidRecommendation[]
> {
  const channelEfficiencies = await fetchChannelEfficiencies();
  if (channelEfficiencies.length === 0) return [];

  const allCosts = channelEfficiencies.map((c) => c.totalCost);
  const recommendations: BidRecommendation[] = [];

  for (const entry of channelEfficiencies) {
    const budgetLevel = assessBudgetLevel(entry.totalCost, allCosts);

    // low budget + high efficiency → 증액 추천 우선순위 상향
    const base = generateChannelRecommendation(entry);
    const isHighImpact =
      entry.efficiency > 5 && budgetLevel === 'low' && entry.positionBasedConversions > 0;

    // 우선순위 계산:
    //   - 효율성 5x 초과 + low budget → priority 1
    //   - 효율성 < 1x (비효율) → priority 2
    //   - 무료 채널 전환 → priority 3
    //   - 나머지 → priority 4~5
    let priority: number;
    if (isHighImpact) {
      priority = 1;
    } else if (entry.efficiency < 0.5) {
      priority = 2;
    } else if (entry.totalCost === 0 && entry.positionBasedConversions > 0) {
      priority = 3;
    } else if (entry.efficiency < 1) {
      priority = 4;
    } else {
      priority = 5;
    }

    recommendations.push({
      ...base,
      priority,
    });
  }

  // 우선순위 정렬
  recommendations.sort((a, b) => a.priority - b.priority);

  // predictive_insights 테이블에 저장
  await persistBidRecommendations(recommendations);

  return recommendations;
}

/**
 * 입찰 추천을 predictive_insights 테이블에 저장한다.
 */
async function persistBidRecommendations(
  recommendations: BidRecommendation[],
): Promise<void> {
  if (recommendations.length === 0) return;

  const now = new Date().toISOString();
  const insights: InsightInsert[] = recommendations.map((rec) => ({
    insight_type: 'ad_optimization',
    title: `[입찰 최적화] ${rec.channel} — ${rec.suggestedAction === 'increase_budget' ? '예산 증액' : rec.suggestedAction === 'reduce_budget_or_pause' ? '예산 감축' : rec.suggestedAction === 'increase_content_investment' ? '콘텐츠 투자' : '현행 유지'}`,
    description: rec.recommendation,
    keyword: rec.channel,
    destination: null,
    trend_direction: rec.efficiency > 5 ? 'rising' : rec.efficiency < 1 ? 'falling' : 'stable',
    change_percent: Math.round((rec.efficiency - 1) * 100),
    recommendation: rec.recommendation,
    suggested_action: rec.suggestedAction,
    estimated_impact: rec.efficiency > 5
      ? `예산 증액 시 ${Math.round((rec.efficiency - 1) * 20)}% 추가 수익 예상`
      : rec.efficiency < 1
        ? `예산 감축 시 ${Math.round((1 - rec.efficiency) * 100)}% 비용 절감`
        : '현행 유지',
    priority: Math.max(1, 100 - (rec.priority - 1) * 20),
    status: 'pending',
    created_at: now,
  }));

  const { error } = await supabaseAdmin
    .from('predictive_insights')
    .upsert(insights, {
      onConflict: 'id',
      ignoreDuplicates: false,
    });

  if (error) {
    console.error('[MTA-BidFeedback] predictive_insights 저장 실패:', error.message);
  }
}

/**
 * 개별 입찰 추천을 실행한다.
 *
 * 현재는 stub 상태로, 실제 광고 API(예: Meta Ads, Google Ads) 호출 대신
 * predictive_insights의 상태를 'actioned'로 변경하고 로그를 남긴다.
 *
 * @param rec - 실행할 입찰 추천
 */
export async function applyBidRecommendation(
  rec: BidRecommendation,
): Promise<{ ok: boolean; action: string }> {
  console.log(
    `[MTA-BidFeedback] applyBidRecommendation 실행: 채널=${rec.channel}, ` +
      `액션=${rec.suggestedAction}, 효율성=${rec.efficiency}, 우선순위=${rec.priority}`,
  );
  console.log(`[MTA-BidFeedback] 추천 내용: ${rec.recommendation}`);

  // 실제 광고 API 호출은 stub — 여기서는 상태만 업데이트
  // TODO: 추후 Meta Ads API / Google Ads API 연동
  // - increase_budget: campaigns/{id} PATCH budget_amount
  // - reduce_budget_or_pause: campaigns/{id} PATCH status=paused 또는 budget_amount 축소
  // - increase_content_investment: 무료 채널은 콘텐츠 제작 예산 증액

  // predictive_insights에서 해당 채널의 pending 건을 actioned로 변경
  const { error } = await supabaseAdmin
    .from('predictive_insights')
    .update({
      status: 'actioned',
      actioned_at: new Date().toISOString(),
    } as never)
    .eq('insight_type', 'ad_optimization')
    .eq('keyword', rec.channel)
    .eq('status', 'pending');

  if (error) {
    console.warn(
      `[MTA-BidFeedback] insight 상태 업데이트 실패 (${rec.channel}): ${error.message}`,
    );
  }

  return {
    ok: !error,
    action: rec.suggestedAction,
  };
}
