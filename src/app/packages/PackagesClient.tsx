'use client';

import { useState, useMemo } from 'react';
import Link from 'next/link';
import { matchAttractions, normalizeDays } from '@/lib/attraction-matcher';
import type { AttractionData } from '@/lib/attraction-matcher';
import { getMinPriceFromDates } from '@/lib/price-dates';
import SearchBar from '@/components/customer/SearchBar';
import GlobalNav from '@/components/customer/GlobalNav';
import PackageCard from '@/components/customer/PackageCard';
import { REGIONS, matchesRegion, resolveLegacyFilterLabel } from '@/lib/regions';

interface Package {
  id: string;
  title: string;
  destination?: string;
  country?: string | null;
  duration?: number;
  nights?: number | null;
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
  hero_tagline?: string | null;
  hero_image_url?: string | null;
  thumbnail_urls?: string[] | null;
  avg_rating?: number | null;
  review_count?: number | null;
  products?: { display_name?: string; internal_code?: string };
  seats_held?: number;
  seats_confirmed?: number;
}

interface AttractionInfo {
  name: string; photos?: { src_medium: string; src_large: string }[];
  country?: string; region?: string; mention_count?: number;
}

// 항공사 매핑 SSOT: getAirlineName() in @/lib/render-contract (CRC). 인라인 dict 제거.
// 지역 매칭 SSOT: REGIONS in @/lib/regions. 인라인 정규식 제거.

const SORT_OPTIONS = [
  { label: '추천순', value: 'recommended' },
  { label: '가격 낮은순', value: 'price_asc' },
  { label: '가격 높은순', value: 'price_desc' },
] as const;

// 필터: 전체 + REGIONS (featuredCities 가 있는 region 만 — 즉 실제 패키지가 있는 곳) + 인천출발
const REGION_FILTERS = REGIONS.filter(r => r.featuredCities.length > 0);
const FILTER_OPTIONS = ['전체', ...REGION_FILTERS.map(r => r.label), '인천출발'] as const;

function matchesFilter(pkg: Package, filter: string): boolean {
  const resolved = resolveLegacyFilterLabel(filter); // "마카오/홍콩" → "마카오·홍콩"
  if (resolved === '전체') return true;
  if (resolved === '인천출발') return /인천/.test(pkg.departure_airport || '');
  const region = REGION_FILTERS.find(r => r.label === resolved);
  if (region) return matchesRegion(pkg as { country?: string | null; destination?: string | null }, region.slug);
  return false;
}

const CATEGORY_LABELS: Record<string, string> = {
  honeymoon: '💍 허니문',
  golf: '⛳ 해외골프',
  cruise: '🚢 크루즈',
  theme: '🎯 테마여행',
};

interface ClientProps {
  initialPackages: Package[];
  initialAttractions: AttractionInfo[];
  destination: string;
  filter: string;
  q?: string;
  month?: string;
  priceMax?: string;
  urgency?: string;
  category?: string;
  recommendedIds?: string[];
  recommendedReasonMap?: Record<string, string[]>;
}

export default function PackagesClient({ initialPackages, initialAttractions, destination, filter, q = '', month = '', priceMax = '', urgency = '', category = '', recommendedIds = [], recommendedReasonMap = {} }: ClientProps) {
  const recommendedSet = useMemo(() => new Set(recommendedIds), [recommendedIds]);
  const [activeReasonId, setActiveReasonId] = useState<string | null>(null);

  // 클릭 시그널 (LTR 학습 데이터) — silent fail
  const trackClick = (packageId: string) => {
    try {
      fetch('/api/tracking/score-signal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          package_id: packageId,
          signal_type: 'click',
        }),
        keepalive: true,
      }).catch(() => { /* silent */ });
    } catch { /* silent */ }
  };
  const destParam = destination || q;
  const packages = initialPackages;
  const attractions = initialAttractions;
  const [activeFilter, setActiveFilter] = useState(resolveLegacyFilterLabel(filter || '전체'));
  const [sortBy, setSortBy] = useState('recommended');
  const priceMaxNum = priceMax ? Number(priceMax) : 0;

  // 최저가 계산 (순수 함수 — useMemo 의존성 안에서만 호출)
  function getMinPrice(pkg: Package): number {
    if (pkg.price_dates?.length) {
      const min = getMinPriceFromDates(pkg.price_dates as any);
      if (min > 0) return min;
    }
    const tierPrices = (pkg.price_tiers || []).map(t => t.adult_price).filter(Boolean) as number[];
    const all = [pkg.price, ...tierPrices].filter(Boolean) as number[];
    return all.length > 0 ? Math.min(...all) : 0;
  }

  // 상품별 대표 이미지 + 최저가를 packages/attractions 변경 시 1회만 계산.
  // 이전 구현은 렌더 중 Set 변이 + 매 렌더마다 matchAttractions() 호출 → 순서 의존 + 비용 N배.
  const imageByPkgId = useMemo(() => {
    const used = new Set<string>();
    const map = new Map<string, string | null>();
    for (const pkg of packages) {
      let chosen: string | null = null;
      // 1차: itinerary 관광지 매칭
      const days = normalizeDays<{ day: number; schedule?: { activity: string; type?: string }[] }>(pkg.itinerary_data);
      outer: for (const day of days) {
        for (const item of (day.schedule || [])) {
          if (item.type === 'flight' || item.type === 'hotel' || item.type === 'shopping') continue;
          if (/공항|출발|도착|이동|수속|탑승|귀환|체크인|체크아웃|투숙|휴식|미팅|조식|중식|석식/.test(item.activity)) continue;
          const attr = matchAttractions(item.activity, attractions as AttractionData[], pkg.destination)[0] || null;
          if (attr?.photos?.length) {
            for (const photo of attr.photos) {
              if (photo?.src_medium && !used.has(photo.src_medium)) {
                used.add(photo.src_medium);
                chosen = photo.src_medium;
                break outer;
              }
            }
          }
        }
      }
      // 2차: 목적지 폴백
      if (!chosen) {
        const destParts = (pkg.destination || '').split(/[\/,\s]/).map(s => s.trim()).filter(Boolean);
        const destAttractions = attractions
          .filter(a => a.photos && a.photos.length > 0 && destParts.some(part =>
            (a.region || '').includes(part) || (a.country || '').includes(part)
          ))
          .sort((a, b) => (b.mention_count || 0) - (a.mention_count || 0));
        outer2: for (const attr of destAttractions) {
          for (const photo of (attr.photos || [])) {
            if (photo?.src_medium && !used.has(photo.src_medium)) {
              used.add(photo.src_medium);
              chosen = photo.src_medium;
              break outer2;
            }
          }
        }
      }
      map.set(pkg.id, chosen);
    }
    return map;
  }, [packages, attractions]);

  const minPriceByPkgId = useMemo(() => {
    const map = new Map<string, number>();
    for (const pkg of packages) map.set(pkg.id, getMinPrice(pkg));
    return map;
  }, [packages]);

  // 출발월 매칭: price_dates 또는 price_tiers.departure_dates에 해당 YYYY-MM 시작 날짜가 있는지
  function matchesMonth(pkg: Package, ym: string): boolean {
    if (!ym) return true;
    if (pkg.price_dates?.length) {
      if (pkg.price_dates.some(d => typeof d.date === 'string' && d.date.startsWith(ym))) return true;
    }
    if (pkg.price_tiers?.length) {
      for (const t of pkg.price_tiers) {
        if (t.departure_dates?.some(d => typeof d === 'string' && d.startsWith(ym))) return true;
      }
    }
    return false;
  }

  // 필터 + 정렬 (클라이언트 사이드) — minPrice는 사전 계산된 맵에서 조회
  const filteredPackages = useMemo(() => {
    const mp = (pkg: Package) => minPriceByPkgId.get(pkg.id) ?? 0;
    let result = packages.filter(pkg => matchesFilter(pkg, activeFilter));
    if (month) result = result.filter(pkg => matchesMonth(pkg, month));
    if (priceMaxNum > 0) result = result.filter(pkg => {
      const v = mp(pkg);
      return v > 0 && v <= priceMaxNum;
    });
    if (sortBy === 'price_asc') result = [...result].sort((a, b) => mp(a) - mp(b));
    if (sortBy === 'price_desc') result = [...result].sort((a, b) => mp(b) - mp(a));
    return result;
  }, [packages, activeFilter, sortBy, month, priceMaxNum, minPriceByPkgId]);

  return (
    <div className="min-h-screen bg-white max-w-lg md:max-w-none mx-auto pb-24 md:pb-16">
      <GlobalNav />

      {/* 모바일 페이지 타이틀 */}
      <div className="md:hidden bg-white border-b border-gray-100 px-4 py-4">
        <h1 className="text-2xl font-black text-gray-900 tracking-tight">{destParam || '전체 상품'}</h1>
        <p className="text-sm text-gray-500 mt-0.5">{filteredPackages.length}개 상품</p>
      </div>

      {/* 데스크톱 페이지 타이틀 */}
      <div className="hidden md:block md:max-w-7xl md:mx-auto md:px-8 md:pt-12 md:pb-3">
        <h1 className="text-4xl lg:text-5xl font-black text-gray-900 tracking-tight">{destParam || '전체 상품'}</h1>
        <p className="text-base text-gray-500 mt-2">{filteredPackages.length}개 상품</p>
      </div>

      {/* 검색바 */}
      <div className="px-4 pt-3 md:max-w-7xl md:mx-auto md:px-8 md:pt-6">
        <SearchBar initialQ={q} initialMonth={month} initialPriceMax={priceMax} initialDestination={destination} />
      </div>

      {/* 마감특가 / 카테고리 활성 배지 */}
      {(urgency === '1' || category) && (
        <div className="px-4 pt-3 md:max-w-7xl md:mx-auto md:px-8">
          <div className="flex items-center gap-2">
            {urgency === '1' && (
              <span className="inline-flex items-center gap-1.5 bg-[#FFF1F2] text-[#F04452] text-[13px] font-semibold px-3 py-1.5 rounded-full">
                🔥 마감특가 모아보기
              </span>
            )}
            {category && CATEGORY_LABELS[category] && (
              <span className="inline-flex items-center gap-1.5 bg-[#EBF3FE] text-[#3182F6] text-[13px] font-semibold px-3 py-1.5 rounded-full">
                {CATEGORY_LABELS[category]}
              </span>
            )}
            <Link href="/packages" className="text-[12px] text-[#8B95A1] hover:text-[#3182F6] transition ml-1">
              전체 보기 →
            </Link>
          </div>
        </div>
      )}

      {/* 필터 + 정렬 */}
      <div className="sticky top-14 md:top-16 z-20 bg-white border-b border-gray-100 px-4 py-2 md:max-w-7xl md:mx-auto md:px-8 md:py-4 md:bg-transparent md:border-b-0">
        <div className="flex gap-2 overflow-x-auto scrollbar-hide md:flex-wrap md:gap-3">
          <select
            aria-label="정렬 순서"
            className="flex-shrink-0 text-sm border border-gray-200 rounded-full px-3 py-1.5 md:px-4 md:py-2 bg-white text-gray-600 appearance-none"
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
              className={`flex-shrink-0 text-sm md:px-4 md:py-2 px-3 py-1.5 rounded-full border transition ${
                activeFilter === filter
                  ? 'bg-[#3182F6] text-white border-[#3182F6]'
                  : 'bg-white text-gray-600 border-gray-200 hover:shadow-card-hover'
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
        <div className="text-center py-20 px-6">
          {urgency === '1' ? (
            <>
              <p className="text-[32px] mb-3">🔥</p>
              <p className="text-[#191F28] font-bold text-[17px] mb-1">현재 마감특가 상품이 모두 매진되었습니다</p>
              <p className="text-[#8B95A1] text-[14px] mb-6">아래 인기 패키지를 확인해 보세요</p>
              <Link href="/packages" className="inline-block bg-[#3182F6] text-white font-semibold text-[14px] px-6 py-3 rounded-full hover:bg-[#1B64DA] transition">
                전체 인기 패키지 보기
              </Link>
            </>
          ) : (
            <>
              <p className="text-gray-500 text-base mb-2">{activeFilter !== '전체' ? `'${activeFilter}' 상품이 없습니다` : '상품이 없습니다'}</p>
              {activeFilter !== '전체' ? (
                <button onClick={() => setActiveFilter('전체')} className="text-[#3182F6] text-sm underline">전체 보기</button>
              ) : (
                <Link href="/" className="text-[#3182F6] text-sm underline">홈으로</Link>
              )}
            </>
          )}
        </div>
      ) : (
        <div className="px-4 py-4 space-y-3 md:max-w-7xl md:mx-auto md:px-8 md:py-6 md:space-y-0 md:grid md:grid-cols-2 lg:grid-cols-3 md:gap-6">
          {filteredPackages.map(pkg => (
            <PackageCard
              key={pkg.id}
              pkg={pkg as any}
              variant="horizontal"
              image={imageByPkgId.get(pkg.id) ?? null}
              precomputedMinPrice={minPriceByPkgId.get(pkg.id) ?? 0}
              isRecommended={recommendedSet.has(pkg.id)}
              recommendedReasons={recommendedReasonMap[pkg.id] ?? []}
              isReasonOpen={activeReasonId === pkg.id}
              onToggleReason={(id) => setActiveReasonId(activeReasonId === id ? null : id)}
              onClick={trackClick}
            />
          ))}
        </div>
      )}

      {/* 플로팅 CTA — 모바일 전용 */}
      <div className="md:hidden fixed bottom-0 left-0 right-0 bg-white/95 backdrop-blur-xl z-50 border-t border-gray-100 safe-area-bottom">
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
