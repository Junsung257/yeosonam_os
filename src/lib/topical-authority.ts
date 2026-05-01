/**
 * Topical Authority — pillar↔cluster 양방향 interlink 자동화
 *
 * 핵심 컨셉 (Koray Tugberk Gubur, 2023):
 *   "한 destination 도메인에서 깊이를 보여주려면 pillar(허브) + 주변 cluster들이
 *    상호 링크로 묶여야 함. Google이 '이 사이트가 다낭 전문가다'를 판단하는 신호."
 *
 * 흐름:
 *   1) rebuildClustersForDestination(dest) — destination별 pillar 1 + 모든 published cluster 매핑
 *   2) appendInterlinkSection(blogHtml, slug) — 발행 직전 본문 끝에 자동 주입
 *      - pillar라면: cluster 6-10개 리스트
 *      - cluster라면: pillar 1개 + 형제 cluster 3-4개
 *
 * 주입 위치: 본문 마지막 ## CTA 직전, "## 이 글과 함께 읽기" 섹션
 */

import { supabaseAdmin } from './supabase';

const MAX_CLUSTERS_PER_PILLAR = 12;
const MAX_SIBLINGS_FOR_CLUSTER = 4;

interface ClusterRow {
  pillar_slug: string;
  cluster_slug: string;
  destination: string;
  relation_type: string;
  rank: number;
}

/**
 * destination 1개의 pillar↔cluster 매핑 재구성
 * - pillar = content_type='pillar' AND pillar_for=dest (1개만 존재 가정)
 * - cluster = published 정보성/상품 (같은 destination, 본인 pillar 제외)
 */
export async function rebuildClustersForDestination(destination: string): Promise<{
  pillar_slug: string | null;
  cluster_count: number;
  inserted: number;
}> {
  // pillar 찾기
  const { data: pillarRows } = await supabaseAdmin
    .from('content_creatives')
    .select('slug, view_count')
    .eq('content_type', 'pillar')
    .eq('pillar_for', destination)
    .eq('status', 'published')
    .order('view_count', { ascending: false })
    .limit(1);

  const pillarSlug = pillarRows?.[0]?.slug as string | undefined;
  if (!pillarSlug) {
    return { pillar_slug: null, cluster_count: 0, inserted: 0 };
  }

  // 클러스터 후보: 같은 destination의 published 정보성 + 상품 글 (pillar 제외)
  const { data: clusters } = await supabaseAdmin
    .from('content_creatives')
    .select('slug, content_type, view_count, product_id, published_at')
    .eq('destination', destination)
    .eq('channel', 'naver_blog')
    .eq('status', 'published')
    .neq('slug', pillarSlug)
    .order('view_count', { ascending: false })
    .order('published_at', { ascending: false })
    .limit(MAX_CLUSTERS_PER_PILLAR);

  if (!clusters || clusters.length === 0) {
    return { pillar_slug: pillarSlug, cluster_count: 0, inserted: 0 };
  }

  // 매핑 row 생성 (priority: product > guide > tips)
  const rows = (clusters as Array<any>).map((c, idx) => ({
    pillar_slug: pillarSlug,
    cluster_slug: c.slug,
    destination,
    relation_type: c.product_id ? 'product' : (c.content_type || 'related'),
    rank: idx,
  }));

  // 기존 매핑 삭제 후 재삽입 (idempotent)
  await supabaseAdmin
    .from('topical_clusters')
    .delete()
    .eq('pillar_slug', pillarSlug);

  const { error, data: inserted } = await supabaseAdmin
    .from('topical_clusters')
    .insert(rows)
    .select('id');

  return {
    pillar_slug: pillarSlug,
    cluster_count: clusters.length,
    inserted: error ? 0 : (inserted?.length ?? 0),
  };
}

/**
 * 발행 시점에 호출 — 본문 끝에 "이 글과 함께 읽기" 섹션 주입
 */
export async function appendInterlinkSection(
  blogHtml: string,
  slug: string,
  destination: string | null,
): Promise<string> {
  if (!destination) return blogHtml;
  if (blogHtml.includes('## 이 글과 함께 읽기')) return blogHtml;  // 이미 있음

  // 이 글이 pillar인지 cluster인지 판별
  const { data: thisPostRows } = await supabaseAdmin
    .from('content_creatives')
    .select('content_type, pillar_for')
    .eq('slug', slug)
    .limit(1);
  const isPillar = thisPostRows?.[0]?.content_type === 'pillar';

  let linksMarkdown = '';

  if (isPillar) {
    // pillar → 모든 cluster 링크
    const { data: clusters } = await supabaseAdmin
      .from('topical_clusters')
      .select('cluster_slug, relation_type, rank, content_creatives!cluster_slug(slug, seo_title, view_count)')
      .eq('pillar_slug', slug)
      .order('rank', { ascending: true });

    const items = (clusters || []) as Array<any>;
    if (items.length > 0) {
      linksMarkdown = items.slice(0, MAX_CLUSTERS_PER_PILLAR)
        .map(c => {
          const t = c.content_creatives?.seo_title || c.cluster_slug;
          return `- [${t}](/blog/${c.cluster_slug})`;
        })
        .join('\n');
    }
  } else {
    // cluster → pillar 1 + 형제 cluster N
    const { data: rel } = await supabaseAdmin
      .from('topical_clusters')
      .select('pillar_slug')
      .eq('cluster_slug', slug)
      .limit(1);

    const pillarSlug = rel?.[0]?.pillar_slug as string | undefined;
    if (pillarSlug) {
      const { data: pillarRow } = await supabaseAdmin
        .from('content_creatives')
        .select('seo_title')
        .eq('slug', pillarSlug)
        .limit(1);
      const pillarTitle = pillarRow?.[0]?.seo_title || `${destination} 완벽 가이드`;

      // 형제 cluster (자기 자신 제외)
      const { data: siblings } = await supabaseAdmin
        .from('topical_clusters')
        .select('cluster_slug, content_creatives!cluster_slug(seo_title)')
        .eq('pillar_slug', pillarSlug)
        .neq('cluster_slug', slug)
        .order('rank', { ascending: true })
        .limit(MAX_SIBLINGS_FOR_CLUSTER);

      const sibLines = ((siblings || []) as Array<any>).map(s => {
        const t = s.content_creatives?.seo_title || s.cluster_slug;
        return `- [${t}](/blog/${s.cluster_slug})`;
      });

      linksMarkdown = `- 📚 **${destination} 종합 가이드**: [${pillarTitle}](/blog/${pillarSlug})\n${sibLines.join('\n')}`;
    }
  }

  if (!linksMarkdown) return blogHtml;

  const interlinkSection = `\n\n## 이 글과 함께 읽기\n\n${linksMarkdown}\n`;

  // CTA 섹션이 마지막에 있으면 그 직전에, 없으면 끝에
  const ctaMarker = blogHtml.match(/\n\n##\s+(?:.*?CTA|여소남|상담)/i);
  if (ctaMarker?.index !== undefined) {
    return blogHtml.slice(0, ctaMarker.index) + interlinkSection + blogHtml.slice(ctaMarker.index);
  }
  return blogHtml + interlinkSection;
}

/**
 * 모든 활성 destination에 대해 cluster 재구성 (cron이 호출)
 */
export async function rebuildAllClusters(): Promise<{
  destinations_processed: number;
  total_inserted: number;
  errors: string[];
}> {
  const { data: pkgs } = await supabaseAdmin
    .from('travel_packages')
    .select('destination')
    .in('status', ['approved', 'active']);

  const destinations = Array.from(new Set(
    ((pkgs || []) as Array<{ destination: string | null }>)
      .map(p => p.destination)
      .filter((d): d is string => Boolean(d))
  ));

  let totalInserted = 0;
  const errors: string[] = [];
  for (const dest of destinations) {
    try {
      const r = await rebuildClustersForDestination(dest);
      totalInserted += r.inserted;
    } catch (err) {
      errors.push(`${dest}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return {
    destinations_processed: destinations.length,
    total_inserted: totalInserted,
    errors,
  };
}
