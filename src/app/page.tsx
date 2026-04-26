import Link from 'next/link';
import Image from 'next/image';
import { createClient } from '@supabase/supabase-js';
import SearchBar from '@/components/customer/SearchBar';

// Vercel(Linux) 에서는 ISR 5분 유지, Windows 로컬 빌드는 chunk race 회피용으로 force-dynamic.
// ERR-windows-prerender-chunk@2026-04-26 (Next.js 14.0.4 로컬 빌드 한정 회피책)
export const revalidate = process.platform === 'win32' ? 0 : 300;
export const dynamic = process.platform === 'win32' ? 'force-dynamic' : 'auto';

// ── Supabase 서버사이드 ──
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

  // 1+2. Supabase 병렬 fetch (순차 → 병렬로 TTFB 절반 단축)
  const [pkgResult, attrResult] = await Promise.all([
    sb.from('travel_packages')
      .select('destination, price, price_tiers, price_dates, country')
      .in('status', ['active', 'approved']),
    sb.from('attractions')
      .select('name, photos, country, region, mention_count')
      .not('photos', 'is', null)
      .limit(300),
  ]);

  const allPkgs = pkgResult.data;
  const attractions = attrResult.data;

  const destMap: Record<string, { count: number; minPrice: number; country: string }> = {};
  (allPkgs ?? []).forEach((p: any) => {
    const dest = p.destination;
    if (!dest) return;
    if (!destMap[dest]) destMap[dest] = { count: 0, minPrice: Infinity, country: p.country || '' };
    destMap[dest].count++;
    let min = Infinity;
    if (p.price_dates?.length) {
      const pdPrices = (p.price_dates as any[]).map((d: any) => d.price).filter(Boolean);
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

  const usedPhotoIds = new Set<number>();
  const destsWithImages = destinations.map(dest => {
    const destParts = dest.destination.split(/[\/,\s]/).map(s => s.trim()).filter(Boolean);
    const matched = (attractions ?? [])
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
      const image = chosen.photos[0].src_medium || chosen.photos[0].src_large || '';
      if (chosen.photos[0].pexels_id) usedPhotoIds.add(chosen.photos[0].pexels_id);
      return { ...dest, image };
    }
    return dest;
  });

  // 추천 여행지 TOP 4 (Pillar 준비된 destination 우선)
  const { data: topDestsRaw } = await sb
    .from('active_destinations')
    .select('*')
    .order('package_count', { ascending: false })
    .limit(4);

  // 각 destination 대표 이미지 + Pillar 존재 여부
  const topDestNames = ((topDestsRaw as Array<{ destination: string }>) || []).map(d => d.destination);
  const [{ data: topDestAttrs }, { data: pillarExists }] = topDestNames.length > 0
    ? await Promise.all([
        sb.from('attractions').select('destination, name, photos').in('destination', topDestNames).not('photos', 'is', null).limit(50),
        sb.from('content_creatives').select('pillar_for').in('pillar_for', topDestNames).eq('content_type', 'pillar').eq('status', 'published'),
      ])
    : [{ data: null }, { data: null }];

  const attrImageByDest: Record<string, string> = {};
  ((topDestAttrs as Array<{ destination: string; photos: Array<{ src_medium?: string }> | null }>) || []).forEach(a => {
    if (a.destination && !attrImageByDest[a.destination]) {
      const img = a.photos?.[0]?.src_medium;
      if (img) attrImageByDest[a.destination] = img;
    }
  });

  const pillarSet = new Set(((pillarExists as Array<{ pillar_for: string | null }>) || []).map(p => p.pillar_for).filter(Boolean) as string[]);

  const topDests = ((topDestsRaw as Array<{ destination: string; package_count: number; avg_rating: number | null; total_reviews: number | null; min_price: number | null }>) || [])
    .map(d => ({
      ...d,
      image: attrImageByDest[d.destination] || null,
      hasPillar: pillarSet.has(d.destination),
    }));

  // 전체 평점 집계 (aggregateRating Schema 용)
  const { data: ratingAgg } = await sb
    .from('travel_packages')
    .select('avg_rating, review_count')
    .not('avg_rating', 'is', null)
    .gte('review_count', 1);

  const totalReviews = ((ratingAgg as Array<{ review_count: number }> | null) || [])
    .reduce((s, r) => s + (r.review_count || 0), 0);
  const weightedSum = ((ratingAgg as Array<{ avg_rating: number; review_count: number }> | null) || [])
    .reduce((s, r) => s + (r.avg_rating * r.review_count), 0);
  const aggregateRating = totalReviews > 0 ? (weightedSum / totalReviews) : null;

  const BASE_URL = process.env.NEXT_PUBLIC_BASE_URL || 'https://yeosonam.com';

  return (
    <div className="min-h-screen bg-white max-w-lg md:max-w-none mx-auto">
      {/* TravelAgency + WebSite SearchAction Schema */}
      {/* suppressHydrationWarning: 일부 브라우저 확장(Grammarly/ColorZilla/광고차단기)이 SSR HTML
          수신 직후 <script> 태그에 inline style을 inject 해 React가 "Extra attributes from the
          server: style" 경고를 띄우는 알려진 문제 회피. JSON-LD 자체는 정상 렌더된다. */}
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

      {/* 데스크톱 전용 상단 네비 */}
      <nav className="hidden md:flex sticky top-0 z-40 bg-white/90 backdrop-blur-xl border-b border-gray-100 px-8 py-4 items-center justify-between">
        <Link href="/" className="text-xl font-black tracking-tight text-[#340897]">여소남</Link>
        <div className="flex items-center gap-6 text-sm font-medium text-gray-700">
          <Link href="/packages" className="hover:text-[#340897] transition">전체 상품</Link>
          <Link href="/destinations" className="hover:text-[#340897] transition">여행지</Link>
          <Link href="/blog" className="hover:text-[#340897] transition">매거진</Link>
          <Link href="/group-inquiry" className="hover:text-[#340897] transition">단체 문의</Link>
          <a href="tel:051-000-0000" className="text-gray-500 hover:text-gray-900 transition">📞 051-000-0000</a>
          <a
            href="https://pf.kakao.com/_xcFxkBG/chat"
            target="_blank"
            rel="noopener"
            referrerPolicy="no-referrer-when-downgrade"
            className="bg-[#FEE500] text-[#3C1E1E] font-bold text-sm px-4 py-2 rounded-full hover:shadow-md transition"
          >
            💬 카카오톡 상담
          </a>
        </div>
      </nav>

      {/* 히어로 */}
      <header className="bg-gradient-to-b from-[#340897] to-[#4b2ead] px-5 pt-10 pb-8 text-center md:px-8 md:pt-20 md:pb-24">
        <div className="inline-flex items-center gap-1.5 bg-white/20 rounded-full px-3 py-1 mb-3 md:px-5 md:py-2 md:mb-5">
          <span className="text-white text-sm md:text-base font-medium">✈ 김해공항 출발 전용</span>
        </div>

        <h1 className="text-white text-2xl md:text-6xl font-black tracking-tight">여소남</h1>
        <p className="text-white/90 text-sm md:text-xl mt-1 md:mt-3 font-medium">가치있는 여행을 소개합니다</p>

        <div className="flex gap-2 md:gap-3 overflow-x-auto scrollbar-hide pb-1 mt-5 md:mt-10 justify-center flex-wrap">
          {['전체', '중국', '일본', '동남아', '마카오/홍콩', '인천출발'].map(region => (
            <Link
              key={region}
              href={region === '전체' ? '/packages' : `/packages?filter=${encodeURIComponent(region)}`}
              prefetch={true}
              className="flex-shrink-0 bg-white/20 text-white text-sm md:text-base px-3.5 py-2 md:px-5 md:py-2.5 rounded-full border border-white/30 active:bg-white/30 hover:bg-white/30 transition"
            >
              {region}
            </Link>
          ))}
        </div>
      </header>

      {/* 목적지 카드 그리드 — 서버 렌더링, 즉시 표시 */}
      <main className="px-4 -mt-6 md:px-8 md:-mt-16 md:max-w-7xl md:mx-auto">
        {/* 통합 검색바 */}
        <div className="mb-4 md:mb-8">
          <SearchBar />
        </div>

        {/* 🆕 추천 여행지 TOP 4 — Pillar 가이드 연결 */}
        {topDests.length > 0 && (
          <div className="mb-4 md:mb-8">
            <div className="flex items-end justify-between mb-3 md:mb-4">
              <div>
                <h2 className="text-base md:text-2xl font-bold text-gray-800">🗺 추천 여행지</h2>
                <p className="text-[11px] md:text-[13px] text-gray-500 mt-0.5">완벽 가이드 · 관광지 · 엄선 패키지</p>
              </div>
              <Link href="/destinations" className="text-[12px] md:text-[13px] text-[#340897] font-semibold hover:underline">
                전체 보기 →
              </Link>
            </div>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5 md:gap-4">
              {topDests.map(d => (
                <Link
                  key={d.destination}
                  href={`/destinations/${encodeURIComponent(d.destination)}`}
                  className="group relative h-44 md:h-56 rounded-xl overflow-hidden border border-gray-100 bg-gray-200 hover:shadow-lg transition"
                >
                  {d.image ? (
                    <img
                      src={d.image}
                      alt={`${d.destination} 여행 대표 사진`}
                      className="absolute inset-0 w-full h-full object-cover group-hover:scale-105 transition duration-500"
                      loading="lazy"
                    />
                  ) : (
                    <div className="absolute inset-0 bg-gradient-to-br from-violet-400 to-purple-600 flex items-center justify-center text-5xl">
                      🌍
                    </div>
                  )}
                  <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent" />
                  <div className="absolute bottom-0 left-0 right-0 p-3 text-white">
                    {d.hasPillar && (
                      <span className="inline-block mb-1 px-1.5 py-0.5 bg-amber-400 text-slate-900 text-[9px] font-bold rounded">
                        ✨ 완벽 가이드
                      </span>
                    )}
                    <h3 className="text-[15px] md:text-[18px] font-extrabold leading-tight">
                      {d.destination}
                    </h3>
                    <div className="mt-0.5 flex items-center gap-1.5 text-[10px] md:text-[11px] opacity-90">
                      <span>🧳 {d.package_count}개</span>
                      {d.min_price && <span>· {Math.round(d.min_price / 10000)}만원~</span>}
                      {d.avg_rating && <span>· ⭐ {Number(d.avg_rating).toFixed(1)}</span>}
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          </div>
        )}

        <div className="bg-white rounded-2xl shadow-lg border border-gray-100 p-4 md:p-8">
          <h2 className="text-base md:text-2xl font-bold text-gray-800 mb-3 md:mb-6">인기 여행지</h2>

          {destsWithImages.length === 0 ? (
            <div className="text-center py-12 text-gray-500 text-base">현재 판매 중인 상품이 없습니다</div>
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3 md:gap-5">
              {destsWithImages.map((dest, index) => {
                const emoji = COUNTRY_EMOJI[dest.country] || '🌍';
                return (
                  <Link key={dest.destination} href={`/packages?destination=${encodeURIComponent(dest.destination)}`} prefetch={true}>
                    <div className="group relative rounded-xl overflow-hidden border border-gray-100 hover:border-violet-300 hover:shadow-md transition-all cursor-pointer">
                      <div className="relative h-28 md:h-44 lg:h-52 bg-gray-100">
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
                          <div className="w-full h-full bg-gradient-to-br from-violet-100 to-purple-200 flex items-center justify-center text-3xl md:text-5xl">{emoji}</div>
                        )}
                        <div className="absolute inset-0 bg-gradient-to-t from-black/50 to-transparent" />
                        <div className="absolute bottom-2 left-2.5 md:bottom-3 md:left-3">
                          <p className="text-white text-base md:text-lg font-bold leading-tight">{emoji} {dest.destination}</p>
                        </div>
                        <div className="absolute top-2 right-2 md:top-3 md:right-3">
                          <span className="bg-white/90 text-xs md:text-sm font-bold text-violet-700 px-2 py-0.5 rounded-full">{dest.count}개</span>
                        </div>
                      </div>
                      <div className="px-2.5 py-2 md:px-3 md:py-3">
                        <p className="text-base md:text-lg font-black text-gray-900">
                          {dest.minPrice > 0 ? `₩${dest.minPrice.toLocaleString()}~` : '가격 문의'}
                        </p>
                      </div>
                    </div>
                  </Link>
                );
              })}
            </div>
          )}
        </div>
      </main>

      {/* 하단 안내 */}
      <footer className="px-6 py-8 md:py-16 text-center md:max-w-7xl md:mx-auto">
        <p className="text-sm md:text-base text-gray-500">부산/김해 출발 단체·패키지 여행 전문</p>
        <p className="text-xs md:text-sm text-gray-500 mt-1">yeosonam.co.kr</p>
      </footer>

      {/* 플로팅 CTA — 모바일 전용 */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 bg-white/95 backdrop-blur-xl z-50 border-t border-gray-100 safe-area-bottom" aria-label="문의하기">
        <div className="max-w-lg mx-auto px-4 pb-5 pt-3 flex items-center gap-3">
          <a href="tel:051-000-0000" className="w-12 h-12 flex items-center justify-center rounded-full border border-gray-200 hover:bg-gray-50 shrink-0">
            <span className="text-lg">📞</span>
          </a>
          <a href="https://pf.kakao.com/_xcFxkBG/chat" target="_blank" rel="noopener" referrerPolicy="no-referrer-when-downgrade"
            className="flex-1 bg-[#FEE500] h-12 rounded-full text-[#3C1E1E] font-bold text-base flex items-center justify-center gap-2 shadow-lg active:scale-[0.98] transition-all">
            💬 카카오톡 상담
          </a>
        </div>
      </nav>
    </div>
  );
}
