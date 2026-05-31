'use client';

import { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import useSWR from 'swr';
import { getMinPriceFromDates } from '@/lib/price-dates';
import SearchBar from '@/components/customer/SearchBar';
import GlobalNav from '@/components/customer/GlobalNav';
import PackageCard from '@/components/customer/PackageCard';
import { REGIONS, matchesRegion, resolveLegacyFilterLabel } from '@/lib/regions';
import { getConsultTelHref } from '@/lib/consult-escalation';
import { getSessionId } from '@/lib/tracker';
import {
  type DepartureHubId,
  DEPARTURE_HUB_OPTIONS,
  DEFAULT_DEPARTURE_HUB,
  appendDepartureHubToSearchParams,
  normalizeDepartureHub,
} from '@/lib/departure-hub';
import Loading from './loading';

const swrFetcher = (url: string) => fetch(url).then((r) => r.json());
const INITIAL_VISIBLE_COUNT = 18;
const VISIBLE_STEP = 18;
const consultTelHref = getConsultTelHref();

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
  catalog_id?: string | null;
}

const SORT_OPTIONS = [
  { label: '추천순', value: 'recommended' },
  { label: '가격 낮은순', value: 'price_asc' },
  { label: '가격 높은순', value: 'price_desc' },
] as const;

const REGION_FILTERS = REGIONS.filter(r => r.featuredCities.length > 0);
const FILTER_OPTIONS = ['전체', ...REGION_FILTERS.map(r => r.label)] as const;

const INTENT_OPTIONS = [
  { id: 'family', label: '부모님/가족', hint: '이동·호텔·쇼핑 부담을 먼저 볼게요' },
  { id: 'budget', label: '최저가', hint: '가격이 낮은 상품부터 볼게요' },
  { id: 'no_shopping', label: '쇼핑 없는 상품', hint: '노쇼핑·부담 적은 조건을 먼저 볼게요' },
  { id: 'consult', label: '상담원이 골라줘요', hint: '조건을 확인하고 상담으로 이어갈게요' },
] as const;

type IntentId = typeof INTENT_OPTIONS[number]['id'];

function matchesFilter(pkg: Package, filter: string): boolean {
  const resolved = resolveLegacyFilterLabel(filter);
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

interface SearchResponse {
  packages: Package[];
  imageByPkgId: Record<string, string | null>;
  recommendedIds: string[];
  recommendedReasonMap: Record<string, string[]>;
  scoreByPkgId?: Record<string, {
    label: string;
    reasons: string[];
    comparisonSummary: string;
    hotelGradeLabel: string | null;
    groupSize: number;
    rankInGroup: number | null;
    effectivePrice: number | null;
    listPrice: number | null;
    hasComparison: boolean;
  } | null>;
  scoreReasonMap?: Record<string, string[]>;
  rankByPkgId?: Record<string, number>;
  comparisonGroupSizeMap?: Record<string, number>;
  hub: DepartureHubId;
  filterForClient: string;
}

function packageMinPrice(pkg: Package): number {
  const dates = (pkg.price_dates || []) as Array<{ date: string; price: number }>;
  const valid = dates.filter(d => d?.price && d.price > 0);
  if (valid.length > 0) return Math.min(...valid.map(d => d.price));
  return pkg.price && pkg.price > 0 ? pkg.price : Number.POSITIVE_INFINITY;
}

function packageIntentScore(pkg: Package, intent: IntentId | null): number {
  if (!intent || intent === 'consult') return 0;
  const haystack = [
    pkg.title,
    pkg.display_title,
    pkg.hero_tagline,
    pkg.product_type,
    ...(pkg.product_highlights ?? []),
    ...(pkg.product_tags ?? []),
  ].filter(Boolean).join(' ');
  if (intent === 'no_shopping') {
    return /노쇼핑|쇼핑\s*(없|無|무)|쇼핑\s*0/i.test(haystack) ? 10 : 0;
  }
  if (intent === 'family') {
    let score = 0;
    if (/부모|가족|효도|시니어|어르신|편안|여유/i.test(haystack)) score += 5;
    if (/노쇼핑|노팁|노옵션|직항|5성|특급|프리미엄|고품격/i.test(haystack)) score += 2;
    return score;
  }
  return 0;
}

const EMPTY_PACKAGES: Package[] = [];
const EMPTY_IMAGE_BY_PKG_ID: Record<string, string | null> = {};
const EMPTY_RECOMMENDED_IDS: string[] = [];
const EMPTY_RECOMMENDED_REASON_MAP: Record<string, string[]> = {};
const EMPTY_SCORE_BY_PKG_ID: NonNullable<SearchResponse['scoreByPkgId']> = {};

export default function PackagesClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [activeReasonId, setActiveReasonId] = useState<string | null>(null);
  const [selectedIntent, setSelectedIntent] = useState<IntentId | null>(null);
  const trackedRecommendViewsRef = useRef<Set<string>>(new Set());

  const destination = searchParams.get('destination') || '';
  const rawFilter = searchParams.get('filter') || '';
  const q = searchParams.get('q')?.trim() || '';
  const month = searchParams.get('month') || '';
  const priceMin = searchParams.get('priceMin') || '';
  const priceMax = searchParams.get('priceMax') || '';
  const urgency = searchParams.get('urgency') || '';
  const category = searchParams.get('category') || '';

  let hubFromParam = normalizeDepartureHub(searchParams.get('hub'));
  if (rawFilter === '인천출발' && !searchParams.get('hub')) hubFromParam = 'incheon';
  const filterForClientInitial = rawFilter === '인천출발' ? '' : rawFilter;

  const apiQuery = searchParams.toString();
  const { data, isLoading } = useSWR<SearchResponse>(
    `/api/packages/search?${apiQuery}`,
    swrFetcher,
    { revalidateOnFocus: false, dedupingInterval: 60_000 },
  );

  const initialPackages = data?.packages ?? EMPTY_PACKAGES;
  const imageByPkgIdProp = data?.imageByPkgId ?? EMPTY_IMAGE_BY_PKG_ID;
  const recommendedIds = data?.recommendedIds ?? EMPTY_RECOMMENDED_IDS;
  const recommendedReasonMap = data?.recommendedReasonMap ?? EMPTY_RECOMMENDED_REASON_MAP;
  const scoreByPkgId = data?.scoreByPkgId ?? EMPTY_SCORE_BY_PKG_ID;
  const hub = data?.hub ?? hubFromParam;
  const filter = data?.filterForClient ?? filterForClientInitial;
  const recommendedSet = useMemo(() => new Set(recommendedIds), [recommendedIds]);
  const selectedIntentInfo = INTENT_OPTIONS.find(opt => opt.id === selectedIntent) ?? null;

  const [compareIds, setCompareIds] = useState<string[]>([]);
  const [compareOpen, setCompareOpen] = useState(false);

  const toggleCompare = useCallback((id: string) => {
    setCompareIds(prev => {
      if (prev.includes(id)) return prev.filter(x => x !== id);
      if (prev.length >= 2) return [prev[1], id];
      return [...prev, id];
    });
  }, []);

  const clearCompare = useCallback(() => {
    setCompareIds([]);
    setCompareOpen(false);
  }, []);

  const comparePackages = useMemo(
    () => compareIds.map(id => initialPackages.find(p => p.id === id)).filter(Boolean),
    [compareIds, initialPackages],
  );

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

  const hrefPackagesClearUrgencyCategory = useMemo(() => {
    const p = new URLSearchParams(searchParams.toString());
    p.delete('urgency');
    p.delete('category');
    const qs = p.toString();
    return qs ? `/packages?${qs}` : '/packages';
  }, [searchParams]);

  // ── 정렬 + 필터 ─────────────────────────────────────────────
  const [activeFilter, setActiveFilter] = useState('전체');
  const [sortBy, setSortBy] = useState('recommended');

  useEffect(() => {
    setActiveFilter(filter || '전체');
  }, [filter]);

  const trackScoreSignal = useCallback((input: {
    packageId?: string;
    signalType: 'recommend_badge_view' | 'recommend_reason_open' | 'comparison_open' | 'intent_chip_select' | 'lead_sheet_open';
    groupKey?: string;
    rank?: number | null;
    score?: number | null;
    intent?: IntentId | null;
  }) => {
    const packageId = input.packageId ?? recommendedIds[0] ?? initialPackages[0]?.id;
    if (!packageId) return;
    const intentKey = input.intent ?? selectedIntent;
    fetch('/api/tracking/score-signal', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        package_id: packageId,
        signal_type: input.signalType,
        group_key: input.groupKey ?? (intentKey ? `intent:${intentKey}` : null),
        rank: input.rank ?? null,
        score: input.score ?? null,
        session_id: getSessionId(),
      }),
    }).catch(() => {});
  }, [initialPackages, recommendedIds, selectedIntent]);

  const handleIntentSelect = useCallback((intent: IntentId) => {
    const nextIntent = selectedIntent === intent ? null : intent;
    setSelectedIntent(nextIntent);
    trackScoreSignal({
      signalType: 'intent_chip_select',
      groupKey: `intent:${intent}:${nextIntent ? 'on' : 'off'}`,
      intent: nextIntent ?? intent,
    });
    if (intent === 'budget') setSortBy('price_asc');
    if (selectedIntent === 'budget' && intent === 'budget') setSortBy('recommended');
    if (intent === 'consult') {
      window.open('https://pf.kakao.com/_xcFxkBG/chat', '_blank', 'noopener,noreferrer');
    }
  }, [selectedIntent, trackScoreSignal]);

  const filteredPackages = useMemo(() => {
    let list = [...initialPackages];
    if (activeFilter !== '전체') list = list.filter(p => matchesFilter(p, activeFilter));
    const today = new Date().toISOString().slice(0, 10);
    if (urgency === '1') list = list.filter(p => {
      if (p.product_type === 'urgency') return true;
      const pd = (p.price_dates || []) as Array<{ date?: string }>;
      return pd.some(d => d?.date && d.date >= today);
    });
    if (category) list = list.filter(p => p.product_type?.includes(category) || p.product_tags?.includes(category));
    const sortFn = sortBy === 'price_asc' ? (a: Package, b: Package) => packageMinPrice(a) - packageMinPrice(b)
      : sortBy === 'price_desc' ? (a: Package, b: Package) => packageMinPrice(b) - packageMinPrice(a)
      : (a: Package, b: Package) => {
        const intentDiff = packageIntentScore(b, selectedIntent) - packageIntentScore(a, selectedIntent);
        if (intentDiff !== 0) return intentDiff;
        const aRec = recommendedSet.has(a.id);
        const bRec = recommendedSet.has(b.id);
        if (aRec && !bRec) return -1;
        if (!aRec && bRec) return 1;
        return 0;
      };
    list.sort(sortFn);
    return list;
  }, [initialPackages, activeFilter, sortBy, urgency, category, recommendedSet, selectedIntent]);

  const [visibleCount, setVisibleCount] = useState(INITIAL_VISIBLE_COUNT);
  useEffect(() => { setVisibleCount(INITIAL_VISIBLE_COUNT); }, [apiQuery]);
  const visiblePackages = useMemo(() => filteredPackages.slice(0, visibleCount), [filteredPackages, visibleCount]);

  useEffect(() => {
    for (const pkg of visiblePackages) {
      const score = scoreByPkgId[pkg.id];
      if (!score?.hasComparison || trackedRecommendViewsRef.current.has(pkg.id)) continue;
      trackedRecommendViewsRef.current.add(pkg.id);
      trackScoreSignal({
        packageId: pkg.id,
        signalType: 'recommend_badge_view',
        groupKey: selectedIntent ? `intent:${selectedIntent}` : undefined,
        rank: score.rankInGroup,
      });
    }
  }, [scoreByPkgId, selectedIntent, trackScoreSignal, visiblePackages]);

  const minPriceByPkgId = useMemo(() => {
    const map = new Map<string, number>();
    for (const p of initialPackages) {
      const dates = (p.price_dates || []) as Array<{ date: string; price: number }>;
      if (dates.length > 0) {
        const valid = dates.filter(d => d?.price && d.price > 0);
        if (valid.length > 0) { map.set(p.id, Math.min(...valid.map(d => d.price))); continue; }
      }
      if (p.price && p.price > 0) map.set(p.id, p.price);
    }
    return map;
  }, [initialPackages]);

  const catalogGroupSizeMap = useMemo(() => {
    const map = new Map<string, number>();
    for (const p of initialPackages) {
      if (!p.catalog_id) continue;
      map.set(p.catalog_id, (map.get(p.catalog_id) || 0) + 1);
    }
    return map;
  }, [initialPackages]);

  const trackClick = useCallback((id: string) => {
    fetch('/api/tracking/click', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ package_id: id, source: 'list' }),
    }).catch(() => {});
  }, []);

  const listTopRef = useRef<HTMLDivElement>(null);
  if (isLoading) return <Loading />;

  return (
    <div className="min-h-screen bg-white">
      <GlobalNav />
      <h1 className="sr-only">여소남 패키지 여행 상품</h1>
      <a href={consultTelHref || '/group-inquiry'} className="sr-only">
        여행 상품 문의
      </a>

      <div className="md:border-b md:border-[#F2F4F6]">
        <div className="max-w-7xl mx-auto px-4 md:px-8 pt-4 md:pt-6 pb-[5px] md:pb-0">
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

      {isLoading && <Loading />}

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

      <div className="px-4 pt-3 pb-1 md:max-w-7xl md:mx-auto md:px-8">
        <p className="mb-2 text-[13px] font-bold text-text-primary">어떤 여행을 찾고 계세요?</p>
        <p className="mb-2 text-[12px] font-medium text-text-secondary">
          하나만 눌러도 상품 순서가 바로 바뀌어요. 그냥 둘러봐도 괜찮아요.
        </p>
        <div className="flex gap-2 overflow-x-auto no-scrollbar pb-1">
          {INTENT_OPTIONS.map(opt => (
            <button
              key={opt.id}
              type="button"
              onClick={() => handleIntentSelect(opt.id)}
              className={`shrink-0 h-10 rounded-full border px-3.5 text-[13px] font-bold transition ${
                selectedIntent === opt.id
                  ? 'border-brand bg-brand text-white shadow-sm'
                  : 'border-[#DCE5F0] bg-white text-text-body hover:border-brand/60 hover:text-brand'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
        {selectedIntentInfo && (
          <p className="mt-1.5 text-[12px] font-medium text-text-secondary">
            {selectedIntentInfo.hint}
          </p>
        )}
      </div>

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
          {visiblePackages.map(pkg => {
            const score = scoreByPkgId[pkg.id] ?? null;
            const rankBadge =
              score?.hasComparison && score.rankInGroup != null && score.rankInGroup <= 3
                ? `비교 ${score.rankInGroup}위`
                : undefined;
            return (
            <div key={pkg.id} className="relative">
              <button
                type="button"
                onClick={(e) => { e.preventDefault(); toggleCompare(pkg.id); }}
                className={`absolute top-2 right-2 z-10 w-8 h-8 flex items-center justify-center rounded-full border-2 transition-all ${
                  compareIds.includes(pkg.id)
                    ? 'bg-brand border-brand text-white shadow-sm'
                    : 'bg-white/90 border-gray-300 text-gray-400 hover:border-brand/60 hover:text-brand'
                }`}
                aria-label={compareIds.includes(pkg.id) ? `비교 해제: ${pkg.display_title || pkg.title}` : `비교 추가: ${pkg.display_title || pkg.title}`}
              >
                {compareIds.includes(pkg.id) ? (
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6L9 17l-5-5"/></svg>
                ) : (
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><rect x="2" y="3" width="20" height="18" rx="2"/><path d="M12 8v8M8 12h8"/></svg>
                )}
              </button>
              <PackageCard
                pkg={pkg as Package}
                variant="horizontal"
                image={imageByPkgIdProp[pkg.id] ?? null}
                precomputedMinPrice={minPriceByPkgId.get(pkg.id) ?? 0}
                isRecommended={recommendedSet.has(pkg.id)}
                recommendedReasons={recommendedReasonMap[pkg.id] ?? score?.reasons ?? []}
                isReasonOpen={activeReasonId === pkg.id}
                onToggleReason={(id) => setActiveReasonId(activeReasonId === id ? null : id)}
                onClick={trackClick}
                rankBadge={rankBadge}
                primaryReason={score?.hasComparison && score.rankInGroup === 1 ? score.label : undefined}
                comparisonLabel={score?.label}
                comparisonSummary={score?.comparisonSummary}
                comparisonReasons={score?.reasons}
                comparisonRank={score?.rankInGroup}
                comparisonGroupSize={score?.groupSize}
                hotelGradeLabel={score?.hotelGradeLabel}
                trackingIntent={selectedIntent}
                catalogGroupCount={pkg.catalog_id ? catalogGroupSizeMap.get(pkg.catalog_id) : undefined}
              />
            </div>
          );
          })}
        </div>
      )}
      {filteredPackages.length > visiblePackages.length && (
        <div className="px-4 pb-6 md:max-w-7xl md:mx-auto md:px-8">
          <button
            type="button"
            onClick={() => setVisibleCount(v => Math.min(v + VISIBLE_STEP, filteredPackages.length))}
            className="w-full h-11 rounded-full border border-[#D1DCE8] bg-white text-[14px] font-semibold text-text-primary hover:border-brand/60 hover:text-brand transition"
          >
            상품 더 보기 ({visiblePackages.length}/{filteredPackages.length})
          </button>
        </div>
      )}

      {/* 플로팅 CTA — 모바일 전용 */}
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

      {/* ── 비교 플로팅 버튼 ── */}
      {compareIds.length > 0 && (
        <div className="fixed bottom-20 md:bottom-[88px] left-1/2 -translate-x-1/2 z-40">
          <div className="bg-white shadow-[0_8px_32px_rgba(0,0,0,0.12)] border border-gray-200 rounded-full px-4 py-2 flex items-center gap-3">
            <span className="text-[13px] font-medium text-text-secondary whitespace-nowrap">
              {compareIds.length}개 선택됨
            </span>
            <button
              type="button"
              onClick={clearCompare}
              className="text-[12px] font-medium text-text-body hover:text-danger transition"
            >
              해제
            </button>
            <div className="w-px h-4 bg-gray-200" />
            <button
              type="button"
              disabled={compareIds.length < 2}
              onClick={() => {
                setCompareOpen(true);
                trackScoreSignal({
                  packageId: compareIds[0],
                  signalType: 'comparison_open',
                  groupKey: selectedIntent
                    ? `intent:${selectedIntent};compare:${compareIds.join(',')}`
                    : `compare:${compareIds.join(',')}`,
                });
              }}
              className="px-4 py-1.5 bg-brand text-white text-[13px] font-bold rounded-full hover:bg-brand-dark transition disabled:opacity-40 disabled:cursor-not-allowed"
            >
              비교하기
            </button>
          </div>
        </div>
      )}

      {/* ── Pairwise 비교 모달 ── */}
      {compareOpen && comparePackages.length === 2 && (
        <SimpleCompareModal
          a={comparePackages[0]!}
          b={comparePackages[1]!}
          onClose={() => { setCompareOpen(false); }}
        />
      )}
    </div>
  );
}

/** 간편 상품 비교 모달 */
function SimpleCompareModal({
  a,
  b,
  onClose,
}: {
  a: Package;
  b: Package;
  onClose: () => void;
}) {
  useEffect(() => {
    document.body.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = '';
      document.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  const getPrice = (p: Package) => {
    const dates = (p.price_dates || []) as Array<{ price: number }>;
    const valid = dates.filter(d => d?.price > 0);
    if (valid.length > 0) return Math.min(...valid.map(d => d.price));
    return p.price ?? 0;
  };

  const rows: { label: string; va: string | number; vb: string | number }[] = [
    { label: '가격', va: getPrice(a).toLocaleString() + '원~', vb: getPrice(b).toLocaleString() + '원~' },
    { label: '목적지', va: a.destination || '-', vb: b.destination || '-' },
    { label: '일정', va: a.nights && a.duration ? `${a.nights}박${a.duration}일` : '-', vb: b.nights && b.duration ? `${b.nights}박${b.duration}일` : '-' },
    { label: '항공', va: a.airline || '-', vb: b.airline || '-' },
    { label: '출발공항', va: a.departure_airport || '-', vb: b.departure_airport || '-' },
    { label: '평점', va: a.avg_rating ? `★ ${Number(a.avg_rating).toFixed(1)}` : '-', vb: b.avg_rating ? `★ ${Number(b.avg_rating).toFixed(1)}` : '-' },
  ];

  return (
    <div className="fixed inset-0 z-[200] flex items-end md:items-center md:justify-center">
      <button type="button" className="absolute inset-0 bg-black/45 backdrop-blur-sm" aria-label="닫기" onClick={onClose} />
      <div className="relative w-full max-h-[85vh] md:max-w-lg bg-white rounded-t-[24px] md:rounded-2xl shadow-2xl flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 shrink-0">
          <h2 className="text-[16px] font-bold text-text-primary">상품 비교</h2>
          <button type="button" aria-label="Close comparison" onClick={onClose} className="w-10 h-10 flex items-center justify-center rounded-full hover:bg-gray-100 text-text-body">
            <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M6 6l12 12M6 18L18 6"/></svg>
          </button>
        </div>
        <div className="overflow-y-auto px-4 py-4 space-y-3">
          <div className="grid grid-cols-2 gap-3 mb-2">
            <Link href={`/packages/${a.id}`} className="text-center text-[13px] font-semibold text-brand hover:underline truncate">
              {a.display_title || a.title}
            </Link>
            <Link href={`/packages/${b.id}`} className="text-center text-[13px] font-semibold text-brand hover:underline truncate">
              {b.display_title || b.title}
            </Link>
          </div>
          {rows.map(row => {
            const isDiff = row.va !== row.vb;
            return (
              <div key={row.label} className="grid grid-cols-2 gap-3 text-body items-center">
                <div className={`text-center font-semibold ${isDiff ? 'text-brand' : 'text-text-primary'}`}>{row.va}</div>
                <div className="text-center text-[11px] font-medium text-text-secondary">{row.label}</div>
                <div className={`text-center font-semibold ${isDiff ? 'text-brand' : 'text-text-primary'}`}>{row.vb}</div>
              </div>
            );
          })}
        </div>
        <div className="grid grid-cols-2 gap-2 px-4 py-3 border-t border-gray-100 shrink-0">
          <Link href={`/packages/${a.id}`} className="text-center py-2.5 rounded-xl bg-brand-light text-brand text-[13px] font-bold hover:bg-brand hover:text-white transition">
            상세보기
          </Link>
          <Link href={`/packages/${b.id}`} className="text-center py-2.5 rounded-xl bg-brand-light text-brand text-[13px] font-bold hover:bg-brand hover:text-white transition">
            상세보기
          </Link>
        </div>
      </div>
    </div>
  );
}
