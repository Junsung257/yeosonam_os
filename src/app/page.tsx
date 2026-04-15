import Link from 'next/link';
import Image from 'next/image';
import { createClient } from '@supabase/supabase-js';
import SearchBar from '@/components/customer/SearchBar';

export const revalidate = 300; // 5분 ISR

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

  return (
    <div className="min-h-screen bg-white max-w-lg md:max-w-none mx-auto">
      {/* 데스크톱 전용 상단 네비 */}
      <nav className="hidden md:flex sticky top-0 z-40 bg-white/90 backdrop-blur-xl border-b border-gray-100 px-8 py-4 items-center justify-between">
        <Link href="/" className="text-xl font-black tracking-tight text-[#340897]">여소남</Link>
        <div className="flex items-center gap-6 text-sm font-medium text-gray-700">
          <Link href="/packages" className="hover:text-[#340897] transition">전체 상품</Link>
          <Link href="/blog" className="hover:text-[#340897] transition">여행 정보</Link>
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
