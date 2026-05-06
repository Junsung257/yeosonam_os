import type { Metadata } from 'next';
import PackagesClient from './PackagesClient';
import { supabaseAdmin } from '@/lib/supabase';
import {
  normalizeDepartureHub,
  departureHubSupabaseOr,
  hubMatchesDepartureAirport,
  type DepartureHubId,
} from '@/lib/departure-hub';

export const revalidate = 300; // 5분 ISR

function hubMetaLabel(hub: DepartureHubId): string {
  if (hub === 'all') return '전국 출발';
  if (hub === 'busan') return '부산 출발';
  if (hub === 'incheon') return '인천 출발';
  if (hub === 'daegu') return '대구 출발';
  return '청주 출발';
}

export async function generateMetadata({
  searchParams,
}: {
  searchParams: { destination?: string; q?: string; month?: string; hub?: string; filter?: string };
}): Promise<Metadata> {
  let hub = normalizeDepartureHub(searchParams.hub);
  if ((searchParams.filter || '') === '인천출발' && !searchParams.hub) hub = 'incheon';

  const term = (searchParams.destination || searchParams.q || '').trim();
  const month = searchParams.month || '';
  const hubLine = hubMetaLabel(hub);

  if (term) {
    const monthLabel = month ? ` ${month.split('-')[0]}년 ${parseInt(month.split('-')[1])}월` : '';
    return {
      title: `${term}${monthLabel} 패키지 | 여소남`,
      description: `${term}${monthLabel} · ${hubLine} 단체·패키지 여행. 확정일·요금 비교.`,
      alternates: {
        canonical: `/packages?destination=${encodeURIComponent(term)}${month ? `&month=${month}` : ''}`,
      },
    };
  }
  return {
    title: `${hubLine} 패키지 상품 | 여소남`,
    description: `${hubLine} 단체·패키지 여행 상품. 중국·일본·동남아·마카오 등 인기 여행지.`,
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
  product_tags, product_highlights, product_summary,
  internal_code, is_airtel, display_title, hero_tagline, duration, nights,
  avg_rating, review_count,
  seats_held, seats_confirmed,
  products(internal_code, display_name)
`;

export default async function PackagesPage({
  searchParams,
}: {
  searchParams: {
    destination?: string;
    filter?: string;
    q?: string;
    month?: string;
    priceMin?: string;
    priceMax?: string;
    urgency?: string;
    category?: string;
    hub?: string;
  };
}) {
  const destination = searchParams.destination || '';
  const rawFilter = searchParams.filter || '';
  /** 레거시 칩 "인천출발" 북마크 → 출발 허브 인천 (허브 필로 이관) */
  let hub = normalizeDepartureHub(searchParams.hub);
  if (rawFilter === '인천출발' && !searchParams.hub) hub = 'incheon';
  const filterForClient = rawFilter === '인천출발' ? '' : rawFilter;

  const q = searchParams.q?.trim() || '';
  const month = searchParams.month || '';
  const priceMin = searchParams.priceMin || '';
  const priceMax = searchParams.priceMax || '';
  const urgency = searchParams.urgency || '';
  const category = searchParams.category || '';
  const sb = supabaseAdmin;

  const urgencyOn = urgency === '1';
  const hubOr = departureHubSupabaseOr(hub);
  /** 마감특가는 SQL에서 or()를 쓰므로, 동시에 출발 허브를 쓰면 or 절이 덮어써짐 → 넉넉히 받은 뒤 허브는 메모리에서 걸러냄 */
  const fetchLimit = urgencyOn ? 200 : 50;

  // 상품 목록 서버사이드 fetch
  // audit_status === 'blocked' 상품은 고객 목록에서 제외 (감사 게이트 이중 가드)
  let query = sb
    .from('travel_packages')
    .select(PACKAGE_FIELDS)
    .in('status', ['active', 'approved'])
    .or('audit_status.is.null,audit_status.neq.blocked')
    .order('created_at', { ascending: false })
    .limit(fetchLimit);

  if (destination) {
    query = query.ilike('destination', `%${destination}%`);
  }

  // 마감특가: product_type='urgency' OR ticketing_deadline 14일 이내
  if (urgencyOn) {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() + 14);
    const cutoffStr = cutoff.toISOString().slice(0, 10);
    query = query.or(`product_type.eq.urgency,ticketing_deadline.lte.${cutoffStr}`);
  }

  // 출발 허브 — 마감특가가 아닐 때만 SQL or (위와 충돌 방지)
  if (hubOr && !urgencyOn) {
    query = query.or(hubOr);
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
  let aliveRaw = (rawPackages ?? []).filter((p: any) => {
    const pd = (p.price_dates || []) as Array<{ date?: string }>;
    if (pd.length === 0) return true;
    return pd.some(d => d?.date && d.date >= today);
  });

  if (urgencyOn && hub !== 'all') {
    aliveRaw = aliveRaw.filter((p: any) => hubMatchesDepartureAirport(hub, p.departure_airport));
  }

  aliveRaw = aliveRaw.slice(0, 50);

  // products JOIN 결과를 단일 객체로 정규화 (Supabase는 배열로 반환)
  const packages = aliveRaw.map((pkg: any) => ({
    ...pkg,
    products: Array.isArray(pkg.products) ? pkg.products[0] ?? null : pkg.products,
  }));

  // 관광지 사진 서버사이드 fetch
  // Next 데이터 캐시(약 2MB) 초과를 피하기 위해 payload 상한을 둔다.
  // 기존 4000건은 photos JSON 포함 시 캐시 실패를 유발할 수 있어, 목적지 힌트 기반으로 축소 조회한다.
  const attractionLimit = destination || q ? 180 : 240;
  let attractionQuery = sb
    .from('attractions')
    .select('name, photos, country, region, mention_count')
    .not('photos', 'is', null)
    .order('mention_count', { ascending: false })
    .limit(attractionLimit);

  const hintParts = Array.from(
    new Set(
      (aliveRaw ?? [])
        .flatMap((p: any) => String(p?.destination || '').split(/[\/,\s]/))
        .map((s: string) => s.trim())
        .filter((s: string) => s.length >= 2),
    ),
  ).slice(0, 6);
  if (hintParts.length > 0) {
    const ors = hintParts
      .map((part) => `region.ilike.%${part}%,country.ilike.%${part}%`)
      .join(',');
    attractionQuery = attractionQuery.or(ors);
  }

  const { data: attractions } = await attractionQuery;

  // 그룹 1위 패키지 ID + 추천 사유 (추천 뱃지 + 툴팁용)
  const pkgIds = (packages ?? []).map((p: { id?: string }) => p.id).filter(Boolean) as string[];
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
      filter={filterForClient}
      hub={hub}
      q={q}
      month={month}
      priceMin={priceMin}
      priceMax={priceMax}
      urgency={urgency}
      category={category}
      recommendedIds={recommendedIds}
      recommendedReasonMap={recommendedReasonMap}
    />
  );
}
