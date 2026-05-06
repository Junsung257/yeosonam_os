'use client';

import { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { matchAttractions, normalizeDays } from '@/lib/attraction-matcher';
import type { AttractionData } from '@/lib/attraction-matcher';
import { getMinPriceFromDates } from '@/lib/price-dates';
import SearchBar from '@/components/customer/SearchBar';
import GlobalNav from '@/components/customer/GlobalNav';
import PackageCard from '@/components/customer/PackageCard';
import { REGIONS, matchesRegion, resolveLegacyFilterLabel } from '@/lib/regions';
import { pickUnusedAttractionPhotoUrl } from '@/lib/image-url';
import { getConsultTelHref } from '@/lib/consult-escalation';
import {
  type DepartureHubId,
  DEPARTURE_HUB_OPTIONS,
  DEFAULT_DEPARTURE_HUB,
  appendDepartureHubToSearchParams,
} from '@/lib/departure-hub';

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

// 필터: 전체 + REGIONS (목적지 권역). 출발 공항은 상단 출발 허브 칩으로 분리.
const REGION_FILTERS = REGIONS.filter(r => r.featuredCities.length > 0);
const FILTER_OPTIONS = ['전체', ...REGION_FILTERS.map(r => r.label)] as const;

function matchesFilter(pkg: Package, filter: string): boolean {
  const resolved = resolveLegacyFilterLabel(filter); // "마카오/홍콩" → "마카오·홍콩"
  if (resolved === '전체') return true;
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
  hub: DepartureHubId;
  q?: string;
  month?: string;
  priceMin?: string;
  priceMax?: string;
  urgency?: string;
  category?: string;
  recommendedIds?: string[];
  recommendedReasonMap?: Record<string, string[]>;
}

export default function PackagesClient({ initialPackages, initialAttractions, destination, filter, hub, q = '', month = '', priceMin = '', priceMax = '', urgency = '', category = '', recommendedIds = [], recommendedReasonMap = {} }: ClientProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const recommendedSet = useMemo(() => new Set(recommendedIds), [recommendedIds]);
  const [activeReasonId, setActiveReasonId] = useState<string | null>(null);

  const navigateWithHub = useCallback(
    (nextHub: DepartureHubId) => {
      const p = new URLSearchParams(searchParams.toString());
      appendDepartureHubToSearchParams(p, nextHub);
      p.delete('filter');
      const qs = p.toString();
      router.push(qs ? `/packages?${qs}` : '/packages');
    },
    [router, searchParams],
  );

  /** 마감특가·테마 칩 해제 시 출발 허브·검색어는 유지 */
  const hrefPackagesClearUrgencyCategory = useMemo(() => {
    const p = new URLSearchParams(searchParams.toString());
    p.delete('urgency');
    p.delete('category');
    const qs = p.toString();
    return qs ? `/packages?${qs}` : '/packages';
  }, [searchParams]);

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
  const listTopRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    listTopRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [activeFilter, sortBy]);
  const priceMinNum = priceMin ? Number(priceMin) : 0;
  const priceMaxNum = priceMax ? Number(priceMax) : 0;
  const consultTelHref = getConsultTelHref();

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
          const fromAttr = pickUnusedAttractionPhotoUrl(attr?.photos, used);
          if (fromAttr) {
            chosen = fromAttr;
            break outer;
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
          const fromDest = pickUnusedAttractionPhotoUrl(attr.photos, used);
          if (fromDest) {
            chosen = fromDest;
            break outer2;
          }
        }
      }
      // 3차: 상품 자체 thumbnail_urls (attraction 사진 전혀 없을 때)
      if (!chosen) {
        const thumb = pkg.thumbnail_urls?.find(u => u && u.startsWith('http'));
        if (thumb) chosen = thumb;
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

  // 출발월 매칭: price_dates 또는 price_tiers.departure_dates에 해당 YYYY-MM 시작 날짜가 있는지 (콤마로 여러 월)
  function matchesSingleMonth(pkg: Package, ym: string): boolean {
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
  function matchesMonth(pkg: Package, monthParam: string): boolean {
    if (!monthParam) return true;
    const yms = monthParam.split(',').map(s => s.trim()).filter(Boolean);
    if (yms.length === 0) return true;
    return yms.some(ym => matchesSingleMonth(pkg, ym));
  }

  // 필터 + 정렬 (클라이언트 사이드) — minPrice는 사전 계산된 맵에서 조회
  const filteredPackages = useMemo(() => {
    const mp = (pkg: Package) => minPriceByPkgId.get(pkg.id) ?? 0;
    let result = packages.filter(pkg => matchesFilter(pkg, activeFilter));
    if (month) result = result.filter(pkg => matchesMonth(pkg, month));
    if (priceMinNum > 0 || priceMaxNum > 0) {
      result = result.filter(pkg => {
        const v = mp(pkg);
        if (v <= 0) return false;
        if (priceMinNum > 0 && v < priceMinNum) return false;
        if (priceMaxNum > 0 && v > priceMaxNum) return false;
        return true;
      });
    }
    if (sortBy === 'price_asc') result = [...result].sort((a, b) => mp(a) - mp(b));
    if (sortBy === 'price_desc') result = [...result].sort((a, b) => mp(b) - mp(a));
    return result;
  }, [packages, activeFilter, sortBy, month, priceMinNum, priceMaxNum, minPriceByPkgId]);

  return (
    <div className="min-h-screen bg-white w-full overflow-x-hidden max-w-lg md:max-w-none mx-auto pb-24 md:pb-16">
      <GlobalNav />

      {/* 통합 헤더 — 타이틀 + 출발 허브 + 검색 폼을 하나의 파란 존으로 */}
      <div className="bg-gradient-to-b from-brand-light to-[#F5F9FF] border-b border-blue-200/50">
        <div className="px-4 pt-5 pb-4 w-full max-w-full min-w-0 md:max-w-7xl md:mx-auto md:px-8 md:pt-8 md:pb-6">
          {/* 페이지 타이틀 */}
          <div className="mb-4">
            <h1 className="text-h1 md:text-3xl lg:text-4xl font-bold text-text-primary tracking-[-0.03em]">
              {destParam || '전체 상품'}
            </h1>
            <p className="text-[13px] text-text-body mt-1">{filteredPackages.length}개 상품</p>
          </div>

          {/* 출발 허브 — 가로 스크롤 pill 행 */}
          <div className="flex gap-2 overflow-x-auto pb-1 no-scrollbar mb-3 -mx-4 px-4 md:mx-0 md:px-0">
            {DEPARTURE_HUB_OPTIONS.map(({ id, label }) => {
              const isSelected =
                id === 'all'
                  ? hub === 'all'
                  : id === DEFAULT_DEPARTURE_HUB
                    ? hub === DEFAULT_DEPARTURE_HUB
                    : hub === id;
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => navigateWithHub(id)}
                  className={`shrink-0 h-[34px] px-4 text-[13px] font-semibold rounded-full border transition-all card-touch ${
                    isSelected
                      ? 'bg-brand text-white border-brand shadow-sm'
                      : 'bg-white text-text-body border-[#D1DCE8] hover:border-brand/60 hover:text-brand'
                  }`}
                >
                  {label}
                </button>
              );
            })}
          </div>

          {/* 검색 폼 */}
          <SearchBar
            variant="packages"
            initialQ={q}
            initialMonth={month}
            initialPriceMin={priceMin}
            initialPriceMax={priceMax}
            initialDestination={destination}
            hub={hub}
            urgency={urgency}
            category={category}
          />
        </div>
      </div>

      {/* 마감특가 / 카테고리 활성 배지 */}
      {(urgency === '1' || category) && (
        <div className="px-4 pt-3 md:max-w-7xl md:mx-auto md:px-8">
          <div className="flex items-center gap-2">
            {urgency === '1' && (
              <span className="inline-flex items-center gap-1.5 bg-danger-light text-danger text-[13px] font-semibold px-3 py-1.5 rounded-full">
                🔥 마감특가 모아보기
              </span>
            )}
            {category && CATEGORY_LABELS[category] && (
              <span className="inline-flex items-center gap-1.5 bg-brand-light text-brand text-[13px] font-semibold px-3 py-1.5 rounded-full">
                {CATEGORY_LABELS[category]}
              </span>
            )}
            <Link href={hrefPackagesClearUrgencyCategory} className="text-micro text-text-secondary hover:text-brand transition ml-1">
              전체 보기 →
            </Link>
          </div>
        </div>
      )}

      {/* 정렬 + 목적지 권역 — flat chip row (중첩 카드 제거) */}
      <div className="sticky top-14 md:top-16 z-20 border-b border-[#EEF2F6] bg-white/95 backdrop-blur-md supports-[backdrop-filter]:bg-white/80">
        <div className="max-w-7xl mx-auto px-4 py-2.5 md:px-8 w-full max-w-full min-w-0">
          <div className="flex items-center gap-2.5 overflow-x-auto no-scrollbar">
            <div className="relative shrink-0">
              <select
                aria-label="정렬 순서"
                className="h-[34px] text-[13px] border border-[#E5E7EB] rounded-full pl-3 pr-7 bg-white text-text-primary appearance-none cursor-pointer font-medium"
                value={sortBy}
                onChange={e => setSortBy(e.target.value)}
                style={{
                  backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='10' viewBox='0 0 12 12'%3E%3Cpath fill='%238B95A1' d='M2 4l4 4 4-4'/%3E%3C/svg%3E")`,
                  backgroundRepeat: 'no-repeat',
                  backgroundPosition: 'right 10px center',
                }}
              >
                {SORT_OPTIONS.map(opt => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            </div>
            <div className="w-px h-4 bg-[#E5E7EB] shrink-0" />
            {FILTER_OPTIONS.map(f => (
              <button
                key={f}
                type="button"
                className={`shrink-0 h-[34px] px-3.5 text-[13px] font-medium rounded-full border transition card-touch ${
                  activeFilter === f
                    ? 'bg-brand text-white border-brand shadow-sm'
                    : 'bg-white text-text-body border-[#E5E7EB] hover:border-brand/40 hover:text-brand'
                }`}
                onClick={() => setActiveFilter(f)}
              >
                {f}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* 상품 카드 리스트 */}
      <div ref={listTopRef} />
      {filteredPackages.length === 0 ? (
        <div className="text-center py-20 px-6">
          {urgency === '1' ? (
            <>
              <p className="text-[32px] mb-3">🔥</p>
              <p className="text-text-primary font-bold text-[17px] mb-1">현재 마감특가 상품이 모두 매진되었습니다</p>
              <p className="text-text-secondary text-body mb-6">아래 인기 패키지를 확인해 보세요</p>
              <Link href={hrefPackagesClearUrgencyCategory} className="inline-block bg-brand text-white font-semibold text-body px-6 py-3 rounded-full hover:bg-[#1B64DA] transition">
                전체 인기 패키지 보기
              </Link>
            </>
          ) : (
            <div className="flex flex-col items-center gap-4 py-16 px-6">
              <svg className="w-14 h-14 text-slate-200" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 15.803 7.5 7.5 0 0016.803 15.803z" />
              </svg>
              <div className="text-center space-y-1">
                <p className="text-[15px] font-semibold text-text-primary">
                  {activeFilter !== '전체' ? `'${activeFilter}' 상품이 없습니다` : '조건에 맞는 상품이 없습니다'}
                </p>
                <p className="text-[13px] text-text-secondary">필터를 초기화하거나 직접 문의해 보세요</p>
              </div>
              <div className="flex items-center gap-2 mt-1">
                {activeFilter !== '전체' && (
                  <button
                    onClick={() => setActiveFilter('전체')}
                    className="px-4 py-2 text-[13px] font-medium text-brand bg-brand-light rounded-full hover:bg-blue-100 transition"
                  >
                    전체 보기
                  </button>
                )}
                {consultTelHref && (
                  <a
                    href={consultTelHref}
                    className="px-4 py-2 text-[13px] font-medium text-white bg-brand rounded-full hover:bg-brand-dark transition"
                  >
                    📞 직접 문의
                  </a>
                )}
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className="px-4 py-4 space-y-3 w-full max-w-full min-w-0 md:max-w-7xl md:mx-auto md:px-8 md:py-6 md:space-y-0 md:grid md:grid-cols-2 lg:grid-cols-3 md:gap-6">
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

      {/* 플로팅 CTA — 모바일 전용 (전화는 NEXT_PUBLIC_CONSULT_PHONE 있을 때만) */}
      <div className="md:hidden fixed bottom-0 left-0 right-0 bg-white/95 backdrop-blur-xl z-50 border-t border-gray-100 safe-area-bottom">
        <div className="max-w-lg mx-auto px-4 pb-5 pt-3 flex items-center gap-3">
          {consultTelHref ? (
            <a
              href={consultTelHref}
              className="w-12 h-12 flex items-center justify-center rounded-full border border-gray-200 hover:bg-gray-50 shrink-0"
            >
              <span className="text-lg">📞</span>
            </a>
          ) : null}
          <a href="https://pf.kakao.com/_xcFxkBG/chat" target="_blank" rel="noopener" referrerPolicy="no-referrer-when-downgrade"
            className="flex-1 bg-[#FEE500] h-12 rounded-full text-[#3C1E1E] font-bold text-base flex items-center justify-center gap-2 shadow-lg active:scale-[0.98] transition-all">
            💬 카카오톡 상담
          </a>
        </div>
      </div>
    </div>
  );
}
