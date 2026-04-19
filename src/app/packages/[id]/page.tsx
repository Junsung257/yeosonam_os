import type React from 'react';
import { createClient } from '@supabase/supabase-js';
import { notFound } from 'next/navigation';
import DetailClient from './DetailClient';
import type { Metadata } from 'next';
import { matchAttractions, normalizeDays, buildAttractionIndex, matchAttractionIndexed } from '@/lib/attraction-matcher';
import type { AttractionData } from '@/lib/attraction-matcher';
import { resolveTermsForPackage, formatCancellationDates, type NoticeBlock } from '@/lib/standard-terms';

export const revalidate = 3600; // 1시간 ISR (상품 데이터 변경 빈도 낮음)

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
}

// SEO: 동적 메타데이터
export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const sb = getSupabase();
  const { data } = await sb
    .from('travel_packages')
    .select('title, destination, price, product_summary')
    .eq('id', id)
    .single();

  if (!data) return { title: '상품 상세 | 여소남' };

  return {
    title: `${data.title} | 여소남`,
    description: data.product_summary || `${data.destination} ${data.title} - 여소남 패키지 여행`,
    openGraph: {
      title: data.title,
      description: data.product_summary || `${data.destination} 여행`,
    },
  };
}

export default async function PackageDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const sb = getSupabase();

  // ACL: 고객 노출 페이지에서는 내부필드(net_price/selling_price/margin_rate) SELECT 금지.
  // 어드민 UI는 /api/packages GET으로 별도 조회하며 거기서는 원가 정보가 유지된다.
  const pkgResult = await sb.from('travel_packages')
    .select('*, products(internal_code, display_name, departure_region)')
    .eq('id', id)
    .single();

  const pkg = pkgResult.data;

  // 감사 차단 상품은 고객 상세도 404 처리 (감사 게이트 이중 가드)
  if (pkg && (pkg as { audit_status?: string }).audit_status === 'blocked') {
    notFound();
  }

  // ── 2-단계 Fetch 전략 (Next.js 2MB 캐시 한계 + 성능 최적화) ─────────────────
  // Step A: 매칭 전용 경량 fetch (name, country, region, aliases만) — 수백 KB
  // Step B: 매칭된 N개에 한해 사진/설명 상세 fetch — 수십 KB
  //
  // 기존: select('*') + limit(3000) + photos 포함 → 2MB 초과 → fetch cache 실패 + 30s timeout
  let matchQuery = sb.from('attractions')
    .select('name, country, region, aliases');

  if (pkg && pkg.destination) {
    const destTokens = pkg.destination.split(/[\/,·&]/).map((t: string) => t.trim()).filter(Boolean);
    const regionClauses = destTokens.map((t: string) => `region.ilike.%${t}%`).join(',');
    const countryList = '중국,베트남,일본,필리핀,태국,말레이시아,싱가포르,대만,몽골,라오스,인도네시아,홍콩,마카오';
    const countryClauses = countryList.split(',').map(c => `country.eq.${c}`).join(',');
    const destCountryClause = `country.ilike.%${pkg.destination}%`;
    matchQuery = matchQuery.or(`${regionClauses},${destCountryClause},${countryClauses}`);
  }

  const matchResult = await matchQuery.limit(3000);
  const lightAttractions = (matchResult.data ?? []) as unknown as AttractionData[];

  // 매칭된 관광지 이름 목록만 추출 (서버사이드 1회)
  const matchedNames = new Set<string>();
  if (pkg?.itinerary_data && lightAttractions.length) {
    const index = buildAttractionIndex(lightAttractions, pkg.destination);
    const daysData = normalizeDays<{ day: number; schedule?: { activity: string; type?: string }[] }>(pkg.itinerary_data);
    for (const day of daysData) {
      for (const item of (day.schedule || [])) {
        if (item.type === 'flight' || item.type === 'hotel' || item.type === 'shopping') continue;
        const single = matchAttractionIndexed(item.activity, index);
        if (single) matchedNames.add(single.name);
        if (!single && /[,，]/.test(item.activity)) {
          const parts = item.activity.replace(/^▶/, '').split(/[,，]\s*/).map(s => s.trim()).filter(s => s.length >= 2);
          for (const part of parts) {
            const m = matchAttractionIndexed(part, index);
            if (m) matchedNames.add(m.name);
          }
        }
      }
    }
  }

  // Step B: 매칭된 관광지만 photos/short_desc 등 상세 가져오기 (일반적으로 10개 미만)
  let relevantAttractions: AttractionData[] = [];
  if (matchedNames.size > 0) {
    const { data: detail } = await sb.from('attractions')
      .select('name, short_desc, long_desc, photos, country, region, badge_type, emoji, aliases, category')
      .in('name', Array.from(matchedNames));
    relevantAttractions = (detail ?? []) as unknown as AttractionData[];
  }
  // 기존 fallback 호환 — 매칭 0건 시 전체 대신 경량 목록 전달 (payload 과다 방지)
  const attrResult = { data: relevantAttractions.length > 0 ? relevantAttractions : lightAttractions };

  const normalizedPkg = pkg ? {
    ...pkg,
    products: Array.isArray(pkg.products) ? pkg.products[0] ?? null : pkg.products,
  } : null;

  // 관련 블로그 글 조회 (1) — 이 상품을 홍보하는 글 (product_id 직접 매칭)
  let relatedBlogPosts: { slug: string; seo_title: string | null; og_image_url: string | null; angle_type: string }[] = [];
  // 관련 블로그 글 조회 (2) — 같은 destination의 정보성 글 (여행 준비물/날씨/가이드 등)
  let destinationBlogPosts: { slug: string; seo_title: string | null; og_image_url: string | null; angle_type: string; seo_description: string | null }[] = [];
  if (pkg?.destination) {
    const [productScoped, destinationScoped] = await Promise.all([
      sb.from('content_creatives')
        .select('slug, seo_title, og_image_url, angle_type')
        .eq('status', 'published')
        .eq('channel', 'naver_blog')
        .not('slug', 'is', null)
        .eq('product_id', id)
        .order('published_at', { ascending: false })
        .limit(3),
      sb.from('content_creatives')
        .select('slug, seo_title, og_image_url, angle_type, seo_description, travel_packages!inner(destination)')
        .eq('status', 'published')
        .eq('channel', 'naver_blog')
        .not('slug', 'is', null)
        .eq('travel_packages.destination', pkg.destination)
        .neq('product_id', id)
        .order('published_at', { ascending: false })
        .limit(8),
    ]);

    relatedBlogPosts = (productScoped.data ?? []) as typeof relatedBlogPosts;

    // 중복 slug 제거 + 상위 4개
    const seenSlugs = new Set(relatedBlogPosts.map(p => p.slug));
    destinationBlogPosts = ((destinationScoped.data ?? []) as typeof destinationBlogPosts)
      .filter(p => !seenSlugs.has(p.slug))
      .slice(0, 4);
  }

  // 미매칭 관광지 수집 (서버사이드 1회만) — 경량 목록으로 매칭 시도
  if (pkg?.itinerary_data && lightAttractions.length) {
    const skipPattern = /^(호텔|리조트)?\s*(조식|투숙|체크|휴식|이동|출발|도착|귀환|수속|공항|탑승|기내|자유시간|석식|중식|면세점|쇼핑센터|가이드|미팅)/;
    const daysData = normalizeDays<{ day: number; schedule?: { activity: string; type?: string }[] }>(pkg.itinerary_data);
    const unmatchedItems: { activity: string; package_id: string; package_title: string; day_number: number; country?: string }[] = [];
    for (const day of daysData) {
      (day.schedule || []).forEach((item) => {
        if (skipPattern.test(item.activity)) return;
        if (item.type === 'flight' || item.type === 'hotel' || item.type === 'shopping') return;
        if (/공항|출발|도착|이동|수속|탑승|귀환|체크인|체크아웃|투숙|휴식|미팅|조식|중식|석식/.test(item.activity)) return;
        const attr = matchAttractions(item.activity, lightAttractions, pkg.destination)[0] || null;
        if (!attr) unmatchedItems.push({ activity: item.activity, package_id: id, package_title: pkg.title, day_number: day.day, country: pkg.destination });
      });
    }
    if (unmatchedItems.length > 0) {
      const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'https://yeosonam.com';
      fetch(`${baseUrl}/api/unmatched`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ items: unmatchedItems }) }).catch(() => {});
    }
  }

  // 서버에서 매칭된 관광지(photos/short_desc 포함)만 전달
  const attractionsForClient = (attrResult.data ?? []) as React.ComponentProps<typeof DetailClient>['initialAttractions'];

  // 4-level 약관 해소 (mobile surface) — 출발일 가장 이른 날짜 기준으로 날짜 병기
  let initialNotices: NoticeBlock[] = [];
  if (normalizedPkg) {
    const rawPriceDates = (normalizedPkg as { price_dates?: { date: string }[] }).price_dates ?? [];
    const earliestDate = rawPriceDates.map(d => d.date).filter(Boolean).sort()[0] ?? null;
    const resolved = await resolveTermsForPackage(
      {
        id: normalizedPkg.id,
        product_type: normalizedPkg.product_type,
        land_operator_id: normalizedPkg.land_operator_id,
        notices_parsed: normalizedPkg.notices_parsed,
      },
      'mobile',
    );
    initialNotices = formatCancellationDates(resolved, earliestDate);
  }

  return (
    <DetailClient
      initialPackage={normalizedPkg}
      initialAttractions={attractionsForClient}
      packageId={id}
      relatedBlogPosts={relatedBlogPosts}
      destinationBlogPosts={destinationBlogPosts}
      initialNotices={initialNotices}
    />
  );
}
