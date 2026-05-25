/**
 * 어필리에이터 카드뉴스 성과 피드백 생성
 *
 * post_engagement_snapshots 데이터를 분석하여 AI가 인사이트를 생성하고
 * affiliate_content_insights 테이블에 저장합니다.
 *
 * AdCreative.ai / Smartly.io 의 성과 분석→추천 패턴 참고.
 */
import { supabaseAdmin } from '@/lib/supabase';

export type InsightType =
  | 'performance_tip'
  | 'template_recommendation'
  | 'topic_suggestion'
  | 'timing_optimization'
  | 'summary_report';

export interface ContentInsight {
  id: string;
  affiliate_id: string;
  card_news_id: string | null;
  insight_type: InsightType;
  title: string;
  content: string;
  source_data: Record<string, unknown> | null;
  is_read: boolean;
  created_at: string;
}

interface PerformanceStats {
  card_news_id: string;
  title: string;
  totalViews: number;
  totalLikes: number;
  totalComments: number;
  totalShares: number;
  totalSaves: number;
  totalClicks: number;
  totalReach: number;
  engagementRate: number;
  ctr: number;
  snapshots: number;
  templateFamily: string | null;
  brandingLevel: string | null;
  createdAt: string;
}

/**
 * 특정 어필리에이터의 모든 카드뉴스 성과 집계
 */
export async function getAffiliatePerformanceSummary(
  affiliateId: string,
): Promise<{
  cardNews: PerformanceStats[];
  total: {
    views: number;
    likes: number;
    comments: number;
    shares: number;
    saves: number;
    clicks: number;
    avgEngagementRate: number;
    avgCtr: number;
  };
}> {
  // 1. 어필리에이터의 카드뉴스 목록
  const { data: cards, error: cardsErr } = await supabaseAdmin
    .from('card_news')
    .select('id, title, created_at, template_family, branding_level')
    .eq('created_by_affiliate_id', affiliateId)
    .order('created_at', { ascending: false });

  if (cardsErr || !cards || cards.length === 0) {
    return {
      cardNews: [],
      total: { views: 0, likes: 0, comments: 0, shares: 0, saves: 0, clicks: 0, avgEngagementRate: 0, avgCtr: 0 },
    };
  }

  // 2. 각 카드의 최신 engagement 스냅샷 (마지막 1개만)
  const stats: PerformanceStats[] = await Promise.all(
    cards.map(async (c: { id: number; title?: string; created_at?: string; template_family?: string | null; branding_level?: string | null }) => {
      const { data: snaps } = await supabaseAdmin
        .from('post_engagement_snapshots')
        .select('views, likes, comments, shares, saves, clicks, reach, ctr, created_at')
        .eq('card_news_id', c.id)
        .order('captured_at', { ascending: false })
        .limit(1);

      const s = snaps?.[0];
      if (!s) {
        return {
          card_news_id: c.id,
          title: c.title,
          totalViews: 0,
          totalLikes: 0,
          totalComments: 0,
          totalShares: 0,
          totalSaves: 0,
          totalClicks: 0,
          totalReach: 0,
          engagementRate: 0,
          ctr: 0,
          snapshots: 0,
          templateFamily: c.template_family,
          brandingLevel: c.branding_level,
          createdAt: c.created_at,
        };
      }

      const totalEngagement = (s.likes ?? 0) + (s.comments ?? 0) * 3 + (s.shares ?? 0) * 5 + (s.saves ?? 0) * 5;
      const reach = s.reach ?? 1;
      return {
        card_news_id: c.id,
        title: c.title,
        totalViews: s.views ?? 0,
        totalLikes: s.likes ?? 0,
        totalComments: s.comments ?? 0,
        totalShares: s.shares ?? 0,
        totalSaves: s.saves ?? 0,
        totalClicks: s.clicks ?? 0,
        totalReach: reach,
        engagementRate: Math.round((totalEngagement / Math.max(reach, 1)) * 10000) / 100,
        ctr: s.ctr ?? 0,
        snapshots: snaps?.length ?? 0,
        templateFamily: c.template_family,
        brandingLevel: c.branding_level,
        createdAt: c.created_at,
      };
    }),
  );

  const totalViews = stats.reduce((a, b) => a + b.totalViews, 0);
  const totalLikes = stats.reduce((a, b) => a + b.totalLikes, 0);
  const totalComments = stats.reduce((a, b) => a + b.totalComments, 0);
  const totalShares = stats.reduce((a, b) => a + b.totalShares, 0);
  const totalSaves = stats.reduce((a, b) => a + b.totalSaves, 0);
  const totalClicks = stats.reduce((a, b) => a + b.totalClicks, 0);
  const cardsWithData = stats.filter((s) => s.snapshots > 0);

  return {
    cardNews: stats,
    total: {
      views: totalViews,
      likes: totalLikes,
      comments: totalComments,
      shares: totalShares,
      saves: totalSaves,
      clicks: totalClicks,
      avgEngagementRate: cardsWithData.length > 0
        ? Math.round((cardsWithData.reduce((a, b) => a + b.engagementRate, 0) / cardsWithData.length) * 100) / 100
        : 0,
      avgCtr: cardsWithData.length > 0
        ? Math.round((cardsWithData.reduce((a, b) => a + b.ctr, 0) / cardsWithData.length) * 100) / 100
        : 0,
    },
  };
}

/**
 * 성과 데이터를 바탕으로 AI 인사이트 생성
 * (규칙 기반 → 추후 LLM 기반으로 업그레이드)
 */
export function generateInsightsFromPerformance(
  affiliateId: string,
  affiliateName: string,
  summary: Awaited<ReturnType<typeof getAffiliatePerformanceSummary>>,
): Omit<ContentInsight, 'id' | 'created_at'>[] {
  const insights: Omit<ContentInsight, 'id' | 'created_at'>[] = [];

  if (summary.cardNews.length === 0) {
    insights.push({
      affiliate_id: affiliateId,
      card_news_id: null,
      insight_type: 'summary_report',
      title: '첫 카드뉴스를 만들어보세요',
      content: `${affiliateName}님이 아직 카드뉴스를 생성하지 않았습니다. 지금 첫 카드뉴스를 만들고 마케팅에 활용해보세요.`,
      source_data: { totalCards: 0 },
      is_read: false,
    });
    return insights;
  }

  const { total, cardNews } = summary;

  // 1. 성과 요약 리포트
  const bestCard = [...cardNews].sort((a, b) => b.engagementRate - a.engagementRate)[0];
  insights.push({
    affiliate_id: affiliateId,
    card_news_id: bestCard?.card_news_id ?? null,
    insight_type: 'summary_report',
    title: `${affiliateName}님의 카드뉴스 성과 요약`,
    content: `총 ${cardNews.length}개의 카드뉴스 중 가장 높은 참여율을 기록한 콘텐츠는 "${
      bestCard?.title ?? '없음'
    }" (참여율 ${bestCard?.engagementRate ?? 0}%)입니다. 전체 평균 참여율은 ${total.avgEngagementRate}%입니다.`,
    source_data: {
      totalCards: cardNews.length,
      totalViews: total.views,
      totalEngagement: total.likes + total.comments + total.shares + total.saves,
      avgEngagementRate: total.avgEngagementRate,
      bestCardTitle: bestCard?.title,
      bestCardEngagementRate: bestCard?.engagementRate,
    },
    is_read: false,
  });

  // 2. 템플릿 추천 (성과 좋은 템플릿 우선)
  const templatePerformance = new Map<string, { count: number; totalEngRate: number }>();
  for (const c of cardNews) {
    const key = c.templateFamily ?? 'unknown';
    const existing = templatePerformance.get(key) ?? { count: 0, totalEngRate: 0 };
    existing.count++;
    existing.totalEngRate += c.engagementRate;
    templatePerformance.set(key, existing);
  }
  const sortedTemplates = [...templatePerformance.entries()]
    .map(([k, v]) => ({ template: k, avgRate: v.totalEngRate / v.count, count: v.count }))
    .sort((a, b) => b.avgRate - a.avgRate);

  if (sortedTemplates.length > 0 && sortedTemplates[0].count >= 2) {
    insights.push({
      affiliate_id: affiliateId,
      card_news_id: null,
      insight_type: 'template_recommendation',
      title: '추천 템플릿',
      content: `"${sortedTemplates[0].template}" 템플릿을 사용한 카드뉴스의 평균 참여율이 ${sortedTemplates[0].avgRate}%로 가장 높습니다. (${
        sortedTemplates[0].count
      }개 데이터 기반)`,
      source_data: {
        recommendations: sortedTemplates.map((t) => ({
          template: t.template,
          avgEngagementRate: t.avgRate,
          cardCount: t.count,
        })),
      },
      is_read: false,
    });
  }

  // 3. 게시 시간 최적화
  // (실제 IG 게시 시간 데이터가 있을 때만)
  const bestPerformingCard = cardNews.find((c) => c.engagementRate > 0);
  if (bestPerformingCard) {
    insights.push({
      affiliate_id: affiliateId,
      card_news_id: bestPerformingCard.card_news_id,
      insight_type: 'timing_optimization',
      title: '콘텐츠 성과가 좋습니다',
      content: `"${bestPerformingCard.title}" 카드뉴스가 좋은 반응을 얻고 있습니다 (참여율 ${bestPerformingCard.engagementRate}%). 비슷한 주제로 추가 콘텐츠를 제작해보세요.`,
      source_data: {
        referenceCard: bestPerformingCard.card_news_id,
        engagementRate: bestPerformingCard.engagementRate,
        ctr: bestPerformingCard.ctr,
      },
      is_read: false,
    });
  }

  // 4. 참여율이 낮은 경우 개선 팁
  const lowEngagementCards = cardNews.filter((c) => c.snapshots > 0 && c.engagementRate < 1);
  if (lowEngagementCards.length > 0) {
    const lowest = [...lowEngagementCards].sort((a, b) => a.engagementRate - b.engagementRate)[0];
    insights.push({
      affiliate_id: affiliateId,
      card_news_id: lowest.card_news_id,
      insight_type: 'performance_tip',
      title: '참여율 개선 팁',
      content: `"${lowest.title}" 카드뉴스의 참여율이 ${lowest.engagementRate}%로 낮습니다. 더 강렬한 첫 슬라이드(훅)와 명확한 클릭 유도 문구(CTA)를 시도해보세요.`,
      source_data: {
        cardTitle: lowest.title,
        engagementRate: lowest.engagementRate,
        totalViews: lowest.totalViews,
      },
      is_read: false,
    });
  }

  return insights;
}

/**
 * 어필리에이터 성과 분석 → 인사이트 저장
 */
export async function analyzeAndSaveInsights(
  affiliateId: string,
  affiliateName: string,
): Promise<ContentInsight[]> {
  const summary = await getAffiliatePerformanceSummary(affiliateId);
  const insights = generateInsightsFromPerformance(affiliateId, affiliateName, summary);

  if (insights.length === 0) return [];

  const now = new Date().toISOString();
  const rows = insights.map((ins) => ({
    affiliate_id: ins.affiliate_id,
    card_news_id: ins.card_news_id,
    insight_type: ins.insight_type,
    title: ins.title,
    content: ins.content,
    source_data: ins.source_data,
    is_read: false,
    created_at: now,
  }));

  const { data, error } = await supabaseAdmin
    .from('affiliate_content_insights')
    .insert(rows)
    .select();

  if (error) {
    console.error('[affiliate-feedback] 인사이트 저장 실패:', error.message);
    return [];
  }

  return (data ?? []) as ContentInsight[];
}

/**
 * 어필리에이터의 최신 인사이트 조회
 */
export async function getAffiliateInsights(
  affiliateId: string,
  limit = 20,
): Promise<ContentInsight[]> {
  const { data, error } = await supabaseAdmin
    .from('affiliate_content_insights')
    .select('*')
    .eq('affiliate_id', affiliateId)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) {
    console.error('[affiliate-feedback] 인사이트 조회 실패:', error.message);
    return [];
  }

  return (data ?? []) as ContentInsight[];
}

/**
 * 인사이트 읽음 처리
 */
export async function markInsightAsRead(insightId: string): Promise<boolean> {
  const { error } = await supabaseAdmin
    .from('affiliate_content_insights')
    .update({ is_read: true })
    .eq('id', insightId);

  if (error) {
    console.error('[affiliate-feedback] 읽음 처리 실패:', error.message);
    return false;
  }
  return true;
}
