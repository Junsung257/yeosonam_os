import type { Metadata } from 'next';
import PackagesClient from './PackagesClient';
import { supabaseAdmin } from '@/lib/supabase';

export const revalidate = 300; // 5분 ISR

export async function generateMetadata({
  searchParams,
}: {
  searchParams: { destination?: string; q?: string; month?: string };
}): Promise<Metadata> {
  const term = (searchParams.destination || searchParams.q || '').trim();
  const month = searchParams.month || '';
  if (term) {
    const monthLabel = month ? ` ${month.split('-')[0]}년 ${parseInt(month.split('-')[1])}월` : '';
    return {
      title: `${term}${monthLabel} 패키지 여행 | 여소남`,
      description: `${term}${monthLabel} 단체·패키지 여행 상품. 김해공항 출발, 확정일·잔여석 실시간 확인.`,
      alternates: {
        canonical: `/packages?destination=${encodeURIComponent(term)}${month ? `&month=${month}` : ''}`,
      },
    };
  }
  return {
    title: '전체 패키지 상품 | 여소남',
    description: '김해공항 출발 단체·패키지 여행 전체 상품. 중국·일본·동남아·마카오 인기 여행지.',
    alternates: { canonical: '/packages' },
  };
}

// 주의: travel_packages 에는 hero_image_url / thumbnail_urls 컬럼 없음 (photos 는 별도 테이블).
// select 에 포함하면 supabase 가 쿼리 전체 에러 → data=null → "상품이 없습니다" 표시.
// 카드 이미지는 attractions 매칭(imageByPkgId) 으로 폴백.
const PACKAGE_FIELDS = `
  id, title, destination, country, category, product_type, trip_style,
  departure_days, departure_airport, airline, min_participants, ticketing_deadline,
  price, price_tiers, price_list, price_dates, status, created_at,
  product_tags, product_highlights, product_summary, itinerary_data,
  internal_code, is_airtel, display_title, hero_tagline, duration, nights,
  avg_rating, review_count,
  seats_held, seats_confirmed,
  products(internal_code, display_name)
`;

export default async function PackagesPage({
  searchParams,
}: {
  searchParams: { destination?: string; filter?: string; q?: string; month?: string; priceMax?: string; urgency?: string; category?: string };
}) {
  const destination = searchParams.destination || '';
  const filter = searchParams.filter || '';
  const q = searchParams.q?.trim() || '';
  const month = searchParams.month || '';
  const priceMax = searchParams.priceMax || '';
  const urgency = searchParams.urgency || '';
  const category = searchParams.category || '';
  const sb = supabaseAdmin;

  // 상품 목록 서버사이드 fetch
  // audit_status === 'blocked' 상품은 고객 목록에서 제외 (감사 게이트 이중 가드)
  let query = sb
    .from('travel_packages')
    .select(PACKAGE_FIELDS)
    .in('status', ['active', 'approved'])
    .or('audit_status.is.null,audit_status.neq.blocked')
    .order('created_at', { ascending: false })
    .limit(50);

  if (destination) {
    query = query.ilike('destination', `%${destination}%`);
  }

  // 마감특가: product_type='urgency' OR ticketing_deadline 14일 이내
  if (urgency === '1') {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() + 14);
    const cutoffStr = cutoff.toISOString().slice(0, 10);
    query = query.or(`product_type.eq.urgency,ticketing_deadline.lte.${cutoffStr}`);
  }

  // 카테고리 필터: honeymoon / golf / cruise / theme
  if (category) {
    query = query.eq('category', category);
  }

  // 자유 검색: destination/title/display_title 중 어디든 매칭
  if (q) {
    const safe = q.replace(/[%,]/g, ' ');
    query = query.or(`destination.ilike.%${safe}%,title.ilike.%${safe}%,display_title.ilike.%${safe}%`);
  }

  const { data: rawPackages, error: pkgErr } = await query;
  if (pkgErr) throw pkgErr; // 컬럼 누락 등 silent fail 방지 (ERR-FUK-rawtext-pollution 류 재발 방지)

  // 출발일 살아있는 상품만 (홈 "인기 여행지" 카운트 / destinations/[city] 와 정합성).
  // price_dates 가 비어있는 legacy 상품은 alive 로 간주.
  const today = new Date().toISOString().slice(0, 10);
  const aliveRaw = (rawPackages ?? []).filter((p: any) => {
    const pd = (p.price_dates || []) as Array<{ date?: string }>;
    if (pd.length === 0) return true;
    return pd.some(d => d?.date && d.date >= today);
  });

  // products JOIN 결과를 단일 객체로 정규화 (Supabase는 배열로 반환)
  const packages = aliveRaw.map((pkg: any) => ({
    ...pkg,
    products: Array.isArray(pkg.products) ? pkg.products[0] ?? null : pkg.products,
  }));

  // 관광지 사진 서버사이드 fetch
  const { data: attractions } = await sb
    .from('attractions')
    .select('name, short_desc, photos, country, region, mention_count')
    .not('photos', 'is', null)
    .limit(300);

  // 그룹 1위 패키지 ID + 추천 사유 (추천 뱃지 + 툴팁용)
  const pkgIds = (packages ?? []).map(p => p.id).filter(Boolean);
  let recommendedIds: string[] = [];
  let recommendedReasonMap: Record<string, string[]> = {};
  if (pkgIds.length > 0) {
    const { data: scores } = await sb
      .from('package_scores')
      .select('package_id, rank_in_group, group_size, breakdown')
      .in('package_id', pkgIds)
      .eq('rank_in_group', 1)
      .gte('group_size', 2);
    type ScoreRow = { package_id: string; breakdown: { why?: string[] } | null };
    recommendedIds = ((scores ?? []) as ScoreRow[]).map(s => s.package_id);
    recommendedReasonMap = Object.fromEntries(
      ((scores ?? []) as ScoreRow[])
        .map(s => [s.package_id, s.breakdown?.why ?? []]),
    );
  }

  return (
    <PackagesClient
      initialPackages={packages ?? []}
      initialAttractions={attractions ?? []}
      destination={destination}
      filter={filter}
      q={q}
      month={month}
      priceMax={priceMax}
      urgency={urgency}
      category={category}
      recommendedIds={recommendedIds}
      recommendedReasonMap={recommendedReasonMap}
    />
  );
}
