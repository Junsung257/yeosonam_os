import Link from 'next/link';
import Image from 'next/image';
import { supabaseAdmin } from '@/lib/supabase';
import HomeHeroSearchCluster from '@/components/customer/HomeHeroSearchCluster';
import { getSecret } from '@/lib/secret-registry';
import { HomeHeroUrgencyStrip, type HomeUrgencyTeaser } from '@/components/customer/HomeHeroUrgencyStrip';
import GlobalNav from '@/components/customer/GlobalNav';
import { SafeCoverNextImg } from '@/components/customer/SafeRemoteImage';
import SectionHeader from '@/components/customer/SectionHeader';
import CategoryIcons from '@/components/customer/CategoryIcons';
import HeroBanner from '@/components/customer/HeroBanner';
import type { HeroSlide } from '@/components/customer/HeroBanner';
import RankingSection from '@/components/customer/RankingSection';
import type { RankingItem } from '@/components/customer/RankingSection';
import { getConsultTelHref } from '@/lib/consult-escalation';

/** 목적지 카드에 상품 개수 숫자를 노출할 최소치(그 미만이면 '상품 적음' 인상 완화 — 인지 부하·역효과 방지) */
const PKG_COUNT_DISCLOSE_MIN = 6;

// ISR 5분 / Windows 로컬은 force-dynamic (chunk race 회피)
export const revalidate = process.platform === 'win32' ? 0 : 300;
export const dynamic = process.platform === 'win32' ? 'force-dynamic' : 'auto';

function guessCountry(dest: string): string {
  if (/나트랑|다낭|하노이|푸꾸옥|호치민|달랏/.test(dest)) return '베트남';
  if (/장가계|청도|서안|상해|연길|백두산|구채구/.test(dest)) return '중국';
  if (/시즈오카|후쿠오카|오사카|도쿄|큐슈|토야마|후지노미야/.test(dest)) return '일본';
  if (/보홀|세부|마닐라/.test(dest)) return '필리핀';
  if (/코타키나발루|말라카/.test(dest)) return '말레이시아';
  if (/방콕|치앙마이|푸켓|파타야/.test(dest)) return '태국';
  if (/발리|마나도/.test(dest)) return '인도네시아';
  if (/마카오/.test(dest)) return '마카오';
  return '';
}

interface Destination {
  destination: string;
  count: number;
  minPrice: number;
  country: string;
  image?: string;
}

const DOMESTIC_KEYWORDS = /국내|제주|부산|서울|강원|경주|여수/;

function computeRankingMinPrice(p: any, today: string): number {
  const pd = (p.price_dates || []) as Array<{ date?: string; price?: number }>;
  const futurePd = pd.filter((d: any) => d?.date && d.date >= today);
  if (futurePd.length > 0) {
    const prices = futurePd.map((d: any) => d.price).filter(Boolean) as number[];
    if (prices.length > 0) return Math.min(...prices);
  }
  const tierPrices = (p.price_tiers || []).map((t: any) => t.adult_price).filter(Boolean) as number[];
  const fallback = [p.price, ...tierPrices].filter(Boolean) as number[];
  return fallback.length > 0 ? Math.min(...fallback) : 0;
}

/** 랭킹 카드: 동일 이미지 URL이 여러 상품에 반복되지 않게 할당 */
function buildRankingItemsUnique(
  rankingPkgs: any[],
  attractions: any[],
  today: string,
  overseasOnly: boolean,
  usedUrls: Set<string>,
): RankingItem[] {
  const list = rankingPkgs
    .filter((p: any) => {
      const isDom = DOMESTIC_KEYWORDS.test(p.destination || '');
      return overseasOnly ? !isDom : isDom;
    })
    .slice(0, 7);

  return list.map((p: any) => {
    const tryList: string[] = [];
    if (p.hero_image_url) tryList.push(p.hero_image_url);
    if (Array.isArray(p.thumbnail_urls)) {
      for (const u of p.thumbnail_urls) {
        if (u) tryList.push(u);
      }
    }

    let image: string | null = null;
    for (const url of tryList) {
      if (url && !usedUrls.has(url)) {
        image = url;
        usedUrls.add(url);
        break;
      }
    }

    if (!image) {
      const destParts = (p.destination || '').split(/[\/,\s]/).map((s: string) => s.trim()).filter(Boolean);
      const matched = attractions
        .filter((a: any) => {
          if (!a.photos?.length) return false;
          return destParts.some((part: string) => {
            const r = a.region || '';
            const c = a.country || '';
            return r === part || r.includes(part) || part.includes(r) || (!!c && c.includes(part));
          });
        })
        .sort((a: any, b: any) => (b.mention_count || 0) - (a.mention_count || 0));

      outer: for (const a of matched) {
        for (const ph of a.photos || []) {
          const url = ph.src_large || ph.src_medium;
          if (url && !usedUrls.has(url)) {
            image = url;
            usedUrls.add(url);
            break outer;
          }
        }
      }
    }

    return {
      id: p.id,
      title: p.display_title || p.title,
      destination: p.destination,
      image,
      minPrice: computeRankingMinPrice(p, today),
      duration: p.nights && p.duration ? `${p.nights}박${p.duration}일` : null,
      isOverseas: !DOMESTIC_KEYWORDS.test(p.destination || ''),
    };
  });
}

export default async function HomePage() {
  const sb = supabaseAdmin;
  const today = new Date().toISOString().slice(0, 10);

  // 5개 쿼리 동시 실행 (ratingAgg를 합쳐 총 왕복 1회로 절감)
  const [pkgResult, attrResult, rankingResult, activeDestsResult, ratingResult] = await Promise.all([
    sb.from('travel_packages')
      .select('destination, price, price_tiers, price_dates, country')
      .in('status', ['active', 'approved']),
    sb.from('attractions')
      .select('name, photos, country, region, mention_count')
      .not('photos', 'is', null)
      .limit(300),
    sb.from('travel_packages')
      .select('id, title, display_title, hero_tagline, destination, price, price_tiers, price_dates, country, duration, nights, product_type, ticketing_deadline')
      .in('status', ['active', 'approved'])
      .order('created_at', { ascending: false })
      .limit(30),
    sb.from('active_destinations')
      .select('*')
      .order('package_count', { ascending: false })
      .limit(20),
    sb.from('travel_packages')
      .select('avg_rating, review_count')
      .not('avg_rating', 'is', null)
      .gte('review_count', 1),
  ]);

  const allPkgs = pkgResult.data ?? [];
  const attractions = attrResult.data ?? [];
  const rankingPkgs = rankingResult.data ?? [];

  /** 홈 검색 시트 하단 — 마감 임박·특가 상품 최대 3개(랭킹 풀에서 추림) */
  const cutoffTeaser = new Date();
  cutoffTeaser.setDate(cutoffTeaser.getDate() + 14);
  const cutoffTeaserStr = cutoffTeaser.toISOString().slice(0, 10);
  function pkgAliveForTeaser(p: any) {
    const pd = (p.price_dates || []) as Array<{ date?: string }>;
    if (!pd.length) return true;
    return pd.some(d => d?.date && d.date >= today);
  }
  function pkgUrgentForTeaser(p: any) {
    if (p.product_type === 'urgency') return true;
    const td = p.ticketing_deadline ? String(p.ticketing_deadline).slice(0, 10) : '';
    return !!(td && td <= cutoffTeaserStr);
  }
  const homeUrgencyTop3: { id: string; title: string; destination: string | undefined; minPrice: number }[] = [];
  const seenUrgent = new Set<string>();
  for (const p of rankingPkgs as any[]) {
    if (!pkgAliveForTeaser(p) || !pkgUrgentForTeaser(p)) continue;
    if (seenUrgent.has(p.id)) continue;
    seenUrgent.add(p.id);
    homeUrgencyTop3.push({
      id: p.id,
      title: p.display_title || p.title,
      destination: p.destination,
      minPrice: computeRankingMinPrice(p, today),
    });
    if (homeUrgencyTop3.length >= 3) break;
  }

  // 목적지별 집계
  const destMap: Record<string, { count: number; minPrice: number; country: string }> = {};
  allPkgs.forEach((p: any) => {
    const dest = p.destination;
    if (!dest) return;
    const pd = (p.price_dates || []) as Array<{ date?: string; price?: number }>;
    const futurePd = pd.filter((d: any) => d?.date && d.date >= today);
    const isAlive = pd.length === 0 || futurePd.length > 0;
    if (!isAlive) return;
    if (!destMap[dest]) destMap[dest] = { count: 0, minPrice: Infinity, country: p.country || '' };
    destMap[dest].count++;
    let min = Infinity;
    if (futurePd.length > 0) {
      const pdPrices = futurePd.map((d: any) => d.price).filter(Boolean) as number[];
      if (pdPrices.length > 0) min = Math.min(...pdPrices);
    }
    if (min === Infinity) {
      const tierPrices = (p.price_tiers || []).map((t: any) => t.adult_price).filter(Boolean);
      const allPrices = [p.price, ...tierPrices].filter(Boolean);
      if (allPrices.length > 0) min = Math.min(...allPrices);
    }
    if (min < destMap[dest].minPrice) destMap[dest].minPrice = min;
  });

  const destinations: Destination[] = Object.entries(destMap)
    .map(([dest, info]) => ({
      destination: dest,
      ...info,
      minPrice: info.minPrice === Infinity ? 0 : info.minPrice,
      country: (info.country && info.country.trim()) ? info.country.trim() : guessCountry(dest),
    }))
    .sort((a, b) => b.count - a.count);

  // attraction 이미지 매핑 (목적지별 대표 이미지)
  const usedPhotoIds = new Set<number>();
  const destsWithImages = destinations.map(dest => {
    const destParts = dest.destination.split(/[\/,\s]/).map(s => s.trim()).filter(Boolean);
    const matched = attractions
      .filter((a: any) => {
        if (!a.photos || a.photos.length === 0) return false;
        const aRegion = a.region || '';
        const aCountry = a.country || '';
        return destParts.some((part: string) =>
          aRegion === part || aRegion.includes(part) || part.includes(aRegion) ||
          aCountry.includes(part) || dest.destination.includes(aRegion)
        );
      })
      .sort((a: any, b: any) => (b.mention_count || 0) - (a.mention_count || 0));
    const unused = matched.find((a: any) => {
      const photoId = a.photos[0]?.pexels_id;
      return photoId && !usedPhotoIds.has(photoId);
    });
    const chosen = unused || matched[0];
    if (chosen?.photos?.[0]) {
      const image = chosen.photos[0].src_large || chosen.photos[0].src_medium || '';
      if (chosen.photos[0].pexels_id) usedPhotoIds.add(chosen.photos[0].pexels_id);
      return { ...dest, image };
    }
    return dest;
  });

  // 추천 여행지 TOP 4 (active_destinations는 위 Promise.all에서 이미 fetch)
  const topDestsRawAll = activeDestsResult.data;

  const topDestsRaw = ((topDestsRawAll as Array<{
    destination: string; package_count: number;
    avg_rating: number | null; total_reviews: number | null; min_price: number | null;
  }>) || [])
    .map(d => {
      const alive = destMap[d.destination];
      if (!alive || alive.count === 0) return null;
      return {
        ...d,
        package_count: alive.count,
        min_price: alive.minPrice !== Infinity ? alive.minPrice : (d.min_price ?? null),
      };
    })
    .filter((d): d is NonNullable<typeof d> => d !== null)
    .slice(0, 4);

  const topDestNames = topDestsRaw.map(d => d.destination);
  const [{ data: pillarExists }] = topDestNames.length > 0
    ? await Promise.all([
        sb.from('content_creatives').select('pillar_for').in('pillar_for', topDestNames).eq('content_type', 'pillar').eq('status', 'published'),
      ])
    : [{ data: null }];

  const attrImageByDest: Record<string, string> = {};
  (attractions as any[]).forEach((a: any) => {
    if (!a.photos?.length) return;
    const region = a.region || '';
    const match = topDestNames.find(d => d === region || d.includes(region) || region.includes(d));
    if (match && !attrImageByDest[match]) {
      const img = a.photos[0]?.src_large || a.photos[0]?.src_medium;
      if (img) attrImageByDest[match] = img;
    }
  });

  const pillarSet = new Set(
    ((pillarExists as Array<{ pillar_for: string | null }>) || [])
      .map(p => p.pillar_for).filter(Boolean) as string[]
  );

  const topDests = topDestsRaw.map(d => ({
    ...d,
    image: attrImageByDest[d.destination] || null,
    hasPillar: pillarSet.has(d.destination),
  }));

  // Pexels 폴백 — 여행지 카테고리/그리드 빈 슬롯 채우기 (패키지 카드는 제외)
  // ISR 캐시(revalidate=300) + Next.js fetch 캐시(1h)로 실제 Pexels 호출은 드물게 발생
  if (getSecret('PEXELS_API_KEY')) {
    const { getRandomPexelsPhoto, destToEnKeyword } = await import('@/lib/pexels');

    // 추천여행지 + 인기여행지 중 이미지 없는 목적지만 수집
    const missingDests = [...new Set([
      ...topDests.filter(d => !d.image).map(d => d.destination),
      ...destsWithImages.filter(d => !d.image).map(d => d.destination),
    ])];

    if (missingDests.length > 0) {
      const filled = await Promise.all(
        missingDests.map(async dest => {
          try {
            const photo = await getRandomPexelsPhoto(destToEnKeyword(dest));
            // 추천여행지 히어로용 large2x, 나머지는 large
            return { dest, large2x: photo?.src.large2x ?? null, large: photo?.src.large ?? null };
          } catch {
            return { dest, large2x: null, large: null };
          }
        })
      );

      const pexelsByDest: Record<string, { large2x: string | null; large: string | null }> = {};
      filled.forEach(({ dest, large2x, large }) => {
        if (large2x || large) pexelsByDest[dest] = { large2x, large };
      });

      // 추천여행지 — large2x 우선 (히어로 배너에도 사용되므로 고해상도)
      topDests.forEach(d => {
        if (!d.image && pexelsByDest[d.destination]) {
          d.image = pexelsByDest[d.destination].large2x ?? pexelsByDest[d.destination].large ?? null;
        }
      });
      // 인기여행지 그리드 — large (카드 크기에 충분)
      destsWithImages.forEach(d => {
        if (!d.image && pexelsByDest[d.destination]) {
          (d as any).image = pexelsByDest[d.destination].large ?? pexelsByDest[d.destination].large2x;
        }
      });
    }
  }

  // HeroBanner 슬라이드 — Pexels 폴백 이후에 생성해야 빈 슬롯이 채워진 topDests를 사용
  // display_title / hero_tagline 이 있는 대표 패키지를 목적지별로 먼저 찾아 타이틀 품질 향상
  const bestPkgByDest: Record<string, { display_title?: string; hero_tagline?: string; title?: string }> = {};
  (rankingPkgs as any[]).forEach(p => {
    if (!p.destination) return;
    if (!bestPkgByDest[p.destination] && (p.display_title || p.hero_tagline || p.title)) {
      bestPkgByDest[p.destination] = { display_title: p.display_title, hero_tagline: p.hero_tagline, title: p.title };
    }
  });

  const heroSlides: HeroSlide[] = topDests
    .filter(d => d.image)
    .slice(0, 5)
    .map(d => {
      const best = bestPkgByDest[d.destination];
      const slideTitle = best?.display_title || best?.title || `${d.destination} 특가 패키지`;
      return {
        image: d.image!,
        destination: d.destination,
        title: slideTitle,
        tagline: best?.hero_tagline || undefined,
        minPrice: d.min_price ?? undefined,
        href: `/packages?destination=${encodeURIComponent(d.destination)}`,
      };
    });

  const overseas: RankingItem[] = buildRankingItemsUnique(rankingPkgs, attractions, today, true, new Set());
  const domestic: RankingItem[] = buildRankingItemsUnique(rankingPkgs, attractions, today, false, new Set());

  /** 메인 랭킹 카드 소셜 프루프(초기 트래픽: 임계값 미만이면 미노출) */
  const RANK_BOOKING_MIN = 3;
  const RANK_INTEREST_MIN = 8;
  const rankingIds = [...new Set([...overseas, ...domestic].map((p) => p.id))];
  const socialByPackage: Record<string, { bookings: number; interest: number }> = {};
  if (rankingIds.length > 0) {
    const since = new Date(Date.now() - 30 * 86400000).toISOString();
    const [bkRes, sgRes] = await Promise.all([
      sb
        .from('bookings')
        .select('package_id')
        .eq('status', 'confirmed')
        .gte('created_at', since)
        .in('package_id', rankingIds),
      sb
        .from('package_score_signals')
        .select('package_id')
        .gte('created_at', since)
        .in('package_id', rankingIds),
    ]);
    for (const row of bkRes.data ?? []) {
      const pid = (row as { package_id: string | null }).package_id;
      if (!pid) continue;
      if (!socialByPackage[pid]) socialByPackage[pid] = { bookings: 0, interest: 0 };
      socialByPackage[pid].bookings += 1;
    }
    for (const row of sgRes.data ?? []) {
      const pid = (row as { package_id: string | null }).package_id;
      if (!pid) continue;
      if (!socialByPackage[pid]) socialByPackage[pid] = { bookings: 0, interest: 0 };
      socialByPackage[pid].interest += 1;
    }
  }
  function withSocialBadge(item: RankingItem): RankingItem {
    const s = socialByPackage[item.id];
    if (!s) return item;
    if (s.bookings >= RANK_BOOKING_MIN) {
      return {
        ...item,
        socialBadge: { kind: 'bookings' as const, text: `최근 30일 예약 · ${s.bookings}건` },
      };
    }
    if (s.interest >= RANK_INTEREST_MIN) {
      return {
        ...item,
        socialBadge: { kind: 'interest' as const, text: '최근 조회 · 활발' },
      };
    }
    return item;
  }
  const overseasRanked = overseas.map(withSocialBadge);
  const domesticRanked = domestic.map(withSocialBadge);

  const ratingAgg = ratingResult.data;
  const totalReviews = ((ratingAgg as Array<{ review_count: number }>) || [])
    .reduce((s, r) => s + (r.review_count || 0), 0);
  const weightedSum = ((ratingAgg as Array<{ avg_rating: number; review_count: number }>) || [])
    .reduce((s, r) => s + (r.avg_rating * r.review_count), 0);
  const aggregateRating = totalReviews > 0 ? (weightedSum / totalReviews) : null;
  const BASE_URL = process.env.NEXT_PUBLIC_BASE_URL || 'https://yeosonam.com';
  const consultTelHref = getConsultTelHref();
  const consultPhoneLabel = process.env.NEXT_PUBLIC_CONSULT_PHONE?.trim() || null;

  return (
    <div className="min-h-screen bg-white max-w-lg md:max-w-none mx-auto">
      {/* Schema.org */}
      <script
        suppressHydrationWarning
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            '@context': 'https://schema.org',
            '@graph': [
              {
                '@type': 'TravelAgency',
                name: '여소남',
                alternateName: 'Yeosonam',
                url: BASE_URL,
                logo: `${BASE_URL}/logo.png`,
                description: '가치 있는 여행을 소개하는 단위 — 부산 출발 해외여행 패키지 전문',
                areaServed: 'KR',
                ...(aggregateRating ? {
                  aggregateRating: {
                    '@type': 'AggregateRating',
                    ratingValue: aggregateRating.toFixed(2),
                    reviewCount: totalReviews,
                    bestRating: 5,
                  },
                } : {}),
              },
              {
                '@type': 'WebSite',
                url: BASE_URL,
                name: '여소남',
                potentialAction: {
                  '@type': 'SearchAction',
                  target: { '@type': 'EntryPoint', urlTemplate: `${BASE_URL}/packages?q={search_term_string}` },
                  'query-input': 'required name=search_term_string',
                },
              },
            ],
          }),
        }}
      />

      <GlobalNav />

      {/* ── 히어로 배너 — 감성 훅 먼저 ── */}
      {heroSlides.length > 0 && (
        <HeroBanner slides={heroSlides} />
      )}

      {/* ── 검색바 — 히어로 바로 아래 독립 섹션 (오버랩 제거) ── */}
      <div className="bg-white border-b border-[#F2F4F6] px-4 md:px-6 py-4 md:py-5">
        <div className="max-w-[768px] mx-auto">
          <HomeHeroSearchCluster>
            <HomeHeroUrgencyStrip items={homeUrgencyTop3} />
          </HomeHeroSearchCluster>
        </div>
      </div>

      {/* ── 카테고리 아이콘 — 1줄 가로 스크롤 ── */}
      <div className="bg-white border-b border-[#F2F4F6]">
        <CategoryIcons />
      </div>

      {/* ── 인기 패키지 랭킹 ── */}
      {(overseas.length > 0 || domestic.length > 0) && (
        <section className="bg-white pt-6 pb-2 max-w-[1200px] mx-auto">
          <SectionHeader
            title="이번 주 인기 패키지"
            subtitle="실시간 등록 TOP"
            actionHref="/packages"
            actionLabel="전체 보기"
            className="px-5"
          />
          <RankingSection domestic={domesticRanked} overseas={overseasRanked} />
        </section>
      )}

      <main>

        {/* ── 추천 여행지 TOP 4 — Zebra: 연회색 배경 ── */}
        {topDests.length > 0 && (
          <section className="bg-[#F8FAFC] px-4 md:px-8 max-w-[1200px] mx-auto pt-6 pb-8 md:pt-8 md:pb-12">
            <SectionHeader
              title="추천 여행지"
              subtitle="완벽 가이드 · 관광지 · 엄선 패키지"
              actionHref="/destinations"
              actionLabel="전체 보기"
            />
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4">
              {topDests.map((d, idx) => (
                <Link
                  key={d.destination}
                  href={`/destinations/${encodeURIComponent(d.destination)}`}
                  className="group relative h-52 md:h-64 rounded-[16px] overflow-hidden bg-bg-section shadow-card hover:shadow-card-hover transition-shadow card-touch"
                >
                  {d.image ? (
                    <Image
                      src={d.image}
                      alt={`${d.destination} 여행`}
                      fill
                      className="object-cover group-hover:scale-105 transition-transform duration-500"
                      priority={idx < 2}
                      sizes="(max-width: 640px) 50vw, (max-width: 1024px) 25vw, 20vw"
                    />
                  ) : (
                    <div className="absolute inset-0 bg-gradient-to-br from-brand-light to-brand/20 flex items-center justify-center text-5xl">🌍</div>
                  )}
                  <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/20 to-transparent" />
                  <div className="absolute bottom-0 left-0 right-0 p-4 text-white">
                    {d.hasPillar && (
                      <span className="inline-block mb-1.5 px-2 py-0.5 bg-amber-400 text-amber-950 text-[10px] font-bold rounded-full">
                        ✨ 완벽 가이드
                      </span>
                    )}
                    <h3 className="text-[18px] md:text-[20px] font-bold leading-tight tracking-[-0.02em]">
                      {d.destination}
                    </h3>
                    <div className="mt-1 flex items-center gap-2 text-[12px] text-white/80 flex-wrap">
                      {d.package_count >= PKG_COUNT_DISCLOSE_MIN ? (
                        <span>🧳 {d.package_count}개</span>
                      ) : (
                        <span>다양한 출발 일정</span>
                      )}
                      {d.min_price && <span>· {Math.round(d.min_price / 10000)}만원~</span>}
                      {d.avg_rating && <span>· ⭐ {Number(d.avg_rating).toFixed(1)}</span>}
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          </section>
        )}

        {/* ── 인기 여행지 — Zebra: 흰 배경 ── */}
        <section className="bg-white px-4 md:px-8 max-w-[1200px] mx-auto pt-2 pb-8 md:pb-12">
          <SectionHeader title="인기 여행지" subtitle="실시간 패키지 등록순" />

          {destsWithImages.length === 0 ? (
            <div className="text-center py-12 text-text-secondary text-[14px]">현재 판매 중인 상품이 없습니다</div>
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3 md:gap-4">
              {destsWithImages.map((dest, index) => {
                const initial = (dest.destination || '?').trim().slice(0, 2);
                return (
                  <Link
                    key={dest.destination}
                    href={`/packages?destination=${encodeURIComponent(dest.destination)}`}
                    className="group rounded-[16px] overflow-hidden shadow-card hover:shadow-card-hover transition-shadow card-touch bg-white"
                  >
                    <div className="relative h-36 md:h-52 lg:h-56 bg-bg-section">
                      <SafeCoverNextImg
                        src={dest.image}
                        alt={dest.destination}
                        className="group-hover:scale-105 transition-transform duration-300"
                        sizes="(max-width: 768px) 50vw, (max-width: 1280px) 33vw, 25vw"
                        fallback={
                          <div className="absolute inset-0 bg-gradient-to-br from-brand-light to-[#F2F4F6] flex items-center justify-center">
                            <span className="text-[22px] md:text-[28px] font-extrabold text-brand/35 tracking-tight">
                              {initial}
                            </span>
                          </div>
                        }
                      />
                      <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-black/15 to-transparent pointer-events-none" />
                      <div className="absolute bottom-3 left-3 right-3">
                        <p className="text-white text-[16px] md:text-[18px] font-bold tracking-[-0.02em] drop-shadow-md">
                          {dest.destination}
                        </p>
                      </div>
                      {/* 상품 수 배지 — 소수 노출은 이탈 유발 가능, 임계값 이상만 숫자 표기 */}
                      <div className="absolute top-2.5 right-2.5">
                        <span className="bg-white/90 text-[11px] font-bold text-brand px-2 py-0.5 rounded-full">
                          {dest.count >= PKG_COUNT_DISCLOSE_MIN ? `${dest.count}개` : '보러가기'}
                        </span>
                      </div>
                    </div>
                    <div className="px-3 py-2.5 md:px-4 md:py-3">
                      <div className="flex items-baseline gap-0.5">
                        {dest.minPrice > 0 ? (
                          <>
                            <span className="text-[18px] md:text-[20px] font-extrabold text-brand tabular-nums tracking-[-0.02em]">
                              {dest.minPrice.toLocaleString()}
                            </span>
                            <span className="text-[12px] font-medium text-text-secondary ml-0.5">원~</span>
                          </>
                        ) : (
                          <span className="text-[13px] text-text-secondary">가격 문의</span>
                        )}
                      </div>
                    </div>
                  </Link>
                );
              })}
            </div>
          )}
        </section>
      </main>

      {/* ── 패키지 중심 CTA (자유여행/AI는 보조 링크로 — 기대치 정렬) ── */}
      <section className="bg-[#F8FAFC] px-4 md:px-8 pb-8 pt-6 max-w-[1200px] mx-auto">
        <div className="rounded-2xl overflow-hidden border border-[#E5E7EB] shadow-card bg-white">
          <Link
            href="/packages"
            className="group flex items-center justify-between bg-gradient-to-r from-brand to-[#60A5FA] px-5 py-4 md:px-6 md:py-5 hover:shadow-lg transition-shadow"
          >
            <div>
              <p className="text-[11px] font-semibold text-white/80 tracking-wide mb-0.5">패키지·단체 여행</p>
              <p className="text-[16px] md:text-[18px] font-extrabold text-white leading-tight">
                출발 가능 일정·가격을 한눈에
              </p>
              <p className="text-[12px] text-white/85 mt-0.5">마감 임박·테마별 상품까지 바로 비교</p>
            </div>
            <div className="shrink-0 ml-4 bg-white/20 group-hover:bg-white/30 transition-colors rounded-full p-2.5">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5">
                <path d="M5 12h14M12 5l7 7-7 7"/>
              </svg>
            </div>
          </Link>
          <div className="px-4 py-3 md:px-6 md:py-3.5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 bg-admin-bg">
            <p className="text-[12px] md:text-[13px] text-text-body">
              항공+호텔 맞춤 조합은 단계적으로 준비 중입니다.
            </p>
            <Link
              href="/free-travel"
              className="text-[12px] md:text-[13px] font-semibold text-brand shrink-0 underline-offset-2 hover:underline"
            >
              자유여행 베타 페이지 →
            </Link>
          </div>
        </div>
      </section>

      {/* ── 푸터 ── */}
      <footer className="px-6 py-8 md:py-12 text-center border-t border-admin-border bg-white">
        <p className="text-[13px] text-text-secondary font-medium">부산 출발 단체·패키지 여행 전문</p>
        {/* 신뢰 뱃지 */}
        <div className="mt-3 flex justify-center gap-2 flex-wrap">
          <span className="text-[11px] text-text-secondary border border-[#E5E7EB] px-2.5 py-1 rounded-full">🛡️ 출발 보장</span>
          <span className="text-[11px] text-text-secondary border border-[#E5E7EB] px-2.5 py-1 rounded-full">📋 관광사업자 등록</span>
          <span className="text-[11px] text-text-secondary border border-[#E5E7EB] px-2.5 py-1 rounded-full">🔒 안전 결제</span>
        </div>
        <p className="text-[11px] text-text-secondary/50 mt-2">yeosonam.co.kr</p>
        <div className="mt-3 flex justify-center gap-4">
          <Link href="/packages" className="text-[13px] text-text-body hover:text-brand transition-colors">전체 상품</Link>
          <Link href="/blog" className="text-[13px] text-text-body hover:text-brand transition-colors">매거진</Link>
          <Link href="/group-inquiry" className="text-[13px] text-text-body hover:text-brand transition-colors">단체 문의</Link>
        </div>
      </footer>

    </div>
  );
}
