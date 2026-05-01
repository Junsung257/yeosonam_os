import Image from 'next/image';
import Link from 'next/link';
import { createClient } from '@supabase/supabase-js';
import SearchBar from '@/components/customer/SearchBar';
import GlobalNav from '@/components/customer/GlobalNav';
import SectionHeader from '@/components/customer/SectionHeader';
import CategoryIcons from '@/components/customer/CategoryIcons';
import HeroBanner from '@/components/customer/HeroBanner';
import type { HeroSlide } from '@/components/customer/HeroBanner';
import RankingSection from '@/components/customer/RankingSection';
import type { RankingItem } from '@/components/customer/RankingSection';

// ISR 5분 / Windows 로컬은 force-dynamic (chunk race 회피)
export const revalidate = process.platform === 'win32' ? 0 : 300;
export const dynamic = process.platform === 'win32' ? 'force-dynamic' : 'auto';

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
}

const COUNTRY_EMOJI: Record<string, string> = {
  '베트남': '🇻🇳', '중국': '🇨🇳', '일본': '🇯🇵', '필리핀': '🇵🇭',
  '말레이시아': '🇲🇾', '태국': '🇹🇭', '인도네시아': '🇮🇩', '캄보디아': '🇰🇭',
  '대만': '🇹🇼', '몽골': '🇲🇳', '홍콩': '🇭🇰', '마카오': '🇲🇴',
  '싱가포르': '🇸🇬', '라오스': '🇱🇦',
};

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

export default async function HomePage() {
  const sb = getSupabase();
  const today = new Date().toISOString().slice(0, 10);

  // 4개 쿼리 동시 실행 (active_destinations를 기존 3개와 합쳐 왕복 1회 절감)
  const [pkgResult, attrResult, rankingResult, activeDestsResult] = await Promise.all([
    sb.from('travel_packages')
      .select('destination, price, price_tiers, price_dates, country')
      .in('status', ['active', 'approved']),
    sb.from('attractions')
      .select('name, photos, country, region, destination, mention_count')
      .not('photos', 'is', null)
      .limit(300),
    sb.from('travel_packages')
      .select('id, title, display_title, destination, price, price_tiers, price_dates, country, hero_image_url, thumbnail_urls, duration, nights')
      .in('status', ['active', 'approved'])
      .order('created_at', { ascending: false })
      .limit(30),
    sb.from('active_destinations')
      .select('*')
      .order('package_count', { ascending: false })
      .limit(20),
  ]);

  const allPkgs = pkgResult.data ?? [];
  const attractions = attrResult.data ?? [];
  const rankingPkgs = rankingResult.data ?? [];

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
  const [{ data: topDestAttrs }, { data: pillarExists }] = topDestNames.length > 0
    ? await Promise.all([
        sb.from('attractions').select('destination, name, photos').in('destination', topDestNames).not('photos', 'is', null).limit(50),
        sb.from('content_creatives').select('pillar_for').in('pillar_for', topDestNames).eq('content_type', 'pillar').eq('status', 'published'),
      ])
    : [{ data: null }, { data: null }];

  const attrImageByDest: Record<string, string> = {};
  ((topDestAttrs as Array<{ destination: string; photos: Array<{ src_medium?: string; src_large?: string }> | null }>) || [])
    .forEach(a => {
      if (a.destination && !attrImageByDest[a.destination]) {
        const img = a.photos?.[0]?.src_large || a.photos?.[0]?.src_medium;
        if (img) attrImageByDest[a.destination] = img;
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

  // 랭킹 데이터 (패키지에 attraction 이미지 매핑)
  const attrImageByDestFull: Record<string, string> = {};
  attractions.forEach((a: any) => {
    const dest = a.destination || a.region || '';
    if (dest && !attrImageByDestFull[dest] && a.photos?.[0]) {
      const img = a.photos[0].src_large || a.photos[0].src_medium;
      if (img) attrImageByDestFull[dest] = img;
    }
  });

  // Pexels 폴백 — 여행지 카테고리/그리드 빈 슬롯 채우기 (패키지 카드는 제외)
  // ISR 캐시(revalidate=300) + Next.js fetch 캐시(1h)로 실제 Pexels 호출은 드물게 발생
  if (process.env.PEXELS_API_KEY) {
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
  const heroSlides: HeroSlide[] = topDests
    .filter(d => d.image)
    .slice(0, 5)
    .map(d => ({
      image: d.image!,
      destination: d.destination,
      title: `${d.destination} 특가 패키지`,
      minPrice: d.min_price ?? undefined,
      href: `/packages?destination=${encodeURIComponent(d.destination)}`,
    }));

  function computePkgMinPrice(p: any): number {
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

  const DOMESTIC_KEYWORDS = /국내|제주|부산|서울|강원|경주|여수/;
  const toRankingItem = (p: any): RankingItem => ({
    id: p.id,
    title: p.display_title || p.title,
    destination: p.destination,
    image: p.hero_image_url || p.thumbnail_urls?.[0] || attrImageByDestFull[p.destination] || null,
    minPrice: computePkgMinPrice(p),
    duration: p.nights && p.duration ? `${p.nights}박${p.duration}일` : null,
    isOverseas: !DOMESTIC_KEYWORDS.test(p.destination || ''),
  });

  const overseas: RankingItem[] = rankingPkgs
    .filter((p: any) => !DOMESTIC_KEYWORDS.test(p.destination || ''))
    .slice(0, 7)
    .map(toRankingItem);
  const domestic: RankingItem[] = rankingPkgs
    .filter((p: any) => DOMESTIC_KEYWORDS.test(p.destination || ''))
    .slice(0, 7)
    .map(toRankingItem);

  // 평점 집계 (Schema.org용)
  const { data: ratingAgg } = await sb
    .from('travel_packages')
    .select('avg_rating, review_count')
    .not('avg_rating', 'is', null)
    .gte('review_count', 1);

  const totalReviews = ((ratingAgg as Array<{ review_count: number }>) || [])
    .reduce((s, r) => s + (r.review_count || 0), 0);
  const weightedSum = ((ratingAgg as Array<{ avg_rating: number; review_count: number }>) || [])
    .reduce((s, r) => s + (r.avg_rating * r.review_count), 0);
  const aggregateRating = totalReviews > 0 ? (weightedSum / totalReviews) : null;
  const BASE_URL = process.env.NEXT_PUBLIC_BASE_URL || 'https://yeosonam.com';

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

      {/* ── 카테고리 아이콘 ── */}
      <CategoryIcons />

      {/* ── 섹션 구분 ── */}
      <div className="h-2 bg-[#F2F4F6] w-full" />

      {/* ── 히어로 배너 ── */}
      {heroSlides.length > 0 && (
        <HeroBanner slides={heroSlides} />
      )}

      {/* ── 검색바 — 히어로 하단 오버랩 ── */}
      <div className="px-4 md:px-6 -mt-7 md:-mt-10 relative z-10 pb-3 md:pb-5">
        <div className="max-w-[768px] mx-auto">
          <SearchBar />
        </div>
      </div>

      {/* ── 섹션 구분 ── */}
      <div className="h-2 bg-[#F2F4F6] w-full mt-2 md:mt-4" />

      {/* ── 인기 패키지 랭킹 ── */}
      {(overseas.length > 0 || domestic.length > 0) && (
        <section className="pt-6 pb-2 max-w-[1200px] mx-auto">
          <SectionHeader
            title="이번 주 인기 패키지"
            subtitle="실시간 등록 TOP"
            actionHref="/packages"
            actionLabel="전체 보기"
            className="px-5"
          />
          <RankingSection domestic={domestic} overseas={overseas} />
        </section>
      )}

      {/* ── 섹션 구분 ── */}
      <div className="h-2 bg-[#F2F4F6] w-full mt-4" />

      <main className="px-4 md:px-8 max-w-[1200px] mx-auto">

        {/* ── 추천 여행지 TOP 4 ── */}
        {topDests.length > 0 && (
          <section className="pt-6 pb-8 md:pt-8 md:pb-12">
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
                  className="group relative h-52 md:h-64 rounded-[16px] overflow-hidden bg-[#F2F4F6] shadow-card hover:shadow-card-hover transition-shadow card-touch"
                >
                  {d.image ? (
                    <img
                      src={d.image}
                      alt={`${d.destination} 여행`}
                      className="absolute inset-0 w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                      loading={idx < 2 ? 'eager' : 'lazy'}
                    />
                  ) : (
                    <div className="absolute inset-0 bg-gradient-to-br from-[#EBF3FE] to-[#3182F6]/20 flex items-center justify-center text-5xl">🌍</div>
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
                    <div className="mt-1 flex items-center gap-2 text-[12px] text-white/80">
                      <span>🧳 {d.package_count}개</span>
                      {d.min_price && <span>· {Math.round(d.min_price / 10000)}만원~</span>}
                      {d.avg_rating && <span>· ⭐ {Number(d.avg_rating).toFixed(1)}</span>}
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          </section>
        )}

        {/* ── 인기 여행지 ── */}
        <section className="pb-8 md:pb-12">
          <SectionHeader title="인기 여행지" subtitle="실시간 패키지 등록순" />

          {destsWithImages.length === 0 ? (
            <div className="text-center py-12 text-[#8B95A1] text-[14px]">현재 판매 중인 상품이 없습니다</div>
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3 md:gap-4">
              {destsWithImages.map((dest, index) => {
                const emoji = COUNTRY_EMOJI[dest.country] || '🌍';
                return (
                  <Link
                    key={dest.destination}
                    href={`/packages?destination=${encodeURIComponent(dest.destination)}`}
                    className="group rounded-[16px] overflow-hidden shadow-card hover:shadow-card-hover transition-shadow card-touch bg-white"
                  >
                    <div className="relative h-36 md:h-52 lg:h-56 bg-[#F2F4F6]">
                      {dest.image ? (
                        <Image
                          src={dest.image}
                          alt={dest.destination}
                          fill
                          sizes="(max-width: 768px) 50vw, (max-width: 1024px) 33vw, 25vw"
                          className="object-cover group-hover:scale-105 transition-transform duration-300"
                          {...(index < 4 ? { priority: true } : { loading: 'lazy' as const })}
                        />
                      ) : (
                        <div className="w-full h-full bg-gradient-to-br from-[#EBF3FE] to-[#F2F4F6] flex items-center justify-center text-3xl md:text-5xl">{emoji}</div>
                      )}
                      <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-black/15 to-transparent pointer-events-none" />
                      {/* 여행지명 오버레이 */}
                      <div className="absolute bottom-3 left-3">
                        <p className="text-white text-[16px] md:text-[18px] font-bold tracking-[-0.02em]">{emoji} {dest.destination}</p>
                      </div>
                      {/* 상품 수 배지 */}
                      <div className="absolute top-2.5 right-2.5">
                        <span className="bg-white/90 text-[11px] font-bold text-[#3182F6] px-2 py-0.5 rounded-full">{dest.count}개</span>
                      </div>
                    </div>
                    <div className="px-3 py-2.5 md:px-4 md:py-3">
                      <div className="flex items-baseline gap-0.5">
                        {dest.minPrice > 0 ? (
                          <>
                            <span className="text-[18px] md:text-[20px] font-extrabold text-[#3182F6] tabular-nums tracking-[-0.02em]">
                              {dest.minPrice.toLocaleString()}
                            </span>
                            <span className="text-[12px] font-medium text-[#8B95A1] ml-0.5">원~</span>
                          </>
                        ) : (
                          <span className="text-[13px] text-[#8B95A1]">가격 문의</span>
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

      {/* ── 자유여행 진입점 배너 ── */}
      <section className="px-4 md:px-8 pb-8 max-w-[1200px] mx-auto">
        <Link
          href="/free-travel"
          className="group flex items-center justify-between bg-gradient-to-r from-[#3182F6] to-[#60A5FA] rounded-2xl px-5 py-4 md:px-6 md:py-5 hover:shadow-lg transition-shadow"
        >
          <div>
            <p className="text-[11px] font-semibold text-white/70 uppercase tracking-wider mb-0.5">AI 자유여행 플래너</p>
            <p className="text-[16px] md:text-[18px] font-extrabold text-white leading-tight">
              항공·호텔 직접 골라 더 저렴하게
            </p>
            <p className="text-[12px] text-white/80 mt-0.5">마이리얼트립 실시간 최저가 × 여소남 패키지 비교</p>
          </div>
          <div className="shrink-0 ml-4 bg-white/20 group-hover:bg-white/30 transition-colors rounded-full p-2.5">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5">
              <path d="M5 12h14M12 5l7 7-7 7"/>
            </svg>
          </div>
        </Link>
      </section>

      {/* ── 푸터 ── */}
      <footer className="px-6 py-8 md:py-12 text-center border-t border-[#F2F4F6]">
        <p className="text-[13px] text-[#8B95A1]">부산/김해 출발 단체·패키지 여행 전문</p>
        <p className="text-[12px] text-[#8B95A1] mt-1">yeosonam.co.kr</p>
        <div className="mt-4 flex justify-center gap-4">
          <Link href="/packages" className="text-[13px] text-[#4E5968] hover:text-[#3182F6] transition-colors">전체 상품</Link>
          <Link href="/blog" className="text-[13px] text-[#4E5968] hover:text-[#3182F6] transition-colors">매거진</Link>
          <Link href="/group-inquiry" className="text-[13px] text-[#4E5968] hover:text-[#3182F6] transition-colors">단체 문의</Link>
        </div>
      </footer>

      {/* ── 모바일 플로팅 CTA ── */}
      <nav
        className="md:hidden fixed bottom-0 left-0 right-0 bg-white/95 backdrop-blur-sm z-50 border-t border-[#F2F4F6] safe-area-bottom"
        aria-label="문의하기"
      >
        <div className="max-w-lg mx-auto px-4 pb-5 pt-3 flex items-center gap-3">
          <a
            href="tel:051-000-0000"
            className="w-[48px] h-[48px] flex items-center justify-center rounded-full border border-[#E5E7EB] hover:bg-[#F2F4F6] shrink-0 transition-colors"
          >
            <span className="text-lg">📞</span>
          </a>
          <a
            href="https://pf.kakao.com/_xcFxkBG/chat"
            target="_blank"
            rel="noopener"
            referrerPolicy="no-referrer-when-downgrade"
            className="flex-1 bg-[#FEE500] h-[52px] rounded-full text-[#3C1E1E] font-bold text-[15px] flex items-center justify-center gap-2 shadow-lg card-touch"
          >
            💬 카카오톡 상담
          </a>
        </div>
      </nav>
    </div>
  );
}
