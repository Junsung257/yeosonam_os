'use client';

import { useState, useMemo, useCallback, useEffect, useRef, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import useSWR from 'swr';
import { ArrowRight, Check, Phone, Plus, RotateCcw, Search, Sparkles, Users, X } from 'lucide-react';
import { getMinPriceFromDates } from '@/lib/price-dates';
import SearchBar from '@/components/customer/SearchBar';
import GlobalNav from '@/components/customer/GlobalNav';
import PackageCard from '@/components/customer/PackageCard';
import { REGIONS, matchesRegion, resolveLegacyFilterLabel } from '@/lib/regions';
import { getConsultTelHref } from '@/lib/consult-escalation';
import { ANALYTICS_EVENTS } from '@/lib/analytics-events';
import { openKakaoChannel } from '@/lib/kakaoChannel';
import { getSessionId, trackEngagement } from '@/lib/tracker';
import { buildConciergeHandoffHref, buildGroupInquiryHandoffHref } from '@/lib/group-inquiry-handoff';
import { packageMatchesCategory } from '@/lib/package-category';
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
const PACKAGES_STICKY_HANDOFF_SUMMARY_ID = 'packages-sticky-handoff-summary';
const PACKAGES_STICKY_NEXT_ACTION_ID = 'packages-sticky-next-action';
const PACKAGES_STICKY_PHONE_DESCRIPTION_ID = 'packages-sticky-phone-description';
const PACKAGES_STICKY_GROUP_DESCRIPTION_ID = 'packages-sticky-group-description';
const PACKAGES_STICKY_KAKAO_DESCRIPTION_ID = 'packages-sticky-kakao-description';
const PACKAGES_FILTER_READINESS_SUMMARY_ID = 'packages-filter-readiness-summary';

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
type MobileAppliedFilterItem = {
  key: string;
  label: string;
  value: string;
  clearLabel: string;
};
type PrimaryFilterKey = 'month' | 'hub' | 'intent' | 'budget';
type PrimaryFilterChecklistItem = {
  key: PrimaryFilterKey;
  label: string;
  complete: boolean;
};

function normalizeIntentId(value: string | null): IntentId | null {
  return INTENT_OPTIONS.some(opt => opt.id === value) ? (value as IntentId) : null;
}

const MONTH_FILTER_OPTIONS = Array.from({ length: 6 }, (_, index) => {
  const date = new Date();
  date.setMonth(date.getMonth() + index);
  const value = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
  return { value, label: `${date.getMonth() + 1}월` };
});

const BUDGET_FILTER_OPTIONS = [
  { value: '', label: '예산 전체', min: '', max: '' },
  { value: 'under_100', label: '100만원 이하', min: '', max: '1000000' },
  { value: '100_150', label: '100~150만원', min: '1000000', max: '1500000' },
  { value: '150_200', label: '150~200만원', min: '1500000', max: '2000000' },
  { value: 'over_200', label: '200만원 이상', min: '2000000', max: '' },
] as const;

const HUB_SUMMARY_LABELS: Record<DepartureHubId, string> = {
  busan: '부산 출발',
  incheon: '인천 출발',
  daegu: '대구 출발',
  cheongju: '청주 출발',
  all: '전국 출발',
};

const CATEGORY_SUMMARY_LABELS: Record<string, string> = {
  honeymoon: '허니문',
  golf: '해외골프',
  cruise: '크루즈',
  theme: '테마여행',
};

const INTENT_HANDOFF_LABELS: Record<IntentId, string> = {
  family: '부모님/가족',
  budget: '예산 맞춤',
  no_shopping: '쇼핑 없는 상품',
  consult: '상담 추천',
};

const INTENT_PARTY_TYPE: Partial<Record<IntentId, string>> = {
  family: 'family',
  no_shopping: 'family',
};
const CONCIERGE_INTENT_BY_PACKAGE_INTENT: Record<IntentId, string> = {
  family: 'filial_trip',
  budget: 'budget_trip',
  no_shopping: 'no_shopping_family',
  consult: 'package_consult',
};

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

function formatMonthSummary(month: string): string {
  const match = month.match(/^(\d{4})-(\d{2})$/);
  if (!match) return month;
  return `${Number(match[2])}월`;
}

function formatWonSummary(value: string): string {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount <= 0) return value;
  if (amount >= 10_000) return `${Math.round(amount / 10_000)}만원`;
  return `${amount.toLocaleString()}원`;
}

function formatBudgetSummary(priceMin: string, priceMax: string): string | null {
  if (priceMin && priceMax) return `${formatWonSummary(priceMin)}~${formatWonSummary(priceMax)}`;
  if (priceMin) return `${formatWonSummary(priceMin)} 이상`;
  if (priceMax) return `${formatWonSummary(priceMax)} 이하`;
  return null;
}

const PACKAGE_DESTINATION_HINTS = [
  '동남아',
  '다낭',
  '나트랑',
  '푸꾸옥',
  '달랏',
  '방콕',
  '파타야',
  '치앙마이',
  '세부',
  '보홀',
  '마닐라',
  '코타키나발루',
  '싱가포르',
  '대만',
  '타이베이',
  '일본',
  '오사카',
  '후쿠오카',
  '삿포로',
  '괌',
  '사이판',
  '하와이',
  '유럽',
  '호주',
];

function inferPackageIntentFromQuery(query: string): IntentId | null {
  if (/노쇼핑|쇼핑\s*없/.test(query)) return 'no_shopping';
  if (/부모님|가족|효도|아이|자녀|시니어|60대|70대/.test(query)) return 'family';
  if (/최저가|저렴|가성비|예산|100만|150만|200만/.test(query)) return 'budget';
  if (/상담|추천해|골라/.test(query)) return 'consult';
  return null;
}

function inferPackageDestinationFromQuery(query: string): string | null {
  return PACKAGE_DESTINATION_HINTS.find((destination) => query.includes(destination)) ?? null;
}

function inferPackageBudgetFromQuery(query: string): string | null {
  const rangeMatch = query.match(/(\d{2,4})\s*(?:~|-|에서)\s*(\d{2,4})\s*(?:만원|만\s*원|만)/);
  if (rangeMatch) return `${rangeMatch[1]}~${rangeMatch[2]}만원`;

  const manwonMatch = query.match(/(\d{2,4})\s*(?:만원|만\s*원|만)/);
  if (manwonMatch) return `${manwonMatch[1]}만원`;

  const wonMatch = query.match(/(\d{6,9})\s*원/);
  if (!wonMatch) return null;
  const won = Number(wonMatch[1]);
  if (!Number.isFinite(won) || won <= 0) return null;
  return won >= 10_000 ? `${Math.round(won / 10_000).toLocaleString('ko-KR')}만원` : `${won.toLocaleString('ko-KR')}원`;
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
  const rawSearchParams = useSearchParams();
  const searchParamsString = rawSearchParams?.toString() ?? '';
  const searchParams = useMemo(() => new URLSearchParams(searchParamsString), [searchParamsString]);
  const [activeReasonId, setActiveReasonId] = useState<string | null>(null);
  const intentFromQuery = normalizeIntentId(searchParams.get('intent'));
  const [selectedIntent, setSelectedIntent] = useState<IntentId | null>(intentFromQuery);
  const [showMoreFilters, setShowMoreFilters] = useState(false);
  const trackedRecommendViewsRef = useRef<Set<string>>(new Set());
  const moreFiltersToggleRef = useRef<HTMLButtonElement | null>(null);
  const moreFiltersFirstControlRef = useRef<HTMLSelectElement | null>(null);
  const moreFiltersWasOpenRef = useRef(false);
  const monthFilterRef = useRef<HTMLSelectElement | null>(null);
  const hubFilterRef = useRef<HTMLSelectElement | null>(null);
  const purposeFilterRef = useRef<HTMLSelectElement | null>(null);
  const budgetFilterRef = useRef<HTMLSelectElement | null>(null);
  const packageListDecisionSummaryRef = useRef<HTMLElement | null>(null);
  const shouldFocusPackageResultsRef = useRef(false);

  const destination = searchParams.get('destination') || '';
  const rawFilter = searchParams.get('filter') || '';
  const q = searchParams.get('q')?.trim() || '';
  const month = searchParams.get('month') || '';
  const priceMin = searchParams.get('priceMin') || '';
  const priceMax = searchParams.get('priceMax') || '';
  const urgency = searchParams.get('urgency') || '';
  const category = searchParams.get('category') || '';

  const rawHubParam = searchParams.get('hub');
  const rawDepartureParam = searchParams.get('departure');
  let hubFromParam = normalizeDepartureHub(rawHubParam ?? rawDepartureParam);
  if (rawFilter === '인천출발' && !rawHubParam && !rawDepartureParam) hubFromParam = 'incheon';
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
  const compareStatusId = 'packages-compare-selection-status';
  const compareHelpId = 'packages-compare-help';
  const compareHandoffSummaryId = 'packages-compare-handoff-summary';
  const compareNextActionId = 'packages-compare-next-action';
  const compareCtaReadinessId = 'packages-compare-cta-readiness';
  const packageFilterGroupTitleId = 'packages-filter-title';
  const packageFilterGroupDescriptionId = 'packages-filter-group-description';
  const packageFilterHelpId = 'packages-filter-help';
  const packageFilterSummaryId = 'packages-filter-summary';
  const packageMobileAppliedFilterSummaryId = 'packages-mobile-applied-filter-summary';
  const packageResultSummaryId = 'packages-result-summary';
  const packageListDecisionSummaryId = 'packages-list-decision-summary';
  const packageFilterReadinessSummaryId = PACKAGES_FILTER_READINESS_SUMMARY_ID;
  const packageFilterDescriptionIds = `${packageFilterHelpId} ${packageFilterGroupDescriptionId} ${packageMobileAppliedFilterSummaryId} ${packageFilterReadinessSummaryId} ${packageResultSummaryId}`;
  const compareDescriptionIds = `${compareStatusId} ${compareHelpId}`;
  const compareActionDescriptionIds = `${compareDescriptionIds} ${compareHandoffSummaryId} ${compareNextActionId} ${compareCtaReadinessId}`;
  const compareStatusText = compareIds.length === 0
    ? '비교 상품이 선택되지 않았습니다.'
    : compareIds.length === 1
      ? '비교 상품 1개가 선택되었습니다. 하나 더 선택하면 비교할 수 있습니다.'
      : '비교 상품 2개가 선택되었습니다. 비교하기를 열 수 있습니다.';
  const compareHelpText = compareIds.length >= 2
    ? '선택한 두 상품의 가격, 목적지, 일정, 항공, 출발공항, 평점을 비교 모달에서 확인할 수 있습니다.'
    : '비교할 상품을 최대 2개까지 선택할 수 있습니다. 이미 2개를 고른 뒤 다른 상품을 누르면 가장 오래된 선택이 교체됩니다.';
  const compareNextActionText = compareIds.length >= 2
    ? '다음: 두 상품 차이를 확인한 뒤 선택 상품 그대로 상담에 전달합니다.'
    : '다음: 비교할 상품을 하나 더 선택하면 상세 비교와 상담 전달이 쉬워집니다.';
  const focusPackageResults = useCallback(() => {
    const target = packageListDecisionSummaryRef.current;
    if (!target) return;
    target.scrollIntoView({ block: 'start', behavior: 'smooth' });
    target.focus({ preventScroll: true });
  }, []);
  const requestPackageResultsFocus = useCallback(() => {
    shouldFocusPackageResultsRef.current = true;
    window.setTimeout(focusPackageResults, 80);
    window.setTimeout(focusPackageResults, 450);
  }, [focusPackageResults]);
  const inferredIntentFromQuery = useMemo(() => inferPackageIntentFromQuery(q), [q]);
  const inferredDestinationFromQuery = useMemo(() => inferPackageDestinationFromQuery(q), [q]);
  const inferredBudgetFromQuery = useMemo(() => inferPackageBudgetFromQuery(q), [q]);
  const effectiveIntent = selectedIntent ?? inferredIntentFromQuery;
  const effectiveIntentInfo = INTENT_OPTIONS.find(opt => opt.id === effectiveIntent) ?? null;

  const navigateWithHub = useCallback(
    (nextHub: DepartureHubId) => {
      requestPackageResultsFocus();
      const p = new URLSearchParams(searchParams.toString());
      appendDepartureHubToSearchParams(p, nextHub);
      p.delete('departure');
      p.delete('filter');
      const qs = p.toString();
      router.push(qs ? `/packages?${qs}` : '/packages');
    },
    [requestPackageResultsFocus, router, searchParams],
  );

  const hrefPackagesClearUrgencyCategory = useMemo(() => {
    const p = new URLSearchParams(searchParams.toString());
    p.delete('urgency');
    p.delete('category');
    const qs = p.toString();
    return qs ? `/packages?${qs}` : '/packages';
  }, [searchParams]);

  // ── 정렬 + 필터 ─────────────────────────────────────────────
  const [activeFilter, setActiveFilter] = useState<string>(FILTER_OPTIONS[0]);
  const [sortBy, setSortBy] = useState('recommended');

  useEffect(() => {
    setActiveFilter(filter || FILTER_OPTIONS[0]);
  }, [filter]);

  useEffect(() => {
    setSelectedIntent(intentFromQuery);
  }, [intentFromQuery]);

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
    const intentKey = input.intent ?? effectiveIntent;
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
  }, [effectiveIntent, initialPackages, recommendedIds]);

  const filteredPackages = useMemo(() => {
    let list = [...initialPackages];
    if (activeFilter !== '전체') list = list.filter(p => matchesFilter(p, activeFilter));
    const today = new Date().toISOString().slice(0, 10);
    if (urgency === '1') list = list.filter(p => {
      if (p.product_type === 'urgency') return true;
      const pd = (p.price_dates || []) as Array<{ date?: string }>;
      return pd.some(d => d?.date && d.date >= today);
    });
    if (category) list = list.filter(p => packageMatchesCategory(p, category));
    const sortFn = sortBy === 'price_asc' ? (a: Package, b: Package) => packageMinPrice(a) - packageMinPrice(b)
      : sortBy === 'price_desc' ? (a: Package, b: Package) => packageMinPrice(b) - packageMinPrice(a)
      : (a: Package, b: Package) => {
        const intentDiff = packageIntentScore(b, effectiveIntent) - packageIntentScore(a, effectiveIntent);
        if (intentDiff !== 0) return intentDiff;
        const aRec = recommendedSet.has(a.id);
        const bRec = recommendedSet.has(b.id);
        if (aRec && !bRec) return -1;
        if (!aRec && bRec) return 1;
        return 0;
      };
    list.sort(sortFn);
    return list;
  }, [initialPackages, activeFilter, sortBy, urgency, category, recommendedSet, effectiveIntent]);

  const filterSummaryItems = useMemo(() => {
    const items: { label: string; value: string }[] = [
      { label: '출발지', value: HUB_SUMMARY_LABELS[hub] },
    ];
    if (month) items.push({ label: '출발월', value: formatMonthSummary(month) });
    const budget = formatBudgetSummary(priceMin, priceMax) ?? inferredBudgetFromQuery;
    if (budget) items.push({ label: '예산', value: budget });
    const summaryDestination = activeFilter !== FILTER_OPTIONS[0] ? activeFilter : inferredDestinationFromQuery;
    if (summaryDestination) items.push({ label: '지역', value: summaryDestination });
    if (category) items.push({ label: '테마', value: CATEGORY_SUMMARY_LABELS[category] ?? category });
    if (urgency === '1') items.push({ label: '상태', value: '마감임박' });
    if (effectiveIntentInfo) items.push({ label: '목적', value: effectiveIntentInfo.label });
    items.push({ label: '결과', value: `${filteredPackages.length}개` });
    return items;
  }, [activeFilter, category, effectiveIntentInfo, filteredPackages.length, hub, inferredBudgetFromQuery, inferredDestinationFromQuery, month, priceMax, priceMin, urgency]);

  const selectedProductNames = useMemo(
    () => comparePackages
      .map((pkg) => pkg?.display_title || pkg?.products?.display_name || pkg?.title)
      .filter((name): name is string => Boolean(name))
      .slice(0, 2),
    [comparePackages],
  );
  const selectedProductBudget = useMemo(() => {
    const selectedPrices = comparePackages
      .filter((pkg): pkg is Package => Boolean(pkg))
      .map((pkg) => packageMinPrice(pkg))
      .filter((price) => Number.isFinite(price) && price > 0);
    if (selectedPrices.length === 0) return null;
    return `1인 ${formatWonSummary(String(Math.min(...selectedPrices)))}부터`;
  }, [comparePackages]);

  const handoffBudget = useMemo(
    () => formatBudgetSummary(priceMin, priceMax) ?? inferredBudgetFromQuery ?? selectedProductBudget,
    [inferredBudgetFromQuery, priceMax, priceMin, selectedProductBudget],
  );
  const handoffDestination = destination || (activeFilter !== FILTER_OPTIONS[0] ? activeFilter : null) || inferredDestinationFromQuery;
  const handoffIntent = effectiveIntent ? INTENT_HANDOFF_LABELS[effectiveIntent] : null;
  const handoffPartyType = effectiveIntent ? INTENT_PARTY_TYPE[effectiveIntent] ?? null : null;
  const primaryFilterChecklist = useMemo<PrimaryFilterChecklistItem[]>(() => [
    { key: 'month', label: '출발월', complete: Boolean(month) },
    { key: 'hub', label: '출발지', complete: Boolean(hub) },
    { key: 'intent', label: '여행 목적', complete: Boolean(effectiveIntent) },
    { key: 'budget', label: '예산', complete: Boolean(handoffBudget) },
  ], [effectiveIntent, handoffBudget, hub, month]);
  const primaryFilterReadyCount = primaryFilterChecklist.filter((item) => item.complete).length;
  const primaryFilterMissingLabels = primaryFilterChecklist
    .filter((item) => !item.complete)
    .map((item) => item.label);
  const primaryFilterReadinessText = primaryFilterMissingLabels.length > 0
    ? `핵심 조건 준비 ${primaryFilterReadyCount}/${primaryFilterChecklist.length}. 보완하면 좋은 조건: ${primaryFilterMissingLabels.join(', ')}.`
    : `핵심 조건 준비 ${primaryFilterReadyCount}/${primaryFilterChecklist.length}. 상담과 비교에 필요한 핵심 조건이 준비되었습니다.`;
  const hasActivePackageFilter = Boolean(
    q || month || destination || selectedIntent || category || urgency || priceMin || priceMax || hub !== DEFAULT_DEPARTURE_HUB,
  );
  const filterReadinessLive = hasActivePackageFilter;
  const packageHandoffPreviewItems = useMemo(() => [
    handoffIntent ? { label: '목적', value: handoffIntent } : null,
    { label: '출발지', value: HUB_SUMMARY_LABELS[hub] },
    handoffDestination ? { label: '지역', value: handoffDestination } : null,
    handoffBudget ? { label: '예산', value: handoffBudget } : null,
    selectedProductNames.length > 0 ? { label: '비교 상품', value: selectedProductNames.join(' / ') } : null,
  ].filter((item): item is { label: string; value: string } => Boolean(item)), [handoffBudget, handoffDestination, handoffIntent, hub, selectedProductNames]);
  const packageHandoffPreviewText = packageHandoffPreviewItems.length > 0
    ? `견적 문의 전달 조건: ${packageHandoffPreviewItems.map((item) => `${item.label} ${item.value}`).join(', ')}. ${primaryFilterReadinessText}`
    : `견적 문의 전달 조건이 아직 없습니다. ${primaryFilterReadinessText}`;
  const compareHandoffSummaryText = selectedProductNames.length > 0
    ? `비교 선택 상품이 상담 전달에 포함됩니다: ${selectedProductNames.join(' / ')}. ${primaryFilterReadinessText}`
    : `비교 상품 ${compareIds.length}개가 선택되었습니다. ${primaryFilterReadinessText}`;
  const compareCtaReadinessText = selectedProductNames.length > 0
    ? `견적 CTA 준비: ${selectedProductNames.join(' / ')} 상품과 핵심 조건 ${primaryFilterReadyCount}/${primaryFilterChecklist.length}개가 함께 전달됩니다.`
    : `견적 CTA 준비: 선택 상품 ${compareIds.length}개입니다. 상품을 하나 더 고르면 비교표와 상담 전달 판단이 쉬워집니다.`;
  const stickyHandoffItems = useMemo(
    () => filterSummaryItems
      .filter((item) => item.label !== '결과')
      .slice(0, 4),
    [filterSummaryItems],
  );
  const stickyPhoneDescriptionIds = `${PACKAGES_STICKY_PHONE_DESCRIPTION_ID} ${PACKAGES_STICKY_HANDOFF_SUMMARY_ID} ${PACKAGES_STICKY_NEXT_ACTION_ID} ${packageFilterReadinessSummaryId}`;
  const stickyGroupDescriptionIds = `${PACKAGES_STICKY_GROUP_DESCRIPTION_ID} ${PACKAGES_STICKY_HANDOFF_SUMMARY_ID} ${PACKAGES_STICKY_NEXT_ACTION_ID} ${packageFilterReadinessSummaryId}`;
  const stickyKakaoDescriptionIds = `${PACKAGES_STICKY_KAKAO_DESCRIPTION_ID} ${PACKAGES_STICKY_HANDOFF_SUMMARY_ID} ${PACKAGES_STICKY_NEXT_ACTION_ID} ${packageFilterReadinessSummaryId}`;
  const handoffSummary = useMemo(() => [
    q ? `검색어: ${q}` : null,
    ...filterSummaryItems
      .filter((item) => item.label !== '결과')
      .map((item) => `${item.label}: ${item.value}`),
    selectedProductNames.length > 0 ? `비교 선택: ${selectedProductNames.join(' / ')}` : null,
  ].filter(Boolean).join('\n'), [filterSummaryItems, q, selectedProductNames]);

  const groupInquiryHref = useMemo(() => {
    return buildGroupInquiryHandoffHref({
      source: 'packages',
      intent: effectiveIntent ?? undefined,
      partyType: handoffPartyType ?? undefined,
      query: q || handoffSummary || '패키지 목록 상담',
      destination: handoffDestination,
      budget: handoffBudget,
      selectedProducts: selectedProductNames.length > 0 ? selectedProductNames : undefined,
    });
  }, [effectiveIntent, handoffBudget, handoffDestination, handoffPartyType, handoffSummary, q, selectedProductNames]);
  const conciergeQuery = useMemo(() => {
    const baseQuery = q || handoffSummary || '패키지 목록 AI 상담';
    const parts = [baseQuery];
    if (handoffDestination && !baseQuery.includes(handoffDestination)) {
      parts.push(`목적지: ${handoffDestination}`);
    }
    if (handoffBudget && !baseQuery.includes(handoffBudget)) {
      parts.push(`예산: ${handoffBudget}`);
    }
    return parts.join('\n');
  }, [handoffBudget, handoffDestination, handoffSummary, q]);
  const conciergeHref = useMemo(() => {
    return buildConciergeHandoffHref({
      source: 'packages',
      intent: effectiveIntent ? CONCIERGE_INTENT_BY_PACKAGE_INTENT[effectiveIntent] : 'package_search',
      partyType: handoffPartyType ?? undefined,
      query: conciergeQuery,
      destination: handoffDestination,
      budget: handoffBudget,
      selectedProducts: selectedProductNames.length > 0 ? selectedProductNames : undefined,
    });
  }, [conciergeQuery, effectiveIntent, handoffBudget, handoffDestination, handoffPartyType, selectedProductNames]);
  const buildPackageDetailHref = useCallback((pkg: Package) => {
    const params = new URLSearchParams();
    const productName = pkg.display_title || pkg.products?.display_name || pkg.title;
    const detailIntent = effectiveIntent ?? (category || null);
    const detailPartyType = effectiveIntent
      ? INTENT_PARTY_TYPE[effectiveIntent] ?? null
      : category === 'golf'
        ? 'golf_group'
        : category === 'honeymoon'
          ? 'couple'
          : null;
    const detailDestination = destination || pkg.destination || (activeFilter !== FILTER_OPTIONS[0] ? activeFilter : null);

    params.set('source', 'packages');
    if (detailIntent) params.set('intent', detailIntent);
    if (detailPartyType) params.set('party_type', detailPartyType);
    if (q) params.set('query', q);
    if (handoffBudget) params.set('budget', handoffBudget);
    if (detailDestination) params.set('destination', detailDestination);
    if (productName) params.set('selected_products', productName);
    ['ref', 'utm_source', 'utm_medium', 'utm_campaign'].forEach((key) => {
      const value = searchParams.get(key);
      if (value) params.set(key, value);
    });

    const qs = params.toString();
    return `/packages/${encodeURIComponent(pkg.id)}${qs ? `?${qs}` : ''}`;
  }, [activeFilter, category, destination, effectiveIntent, handoffBudget, q, searchParams]);

  const [visibleCount, setVisibleCount] = useState(INITIAL_VISIBLE_COUNT);
  useEffect(() => { setVisibleCount(INITIAL_VISIBLE_COUNT); }, [apiQuery]);
  const visiblePackages = useMemo(() => filteredPackages.slice(0, visibleCount), [filteredPackages, visibleCount]);

  useEffect(() => {
    if (!shouldFocusPackageResultsRef.current || isLoading) return;
    shouldFocusPackageResultsRef.current = false;
    const focusTimer = window.setTimeout(() => {
      focusPackageResults();
    }, 0);
    return () => window.clearTimeout(focusTimer);
  }, [apiQuery, filteredPackages.length, focusPackageResults, isLoading]);
  const mobileAppliedFilterItems = useMemo<MobileAppliedFilterItem[]>(() => {
    const items: MobileAppliedFilterItem[] = [];
    if (month) items.push({ key: 'month', label: '출발월', value: formatMonthSummary(month), clearLabel: '출발월 조건 해제' });
    if (hub !== DEFAULT_DEPARTURE_HUB) items.push({ key: 'hub', label: '출발지', value: HUB_SUMMARY_LABELS[hub], clearLabel: '출발지를 기본값으로 되돌리기' });
    if (selectedIntentInfo) items.push({ key: 'intent', label: '목적', value: selectedIntentInfo.label, clearLabel: '여행 목적 조건 해제' });
    const budget = formatBudgetSummary(priceMin, priceMax);
    if (budget) items.push({ key: 'budget', label: '예산', value: budget, clearLabel: '예산 조건 해제' });
    if (destination) items.push({ key: 'destination', label: '도착지', value: destination, clearLabel: '도착지 조건 해제' });
    if (activeFilter !== FILTER_OPTIONS[0]) items.push({ key: 'region', label: '지역', value: activeFilter, clearLabel: '지역 조건 해제' });
    if (category) items.push({ key: 'category', label: '테마', value: CATEGORY_SUMMARY_LABELS[category] ?? category, clearLabel: '테마 조건 해제' });
    if (urgency === '1') items.push({ key: 'urgency', label: '상태', value: '마감임박', clearLabel: '마감임박 조건 해제' });
    if (q) items.push({ key: 'q', label: '검색어', value: q, clearLabel: '검색어 조건 해제' });
    return items.slice(0, 6);
  }, [activeFilter, category, destination, hub, month, priceMax, priceMin, q, selectedIntentInfo, urgency]);
  const packageAppliedFilterSummaryText = filterSummaryItems.map((item) => `${item.label} ${item.value}`).join(', ');
  const packageMobileAppliedFilterSummaryText = mobileAppliedFilterItems.length > 0
    ? `모바일 적용 조건 ${mobileAppliedFilterItems.length}개: ${mobileAppliedFilterItems.map((item) => `${item.label} ${item.value}`).join(', ')}. 결과 ${filteredPackages.length}개.`
    : `${HUB_SUMMARY_LABELS[hub]} 기준, 모바일 적용 조건 없음. 결과 ${filteredPackages.length}개.`;
  const packageResultSummaryText = `현재 조건에 맞는 상품 ${filteredPackages.length}개 중 ${visiblePackages.length}개를 보여주고 있습니다. 적용 조건은 ${packageAppliedFilterSummaryText}입니다. ${primaryFilterReadinessText}`;
  const packageResultSummaryLive = hasActivePackageFilter || compareIds.length > 0;
  const packageFilterGroupDescriptionText = `주요 필터는 출발월, 출발지, 여행 목적, 예산입니다. 더 많은 필터에서 정렬과 지역을 바꿀 수 있습니다. ${packageResultSummaryText}`;
  const packageEmptyStateSummaryId = 'packages-empty-state-summary';
  const emptyStateAppliedFilterItems = filterSummaryItems
    .filter((item) => item.label !== '결과')
    .slice(0, 5);
  const emptyStateRecoveryActions = mobileAppliedFilterItems.slice(0, 3);
  const zeroResultRelaxTargets = [
    month ? '출발월' : null,
    effectiveIntentInfo ? '여행 목적' : null,
    handoffBudget ? '예산' : null,
    activeFilter !== FILTER_OPTIONS[0] ? '지역' : null,
    hub !== DEFAULT_DEPARTURE_HUB ? '출발지' : null,
    q ? '검색어' : null,
    category ? '테마' : null,
    urgency ? '상태' : null,
  ].filter((item): item is string => Boolean(item));
  const packageZeroResultRecoveryText = zeroResultRelaxTargets.length > 0
    ? `먼저 ${zeroResultRelaxTargets.slice(0, 3).join(', ')} 조건을 넓히면 더 많은 상품을 볼 수 있습니다.`
    : '조건을 조금 더 알려주시면 상담에서 맞는 상품을 바로 찾아드릴 수 있습니다.';
  const packageEmptyStateSummaryText = emptyStateAppliedFilterItems.length > 0
    ? `조건에 맞는 상품이 없습니다. 적용 조건: ${emptyStateAppliedFilterItems.map((item) => `${item.label} ${item.value}`).join(', ')}. ${packageZeroResultRecoveryText}`
    : `조건에 맞는 상품이 없습니다. ${packageZeroResultRecoveryText}`;
  const packageFilterNextActionText = filteredPackages.length === 0
    ? packageZeroResultRecoveryText
    : primaryFilterMissingLabels.length > 0
      ? `${primaryFilterMissingLabels[0]} 조건을 추가하면 상담 전달 정확도가 올라갑니다.`
      : compareIds.length > 0
        ? '선택한 비교 상품을 견적 문의에 함께 전달할 수 있습니다.'
        : filteredPackages.length <= 3
          ? '후보가 적다면 더 많은 필터를 넓혀 다른 상품도 확인해 보세요.'
          : '마음에 드는 상품 2개를 비교하거나 바로 상담으로 넘겨보세요.';
  const firstVisiblePackage = visiblePackages[0] ?? null;
  const firstVisiblePackageTitle = firstVisiblePackage?.display_title || firstVisiblePackage?.products?.display_name || firstVisiblePackage?.title || null;
  const firstVisibleScore = firstVisiblePackage ? scoreByPkgId[firstVisiblePackage.id] ?? null : null;
  const firstVisibleMinPrice = firstVisiblePackage ? packageMinPrice(firstVisiblePackage) : null;
  const firstVisibleDetailHref = firstVisiblePackage ? buildPackageDetailHref(firstVisiblePackage) : null;
  const firstVisibleIsCompared = firstVisiblePackage ? compareIds.includes(firstVisiblePackage.id) : false;
  const firstVisibleDecisionReasonText = firstVisiblePackage ? [
    firstVisibleScore?.comparisonSummary || firstVisibleScore?.label || null,
    firstVisiblePackage.departure_airport ? `${firstVisiblePackage.departure_airport} 출발` : null,
    Number.isFinite(firstVisibleMinPrice) && firstVisibleMinPrice && firstVisibleMinPrice > 0
      ? `최저 ${formatWonSummary(String(firstVisibleMinPrice))}`
      : null,
  ].filter((item): item is string => Boolean(item)).slice(0, 3).join(' · ') : null;
  const packageListNextActionDetailText = filteredPackages.length === 0
    ? packageZeroResultRecoveryText
    : firstVisiblePackageTitle
      ? `첫 후보는 ${firstVisiblePackageTitle}입니다. ${firstVisibleDecisionReasonText ? `판단 근거: ${firstVisibleDecisionReasonText}. ` : ''}조건이 맞으면 상세를 열고, 망설여지면 비교에 담아 보세요.`
      : packageFilterNextActionText;
  const packageListDecisionSummaryText = `목록 판단 요약: 결과 ${filteredPackages.length}개, 비교 선택 ${compareIds.length}개, 다음 액션 ${packageFilterNextActionText}. ${packageListNextActionDetailText}`;
  const packageListDescriptionIds = `${packageResultSummaryId} ${packageFilterReadinessSummaryId} ${packageListDecisionSummaryId}`;
  const emptyStateInquiryDescriptionIds = `${packageEmptyStateSummaryId} ${packageResultSummaryId} ${packageFilterReadinessSummaryId}`;
  const hasScarcePackageResults = filteredPackages.length > 0 && filteredPackages.length <= 3;
  const scarceResultRecoverySummaryId = 'packages-scarce-result-recovery-summary';
  const scarceResultRecoveryText = hasScarcePackageResults
    ? `조건에 맞는 상품이 ${filteredPackages.length}개뿐입니다. 선택지가 적으면 AI 상담이나 견적 문의로 같은 조건의 대체 상품까지 확인할 수 있습니다.`
    : '';
  const scarceResultNextActionText = primaryFilterMissingLabels.length > 0
    ? `${primaryFilterMissingLabels[0]} 조건을 추가하면 상담 전달 정확도가 올라갑니다.`
    : emptyStateRecoveryActions.length > 0
      ? `${emptyStateRecoveryActions[0].label} 조건을 잠시 빼면 더 많은 후보를 볼 수 있습니다.`
      : '마음에 드는 상품이 부족하면 상담으로 대체 일정과 조건을 함께 확인하세요.';
  const packageCtaDecisionMetadata = useMemo(() => ({
    selectedIntent: effectiveIntent,
    intent: selectedIntent,
    hub,
    result_count: filteredPackages.length,
    visible_count: visiblePackages.length,
    compare_count: compareIds.length,
    ready_count: primaryFilterReadyCount,
    missing_fields: primaryFilterMissingLabels,
    decision_summary: packageListDecisionSummaryText,
    next_action: packageFilterNextActionText,
    result_summary: packageResultSummaryText,
    applied_filters: packageAppliedFilterSummaryText,
    handoff_preview: packageHandoffPreviewText,
  }), [
    compareIds.length,
    filteredPackages.length,
    hub,
    packageAppliedFilterSummaryText,
    packageFilterNextActionText,
    packageHandoffPreviewText,
    packageListDecisionSummaryText,
    packageResultSummaryText,
    primaryFilterMissingLabels,
    primaryFilterReadyCount,
    effectiveIntent,
    selectedIntent,
    visiblePackages.length,
  ]);

  const handleFirstVisibleCompare = useCallback(() => {
    if (!firstVisiblePackage) return;
    setCompareIds(prev => {
      if (prev.includes(firstVisiblePackage.id)) return prev;
      if (prev.length >= 2) return [prev[1], firstVisiblePackage.id];
      return [...prev, firstVisiblePackage.id];
    });
    trackEngagement({
      event_type: ANALYTICS_EVENTS.stickyCtaClicked,
      cta_type: 'packages_first_candidate_compare',
      page_url: '/packages',
      product_id: firstVisiblePackage.id,
      product_name: firstVisiblePackageTitle ?? firstVisiblePackage.id,
      intent: effectiveIntent,
      budget: handoffBudget,
      destination: handoffDestination,
      party_type: handoffPartyType,
      selected_products: selectedProductNames.length > 0 ? selectedProductNames : null,
      ready_count: packageCtaDecisionMetadata.ready_count,
      missing_fields: packageCtaDecisionMetadata.missing_fields,
      decision_summary: packageCtaDecisionMetadata.decision_summary,
      handoff_preview: packageCtaDecisionMetadata.handoff_preview,
      next_action: '첫 후보를 비교 상품에 담기',
      result_summary: packageCtaDecisionMetadata.result_summary,
      applied_filters: packageCtaDecisionMetadata.applied_filters,
      metadata: {
        source: 'packages_list_decision_summary',
        first_candidate: true,
        first_candidate_price: firstVisibleMinPrice,
        first_candidate_reason: firstVisibleDecisionReasonText,
        ...packageCtaDecisionMetadata,
      },
    });
  }, [
    effectiveIntent,
    firstVisibleDecisionReasonText,
    firstVisibleMinPrice,
    firstVisiblePackage,
    firstVisiblePackageTitle,
    handoffBudget,
    handoffDestination,
    handoffPartyType,
    packageCtaDecisionMetadata,
    selectedProductNames,
  ]);

  const trackFirstVisibleDetailCta = useCallback(() => {
    if (!firstVisiblePackage) return;
    trackEngagement({
      event_type: ANALYTICS_EVENTS.stickyCtaClicked,
      cta_type: 'packages_first_candidate_detail',
      page_url: '/packages',
      product_id: firstVisiblePackage.id,
      product_name: firstVisiblePackageTitle ?? firstVisiblePackage.id,
      intent: effectiveIntent,
      budget: handoffBudget,
      destination: handoffDestination,
      party_type: handoffPartyType,
      selected_products: selectedProductNames.length > 0 ? selectedProductNames : null,
      ready_count: packageCtaDecisionMetadata.ready_count,
      missing_fields: packageCtaDecisionMetadata.missing_fields,
      decision_summary: packageCtaDecisionMetadata.decision_summary,
      handoff_preview: packageCtaDecisionMetadata.handoff_preview,
      next_action: '첫 후보 상세 보기',
      result_summary: packageCtaDecisionMetadata.result_summary,
      applied_filters: packageCtaDecisionMetadata.applied_filters,
      metadata: {
        source: 'packages_list_decision_summary',
        first_candidate: true,
        first_candidate_price: firstVisibleMinPrice,
        first_candidate_reason: firstVisibleDecisionReasonText,
        ...packageCtaDecisionMetadata,
      },
    });
  }, [
    effectiveIntent,
    firstVisibleDecisionReasonText,
    firstVisibleMinPrice,
    firstVisiblePackage,
    firstVisiblePackageTitle,
    handoffBudget,
    handoffDestination,
    handoffPartyType,
    packageCtaDecisionMetadata,
    selectedProductNames,
  ]);

  const trackEmptyStateRecoveryCta = useCallback((ctaType: string) => {
    trackEngagement({
      event_type: ANALYTICS_EVENTS.stickyCtaClicked,
      cta_type: ctaType,
      page_url: '/packages',
      intent: effectiveIntent,
      budget: handoffBudget,
      destination: handoffDestination,
      party_type: handoffPartyType,
      selected_products: selectedProductNames.length > 0 ? selectedProductNames : null,
      ready_count: packageCtaDecisionMetadata.ready_count,
      missing_fields: packageCtaDecisionMetadata.missing_fields,
      decision_summary: packageCtaDecisionMetadata.decision_summary,
      handoff_preview: packageCtaDecisionMetadata.handoff_preview,
      next_action: packageCtaDecisionMetadata.next_action,
      result_summary: packageCtaDecisionMetadata.result_summary,
      applied_filters: packageCtaDecisionMetadata.applied_filters,
      metadata: {
        source: ctaType,
        zero_result: true,
        recovery_actions: emptyStateRecoveryActions.map((item) => item.key),
        ...packageCtaDecisionMetadata,
      },
    });
  }, [
    emptyStateRecoveryActions,
    handoffBudget,
    handoffDestination,
    handoffPartyType,
    packageCtaDecisionMetadata,
    effectiveIntent,
    selectedProductNames,
  ]);

  const trackScarceResultRecoveryCta = useCallback((ctaType: string) => {
    trackEngagement({
      event_type: ANALYTICS_EVENTS.stickyCtaClicked,
      cta_type: ctaType,
      page_url: '/packages',
      intent: effectiveIntent,
      budget: handoffBudget,
      destination: handoffDestination,
      party_type: handoffPartyType,
      selected_products: selectedProductNames.length > 0 ? selectedProductNames : null,
      ready_count: packageCtaDecisionMetadata.ready_count,
      missing_fields: packageCtaDecisionMetadata.missing_fields,
      decision_summary: packageCtaDecisionMetadata.decision_summary,
      handoff_preview: packageCtaDecisionMetadata.handoff_preview,
      next_action: scarceResultNextActionText,
      result_summary: packageCtaDecisionMetadata.result_summary,
      applied_filters: packageCtaDecisionMetadata.applied_filters,
      metadata: {
        source: ctaType,
        scarce_result: true,
        scarce_result_count: filteredPackages.length,
        recovery_actions: emptyStateRecoveryActions.map((item) => item.key),
        ...packageCtaDecisionMetadata,
      },
    });
  }, [
    effectiveIntent,
    emptyStateRecoveryActions,
    filteredPackages.length,
    handoffBudget,
    handoffDestination,
    handoffPartyType,
    packageCtaDecisionMetadata,
    scarceResultNextActionText,
    selectedProductNames,
  ]);

  const trackPackagesAiPromptStart = useCallback((source: string, resultContext: 'empty' | 'scarce') => {
    trackEngagement({
      event_type: ANALYTICS_EVENTS.aiPromptStarted,
      cta_type: source,
      page_url: '/packages',
      intent: effectiveIntent,
      budget: handoffBudget,
      destination: handoffDestination,
      party_type: handoffPartyType,
      selected_products: selectedProductNames.length > 0 ? selectedProductNames : null,
      ready_count: packageCtaDecisionMetadata.ready_count,
      missing_fields: packageCtaDecisionMetadata.missing_fields,
      decision_summary: packageCtaDecisionMetadata.decision_summary,
      handoff_preview: packageCtaDecisionMetadata.handoff_preview,
      next_action: packageCtaDecisionMetadata.next_action,
      result_summary: packageCtaDecisionMetadata.result_summary,
      applied_filters: packageCtaDecisionMetadata.applied_filters,
      metadata: {
        source,
        result_context: resultContext,
        ai_result_count: filteredPackages.length,
        concierge_query: conciergeQuery,
        ...packageCtaDecisionMetadata,
      },
    });
  }, [
    conciergeQuery,
    effectiveIntent,
    filteredPackages.length,
    handoffBudget,
    handoffDestination,
    handoffPartyType,
    packageCtaDecisionMetadata,
    selectedProductNames,
  ]);

  const trackCompareGroupInquiry = useCallback((source: string) => {
    trackEngagement({
      event_type: ANALYTICS_EVENTS.stickyCtaClicked,
      cta_type: source,
      page_url: '/packages',
      intent: effectiveIntent,
      budget: handoffBudget,
      destination: handoffDestination,
      party_type: handoffPartyType,
      selected_products: selectedProductNames.length > 0 ? selectedProductNames : null,
      ready_count: primaryFilterReadyCount,
      missing_fields: primaryFilterMissingLabels,
      decision_summary: packageListDecisionSummaryText,
      handoff_preview: packageHandoffPreviewText,
      next_action: compareNextActionText,
      result_summary: packageResultSummaryText,
      applied_filters: packageAppliedFilterSummaryText,
      metadata: {
        source,
        compare_ids: compareIds,
        compare_count: compareIds.length,
        selectedIntent: effectiveIntent,
        hub,
        next_action: compareNextActionText,
        cta_readiness: compareCtaReadinessText,
      },
    });
  }, [compareCtaReadinessText, compareIds, compareNextActionText, effectiveIntent, handoffBudget, handoffDestination, handoffPartyType, hub, packageAppliedFilterSummaryText, packageHandoffPreviewText, packageListDecisionSummaryText, packageResultSummaryText, primaryFilterMissingLabels, primaryFilterReadyCount, selectedProductNames]);

  const openPackagesKakao = useCallback((source: string) => {
    trackEngagement({
      event_type: ANALYTICS_EVENTS.kakaoClicked,
      cta_type: source,
      page_url: '/packages',
      intent: effectiveIntent,
      budget: handoffBudget,
      destination: handoffDestination,
      party_type: handoffPartyType,
      selected_products: selectedProductNames.length > 0 ? selectedProductNames : null,
      ready_count: packageCtaDecisionMetadata.ready_count,
      missing_fields: packageCtaDecisionMetadata.missing_fields,
      decision_summary: packageCtaDecisionMetadata.decision_summary,
      handoff_preview: packageCtaDecisionMetadata.handoff_preview,
      next_action: packageCtaDecisionMetadata.next_action,
      result_summary: packageCtaDecisionMetadata.result_summary,
      applied_filters: packageCtaDecisionMetadata.applied_filters,
      metadata: {
        source,
        selectedProductNames,
        ...packageCtaDecisionMetadata,
      },
    });
    void openKakaoChannel({
      intent: handoffIntent,
      budget: handoffBudget,
      destination: handoffDestination,
      party_type: handoffPartyType,
      selected_products: selectedProductNames,
      escalationSummary: handoffSummary,
    });
  }, [
    handoffBudget,
    handoffDestination,
    handoffIntent,
    handoffPartyType,
    handoffSummary,
    packageCtaDecisionMetadata,
    effectiveIntent,
    selectedProductNames,
  ]);

  useEffect(() => {
    for (const pkg of visiblePackages) {
      const score = scoreByPkgId[pkg.id];
      if (!score?.hasComparison || trackedRecommendViewsRef.current.has(pkg.id)) continue;
      trackedRecommendViewsRef.current.add(pkg.id);
      trackScoreSignal({
        packageId: pkg.id,
        signalType: 'recommend_badge_view',
        groupKey: effectiveIntent ? `intent:${effectiveIntent}` : undefined,
        rank: score.rankInGroup,
      });
    }
  }, [effectiveIntent, scoreByPkgId, trackScoreSignal, visiblePackages]);

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

  const visiblePackageTrackingById = useMemo(() => {
    const map = new Map<string, { productName: string; rank: number; price: number | null }>();
    visiblePackages.forEach((pkg, index) => {
      map.set(pkg.id, {
        productName: pkg.display_title || pkg.products?.display_name || pkg.title,
        rank: index + 1,
        price: minPriceByPkgId.get(pkg.id) ?? pkg.price ?? null,
      });
    });
    return map;
  }, [minPriceByPkgId, visiblePackages]);

  const catalogGroupSizeMap = useMemo(() => {
    const map = new Map<string, number>();
    for (const p of initialPackages) {
      if (!p.catalog_id) continue;
      map.set(p.catalog_id, (map.get(p.catalog_id) || 0) + 1);
    }
    return map;
  }, [initialPackages]);

  const trackClick = useCallback((id: string) => {
    const tracking = visiblePackageTrackingById.get(id);
    trackEngagement({
      event_type: ANALYTICS_EVENTS.packageCardClicked,
      page_url: '/packages',
      event_source: 'list',
      product_id: id,
      product_name: tracking?.productName ?? id,
      intent: effectiveIntent,
      rank: tracking?.rank ?? null,
      price: tracking?.price ?? null,
      metadata: {
        source: 'list',
        rank: tracking?.rank ?? null,
        price: tracking?.price ?? null,
        selectedIntent: effectiveIntent,
        hub,
      },
    });
  }, [effectiveIntent, hub, visiblePackageTrackingById]);

  const trackPackageFilter = useCallback((filterName: string, value: string) => {
    trackEngagement({
      event_type: ANALYTICS_EVENTS.packageFilterApplied,
      filter_name: filterName,
      filter_value: value,
      page_url: '/packages',
      intent: effectiveIntent,
      budget: handoffBudget,
      destination: handoffDestination,
      party_type: handoffPartyType,
      ready_count: primaryFilterReadyCount,
      missing_fields: primaryFilterMissingLabels,
      decision_summary: packageListDecisionSummaryText,
      handoff_preview: packageHandoffPreviewText,
      next_action: packageFilterNextActionText,
      result_summary: packageResultSummaryText,
      applied_filters: packageAppliedFilterSummaryText,
      metadata: {
        filterName,
        value,
        selectedIntent: effectiveIntent,
        hub,
        resultCount: filteredPackages.length,
        ready_count: primaryFilterReadyCount,
        missing_fields: primaryFilterMissingLabels,
        decision_summary: packageListDecisionSummaryText,
        next_action: packageFilterNextActionText,
        result_summary: packageResultSummaryText,
        applied_filters: packageAppliedFilterSummaryText,
        handoff_preview: packageHandoffPreviewText,
      },
    });
  }, [
    filteredPackages.length,
    handoffBudget,
    handoffDestination,
    handoffPartyType,
    hub,
    packageAppliedFilterSummaryText,
    packageFilterNextActionText,
    packageHandoffPreviewText,
    packageListDecisionSummaryText,
    packageResultSummaryText,
    primaryFilterMissingLabels,
    primaryFilterReadyCount,
    effectiveIntent,
  ]);

  const focusPrimaryFilterControl = useCallback((key: PrimaryFilterKey) => {
    const target = {
      month: monthFilterRef.current,
      hub: hubFilterRef.current,
      intent: purposeFilterRef.current,
      budget: budgetFilterRef.current,
    }[key];
    trackPackageFilter('primary_filter_prompt', key);
    target?.focus();
  }, [trackPackageFilter]);

  const handleIntentSelect = useCallback((intent: IntentId) => {
    const nextIntent = selectedIntent === intent ? null : intent;
    const params = new URLSearchParams(searchParams.toString());
    if (nextIntent) params.set('intent', nextIntent);
    else params.delete('intent');
    const qs = params.toString();
    requestPackageResultsFocus();
    setSelectedIntent(nextIntent);
    router.push(qs ? `/packages?${qs}` : '/packages');
    trackScoreSignal({
      signalType: 'intent_chip_select',
      groupKey: `intent:${intent}:${nextIntent ? 'on' : 'off'}`,
      intent: nextIntent ?? intent,
    });
    const nextFilterChecklist = primaryFilterChecklist.map((item) => (
      item.label === '여행 목적' ? { ...item, complete: Boolean(nextIntent) } : item
    ));
    const nextMissingFields = nextFilterChecklist
      .filter((item) => !item.complete)
      .map((item) => item.label);
    const nextReadyCount = nextFilterChecklist.length - nextMissingFields.length;
    trackEngagement({
      event_type: ANALYTICS_EVENTS.packageFilterApplied,
      filter_name: 'intent',
      filter_value: intent,
      page_url: '/packages',
      intent: nextIntent ?? null,
      budget: formatBudgetSummary(priceMin, priceMax),
      destination: destination || (activeFilter !== FILTER_OPTIONS[0] ? activeFilter : null),
      party_type: INTENT_PARTY_TYPE[nextIntent ?? intent] ?? null,
      ready_count: nextReadyCount,
      missing_fields: nextMissingFields,
      decision_summary: packageListDecisionSummaryText,
      handoff_preview: packageHandoffPreviewText,
      next_action: packageFilterNextActionText,
      result_summary: packageResultSummaryText,
      applied_filters: packageAppliedFilterSummaryText,
      metadata: {
        filterName: 'intent',
        value: intent,
        state: nextIntent ? 'on' : 'off',
        selectedIntent: nextIntent,
        hub,
        resultCount: filteredPackages.length,
        ready_count: nextReadyCount,
        missing_fields: nextMissingFields,
        decision_summary: packageListDecisionSummaryText,
        next_action: packageFilterNextActionText,
        result_summary: packageResultSummaryText,
        applied_filters: packageAppliedFilterSummaryText,
        handoff_preview: packageHandoffPreviewText,
      },
    });
    if (intent === 'budget') setSortBy('price_asc');
    if (selectedIntent === 'budget' && intent === 'budget') setSortBy('recommended');
    if (intent === 'consult') {
      trackEngagement({
        event_type: ANALYTICS_EVENTS.kakaoClicked,
        cta_type: 'packages_intent_consult_chip',
        page_url: '/packages',
        intent: nextIntent ?? intent,
        budget: formatBudgetSummary(priceMin, priceMax),
        destination: destination || (activeFilter !== FILTER_OPTIONS[0] ? activeFilter : null),
        party_type: INTENT_PARTY_TYPE[nextIntent ?? intent] ?? null,
        ready_count: nextReadyCount,
        missing_fields: nextMissingFields,
        decision_summary: packageListDecisionSummaryText,
        handoff_preview: packageHandoffPreviewText,
        next_action: packageFilterNextActionText,
        result_summary: packageResultSummaryText,
        applied_filters: packageAppliedFilterSummaryText,
        metadata: {
          source: 'packages_intent_consult_chip',
          selectedIntent: nextIntent,
          hub,
          ready_count: nextReadyCount,
          missing_fields: nextMissingFields,
          decision_summary: packageListDecisionSummaryText,
          next_action: packageFilterNextActionText,
          handoff_preview: packageHandoffPreviewText,
        },
      });
      void openKakaoChannel({
        intent: INTENT_HANDOFF_LABELS[nextIntent ?? intent] ?? intent,
        budget: formatBudgetSummary(priceMin, priceMax),
        destination: destination || (activeFilter !== FILTER_OPTIONS[0] ? activeFilter : null),
        party_type: INTENT_PARTY_TYPE[nextIntent ?? intent] ?? null,
        escalationSummary: [
          q ? `검색어: ${q}` : null,
          month ? `출발월: ${formatMonthSummary(month)}` : null,
          `출발지: ${HUB_SUMMARY_LABELS[hub]}`,
        ].filter(Boolean).join('\n'),
      });
    }
  }, [
    activeFilter,
    destination,
    filteredPackages.length,
    hub,
    month,
    packageAppliedFilterSummaryText,
    packageFilterNextActionText,
    packageHandoffPreviewText,
    packageListDecisionSummaryText,
    packageResultSummaryText,
    priceMax,
    priceMin,
    primaryFilterChecklist,
    q,
    requestPackageResultsFocus,
    router,
    searchParams,
    selectedIntent,
    trackScoreSignal,
  ]);

  const currentBudgetValue = useMemo(() => {
    const matched = BUDGET_FILTER_OPTIONS.find(opt => opt.min === priceMin && opt.max === priceMax);
    if (matched) return matched.value;
    return priceMin || priceMax ? 'custom' : '';
  }, [priceMax, priceMin]);

  const updatePackageQuery = useCallback((updates: Record<string, string | null>) => {
    requestPackageResultsFocus();
    const p = new URLSearchParams(searchParams.toString());
    Object.entries(updates).forEach(([key, value]) => {
      if (value) p.set(key, value);
      else p.delete(key);
    });
    const qs = p.toString();
    router.push(qs ? `/packages?${qs}` : '/packages');
  }, [requestPackageResultsFocus, router, searchParams]);

  const handleMonthFilterChange = useCallback((value: string) => {
    updatePackageQuery({ month: value || null });
    trackPackageFilter('departure_month', value || 'all');
  }, [trackPackageFilter, updatePackageQuery]);

  const handleBudgetFilterChange = useCallback((value: string) => {
    const selected = BUDGET_FILTER_OPTIONS.find(opt => opt.value === value) ?? BUDGET_FILTER_OPTIONS[0];
    updatePackageQuery({
      priceMin: selected.min || null,
      priceMax: selected.max || null,
    });
    trackPackageFilter('budget', selected.value || 'all');
  }, [trackPackageFilter, updatePackageQuery]);

  const handlePurposeFilterChange = useCallback((value: string) => {
    if (!value) {
      setSelectedIntent(null);
      updatePackageQuery({ intent: null });
      trackPackageFilter('intent', 'all');
      return;
    }
    if (value !== selectedIntent) handleIntentSelect(value as IntentId);
  }, [handleIntentSelect, selectedIntent, trackPackageFilter, updatePackageQuery]);

  const handleRegionFilterChange = useCallback((value: string) => {
    setActiveFilter(value);
    updatePackageQuery({ filter: value === FILTER_OPTIONS[0] ? null : value });
    trackPackageFilter('region', value);
  }, [trackPackageFilter, updatePackageQuery]);

  const handleMobileFilterClear = useCallback((key: string) => {
    if (key === 'hub') {
      navigateWithHub(DEFAULT_DEPARTURE_HUB);
      trackPackageFilter('clear_departure_hub', DEFAULT_DEPARTURE_HUB);
      return;
    }
    if (key === 'intent') {
      setSelectedIntent(null);
      updatePackageQuery({ intent: null });
      trackPackageFilter('clear_intent', 'all');
      return;
    }
    if (key === 'budget') {
      updatePackageQuery({ priceMin: null, priceMax: null });
      trackPackageFilter('clear_budget', 'all');
      return;
    }
    if (key === 'region') {
      setActiveFilter(FILTER_OPTIONS[0]);
      updatePackageQuery({ filter: null });
      trackPackageFilter('clear_region', 'all');
      return;
    }
    if (key === 'month') {
      updatePackageQuery({ month: null });
      trackPackageFilter('clear_departure_month', 'all');
      return;
    }
    if (key === 'destination') {
      updatePackageQuery({ destination: null });
      trackPackageFilter('clear_destination', 'all');
      return;
    }
    if (key === 'category') {
      updatePackageQuery({ category: null });
      trackPackageFilter('clear_category', 'all');
      return;
    }
    if (key === 'urgency') {
      updatePackageQuery({ urgency: null });
      trackPackageFilter('clear_urgency', 'all');
      return;
    }
    if (key === 'q') {
      updatePackageQuery({ q: null });
      trackPackageFilter('clear_query', 'all');
    }
  }, [navigateWithHub, trackPackageFilter, updatePackageQuery]);

  const hasActivePackageFilters = Boolean(
    destination ||
      q ||
      month ||
      priceMin ||
      priceMax ||
      urgency ||
      category ||
      selectedIntent ||
      activeFilter !== FILTER_OPTIONS[0] ||
      hub !== DEFAULT_DEPARTURE_HUB,
  );

  const resetPackageFilters = useCallback(() => {
    requestPackageResultsFocus();
    setSelectedIntent(null);
    setActiveFilter(FILTER_OPTIONS[0]);
    setSortBy('recommended');
    setShowMoreFilters(false);
    trackPackageFilter('reset', 'all');
    router.push('/packages');
  }, [requestPackageResultsFocus, router, trackPackageFilter]);

  const handleMoreFiltersToggle = useCallback(() => {
    setShowMoreFilters((current) => {
      const next = !current;
      trackPackageFilter('more_filters_panel', next ? 'open' : 'closed');
      return next;
    });
  }, [trackPackageFilter]);

  const closeMoreFiltersFromEscape = useCallback(() => {
    setShowMoreFilters((current) => {
      if (!current) return current;
      trackPackageFilter('more_filters_panel', 'closed_escape');
      return false;
    });
  }, [trackPackageFilter]);

  const handleMoreFiltersEscape = useCallback((event: ReactKeyboardEvent<HTMLElement>) => {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    event.stopPropagation();
    closeMoreFiltersFromEscape();
  }, [closeMoreFiltersFromEscape]);

  useEffect(() => {
    if (!showMoreFilters) return undefined;
    const handleDocumentKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      closeMoreFiltersFromEscape();
    };
    window.addEventListener('keydown', handleDocumentKeyDown, true);
    return () => window.removeEventListener('keydown', handleDocumentKeyDown, true);
  }, [closeMoreFiltersFromEscape, showMoreFilters]);

  useEffect(() => {
    if (showMoreFilters) {
      moreFiltersWasOpenRef.current = true;
      const focusTimer = window.setTimeout(() => moreFiltersFirstControlRef.current?.focus({ preventScroll: true }), 80);
      return () => window.clearTimeout(focusTimer);
    }
    if (moreFiltersWasOpenRef.current) {
      moreFiltersWasOpenRef.current = false;
      window.setTimeout(() => moreFiltersToggleRef.current?.focus(), 0);
    }
    return undefined;
  }, [showMoreFilters]);

  const handleLoadMore = useCallback(() => {
    const nextVisibleCount = Math.min(visibleCount + VISIBLE_STEP, filteredPackages.length);
    setVisibleCount(nextVisibleCount);
    trackPackageFilter('list_visible_count', String(nextVisibleCount));
  }, [filteredPackages.length, trackPackageFilter, visibleCount]);

  const listTopRef = useRef<HTMLDivElement>(null);
  if (isLoading) return <Loading />;

  return (
    <div className={`min-h-screen bg-white ${compareIds.length >= 2 ? 'pb-[calc(23rem+env(safe-area-inset-bottom))] md:pb-28' : 'pb-36 md:pb-0'}`}>
      <GlobalNav />
      <a href={consultTelHref || groupInquiryHref} className="sr-only">
        여행 상품 문의
      </a>
      <p
        id={compareStatusId}
        className="sr-only"
        role="status"
        aria-live="polite"
        aria-atomic="true"
      >
        {compareStatusText}
      </p>
      <p id={compareHelpId} className="sr-only">
        {compareHelpText}
      </p>

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
            initialIntent={selectedIntent ?? ''}
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
          <h2 id={packageFilterGroupTitleId} className="sr-only">패키지 검색 필터</h2>
          <p id={packageFilterHelpId} className="sr-only">
            필터를 변경하면 현재 조건과 상품 결과 수가 바로 갱신됩니다.
          </p>
          <p id={packageFilterGroupDescriptionId} className="sr-only">
            {packageFilterGroupDescriptionText}
          </p>
          <div
            className="flex items-center gap-2 overflow-x-auto no-scrollbar"
            role="group"
            aria-labelledby={packageFilterGroupTitleId}
            aria-describedby={packageFilterDescriptionIds}
          >
            <select
              ref={monthFilterRef}
              data-testid="packages-month-filter"
              aria-label="출발월"
              aria-describedby={packageFilterDescriptionIds}
              aria-controls="packages-list"
              className="h-[36px] shrink-0 rounded-full border border-[#E5E7EB] bg-white px-3 text-[13px] font-bold text-text-primary"
              value={month}
              onChange={e => handleMonthFilterChange(e.target.value)}
            >
              <option value="">출발월 전체</option>
              {MONTH_FILTER_OPTIONS.map(opt => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
            <select
              ref={hubFilterRef}
              aria-label="출발지"
              aria-describedby={packageFilterDescriptionIds}
              aria-controls="packages-list"
              className="h-[36px] shrink-0 rounded-full border border-[#E5E7EB] bg-white px-3 text-[13px] font-bold text-text-primary"
              value={hub}
              onChange={e => {
                const nextHub = e.target.value as DepartureHubId;
                navigateWithHub(nextHub);
                trackPackageFilter('departure_hub', nextHub);
              }}
            >
              {DEPARTURE_HUB_OPTIONS.map(opt => (
                <option key={opt.id} value={opt.id}>{opt.label}</option>
              ))}
            </select>
            <select
              ref={purposeFilterRef}
              aria-label="여행 목적"
              aria-describedby={packageFilterDescriptionIds}
              aria-controls="packages-list"
              className="h-[36px] shrink-0 rounded-full border border-[#E5E7EB] bg-white px-3 text-[13px] font-bold text-text-primary"
              value={selectedIntent ?? ''}
              onChange={e => handlePurposeFilterChange(e.target.value)}
            >
              <option value="">여행 목적 전체</option>
              {INTENT_OPTIONS.map(opt => (
                <option key={opt.id} value={opt.id}>{opt.label}</option>
              ))}
            </select>
            <select
              ref={budgetFilterRef}
              aria-label="예산"
              aria-describedby={packageFilterDescriptionIds}
              aria-controls="packages-list"
              className="h-[36px] shrink-0 rounded-full border border-[#E5E7EB] bg-white px-3 text-[13px] font-bold text-text-primary"
              value={currentBudgetValue === 'custom' ? '' : currentBudgetValue}
              onChange={e => handleBudgetFilterChange(e.target.value)}
            >
              {BUDGET_FILTER_OPTIONS.map(opt => (
                <option key={opt.value || 'all'} value={opt.value}>{opt.label}</option>
              ))}
            </select>
            <button
              type="button"
              ref={moreFiltersToggleRef}
              data-testid="packages-more-filters-toggle"
              onClick={handleMoreFiltersToggle}
              aria-expanded={showMoreFilters}
              aria-controls="package-more-filters"
              aria-describedby={packageFilterDescriptionIds}
              className={`h-[36px] shrink-0 rounded-full border px-3.5 text-[13px] font-bold transition ${
                showMoreFilters
                  ? 'border-brand bg-brand text-white'
                  : 'border-[#E5E7EB] bg-white text-text-body hover:border-brand/50 hover:text-brand'
              }`}
            >
              더 많은 필터
            </button>
          </div>
          <div
            id="package-more-filters"
            role="region"
            aria-label="추가 패키지 필터"
            aria-describedby={packageFilterDescriptionIds}
            className={`${showMoreFilters ? 'mt-2 flex' : 'hidden'} items-center gap-2.5 overflow-x-auto no-scrollbar pb-1`}
          >
            <div className="relative shrink-0">
              <select
                ref={moreFiltersFirstControlRef}
                aria-label="정렬 순서"
                aria-describedby={packageFilterDescriptionIds}
                aria-controls="packages-list"
                onKeyDown={handleMoreFiltersEscape}
                className="h-[34px] text-[13px] border border-[#E5E7EB] rounded-full pl-3 pr-7 bg-white text-text-primary appearance-none cursor-pointer font-medium"
                value={sortBy}
                onChange={e => {
                  const nextSort = e.target.value;
                  setSortBy(nextSort);
                  trackPackageFilter('sort', nextSort);
                }}
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
                aria-pressed={activeFilter === f}
                aria-describedby={packageFilterDescriptionIds}
                aria-controls="packages-list"
                className={`shrink-0 h-[34px] px-3.5 text-[13px] font-medium rounded-full border transition card-touch ${
                  activeFilter === f
                    ? 'bg-brand text-white border-brand shadow-sm'
                    : 'bg-white text-text-body border-[#E5E7EB] hover:border-brand/40 hover:text-brand'
                }`}
                onKeyDown={handleMoreFiltersEscape}
                onClick={() => handleRegionFilterChange(f)}
              >
                {f}
              </button>
            ))}
          </div>
          <div
            id={packageMobileAppliedFilterSummaryId}
            data-testid="packages-mobile-applied-filter-summary"
            aria-label={packageMobileAppliedFilterSummaryText}
            className="mt-2 flex items-center gap-2 overflow-x-auto pb-1 md:hidden [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          >
            <span className="shrink-0 rounded-full bg-brand-light px-2.5 py-1 text-[11px] font-extrabold text-brand">
              기준 {HUB_SUMMARY_LABELS[hub]}
            </span>
            <span className="shrink-0 rounded-full border border-[#DCE5F0] bg-white px-2.5 py-1 text-[11px] font-bold text-text-primary">
              결과 {filteredPackages.length}개
            </span>
            <span className="shrink-0 rounded-full border border-[#DCE5F0] bg-white px-2.5 py-1 text-[11px] font-bold text-text-primary">
              적용 조건 {mobileAppliedFilterItems.length}
            </span>
            {mobileAppliedFilterItems.map((item) => (
              <button
                type="button"
                key={`mobile:${item.label}:${item.value}`}
                onClick={() => handleMobileFilterClear(item.key)}
                aria-label={`${item.clearLabel}: ${item.label} ${item.value}`}
                aria-describedby={packageFilterDescriptionIds}
                className="inline-flex h-7 shrink-0 items-center gap-1 rounded-full border border-[#E5E7EB] bg-white pl-2.5 pr-2 text-[11px] font-semibold text-text-secondary transition hover:border-brand/60 hover:bg-brand-light hover:text-brand"
              >
                <span>{item.label} {item.value}</span>
                <X className="h-3 w-3" aria-hidden="true" strokeWidth={2.4} />
              </button>
            ))}
            {hasActivePackageFilters && (
              <button
                type="button"
                onClick={resetPackageFilters}
                aria-label="패키지 필터 조건 모두 초기화"
                aria-describedby={packageFilterDescriptionIds}
                className="shrink-0 rounded-full border border-[#D1DCE8] bg-white px-2.5 py-1 text-[11px] font-bold text-brand transition hover:border-brand/60 hover:bg-brand-light"
              >
                초기화
              </button>
            )}
          </div>
        </div>
      </div>

      <section className="px-4 pt-3 md:max-w-7xl md:mx-auto md:px-8" aria-label="현재 검색 조건" aria-describedby={packageResultSummaryId}>
        <div className="rounded-[18px] border border-[#E5E7EB] bg-[#F8FAFC] p-3 md:flex md:items-center md:justify-between md:gap-4">
          <div id={packageFilterSummaryId} className="flex items-center justify-between gap-3 md:shrink-0">
            <p className="text-[13px] font-bold text-text-primary">현재 조건</p>
            <span className="text-[12px] font-semibold text-brand">{filteredPackages.length}개 상품</span>
          </div>
          <div className="mt-2 flex gap-2 overflow-x-auto no-scrollbar md:mt-0 md:justify-end">
            {filterSummaryItems.map(item => (
              <span
                key={`${item.label}:${item.value}`}
                className="shrink-0 rounded-full border border-[#DCE5F0] bg-white px-3 py-1.5 text-[12px] font-semibold text-text-body"
              >
                <span className="text-text-secondary">{item.label}</span>
                <span className="mx-1 text-[#CBD5E1]">|</span>
                {item.value}
              </span>
            ))}
            {hasActivePackageFilters && (
              <button
                type="button"
                onClick={resetPackageFilters}
                aria-label="패키지 필터 조건 모두 초기화"
                aria-describedby={packageFilterDescriptionIds}
                className="shrink-0 rounded-full border border-[#D1DCE8] bg-white px-3 py-1.5 text-[12px] font-bold text-brand transition hover:border-brand/60 hover:bg-brand-light"
              >
                조건 초기화
              </button>
            )}
          </div>
        </div>
        <div
          data-testid="packages-filter-readiness-summary"
          aria-label={primaryFilterReadinessText}
          className="mt-2 rounded-[14px] border border-[#DCE5F0] bg-white px-3 py-2"
        >
          <div className="flex items-center justify-between gap-3">
            <span className="shrink-0 text-[12px] font-extrabold text-text-primary">
              핵심 조건 준비 {primaryFilterReadyCount}/{primaryFilterChecklist.length}
            </span>
            <span className="min-w-0 truncate text-right text-[12px] font-semibold text-text-secondary">
              {primaryFilterMissingLabels.length > 0
                ? `보완 추천: ${primaryFilterMissingLabels.join(', ')}`
                : '상담 전달 준비 완료'}
            </span>
          </div>
          <div
            className="mt-2 flex gap-1.5 overflow-x-auto no-scrollbar"
            data-testid="packages-filter-readiness-chips"
          >
            {primaryFilterChecklist.map((item) => {
              const filterReadinessChipLabel = `${item.complete ? '완료' : '추천'} · ${item.label}`;
              return item.complete ? (
                <span
                  key={`primary-filter:${item.label}`}
                  className="shrink-0 rounded-full border border-brand/20 bg-brand-light px-2.5 py-1 text-[11px] font-bold text-brand"
                >
                  {item.complete ? '완료' : '추천'} · {item.label}
                </span>
              ) : (
                <button
                  key={`primary-filter:${item.label}`}
                  type="button"
                  onClick={() => focusPrimaryFilterControl(item.key)}
                  aria-label={`${filterReadinessChipLabel} 조건 선택하기`}
                  aria-describedby={packageFilterDescriptionIds}
                  className="shrink-0 rounded-full border border-[#E5E7EB] bg-[#F8FAFC] px-2.5 py-1 text-[11px] font-bold text-text-secondary transition hover:border-brand/50 hover:bg-brand-light hover:text-brand"
                >
                  {item.complete ? '완료' : '추천'} · {item.label}
                </button>
              );
            })}
          </div>
          <p
            data-testid="packages-filter-next-action"
            className="mt-2 text-[12px] font-semibold leading-5 text-text-secondary"
          >
            {packageFilterNextActionText}
          </p>
        </div>
        <div
          data-testid="packages-handoff-preview"
          aria-label={packageHandoffPreviewText}
          className="mt-2 rounded-[14px] border border-[#DCE5F0] bg-white px-3 py-2"
        >
          <div className="flex items-center justify-between gap-3">
            <span className="shrink-0 text-[12px] font-extrabold text-text-primary">견적 문의에 전달</span>
            <span className="min-w-0 truncate text-right text-[12px] font-semibold text-brand">
              {selectedProductNames.length > 0 ? `비교 ${selectedProductNames.length}개 포함` : '조건 기반 상담'}
            </span>
          </div>
          <div className="mt-2 flex gap-1.5 overflow-x-auto no-scrollbar">
            {packageHandoffPreviewItems.map((item) => (
              <span
                key={`handoff:${item.label}:${item.value}`}
                className="shrink-0 rounded-full border border-[#E5E7EB] bg-[#F8FAFC] px-2.5 py-1 text-[11px] font-bold text-text-body"
              >
                <span className="text-text-secondary">{item.label}</span>
                <span className="mx-1 text-[#CBD5E1]">/</span>
                {item.value}
              </span>
            ))}
          </div>
        </div>
      </section>

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
              aria-pressed={selectedIntent === opt.id}
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

      <p
        id={packageResultSummaryId}
        data-testid="packages-result-summary"
        className="sr-only"
        role={packageResultSummaryLive ? 'status' : undefined}
        aria-live="polite"
        aria-atomic="true"
      >
        {packageResultSummaryText}
      </p>
      <p
        id={packageFilterReadinessSummaryId}
        className="sr-only"
        role={filterReadinessLive ? 'status' : undefined}
        aria-live="polite"
        aria-atomic="true"
      >
        {primaryFilterReadinessText}
      </p>

      <section
        ref={packageListDecisionSummaryRef}
        id={packageListDecisionSummaryId}
        data-testid="packages-list-decision-summary"
        tabIndex={-1}
        aria-label={packageListDecisionSummaryText}
        className="mx-4 mb-3 rounded-[16px] border border-[#DCE5F0] bg-white p-3 md:mx-auto md:max-w-7xl md:px-4"
      >
        <div className="grid grid-cols-3 gap-2">
          {[
            { label: '결과', value: `${filteredPackages.length}개` },
            { label: '비교', value: compareIds.length > 0 ? `${compareIds.length}개 선택` : '선택 없음' },
            { label: '다음', value: primaryFilterMissingLabels.length > 0 ? primaryFilterMissingLabels[0] : compareIds.length > 0 ? '견적 전달' : '비교/상담' },
          ].map((item) => (
            <div key={item.label} className="min-w-0 rounded-[12px] bg-[#F8FAFC] px-2.5 py-2">
              <p className="text-[10px] font-bold text-text-secondary">{item.label}</p>
              <p className="mt-0.5 truncate text-[12px] font-extrabold text-text-primary">{item.value}</p>
            </div>
          ))}
        </div>
        <p className="mt-2 text-[12px] font-semibold leading-5 text-text-secondary">
          {packageFilterNextActionText}
        </p>
        <p
          data-testid="packages-list-next-action-detail"
          aria-label={packageListNextActionDetailText}
          className="mt-2 rounded-[12px] bg-[#EFF6FF] px-3 py-2 text-[12px] font-bold leading-5 text-[#1D4ED8]"
        >
          {packageListNextActionDetailText}
        </p>
        {firstVisiblePackage && firstVisibleDetailHref && (
          <div
            data-testid="packages-first-candidate-actions"
            className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2"
          >
            <button
              type="button"
              onClick={handleFirstVisibleCompare}
              aria-pressed={firstVisibleIsCompared}
              aria-describedby={packageListDescriptionIds}
              className={`inline-flex h-10 items-center justify-center gap-2 rounded-full border px-4 text-[13px] font-extrabold transition ${
                firstVisibleIsCompared
                  ? 'border-brand/30 bg-brand-light text-brand'
                  : 'border-[#D7E3F3] bg-white text-text-primary hover:border-brand/60 hover:text-brand'
              }`}
            >
              {firstVisibleIsCompared ? (
                <Check className="h-4 w-4" aria-hidden="true" strokeWidth={2.4} />
              ) : (
                <Plus className="h-4 w-4" aria-hidden="true" strokeWidth={2.4} />
              )}
              {firstVisibleIsCompared ? '첫 후보 비교 담김' : '첫 후보 비교 담기'}
            </button>
            <Link
              href={firstVisibleDetailHref}
              onClick={trackFirstVisibleDetailCta}
              aria-describedby={packageListDescriptionIds}
              className="inline-flex h-10 items-center justify-center gap-2 rounded-full bg-brand px-4 text-[13px] font-extrabold text-white transition hover:bg-brand-dark"
            >
              첫 후보 상세 보기
              <ArrowRight className="h-4 w-4" aria-hidden="true" strokeWidth={2.4} />
            </Link>
          </div>
        )}
      </section>

      <div ref={listTopRef} id="packages-list" aria-describedby={packageListDescriptionIds} />
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
            <div className="flex flex-col items-center gap-4 py-12 px-4">
              <Search className="h-14 w-14 text-slate-200" aria-hidden="true" strokeWidth={1.4} />
              <div className="text-center space-y-1">
                <p className="text-[15px] font-semibold text-text-primary">
                  {activeFilter !== '전체' ? `'${activeFilter}' 상품이 없습니다` : '조건에 맞는 상품이 없습니다'}
                </p>
                <p className="text-[13px] text-text-secondary">조건을 조금 넓히거나 상담으로 바로 이어갈 수 있습니다</p>
              </div>
              <div
                id={packageEmptyStateSummaryId}
                data-testid="packages-empty-state-summary"
                aria-label={packageEmptyStateSummaryText}
                className="w-full max-w-xl rounded-2xl border border-[#E5E7EB] bg-white p-4 text-left shadow-sm"
              >
                <div className="flex items-center justify-between gap-3">
                  <p className="text-[13px] font-extrabold text-text-primary">적용 조건</p>
                  <span className="rounded-full bg-[#F8FAFC] px-2.5 py-1 text-[11px] font-bold text-text-secondary">
                    결과 0개
                  </span>
                </div>
                {emptyStateAppliedFilterItems.length > 0 && (
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {emptyStateAppliedFilterItems.map((item) => (
                      <span key={`${item.label}-${item.value}`} className="rounded-full bg-brand-light px-2.5 py-1 text-[12px] font-bold text-brand">
                        {item.label} {item.value}
                      </span>
                    ))}
                  </div>
                )}
                <p className="mt-3 text-[12px] font-semibold leading-relaxed text-text-secondary">
                  {packageZeroResultRecoveryText}
                </p>
                {emptyStateRecoveryActions.length > 0 && (
                  <div
                    data-testid="packages-empty-state-recovery-actions"
                    className="mt-3 flex flex-wrap gap-1.5"
                  >
                    {emptyStateRecoveryActions.map((item) => (
                      <button
                        key={`empty-recover-${item.key}`}
                        type="button"
                        onClick={() => handleMobileFilterClear(item.key)}
                        aria-label={item.clearLabel}
                        className="inline-flex min-h-8 items-center rounded-full border border-[#D7E3F3] bg-[#F8FAFC] px-3 text-[12px] font-extrabold text-text-primary transition hover:border-brand/60 hover:text-brand"
                      >
                        {item.label} 빼기
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <div className="grid w-full max-w-xl grid-cols-1 gap-2 mt-1 sm:grid-cols-3">
                {hasActivePackageFilters && (
                  <button
                    type="button"
                    onClick={resetPackageFilters}
                    aria-label="패키지 필터 조건 모두 초기화"
                    aria-describedby={packageFilterDescriptionIds}
                    className="inline-flex h-11 items-center justify-center gap-2 rounded-full bg-brand-light px-4 text-[13px] font-extrabold text-brand transition hover:bg-blue-100"
                  >
                    <RotateCcw className="h-4 w-4" aria-hidden="true" />
                    조건 초기화
                  </button>
                )}
                <Link
                  href={conciergeHref}
                  onClick={() => trackPackagesAiPromptStart('packages_empty_state_ai', 'empty')}
                  data-testid="packages-empty-state-ai"
                  data-analytics-id="packages_empty_state_ai"
                  aria-describedby={emptyStateInquiryDescriptionIds}
                  className="inline-flex h-11 items-center justify-center gap-2 rounded-full border border-[#D7E3F3] bg-white px-4 text-[13px] font-extrabold text-text-primary transition hover:border-brand/60 hover:text-brand"
                >
                  <Sparkles className="h-4 w-4" aria-hidden="true" />
                  AI 상담
                </Link>
                <Link
                  href={groupInquiryHref}
                  onClick={() => trackEmptyStateRecoveryCta('packages_empty_state_group_inquiry')}
                  data-testid="packages-empty-state-group-inquiry"
                  data-analytics-id="packages_empty_state_group_inquiry"
                  aria-describedby={emptyStateInquiryDescriptionIds}
                  className="inline-flex h-11 items-center justify-center gap-2 rounded-full bg-brand px-4 text-[13px] font-extrabold text-white transition hover:bg-brand-dark"
                >
                  <Users className="h-4 w-4" aria-hidden="true" />
                  견적 문의
                </Link>
              </div>
            </div>
          )}
        </div>
      ) : (
        <>
        {hasScarcePackageResults && (
          <section
            id={scarceResultRecoverySummaryId}
            data-testid="packages-scarce-result-recovery"
            aria-label={`${scarceResultRecoveryText} ${scarceResultNextActionText}`}
            className="mx-4 mb-2 rounded-[16px] border border-blue-100 bg-[#EFF6FF] p-4 md:mx-auto md:max-w-7xl md:px-5"
          >
            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <div className="min-w-0">
                <p className="text-[13px] font-extrabold text-[#1D4ED8]">
                  선택지가 적어요
                </p>
                <p className="mt-1 text-[12px] font-semibold leading-5 text-[#1E3A8A]">
                  {scarceResultRecoveryText}
                </p>
                <p className="mt-1 text-[12px] font-bold leading-5 text-[#475569]">
                  {scarceResultNextActionText}
                </p>
              </div>
              <div className="flex flex-col gap-2 sm:flex-row md:shrink-0">
                {emptyStateRecoveryActions.length > 0 && (
                  <button
                    type="button"
                    onClick={() => {
                      trackScarceResultRecoveryCta('packages_scarce_result_relax_filter');
                      handleMobileFilterClear(emptyStateRecoveryActions[0].key);
                    }}
                    aria-label={emptyStateRecoveryActions[0].clearLabel}
                    className="inline-flex h-10 items-center justify-center rounded-full border border-blue-200 bg-white px-4 text-[13px] font-extrabold text-[#1D4ED8] transition hover:border-brand/60 hover:text-brand"
                  >
                    {emptyStateRecoveryActions[0].label} 빼기
                  </button>
                )}
                <Link
                  href={conciergeHref}
                  onClick={() => trackPackagesAiPromptStart('packages_scarce_result_ai', 'scarce')}
                  data-testid="packages-scarce-result-ai"
                  aria-describedby={`${scarceResultRecoverySummaryId} ${packageListDescriptionIds}`}
                  className="inline-flex h-10 items-center justify-center gap-2 rounded-full border border-blue-200 bg-white px-4 text-[13px] font-extrabold text-[#1D4ED8] transition hover:border-brand/60 hover:text-brand"
                >
                  <Sparkles className="h-4 w-4" aria-hidden="true" />
                  AI 상담
                </Link>
                <Link
                  href={groupInquiryHref}
                  onClick={() => trackScarceResultRecoveryCta('packages_scarce_result_group_inquiry')}
                  data-testid="packages-scarce-result-group-inquiry"
                  aria-describedby={`${scarceResultRecoverySummaryId} ${packageListDescriptionIds}`}
                  className="inline-flex h-10 items-center justify-center gap-2 rounded-full bg-brand px-4 text-[13px] font-extrabold text-white transition hover:bg-brand-dark"
                >
                  <Users className="h-4 w-4" aria-hidden="true" />
                  견적 문의
                </Link>
              </div>
            </div>
          </section>
        )}
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
                data-testid="packages-compare-toggle"
                onClick={(e) => { e.preventDefault(); toggleCompare(pkg.id); }}
                className={`absolute top-2 right-2 z-10 flex h-10 w-10 items-center justify-center rounded-full border-2 transition-all focus:outline-none focus:ring-4 focus:ring-brand/15 ${
                  compareIds.includes(pkg.id)
                    ? 'bg-brand border-brand text-white shadow-sm'
                    : 'bg-white/90 border-gray-300 text-gray-400 hover:border-brand/60 hover:text-brand'
                }`}
                aria-pressed={compareIds.includes(pkg.id)}
                aria-label={compareIds.includes(pkg.id) ? `비교 해제: ${pkg.display_title || pkg.title}` : `비교 추가: ${pkg.display_title || pkg.title}`}
                aria-describedby={compareDescriptionIds}
              >
                {compareIds.includes(pkg.id) ? (
                  <Check className="h-4 w-4" strokeWidth={3} aria-hidden="true" />
                ) : (
                  <Plus className="h-4 w-4" strokeWidth={2.5} aria-hidden="true" />
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
                detailHref={buildPackageDetailHref(pkg)}
                rankBadge={rankBadge}
                primaryReason={score?.hasComparison && score.rankInGroup === 1 ? score.label : undefined}
                comparisonLabel={score?.label}
                comparisonSummary={score?.comparisonSummary}
                comparisonReasons={score?.reasons}
                comparisonRank={score?.rankInGroup}
                comparisonGroupSize={score?.groupSize}
                hotelGradeLabel={score?.hotelGradeLabel}
                trackingIntent={effectiveIntent}
                catalogGroupCount={pkg.catalog_id ? catalogGroupSizeMap.get(pkg.catalog_id) : undefined}
              />
            </div>
          );
          })}
        </div>
        </>
      )}
      {filteredPackages.length > visiblePackages.length && (
        <div className="px-4 pb-6 md:max-w-7xl md:mx-auto md:px-8">
          <button
            type="button"
            onClick={handleLoadMore}
            aria-describedby={packageResultSummaryId}
            className="w-full h-11 rounded-full border border-[#D1DCE8] bg-white text-[14px] font-semibold text-text-primary hover:border-brand/60 hover:text-brand transition"
          >
            상품 더 보기 ({visiblePackages.length}/{filteredPackages.length})
          </button>
        </div>
      )}

      {/* 플로팅 CTA — 모바일 전용 */}
      <div className="md:hidden fixed bottom-0 left-0 right-0 bg-white/95 backdrop-blur-xl z-50 border-t border-gray-100 safe-area-bottom">
        <div className="max-w-lg mx-auto px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3">
          <p id={PACKAGES_STICKY_PHONE_DESCRIPTION_ID} className="sr-only">
            현재 패키지 목록 조건을 기준으로 전화 상담을 시작합니다.
          </p>
          <p id={PACKAGES_STICKY_GROUP_DESCRIPTION_ID} className="sr-only">
            현재 패키지 목록 조건과 비교 선택 상품을 단체 견적 문의로 이어갑니다.
          </p>
          <p id={PACKAGES_STICKY_KAKAO_DESCRIPTION_ID} className="sr-only">
            현재 패키지 목록 조건을 상담 문구로 정리해 카카오톡 상담창으로 이어갑니다.
          </p>
          <div
            id={PACKAGES_STICKY_HANDOFF_SUMMARY_ID}
            className="mb-2 flex items-center gap-1.5 overflow-x-auto rounded-2xl border border-[#E5E7EB] bg-[#F8FAFC] px-2.5 py-2 no-scrollbar"
            aria-label="상담 전달 조건"
            data-testid="packages-sticky-handoff-summary"
          >
            <span
              data-testid="packages-sticky-filter-readiness"
              className="shrink-0 rounded-full bg-brand-light px-2.5 py-1 text-[11px] font-extrabold text-brand"
            >
              준비 {primaryFilterReadyCount}/{primaryFilterChecklist.length}
            </span>
            {stickyHandoffItems.length > 0 ? stickyHandoffItems.map((item) => (
              <span key={`${item.label}:${item.value}`} className="shrink-0 rounded-full bg-white px-2.5 py-1 text-[11px] font-extrabold text-text-body shadow-sm">
                <span className="text-text-secondary">{item.label}</span>
                <span className="mx-1 text-[#CBD5E1]">/</span>
                {item.value}
              </span>
            )) : (
              <span className="shrink-0 rounded-full bg-white px-2.5 py-1 text-[11px] font-extrabold text-text-body shadow-sm">
                조건 기반 상담
              </span>
            )}
          </div>
          <p
            id={PACKAGES_STICKY_NEXT_ACTION_ID}
            data-testid="packages-sticky-next-action"
            className="mb-2 rounded-2xl border border-[#E5E7EB] bg-white px-3 py-2 text-[12px] font-extrabold leading-snug text-text-primary"
          >
            {packageFilterNextActionText}
          </p>
          <div className="flex items-center gap-3">
          {consultTelHref ? (
            <a
              href={consultTelHref}
              aria-label="전화 상담"
              aria-describedby={stickyPhoneDescriptionIds}
              onClick={() => {
                trackEngagement({
                  event_type: ANALYTICS_EVENTS.stickyCtaClicked,
                  cta_type: 'packages_mobile_phone',
                  page_url: '/packages',
                  intent: effectiveIntent,
                  budget: handoffBudget,
                  destination: handoffDestination,
                  party_type: handoffPartyType,
                  selected_products: selectedProductNames.length > 0 ? selectedProductNames : null,
                  ready_count: packageCtaDecisionMetadata.ready_count,
                  missing_fields: packageCtaDecisionMetadata.missing_fields,
                  decision_summary: packageCtaDecisionMetadata.decision_summary,
                  handoff_preview: packageCtaDecisionMetadata.handoff_preview,
                  next_action: packageCtaDecisionMetadata.next_action,
                  result_summary: packageCtaDecisionMetadata.result_summary,
                  applied_filters: packageCtaDecisionMetadata.applied_filters,
                  metadata: {
                    source: 'packages_mobile_phone',
                    ...packageCtaDecisionMetadata,
                  },
                });
              }}
              className="w-12 h-12 flex items-center justify-center rounded-full border border-gray-200 hover:bg-gray-50 shrink-0"
            >
              <Phone className="h-5 w-5 text-text-primary" aria-hidden="true" />
            </a>
          ) : null}
          <Link
            href={groupInquiryHref}
            aria-describedby={stickyGroupDescriptionIds}
            onClick={() => {
              trackEngagement({
                event_type: ANALYTICS_EVENTS.stickyCtaClicked,
                cta_type: 'packages_mobile_group_inquiry',
                page_url: '/packages',
                intent: effectiveIntent,
                budget: handoffBudget,
                destination: handoffDestination,
                party_type: handoffPartyType,
                selected_products: selectedProductNames.length > 0 ? selectedProductNames : null,
                ready_count: packageCtaDecisionMetadata.ready_count,
                missing_fields: packageCtaDecisionMetadata.missing_fields,
                decision_summary: packageCtaDecisionMetadata.decision_summary,
                handoff_preview: packageCtaDecisionMetadata.handoff_preview,
                next_action: packageCtaDecisionMetadata.next_action,
                result_summary: packageCtaDecisionMetadata.result_summary,
                applied_filters: packageCtaDecisionMetadata.applied_filters,
                metadata: {
                  source: 'packages_mobile_group_inquiry',
                  ...packageCtaDecisionMetadata,
                },
              });
            }}
            className="flex-1 bg-brand h-12 rounded-full text-white font-bold text-[14px] flex items-center justify-center shadow-lg active:scale-[0.98] transition-all"
          >
            견적 문의
          </Link>
          <button
            type="button"
            data-testid="packages-sticky-kakao"
            aria-describedby={stickyKakaoDescriptionIds}
            onClick={() => openPackagesKakao('packages_mobile_bottom_cta')}
            className="flex-1 bg-[#FEE500] h-12 rounded-full text-[#3C1E1E] font-bold text-[14px] flex items-center justify-center shadow-lg active:scale-[0.98] transition-all"
          >
            카톡 상담
          </button>
        </div>
      </div>

      {/* ── 비교 플로팅 버튼 ── */}
      </div>

      {compareIds.length >= 2 && (
        <div
          className="fixed bottom-32 bottom-[var(--packages-compare-bottom)] left-1/2 z-[60] max-h-[min(48dvh,24rem)] w-[min(calc(100vw-2rem),680px)] -translate-x-1/2 overflow-y-auto md:bottom-[88px]"
          style={{ '--packages-compare-bottom': 'calc(15rem + env(safe-area-inset-bottom))' } as CSSProperties}
        >
          <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-gray-200 bg-white px-4 py-3 shadow-[0_8px_32px_rgba(0,0,0,0.12)]">
            <p
              id={compareHandoffSummaryId}
              data-testid="packages-compare-handoff-summary"
              className="min-w-[220px] flex-1 text-[11px] font-semibold leading-4 text-text-secondary"
            >
              {compareHandoffSummaryText}
            </p>
            <p
              id={compareNextActionId}
              data-testid="packages-compare-next-action"
              className="w-full rounded-xl bg-brand-light/60 px-3 py-2 text-[11px] font-bold leading-4 text-brand md:w-auto md:max-w-[260px]"
            >
              {compareNextActionText}
            </p>
            <p
              id={compareCtaReadinessId}
              data-testid="packages-compare-cta-readiness"
              aria-label={compareCtaReadinessText}
              className="w-full rounded-xl border border-[#DCE5F0] bg-[#F8FAFC] px-3 py-2 text-[11px] font-bold leading-4 text-text-primary md:w-auto md:max-w-[280px]"
            >
              {compareCtaReadinessText}
            </p>
            <span className="text-[13px] font-medium text-text-secondary whitespace-nowrap">
              {compareIds.length}개 선택됨
            </span>
            <button
              type="button"
              onClick={clearCompare}
              aria-describedby={compareActionDescriptionIds}
              className="text-[12px] font-medium text-text-body hover:text-danger transition"
            >
              해제
            </button>
            <div className="w-px h-4 bg-gray-200" />
            <Link
              href={groupInquiryHref}
              data-testid="packages-compare-group-inquiry"
              aria-describedby={compareActionDescriptionIds}
              onClick={() => trackCompareGroupInquiry('packages_compare_group_inquiry')}
              className="px-3 py-1.5 text-[13px] font-bold text-brand transition hover:text-brand-dark"
            >
              상담 전달
            </Link>
            <button
              type="button"
              data-testid="packages-compare-open"
              disabled={compareIds.length < 2}
              aria-haspopup="dialog"
              aria-expanded={compareOpen}
              aria-controls="packages-compare-dialog"
              aria-describedby={compareActionDescriptionIds}
              onClick={() => {
                setCompareOpen(true);
                trackScoreSignal({
                  packageId: compareIds[0],
                  signalType: 'comparison_open',
                  groupKey: effectiveIntent
                    ? `intent:${effectiveIntent};compare:${compareIds.join(',')}`
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
          groupInquiryHref={groupInquiryHref}
          handoffSummaryText={compareHandoffSummaryText}
          nextActionText={compareNextActionText}
          buildPackageDetailHref={buildPackageDetailHref}
          onGroupInquiryClick={() => trackCompareGroupInquiry('packages_compare_dialog_group_inquiry')}
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
  groupInquiryHref,
  handoffSummaryText,
  nextActionText,
  buildPackageDetailHref,
  onGroupInquiryClick,
  onClose,
}: {
  a: Package;
  b: Package;
  groupInquiryHref: string;
  handoffSummaryText: string;
  nextActionText: string;
  buildPackageDetailHref: (pkg: Package) => string;
  onGroupInquiryClick: () => void;
  onClose: () => void;
}) {
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    const previousActiveElement = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const focusTimer = window.setTimeout(() => closeButtonRef.current?.focus(), 0);
    const getFocusableElements = () => Array.from(
      dialogRef.current?.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ) ?? [],
    ).filter(element => !element.getAttribute('aria-hidden'));
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
        return;
      }
      if (e.key !== 'Tab') return;

      const focusableElements = getFocusableElements();
      if (focusableElements.length === 0) return;

      const firstElement = focusableElements[0];
      const lastElement = focusableElements[focusableElements.length - 1];
      if (focusableElements.length === 1) {
        e.preventDefault();
        firstElement.focus();
        return;
      }
      if (e.shiftKey && document.activeElement === firstElement) {
        e.preventDefault();
        lastElement.focus();
        return;
      }
      if (!e.shiftKey && document.activeElement === lastElement) {
        e.preventDefault();
        firstElement.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      window.clearTimeout(focusTimer);
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', onKey);
      if (previousActiveElement && document.contains(previousActiveElement)) previousActiveElement.focus();
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
  const compareDialogHandoffSummaryId = 'package-compare-dialog-handoff-summary';
  const compareDialogNextActionId = 'package-compare-dialog-next-action';
  const compareDialogDescriptionIds = `package-compare-description ${compareDialogHandoffSummaryId} ${compareDialogNextActionId}`;

  return (
    <div
      id="packages-compare-dialog"
      className="fixed inset-0 z-[200] flex items-end md:items-center md:justify-center"
      role="dialog"
      aria-modal="true"
      aria-labelledby="package-compare-title"
      aria-describedby={compareDialogDescriptionIds}
      data-testid="packages-compare-dialog"
    >
      <button type="button" className="absolute inset-0 bg-black/45 backdrop-blur-sm" aria-label="상품 비교 닫기" onClick={onClose} />
      <div ref={dialogRef} className="relative w-full max-h-[85vh] md:max-w-lg bg-white rounded-t-[24px] md:rounded-2xl shadow-2xl flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 shrink-0">
          <h2 id="package-compare-title" className="text-[16px] font-bold text-text-primary">상품 비교</h2>
          <button type="button" ref={closeButtonRef} data-testid="packages-compare-close" aria-label="상품 비교 닫기" onClick={onClose} className="w-10 h-10 flex items-center justify-center rounded-full hover:bg-gray-100 text-text-body">
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>
        <div className="overflow-y-auto px-4 py-4 space-y-3">
          <p id="package-compare-description" className="sr-only">
            선택한 두 상품의 가격, 목적지, 일정, 항공, 출발공항, 평점을 같은 기준으로 비교합니다.
          </p>
          <p
            id={compareDialogHandoffSummaryId}
            data-testid="package-compare-dialog-handoff-summary"
            className="rounded-xl bg-brand-light px-3 py-2 text-[12px] font-semibold leading-5 text-brand"
          >
            {handoffSummaryText}
          </p>
          <p
            id={compareDialogNextActionId}
            data-testid="package-compare-dialog-next-action"
            className="rounded-xl border border-blue-100 bg-blue-50 px-3 py-2 text-[12px] font-bold leading-5 text-blue-700"
          >
            {nextActionText}
          </p>
          <div className="grid grid-cols-2 gap-3 mb-2">
            <Link href={buildPackageDetailHref(a)} className="text-center text-[13px] font-semibold text-brand hover:underline truncate">
              {a.display_title || a.title}
            </Link>
            <Link href={buildPackageDetailHref(b)} className="text-center text-[13px] font-semibold text-brand hover:underline truncate">
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
          <Link href={buildPackageDetailHref(a)} className="text-center py-2.5 rounded-xl bg-brand-light text-brand text-[13px] font-bold hover:bg-brand hover:text-white transition">
            상세보기
          </Link>
          <Link href={buildPackageDetailHref(b)} className="text-center py-2.5 rounded-xl bg-brand-light text-brand text-[13px] font-bold hover:bg-brand hover:text-white transition">
            상세보기
          </Link>
          <Link
            href={groupInquiryHref}
            data-testid="package-compare-dialog-group-inquiry"
            aria-describedby={`${compareDialogHandoffSummaryId} ${compareDialogNextActionId}`}
            onClick={onGroupInquiryClick}
            className="col-span-2 text-center py-2.5 rounded-xl bg-brand text-white text-[13px] font-bold hover:bg-brand-dark transition"
          >
            비교 상품으로 상담 전달
          </Link>
        </div>
      </div>
    </div>
  );
}
