'use client';

import { useState, useMemo } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { matchAttraction, normalizeDays } from '@/lib/attraction-matcher';
import type { AttractionData } from '@/lib/attraction-matcher';
import { getMinPriceFromDates } from '@/lib/price-dates';

interface Package {
  id: string;
  title: string;
  destination?: string;
  duration?: number;
  price?: number;
  price_tiers?: { period_label?: string; departure_dates?: string[]; adult_price?: number }[];
  price_dates?: { date: string; price: number; confirmed: boolean }[];
  product_type?: string;
  airline?: string;
  departure_airport?: string;
  product_highlights?: string[];
  product_tags?: string[];
  itinerary_data?: any;
  is_airtel?: boolean;
  display_title?: string;
  products?: { display_name?: string; internal_code?: string };
  seats_held?: number;
  seats_confirmed?: number;
}

interface AttractionInfo {
  name: string; photos?: { src_medium: string; src_large: string }[];
  country?: string; region?: string; mention_count?: number;
}

const AIRLINES: Record<string, string> = { BX: '에어부산', LJ: '진에어', OZ: '아시아나', KE: '대한항공', '7C': '제주항공', TW: '티웨이', VJ: '비엣젯', ZE: '이스타항공', CA: '중국국제항공', CZ: '중국남방항공', MU: '중국동방항공' };

const FILTER_OPTIONS = ['전체', '중국', '일본', '동남아', '마카오/홍콩', '인천출발'] as const;
const SORT_OPTIONS = [
  { label: '추천순', value: 'recommended' },
  { label: '가격 낮은순', value: 'price_asc' },
  { label: '가격 높은순', value: 'price_desc' },
] as const;

const REGION_MAP: Record<string, (pkg: Package) => boolean> = {
  '중국': (pkg) => /장가계|청도|서안|상해|연길|백두산|구채구|심천/.test(pkg.destination || ''),
  '일본': (pkg) => /시즈오카|후쿠오카|오사카|도쿄|큐슈|토야마|후지노미야|나라|교토|이즈/.test(pkg.destination || ''),
  '동남아': (pkg) => /나트랑|달랏|다낭|푸꾸옥|보홀|세부|치앙마이|치앙라이|코타키나발루|방콕|발리|마나도|호치민|하노이/.test(pkg.destination || ''),
  '마카오/홍콩': (pkg) => /마카오|홍콩/.test(pkg.destination || ''),
  '인천출발': (pkg) => /인천/.test(pkg.departure_airport || ''),
};

function matchesFilter(pkg: Package, filter: string): boolean {
  if (filter === '전체') return true;
  const regionFn = REGION_MAP[filter];
  if (regionFn) return regionFn(pkg);
  return false;
}

interface ClientProps {
  initialPackages: Package[];
  initialAttractions: AttractionInfo[];
  destination: string;
  filter: string;
}

export default function PackagesClient({ initialPackages, initialAttractions, destination, filter }: ClientProps) {
  const destParam = destination;
  const packages = initialPackages;
  const attractions = initialAttractions;
  const [activeFilter, setActiveFilter] = useState(filter || '전체');
  const [sortBy, setSortBy] = useState('recommended');

  // 상품의 대표 이미지 찾기 (상품별로 다른 사진 사용)
  const usedImageUrls = new Set<string>();

  function getProductImage(pkg: Package): string | null {
    // 1차: itinerary에서 관광지 매칭
    const days = normalizeDays<{ day: number; schedule?: { activity: string; type?: string }[] }>(pkg.itinerary_data);
    for (const day of days) {
      for (const item of (day.schedule || [])) {
        if (item.type === 'flight' || item.type === 'shopping') continue;
        const attr = matchAttraction(item.activity, attractions as AttractionData[], pkg.destination);
        if (attr?.photos?.length) {
          for (const photo of attr.photos) {
            if (photo?.src_medium && !usedImageUrls.has(photo.src_medium)) {
              usedImageUrls.add(photo.src_medium);
              return photo.src_medium;
            }
          }
        }
      }
    }

    // 2차: 같은 목적지 관광지 중 아직 안 쓴 사진
    const destParts = (pkg.destination || '').split(/[\/,\s]/).map(s => s.trim()).filter(Boolean);
    const destAttractions = attractions
      .filter(a => a.photos && a.photos.length > 0 && destParts.some(part =>
        (a.region || '').includes(part) || (a.country || '').includes(part)
      ))
      .sort((a, b) => (b.mention_count || 0) - (a.mention_count || 0));

    for (const attr of destAttractions) {
      for (const photo of (attr.photos || [])) {
        if (photo?.src_medium && !usedImageUrls.has(photo.src_medium)) {
          usedImageUrls.add(photo.src_medium);
          return photo.src_medium;
        }
      }
    }

    return null;
  }

  // 최저가 계산
  function getMinPrice(pkg: Package): number {
    if (pkg.price_dates?.length) {
      const min = getMinPriceFromDates(pkg.price_dates as any);
      if (min > 0) return min;
    }
    const tierPrices = (pkg.price_tiers || []).map(t => t.adult_price).filter(Boolean) as number[];
    const all = [pkg.price, ...tierPrices].filter(Boolean) as number[];
    return all.length > 0 ? Math.min(...all) : 0;
  }

  // 필터 + 정렬 (클라이언트 사이드)
  const filteredPackages = useMemo(() => {
    let result = packages.filter(pkg => matchesFilter(pkg, activeFilter));
    if (sortBy === 'price_asc') result = [...result].sort((a, b) => getMinPrice(a) - getMinPrice(b));
    if (sortBy === 'price_desc') result = [...result].sort((a, b) => getMinPrice(b) - getMinPrice(a));
    return result;
  }, [packages, activeFilter, sortBy]);

  return (
    <div className="min-h-screen bg-white max-w-lg mx-auto pb-24">
      {/* 헤더 */}
      <div className="sticky top-0 z-30 bg-white/95 backdrop-blur-xl border-b border-gray-100 px-4 py-3 flex items-center gap-3">
        <Link href="/" className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-gray-100">
          <span className="text-lg">←</span>
        </Link>
        <div>
          <h1 className="text-base font-bold text-gray-900">{destParam || '전체 상품'}</h1>
          <p className="text-xs text-gray-500">{filteredPackages.length}개 상품</p>
        </div>
      </div>

      {/* 필터 + 정렬 */}
      <div className="sticky top-[52px] z-20 bg-white border-b border-gray-100 px-4 py-2">
        <div className="flex gap-2 overflow-x-auto scrollbar-hide">
          <select
            aria-label="정렬 순서"
            className="flex-shrink-0 text-sm border border-gray-200 rounded-full px-3 py-1.5 bg-white text-gray-600 appearance-none"
            value={sortBy}
            onChange={e => setSortBy(e.target.value)}
          >
            {SORT_OPTIONS.map(opt => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
          {FILTER_OPTIONS.map(filter => (
            <button
              key={filter}
              className={`flex-shrink-0 text-sm px-3 py-1.5 rounded-full border transition ${
                activeFilter === filter
                  ? 'bg-[#340897] text-white border-[#340897]'
                  : 'bg-white text-gray-600 border-gray-200'
              }`}
              onClick={() => setActiveFilter(filter)}
            >
              {filter}
            </button>
          ))}
        </div>
      </div>

      {/* 상품 카드 리스트 */}
      {filteredPackages.length === 0 ? (
        <div className="text-center py-20">
          <p className="text-gray-500 text-base mb-2">{activeFilter !== '전체' ? `'${activeFilter}' 상품이 없습니다` : '상품이 없습니다'}</p>
          {activeFilter !== '전체' ? (
            <button onClick={() => setActiveFilter('전체')} className="text-violet-600 text-sm underline">전체 보기</button>
          ) : (
            <Link href="/" className="text-violet-600 text-sm underline">홈으로</Link>
          )}
        </div>
      ) : (
        <div className="px-4 py-4 space-y-3">
          {filteredPackages.map(pkg => {
            const minPrice = getMinPrice(pkg);
            const image = getProductImage(pkg);
            const airlineName = AIRLINES[pkg.airline || ''] || pkg.airline;

            return (
              <Link key={pkg.id} href={`/packages/${pkg.id}`} prefetch={true}>
                <div className="flex gap-3 py-4 border-b border-gray-100 last:border-b-0">
                  {/* 이미지 — 항공사 배지 포함 */}
                  <div className="relative flex-shrink-0 w-[110px] h-[88px] rounded-xl overflow-hidden bg-gray-100">
                    {image ? (
                      <Image src={image} alt={pkg.title} fill className="object-cover" sizes="110px" />
                    ) : (
                      <div className="w-full h-full bg-gradient-to-br from-violet-100 to-purple-200 flex items-center justify-center text-2xl">🌍</div>
                    )}
                    {airlineName && (
                      <div className="absolute bottom-1.5 left-1.5 text-xs font-semibold px-1.5 py-0.5 rounded bg-white/90 text-[#340897]">
                        {airlineName}
                      </div>
                    )}
                  </div>

                  {/* 텍스트 영역 */}
                  <div className="flex-1 min-w-0">
                    {/* 배지 행 — 상품 타입 + 에어텔 */}
                    <div className="flex gap-1 mb-1 flex-wrap">
                      {pkg.product_type && (
                        <span className={`text-xs font-semibold px-1.5 py-0.5 rounded ${
                          pkg.product_type.includes('실속') ? 'bg-orange-50 text-orange-700' :
                          pkg.product_type.includes('프리미엄') || pkg.product_type.includes('고품격') ? 'bg-purple-50 text-purple-700' :
                          pkg.product_type.includes('노팁') ? 'bg-emerald-50 text-emerald-700' :
                          'bg-violet-50 text-violet-700'
                        }`}>
                          {pkg.product_type.split('|')[0]}
                        </span>
                      )}
                      {pkg.is_airtel && (
                        <span className="text-xs font-semibold px-1.5 py-0.5 rounded bg-blue-50 text-blue-700">
                          에어텔
                        </span>
                      )}
                    </div>

                    {/* 상품명 — 2줄 클램프 */}
                    <h2 className="text-base font-semibold text-gray-900 leading-snug line-clamp-2">
                      {pkg.display_title || pkg.products?.display_name || pkg.title}
                    </h2>

                    {/* 하이라이트 태그 */}
                    {pkg.product_highlights && pkg.product_highlights.length > 0 && (
                      <div className="flex gap-1 mt-1.5 flex-wrap">
                        {pkg.product_highlights.slice(0, 3).map((tag, i) => (
                          <span key={i} className="text-xs text-gray-500 bg-gray-50 px-1.5 py-0.5 rounded">
                            {tag}
                          </span>
                        ))}
                      </div>
                    )}

                    {/* 가격 + 잔여석 */}
                    <div className="mt-2 flex items-center gap-2">
                      <div className="flex items-baseline gap-0.5">
                        {minPrice > 0 ? (
                          <>
                            <span className="text-lg font-bold text-gray-900">₩{minPrice.toLocaleString()}</span>
                            <span className="text-sm text-gray-500">~</span>
                          </>
                        ) : (
                          <span className="text-sm text-gray-500">가격 문의</span>
                        )}
                      </div>
                      {(() => {
                        const remaining = (pkg.seats_held || 0) - (pkg.seats_confirmed || 0);
                        if (pkg.seats_held && remaining === 0) {
                          return <span className="text-xs font-semibold text-gray-400 line-through">예약 마감</span>;
                        }
                        if (pkg.seats_held && remaining > 0 && remaining <= 5) {
                          return (
                            <span className="text-xs font-bold text-red-600 animate-pulse">
                              잔여 {remaining}석
                            </span>
                          );
                        }
                        return null;
                      })()}
                    </div>
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      )}

      {/* 플로팅 CTA */}
      <div className="fixed bottom-0 left-0 right-0 bg-white/95 backdrop-blur-xl z-50 border-t border-gray-100 safe-area-bottom">
        <div className="max-w-lg mx-auto px-4 pb-5 pt-3 flex items-center gap-3">
          <a href="tel:051-000-0000" className="w-12 h-12 flex items-center justify-center rounded-full border border-gray-200 hover:bg-gray-50 shrink-0">
            <span className="text-lg">📞</span>
          </a>
          <a href="https://pf.kakao.com/_xcFxkBG/chat" target="_blank" rel="noopener" referrerPolicy="no-referrer-when-downgrade"
            className="flex-1 bg-[#FEE500] h-12 rounded-full text-[#3C1E1E] font-bold text-base flex items-center justify-center gap-2 shadow-lg active:scale-[0.98] transition-all">
            💬 카카오톡 상담
          </a>
        </div>
      </div>
    </div>
  );
}
