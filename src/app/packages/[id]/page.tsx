import { createClient } from '@supabase/supabase-js';
import DetailClient from './DetailClient';
import type { Metadata } from 'next';
import { matchAttraction, normalizeDays } from '@/lib/attraction-matcher';
import type { AttractionData } from '@/lib/attraction-matcher';

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

  const pkgResult = await sb.from('travel_packages')
    .select('*, products(internal_code, display_name, departure_region, net_price, selling_price, margin_rate)')
    .eq('id', id)
    .single();

  const pkg = pkgResult.data;

  // 관련 관광지만 필터링 (최소한의 트래픽)
  let attrQuery = sb.from('attractions')
    .select('name, short_desc, long_desc, photos, country, region, badge_type, emoji, aliases, category');

  if (pkg && pkg.destination) {
    attrQuery = attrQuery.or(`region.ilike.%${pkg.destination}%,country.ilike.%${pkg.destination}%,country.eq.중국,country.eq.베트남,country.eq.일본,country.eq.필리핀,country.eq.태국`);
  }

  const attrResult = await attrQuery.limit(3000);

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

  // 미매칭 관광지 수집 (서버사이드: ISR 빌드 시 1회만 실행, 고객 트래픽 무관)
  if (pkg?.itinerary_data && attrResult.data?.length) {
    const skipPattern = /^(호텔|리조트)?\s*(조식|투숙|체크|휴식|이동|출발|도착|귀환|수속|공항|탑승|기내|자유시간|석식|중식|면세점|쇼핑센터|가이드|미팅)/;
    const daysData = normalizeDays<{ day: number; schedule?: { activity: string; type?: string }[] }>(pkg.itinerary_data);
    const unmatchedItems: { activity: string; package_id: string; package_title: string; day_number: number; country?: string }[] = [];
    for (const day of daysData) {
      (day.schedule || []).forEach((item) => {
        if (skipPattern.test(item.activity)) return;
        if (item.type === 'flight' || item.type === 'hotel') return;
        const attr = matchAttraction(item.activity, attrResult.data as unknown as AttractionData[], pkg.destination);
        if (!attr) unmatchedItems.push({ activity: item.activity, package_id: id, package_title: pkg.title, day_number: day.day, country: pkg.destination });
      });
    }
    if (unmatchedItems.length > 0) {
      const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'https://yeosonam.com';
      fetch(`${baseUrl}/api/unmatched`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ items: unmatchedItems }) }).catch(() => {});
    }
  }

  return (
    <DetailClient
      initialPackage={normalizedPkg}
      initialAttractions={attrResult.data ?? []}
      packageId={id}
      relatedBlogPosts={relatedBlogPosts}
      destinationBlogPosts={destinationBlogPosts}
    />
  );
}
