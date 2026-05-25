/**
 * GET /api/content-calendar/recommendations
 *
 * 성과 기반 콘텐츠 추천 엔진
 *
 * post_engagement_snapshots 데이터를 분석하여:
 *   1. 가장 성과 좋은 template_family 추천
 *   2. variant_angle 순위 추천 (각 angle별 평균 engagement)
 *   3. 최적 게시 시간대 추천
 *   4. 상품 유형별(호텔/투어/액티비티) 최적 템플릿
 *
 * Smartly.io / AdCreative.ai 패턴 — 과거 성과로 다음 크리에이티브 최적화
 */
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';

export const runtime = 'nodejs';

interface TemplatePerformance {
  template: string;
  avgEngagementRate: number;
  avgPerformanceScore: number;
  avgCtr: number;
  cardCount: number;
  totalViews: number;
}

interface AnglePerformance {
  angle: string;
  avgEngagementRate: number;
  avgPerformanceScore: number;
  avgCtr: number;
  cardCount: number;
  totalViews: number;
}

interface RecommendationsResponse {
  topTemplates: TemplatePerformance[];
  topAngles: AnglePerformance[];
  bestPostingHour: number | null;
  templateByProductType: Record<string, TemplatePerformance[]>;
  meta: {
    totalSnapshots: number;
    analyzedCards: number;
    periodDays: number;
  };
}

const ENGAGEMENT_WEIGHTS = {
  likes: 1,
  comments: 3,
  shares: 5,
  saves: 5,
};

function calcEngagementScore(snapshot: {
  likes?: number;
  comments?: number;
  shares?: number;
  saves?: number;
  views?: number;
  performance_score?: number;
}): { engagementScore: number; engagementRate: number; performanceScore: number } {
  const views = snapshot.views ?? 0;
  const likes = snapshot.likes ?? 0;
  const comments = snapshot.comments ?? 0;
  const shares = snapshot.shares ?? 0;
  const saves = snapshot.saves ?? 0;

  const engagementScore =
    likes * ENGAGEMENT_WEIGHTS.likes +
    comments * ENGAGEMENT_WEIGHTS.comments +
    shares * ENGAGEMENT_WEIGHTS.shares +
    saves * ENGAGEMENT_WEIGHTS.saves;

  const engagementRate = views > 0 ? (engagementScore / views) * 100 : 0;
  const performanceScore = snapshot.performance_score ?? 0;

  return { engagementScore, engagementRate, performanceScore };
}

export async function GET(request: NextRequest) {
  if (!isSupabaseConfigured) {
    return NextResponse.json({ error: 'DB 미설정' }, { status: 503 });
  }

  const days = parseInt(request.nextUrl.searchParams.get('days') ?? '90', 10); // 최근 90일 기본
  const productTypeFilter = request.nextUrl.searchParams.get('product_type'); // optional

  try {
    const sinceDate = new Date();
    sinceDate.setDate(sinceDate.getDate() - days);
    const sinceIso = sinceDate.toISOString();

    // 1. 최근 engagement 스냅샷 + card_news 조인
    const { data: snapshots, error: snapErr } = await supabaseAdmin
      .from('post_engagement_snapshots')
      .select(`
        id,
        views,
        likes,
        comments,
        shares,
        saves,
        performance_score,
        captured_at,
        card_news_id,
        platform,
        posting_hour,
        trend_score,
        card_news:card_news_id (
          id,
          title,
          template_family,
          status,
          variant_angle,
          branding_level,
          created_by_affiliate_id
        )
      `)
      .gte('captured_at', sinceIso)
      .order('captured_at', { ascending: false });

    if (snapErr) {
      return NextResponse.json({ error: snapErr.message }, { status: 500 });
    }

    if (!snapshots || snapshots.length === 0) {
      return NextResponse.json({
        topTemplates: [],
        topAngles: [],
        bestPostingHour: null,
        templateByProductType: {},
        meta: { totalSnapshots: 0, analyzedCards: 0, periodDays: days },
      });
    }

    // 2. template_family별 집계
    const templateMap = new Map<
      string,
      { totalEngRate: number; totalPerfScore: number; totalViews: number; count: number }
    >();

    // 3. variant_angle별 집계
    const angleMap = new Map<
      string,
      { totalEngRate: number; totalPerfScore: number; totalViews: number; count: number }
    >();

    // 4. 게시 시간대 집계
    const hourMap = new Map<number, { totalEngRate: number; count: number }>();

    // 5. 상품 유형별 템플릿 집계 (단순화: template_family + card_news 연결)
    const prodTypeTemplateMap = new Map<
      string,
      Map<string, { totalEngRate: number; count: number }>
    >();

    const analyzedCardIds = new Set<string>();

    for (const s of snapshots) {
      const card = s.card_news as unknown as {
        id: string;
        title: string;
        template_family: string | null;
        status: string | null;
        variant_angle: string | null;
        branding_level: string | null;
        created_by_affiliate_id: string | null;
      } | null;

      if (!card || !card.id) continue;
      analyzedCardIds.add(card.id);

      const stats = calcEngagementScore(s);
      const template = card.template_family ?? 'unknown';
      const angle = card.variant_angle ?? 'unknown';
      const hour = s.posting_hour;
      const productType = productTypeFilter ?? 'all';

      // Template 집계
      if (!templateMap.has(template)) {
        templateMap.set(template, { totalEngRate: 0, totalPerfScore: 0, totalViews: 0, count: 0 });
      }
      const tStats = templateMap.get(template)!;
      tStats.totalEngRate += stats.engagementRate;
      tStats.totalPerfScore += stats.performanceScore;
      tStats.totalViews += s.views ?? 0;
      tStats.count++;

      // Angle 집계
      if (!angleMap.has(angle)) {
        angleMap.set(angle, { totalEngRate: 0, totalPerfScore: 0, totalViews: 0, count: 0 });
      }
      const aStats = angleMap.get(angle)!;
      aStats.totalEngRate += stats.engagementRate;
      aStats.totalPerfScore += stats.performanceScore;
      aStats.totalViews += s.views ?? 0;
      aStats.count++;

      // 시간대 집계
      if (hour != null) {
        if (!hourMap.has(hour)) {
          hourMap.set(hour, { totalEngRate: 0, count: 0 });
        }
        const hStats = hourMap.get(hour)!;
        hStats.totalEngRate += stats.engagementRate;
        hStats.count++;
      }

      // 상품 유형별 집계
      if (!prodTypeTemplateMap.has(productType)) {
        prodTypeTemplateMap.set(productType, new Map());
      }
      const ptMap = prodTypeTemplateMap.get(productType)!;
      if (!ptMap.has(template)) {
        ptMap.set(template, { totalEngRate: 0, count: 0 });
      }
      const ptStats = ptMap.get(template)!;
      ptStats.totalEngRate += stats.engagementRate;
      ptStats.count++;
    }

    // 6. 결과 정렬
    const topTemplates: TemplatePerformance[] = [...templateMap.entries()]
      .map(([template, v]) => ({
        template,
        avgEngagementRate: v.count > 0 ? parseFloat((v.totalEngRate / v.count).toFixed(2)) : 0,
        avgPerformanceScore: v.count > 0 ? parseFloat((v.totalPerfScore / v.count).toFixed(2)) : 0,
        avgCtr: v.totalViews > 0 ? parseFloat(((v.totalEngRate / v.totalViews) * 100).toFixed(2)) : 0,
        cardCount: v.count,
        totalViews: v.totalViews,
      }))
      .sort((a, b) => b.avgEngagementRate - a.avgEngagementRate);

    const topAngles: AnglePerformance[] = [...angleMap.entries()]
      .map(([angle, v]) => ({
        angle,
        avgEngagementRate: v.count > 0 ? parseFloat((v.totalEngRate / v.count).toFixed(2)) : 0,
        avgPerformanceScore: v.count > 0 ? parseFloat((v.totalPerfScore / v.count).toFixed(2)) : 0,
        avgCtr: v.totalViews > 0 ? parseFloat(((v.totalEngRate / v.totalViews) * 100).toFixed(2)) : 0,
        cardCount: v.count,
        totalViews: v.totalViews,
      }))
      .sort((a, b) => b.avgEngagementRate - a.avgEngagementRate);

    // 7. 최적 게시 시간
    let bestPostingHour: number | null = null;
    let bestHourRate = -1;
    for (const [hour, v] of hourMap.entries()) {
      const avgRate = v.totalEngRate / v.count;
      if (avgRate > bestHourRate && v.count >= 2) {
        bestHourRate = avgRate;
        bestPostingHour = hour;
      }
    }

    // 8. 상품 유형별 템플릿 추천
    const templateByProductType: Record<string, TemplatePerformance[]> = {};
    for (const [pt, tmplMap] of prodTypeTemplateMap.entries()) {
      templateByProductType[pt] = [...tmplMap.entries()]
        .map(([template, v]) => ({
          template,
          avgEngagementRate: v.count > 0 ? parseFloat((v.totalEngRate / v.count).toFixed(2)) : 0,
          avgPerformanceScore: 0,
          avgCtr: 0,
          cardCount: v.count,
          totalViews: 0,
        }))
        .sort((a, b) => b.avgEngagementRate - a.avgEngagementRate);
    }

    return NextResponse.json({
      topTemplates,
      topAngles,
      bestPostingHour,
      templateByProductType,
      meta: {
        totalSnapshots: snapshots.length,
        analyzedCards: analyzedCardIds.size,
        periodDays: days,
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
