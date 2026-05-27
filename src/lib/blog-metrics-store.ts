/**
 * Blog Metrics Store — 발행글 성과 메트릭 수집 + 분석 쿼리
 *
 * 목적:
 *   - 모든 발행글의 7일/30일/90일 성과를 구조화된 JSONB로 보관
 *   - AI-driven 임계값 조정(blog-bayesian-optimizer)의 입력 데이터 제공
 *   - "어떤 글/포맷/앵글이 가장 잘 통하는가" 패턴 분석
 *
 * 사용처:
 *   - blog-learn cron (매주) — 성과 메트릭 업데이트
 *   - blog-bayesian-optimizer (월간) — 최적화 입력
 *   - admin 블로그 대시보드 (실시간)
 *
 * SSOT 원칙:
 *   - content_creatives.metrics JSONB 가 단일 진실 소스
 *   - 다른 캐시/파생 테이블 만들지 않음
 */
import { supabaseAdmin } from './supabase';

const ONE_DAY_MS = 86400_000;

/** 글 1건의 성과 메트릭 스냅샷 */
export interface BlogMetricsSnapshot {
  slug: string;
  creativeId: string;
  title: string;
  destination: string | null;
  angleType: string;
  blogType: 'product' | 'info';
  publishedAt: string;
  /** days since publish */
  age: number;
  /** GSC: 7일 누적 노출수 */
  impressions7d: number;
  /** GSC: 7일 누적 클릭수 */
  clicks7d: number;
  /** CTR (clicks / max(impressions,1)) */
  ctr7d: number;
  /** 평균 포지션 (낮을수록 좋음) */
  avgPosition7d: number;
  /** 본문 길이 (한글 기준) */
  bodyLength: number;
  /** readability 점수 (0-100) */
  readabilityScore: number;
  /** quality gate 통과 여부 */
  qualityGatePassed: boolean;
  /** 내부 링크 수 (발행 시점) */
  internalLinks: number;
  /** featured 여부 */
  featured: boolean;
  /** 상품 연결 여부 */
  hasProduct: boolean;
}

export type MetricsWindow = '7d' | '30d' | '90d';

/**
 * GSC 데이터 + content_creatives 조인하여 7일 메트릭 스냅샷 수집
 * 하루 1회 호출 (blog-learn cron 내에서)
 */
export async function collectWeeklyMetrics(): Promise<{
  total: number;
  updated: number;
  errors: string[];
}> {
  const errors: string[] = [];
  const now = new Date();
  const since = new Date(now.getTime() - 7 * ONE_DAY_MS).toISOString();

  // 1) 발행된 모든 글 조회
  const { data: posts, error: fetchErr } = await supabaseAdmin
    .from('content_creatives')
    .select('id, slug, seo_title, destination, angle_type, blog_type, published_at, readability_score, featured, product_id, quality_gate, blog_html')
    .eq('channel', 'naver_blog')
    .eq('status', 'published');

  if (fetchErr) {
    errors.push(`fetch posts: ${fetchErr.message}`);
    return { total: 0, updated: 0, errors };
  }

  const allPosts = (posts || []) as Array<{
    id: string;
    slug: string | null;
    seo_title: string | null;
    destination: string | null;
    angle_type: string | null;
    blog_type: string | null;
    published_at: string | null;
    readability_score: number | null;
    featured: boolean | null;
    product_id: string | null;
    quality_gate: unknown;
    blog_html: string | null;
  }>;

  if (allPosts.length === 0) {
    return { total: 0, updated: 0, errors };
  }

  const slugs = allPosts.map(p => p.slug).filter(Boolean) as string[];
  if (slugs.length === 0) {
    return { total: 0, updated: 0, errors };
  }

  // 2) rank_history 테이블에서 GSC 데이터 일괄 조회 (slug 기반)
  //    gsc-index-rank 크론이 매일 rank_history에 source='gsc-page'로 저장
  const sinceDate = since.slice(0, 10);
  const { data: gscRows, error: gscErr } = await supabaseAdmin
    .from('rank_history')
    .select('slug, impressions, clicks, position')
    .in('slug', slugs)
    .gte('date', sinceDate)
    .eq('source', 'gsc-page');

  if (gscErr) {
    errors.push(`gsc query: ${gscErr.message}`);
  }

  // slug → GSC 집계
  const gscMap = new Map<string, { impressions: number; clicks: number; positions: number[] }>();
  if (gscRows) {
    for (const row of gscRows as Array<{ slug: string; impressions: number; clicks: number; position: number }>) {
      const key = row.slug;
      if (!gscMap.has(key)) {
        gscMap.set(key, { impressions: 0, clicks: 0, positions: [] });
      }
      const acc = gscMap.get(key)!;
      acc.impressions += row.impressions ?? 0;
      acc.clicks += row.clicks ?? 0;
      if (row.position != null && row.position > 0) {
        acc.positions.push(row.position);
      }
    }
  }

  // 3) 각 글의 metrics JSONB 업데이트
  let updated = 0;
  for (const post of allPosts) {
    if (!post.slug || !post.published_at) continue;

    const slug = post.slug;
    const gsc = gscMap.get(slug);
    const impressions = gsc?.impressions ?? 0;
    const clicks = gsc?.clicks ?? 0;
    const avgPos =
      gsc && gsc.positions.length > 0
        ? Math.round((gsc.positions.reduce((a, b) => a + b, 0) / gsc.positions.length) * 10) / 10
        : null;

    const ageDays = Math.round(
      (now.getTime() - new Date(post.published_at).getTime()) / ONE_DAY_MS,
    );

    const qualityGate = post.quality_gate as { passed?: boolean } | null;

    const metricsPayload = {
      updated_at: now.toISOString(),
      age_days: ageDays,
      impressions_7d: impressions,
      clicks_7d: clicks,
      ctr_7d: impressions > 0 ? Math.round((clicks / impressions) * 10000) / 10000 : 0,
      avg_position_7d: avgPos,
      body_length: post.blog_html ? post.blog_html.replace(/<[^>]+>/g, '').length : null,
      readability_score: post.readability_score,
      quality_gate_passed: qualityGate?.passed ?? false,
      featured: post.featured ?? false,
      has_product: !!post.product_id,
    };

    const { error: upErr } = await supabaseAdmin
      .from('content_creatives')
      .update({ metrics: metricsPayload })
      .eq('id', post.id);

    if (upErr) {
      errors.push(`update metrics ${slug}: ${upErr.message}`);
    } else {
      updated++;
    }
  }

  return { total: allPosts.length, updated, errors };
}

/**
 * 특정 기간의 고성과/저성과 글 패턴 분석
 * - blog-learn > prompt-optimizer 에서 호출
 * - AI-driven 임계값 조정의 입력
 */
export async function analyzePerformancePatterns(
  window: MetricsWindow = '7d',
  minImpressions = 10,
): Promise<{
  topPerformers: BlogMetricsSnapshot[];
  bottomPerformers: BlogMetricsSnapshot[];
  patterns: {
    highCtrAngles: string[];
    lowCtrAngles: string[];
    highCtrBlogTypes: string[];
    avgReadabilityByCtr: { high: number; low: number };
  };
}> {
  const since = new Date(Date.now() - (window === '7d' ? 7 : window === '30d' ? 30 : 90) * ONE_DAY_MS);

  const { data: rows } = await supabaseAdmin
    .from('content_creatives')
    .select('slug, seo_title, destination, angle_type, blog_type, published_at, readability_score, featured, product_id, metrics, quality_gate')
    .eq('status', 'published')
    .eq('channel', 'naver_blog')
    .not('slug', 'is', null)
    .gte('published_at', since.toISOString())
    .limit(500);

  if (!rows || rows.length === 0) {
    return {
      topPerformers: [],
      bottomPerformers: [],
      patterns: { highCtrAngles: [], lowCtrAngles: [], highCtrBlogTypes: [], avgReadabilityByCtr: { high: 0, low: 0 } },
    };
  }

  const snapshots: BlogMetricsSnapshot[] = [];
  for (const r of rows as Array<{
    slug: string | null;
    seo_title: string | null;
    destination: string | null;
    angle_type: string | null;
    blog_type: string | null;
    published_at: string | null;
    readability_score: number | null;
    featured: boolean | null;
    product_id: string | null;
    metrics: unknown;
    quality_gate: unknown;
  }>) {
    const m = r.metrics as Record<string, unknown> | null;
    const imp = (m?.impressions_7d as number) ?? 0;
    if (imp < minImpressions) continue;
    snapshots.push({
      slug: r.slug ?? '',
      creativeId: '',
      title: r.seo_title ?? '',
      destination: r.destination,
      angleType: r.angle_type ?? '',
      blogType: (r.blog_type as 'product' | 'info') ?? 'info',
      publishedAt: r.published_at ?? '',
      age: (m?.age_days as number) ?? 0,
      impressions7d: imp,
      clicks7d: (m?.clicks_7d as number) ?? 0,
      ctr7d: (m?.ctr_7d as number) ?? 0,
      avgPosition7d: (m?.avg_position_7d as number) ?? 0,
      bodyLength: (m?.body_length as number) ?? 0,
      readabilityScore: r.readability_score ?? 0,
      qualityGatePassed: (m?.quality_gate_passed as boolean) ?? false,
      internalLinks: 0,
      featured: r.featured ?? false,
      hasProduct: !!r.product_id,
    });
  }

  // CTR 기준 정렬
  const sorted = [...snapshots].sort((a, b) => b.ctr7d - a.ctr7d);
  const topK = Math.min(5, Math.ceil(sorted.length * 0.1));
  const bottomK = Math.min(5, Math.ceil(sorted.length * 0.1));

  const topPerformers = sorted.slice(0, topK);
  const bottomPerformers = sorted.slice(-bottomK).reverse();

  // 패턴 분석
  const highCtrSet = new Set(topPerformers.map(p => p.angleType));
  const lowCtrSet = new Set(bottomPerformers.map(p => p.angleType));

  const highCtrAngles = [...highCtrSet].filter(Boolean);
  const lowCtrAngles = [...lowCtrSet].filter(Boolean);

  // type별 CTR
  const typeCtr: Record<string, number[]> = {};
  for (const s of snapshots) {
    const t = s.blogType;
    if (!typeCtr[t]) typeCtr[t] = [];
    typeCtr[t].push(s.ctr7d);
  }
  const avgByType: Record<string, number> = {};
  for (const [t, vals] of Object.entries(typeCtr)) {
    avgByType[t] = vals.reduce((a, b) => a + b, 0) / vals.length;
  }
  const highCtrBlogTypes = Object.entries(avgByType)
    .sort(([, a], [, b]) => b - a)
    .map(([t]) => t);

  // readability와 CTR 상관
  const topRead = topPerformers.filter(p => p.readabilityScore > 0).map(p => p.readabilityScore);
  const botRead = bottomPerformers.filter(p => p.readabilityScore > 0).map(p => p.readabilityScore);
  const avgReadHigh = topRead.length > 0 ? topRead.reduce((a, b) => a + b, 0) / topRead.length : 0;
  const avgReadLow = botRead.length > 0 ? botRead.reduce((a, b) => a + b, 0) / botRead.length : 0;

  return {
    topPerformers,
    bottomPerformers,
    patterns: {
      highCtrAngles,
      lowCtrAngles,
      highCtrBlogTypes,
      avgReadabilityByCtr: { high: Math.round(avgReadHigh), low: Math.round(avgReadLow) },
    },
  };
}
