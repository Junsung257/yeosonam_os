'use client';

import type { ReactNode } from 'react';
import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowRight, Heart, Plane, Users, type LucideIcon } from 'lucide-react';
import { useChatStore } from '@/lib/chat-store';
import { REGIONS } from '@/lib/regions';
import { ANALYTICS_EVENTS } from '@/lib/analytics-events';
import { trackEngagement } from '@/lib/tracker';
import { buildGroupInquiryHandoffHref, GROUP_INQUIRY_PRODUCT_LABEL } from '@/lib/group-inquiry-handoff';
import {
  appendDepartureHubToSearchParams,
  DEFAULT_DEPARTURE_HUB,
  DEPARTURE_HUB_OPTIONS,
  type DepartureHubId,
} from '@/lib/departure-hub';

const pillBase =
  'inline-flex items-center justify-center gap-1.5 min-h-[44px] px-4 rounded-full text-[13px] font-semibold tracking-[-0.02em] transition-all card-touch active:scale-[0.98]';

const chipBase =
  'inline-flex items-center justify-center min-h-[40px] px-3 py-2 rounded-xl text-[13px] font-medium border transition card-touch active:scale-[0.99]';

const POPULAR_DESTINATIONS: string[] = [
  '다낭',
  '후쿠오카',
  '보홀',
  '세부',
  '나트랑',
  '장가계',
  '오사카',
  '마카오',
  '방콕',
  '푸켓',
  '홍콩',
  '싱가포르',
];

type PickerStep = 'hub' | 'when' | 'where' | 'budget';

type BudgetPreset = 'any' | 'value' | 'standard' | 'premium';

type HomeHeroScenario = {
  key: string;
  title: string;
  summary: string;
  proof: string;
  intent: string;
  partyType: string;
  query: string;
  destination: string | null;
  budget: string | null;
  selectedProducts: string[];
  Icon: LucideIcon;
};

const HOME_HERO_SCENARIOS: HomeHeroScenario[] = [
  {
    key: 'filial_busan',
    title: '부산 출발 효도여행',
    summary: '60대 부모님 일정·항공·호텔까지 맞춰보기',
    proof: '이동 동선과 노쇼핑 조건 우선',
    intent: 'filial_trip',
    partyType: 'family',
    query: '부산 출발 60대 부모님 효도여행. 이동이 편하고 노쇼핑 조건을 우선으로 비교해주세요.',
    destination: null,
    budget: '표준(50~100만원)',
    selectedProducts: ['부산 출발 효도여행 맞춤 상담'],
    Icon: Heart,
  },
  {
    key: 'family_no_shopping',
    title: '노쇼핑 가족여행',
    summary: '동남아 가족 일정과 추가비용 가능성 확인',
    proof: '아이·부모 동반 일정에 적합',
    intent: 'family_trip',
    partyType: 'family',
    query: '노쇼핑 동남아 가족여행. 추가 비용 가능성과 아이 동반 일정을 같이 비교해주세요.',
    destination: '동남아',
    budget: '표준(50~100만원)',
    selectedProducts: ['노쇼핑 가족여행 맞춤 상담'],
    Icon: Users,
  },
  {
    key: 'workshop_group',
    title: '20명 단체 워크샵',
    summary: '견적·객실·버스·식사 조건 한 번에 정리',
    proof: '단체 견적서 준비에 최적',
    intent: 'workshop_group',
    partyType: 'company',
    query: '20명 단체 워크샵. 객실, 버스, 식사, 행사 동선까지 포함해 견적을 비교해주세요.',
    destination: null,
    budget: null,
    selectedProducts: ['20명 단체 워크샵 견적 상담'],
    Icon: Users,
  },
  {
    key: 'golf_compare',
    title: '3박5일 골프 비교',
    summary: '항공·그린피·숙소 포함가를 빠르게 비교',
    proof: '추가 라운드 비용 확인',
    intent: 'golf_compare',
    partyType: 'group',
    query: '3박5일 골프 여행. 항공, 그린피, 숙소 포함가와 추가 라운드 비용을 비교해주세요.',
    destination: null,
    budget: '프리미엄(100만원 이상)',
    selectedProducts: ['3박5일 골프 비교 상담'],
    Icon: Plane,
  },
];

function budgetPresetFromParams(priceMin: string, priceMax: string): BudgetPreset {
  if (!priceMin && !priceMax) return 'any';
  if (priceMin === '1000000' && priceMax === '') return 'premium';
  if (priceMin === '500001' && priceMax === '1000000') return 'standard';
  if (priceMin === '' && priceMax === '500000') return 'value';
  return 'any';
}

function applyBudgetPreset(preset: BudgetPreset): { priceMin: string; priceMax: string } {
  switch (preset) {
    case 'any':
      return { priceMin: '', priceMax: '' };
    case 'value':
      return { priceMin: '', priceMax: '500000' };
    case 'standard':
      return { priceMin: '500001', priceMax: '1000000' };
    case 'premium':
      return { priceMin: '1000000', priceMax: '' };
    default:
      return { priceMin: '', priceMax: '' };
  }
}

function budgetSentenceLabel(preset: BudgetPreset): string {
  switch (preset) {
    case 'any':
      return '상관없어요';
    case 'value':
      return '가성비(50만원 이하)';
    case 'standard':
      return '표준(50~100만원)';
    case 'premium':
      return '프리미엄(100만원 이상)';
    default:
      return '상관없어요';
  }
}

function buildPackagesHref(opts: {
  hub: DepartureHubId;
  monthParam: string;
  whereMode: 'any' | 'city' | 'region';
  whereCity: string;
  whereRegion: string;
  priceMin: string;
  priceMax: string;
}) {
  const p = new URLSearchParams();
  appendDepartureHubToSearchParams(p, opts.hub);
  if (opts.monthParam) p.set('month', opts.monthParam);
  if (opts.whereMode === 'city' && opts.whereCity) p.set('destination', opts.whereCity);
  if (opts.whereMode === 'region' && opts.whereRegion) p.set('filter', opts.whereRegion);
  if (opts.priceMin) p.set('priceMin', opts.priceMin);
  if (opts.priceMax) p.set('priceMax', opts.priceMax);
  const qs = p.toString();
  return qs ? `/packages?${qs}` : '/packages';
}

/** 다음에 도래하는 해당 월(1~12)의 대표 연·월 — 홈 맥락 칩용 */
function nextCalendarMonth(now: Date, targetMonth: number): { y: number; m: number } {
  const cy = now.getFullYear();
  const cm = now.getMonth() + 1;
  let y = cy;
  if (cm > targetMonth) y = cy + 1;
  return { y, m: targetMonth };
}

function summerJulyAugustYear(now: Date): number {
  const cy = now.getFullYear();
  const cm = now.getMonth() + 1;
  if (cm <= 8) return cy;
  return cy + 1;
}

function getContextualWhenChips(now: Date) {
  const may = nextCalendarMonth(now, 5);
  const jun = nextCalendarMonth(now, 6);
  const sy = summerJulyAugustYear(now);
  return [
    { key: 'may', label: '5월 가정의달', monthParam: `${may.y}-05` },
    { key: 'jun', label: '6월 현충일 연휴', monthParam: `${jun.y}-06` },
    { key: 'summer', label: '7~8월 여름휴가', monthParam: `${sy}-07,${sy}-08` },
  ] as const;
}

function hubSlotLabel(h: DepartureHubId): string {
  if (h === 'busan') return '부산';
  if (h === 'all') return '전국';
  const o = DEPARTURE_HUB_OPTIONS.find(x => x.id === h);
  return o?.label ?? '부산';
}

const chevron = '▾';

const slotTrigger =
  'inline-flex items-center gap-0.5 rounded-lg px-1.5 py-0.5 text-[15px] font-bold text-blue-700 bg-blue-50 border border-blue-200 hover:bg-blue-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/40 transition-colors';

export default function HomeHeroSearchCluster({ children }: { children?: ReactNode }) {
  const openChat = useChatStore(s => s.openChat);
  const [step, setStep] = useState<PickerStep | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [showCustomCalendar, setShowCustomCalendar] = useState(false);
  const [calendarYear, setCalendarYear] = useState(() => new Date().getFullYear());

  const [hub, setHub] = useState<DepartureHubId>(DEFAULT_DEPARTURE_HUB);
  const [monthParam, setMonthParam] = useState('');
  const [whenDisplayLabel, setWhenDisplayLabel] = useState('');
  const [whereMode, setWhereMode] = useState<'any' | 'city' | 'region'>('any');
  const [whereCity, setWhereCity] = useState('');
  const [whereRegion, setWhereRegion] = useState('');
  const [priceMin, setPriceMin] = useState('');
  const [priceMax, setPriceMax] = useState('');
  const sheetRef = useRef<HTMLDivElement | null>(null);
  const sheetCloseButtonRef = useRef<HTMLButtonElement | null>(null);

  const regionFilters = useMemo(
    () => REGIONS.filter(r => r.featuredCities.length > 0).map(r => ({ label: r.label, emoji: r.emoji })),
    [],
  );

  const contextualWhen = useMemo(() => getContextualWhenChips(new Date()), []);

  const budgetPreset = budgetPresetFromParams(priceMin, priceMax);
  const budgetLabel = budgetSentenceLabel(budgetPreset);

  const whenClause =
    !monthParam
      ? '언제든'
      : whenDisplayLabel
        ? `${whenDisplayLabel}에`
        : '선택한 시기에';

  const whereLabel =
    whereMode === 'any'
      ? '어디로든'
      : whereMode === 'city'
        ? whereCity || '목적지'
        : whereRegion ? `${whereRegion} 쪽` : '권역';

  const resultsHref = useMemo(
    () =>
      buildPackagesHref({
        hub,
        monthParam,
        whereMode,
        whereCity,
        whereRegion,
        priceMin,
        priceMax,
      }),
    [hub, monthParam, whereMode, whereCity, whereRegion, priceMin, priceMax],
  );
  const groupInquiryHref = useMemo(
    () => {
      const destination = whereMode === 'city' ? whereCity : whereMode === 'region' ? whereRegion : '';
      const departure = `${hubSlotLabel(hub)} 출발`;
      const when = whenDisplayLabel || (monthParam ? '선택한 시기' : '일정 미정');
      const budget = budgetPreset === 'any' ? '' : budgetLabel;

      return buildGroupInquiryHandoffHref({
        source: 'home_hero',
        intent: 'group_trip',
        partyType: 'group',
        query: [departure, when, destination || '목적지 미정', budget || '예산 미정'].join(', '),
        destination,
        budget,
        selectedProducts: [GROUP_INQUIRY_PRODUCT_LABEL],
      });
    },
    [hub, monthParam, whenDisplayLabel, whereMode, whereCity, whereRegion, budgetLabel, budgetPreset],
  );
  const packageSearchActionId = 'home-hero-package-search-action';
  const packageSearchSummaryId = 'home-hero-package-search-summary';
  const homeSearchOpenDescriptionId = 'home-hero-search-open-description';
  const homeAiConsultDescriptionId = 'home-hero-ai-consult-description';
  const groupInquiryActionId = 'home-hero-group-inquiry-action';
  const groupInquirySummaryId = 'home-hero-group-inquiry-summary';
  const groupInquiryReadinessId = 'home-hero-group-inquiry-readiness';
  const groupInquiryHandoffSummaryId = 'home-hero-group-inquiry-handoff-summary';
  const groupInquiryNextStepId = 'home-hero-group-inquiry-next-step';
  const packageSearchDescriptionIds = `${packageSearchActionId} ${packageSearchSummaryId}`;
  const groupInquiryDescriptionIds = `${groupInquiryActionId} ${groupInquirySummaryId} ${groupInquiryReadinessId} ${groupInquiryHandoffSummaryId} ${groupInquiryNextStepId}`;
  const packageSearchSummary = useMemo(() => {
    const destination = whereMode === 'city' ? whereCity : whereMode === 'region' ? whereRegion : '목적지 미정';
    const when = whenDisplayLabel || (monthParam ? '선택한 시기' : '일정 미정');
    const budget = budgetPreset === 'any' ? '예산 미정' : budgetLabel;
    return `${hubSlotLabel(hub)} 출발, ${when}, ${destination}, ${budget} 조건으로 패키지 목록을 엽니다.`;
  }, [hub, monthParam, whenDisplayLabel, whereMode, whereCity, whereRegion, budgetLabel, budgetPreset]);
  const groupInquirySummary = useMemo(() => {
    const destination = whereMode === 'city' ? whereCity : whereMode === 'region' ? whereRegion : '목적지 미정';
    const when = whenDisplayLabel || (monthParam ? '선택한 시기' : '일정 미정');
    const budget = budgetPreset === 'any' ? '예산 미정' : budgetLabel;
    return `${hubSlotLabel(hub)} 출발, ${when}, ${destination}, ${budget} 조건으로 단체 견적을 문의합니다.`;
  }, [hub, monthParam, whenDisplayLabel, whereMode, whereCity, whereRegion, budgetLabel, budgetPreset]);
  const groupInquiryReadinessChecklist = [
    { label: '출발지', complete: Boolean(hub) },
    { label: '일정', complete: Boolean(whenDisplayLabel || monthParam) },
    { label: '목적지', complete: whereMode !== 'any' && Boolean(whereMode === 'city' ? whereCity : whereRegion) },
    { label: '예산', complete: budgetPreset !== 'any' },
  ];
  const groupInquiryReadyCount = groupInquiryReadinessChecklist.filter((item) => item.complete).length;
  const groupInquiryMissingLabels = groupInquiryReadinessChecklist
    .filter((item) => !item.complete)
    .map((item) => item.label);
  const groupInquiryReadinessText = groupInquiryMissingLabels.length > 0
    ? `단체 견적 전달 준비 ${groupInquiryReadyCount}/${groupInquiryReadinessChecklist.length}. 보완하면 좋은 조건: ${groupInquiryMissingLabels.join(', ')}.`
    : `단체 견적 전달 준비 ${groupInquiryReadyCount}/${groupInquiryReadinessChecklist.length}. 바로 견적 문의로 넘길 수 있습니다.`;
  const groupInquiryNextStepText = groupInquiryMissingLabels.length > 0
    ? `다음 입력: ${groupInquiryMissingLabels[0]}을(를) 정하면 견적 문의가 더 정확해집니다.`
    : '다음 행동: 단체 견적 버튼으로 현재 조건을 그대로 넘길 수 있습니다.';
  const groupInquiryHandoffItems = useMemo(() => {
    const destination = whereMode === 'city' ? whereCity : whereMode === 'region' ? whereRegion : '';
    return [
      { label: '출발지', value: hubSlotLabel(hub) },
      whenDisplayLabel || monthParam ? { label: '일정', value: whenDisplayLabel || '선택한 시기' } : null,
      destination ? { label: '목적지', value: destination } : null,
      budgetPreset !== 'any' ? { label: '예산', value: budgetLabel } : null,
    ].filter((item): item is { label: string; value: string } => Boolean(item));
  }, [budgetLabel, budgetPreset, hub, monthParam, whenDisplayLabel, whereCity, whereMode, whereRegion]);
  const groupInquiryHandoffSummaryText = groupInquiryHandoffItems.length > 0
    ? `견적 문의 전달 조건: ${groupInquiryHandoffItems.map((item) => `${item.label} ${item.value}`).join(', ')}.`
    : '견적 문의 전달 조건은 출발지부터 정리됩니다.';
  const scenarioInquiryLinks = useMemo(
    () => HOME_HERO_SCENARIOS.map((scenario) => ({
      ...scenario,
      href: buildGroupInquiryHandoffHref({
        source: 'home_hero_scenario',
        intent: scenario.intent,
        partyType: scenario.partyType,
        query: scenario.query,
        destination: scenario.destination,
        budget: scenario.budget,
        selectedProducts: scenario.selectedProducts,
      }),
    })),
    [],
  );

  useEffect(() => {
    if (step === null) return;
    const previousActiveElement = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const focusTimer = window.setTimeout(() => sheetCloseButtonRef.current?.focus(), 0);
    const getFocusableElements = () => Array.from(
      sheetRef.current?.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ) ?? [],
    ).filter(element => !element.getAttribute('aria-hidden'));
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setStep(null);
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
    window.addEventListener('keydown', onKey);
    return () => {
      window.clearTimeout(focusTimer);
      document.body.style.overflow = prevOverflow;
      window.removeEventListener('keydown', onKey);
      if (previousActiveElement && document.contains(previousActiveElement)) previousActiveElement.focus();
    };
  }, [step]);

  const closeSheet = () => { setStep(null); setShowCustomCalendar(false); };

  const chipLinkCls = `${chipBase} bg-[#F8FAFC] text-text-primary border-[#E8ECF2] hover:border-brand/45 hover:bg-[#F0F6FF] hover:text-brand`;
  const chipMutedCls = `${chipBase} bg-white text-text-secondary border-dashed border-[#D1D6DB] hover:border-brand/40 hover:text-brand`;
  const chipHeroCls = `${chipBase} w-full justify-start min-h-[48px] px-4 text-left text-body font-semibold`;

  const pageUrl = typeof window !== 'undefined' ? window.location.pathname : '/';

  function trackPackageSearchClick(source: string) {
    trackEngagement({
      event_type: ANALYTICS_EVENTS.packageFilterApplied,
      filter_name: source,
      filter_value: [hub, monthParam || 'any_month', whereMode, budgetPreset].join(':'),
      page_url: pageUrl,
      destination: whereMode === 'city' ? whereCity : whereMode === 'region' ? whereRegion : null,
      budget: budgetPreset === 'any' ? null : budgetLabel,
      metadata: {
        source,
        href: resultsHref,
        departure_hub: hub,
        month: monthParam || null,
        where_mode: whereMode,
        price_min: priceMin || null,
        price_max: priceMax || null,
      },
    });
  }

  function trackGroupInquiryClick(source: string) {
    const destination = whereMode === 'city' ? whereCity : whereMode === 'region' ? whereRegion : null;
    trackEngagement({
      event_type: ANALYTICS_EVENTS.stickyCtaClicked,
      cta_type: source,
      page_url: pageUrl,
      budget: budgetPreset === 'any' ? null : budgetLabel,
      destination,
      party_type: 'group',
      selected_products: [GROUP_INQUIRY_PRODUCT_LABEL],
      metadata: {
        source,
        href: groupInquiryHref,
        departure_hub: hub,
        month: monthParam || null,
        where_mode: whereMode,
      },
    });
  }

  function trackScenarioInquiryClick(scenario: HomeHeroScenario & { href: string }) {
    trackEngagement({
      event_type: ANALYTICS_EVENTS.stickyCtaClicked,
      cta_type: `home_hero_scenario_${scenario.key}`,
      page_url: pageUrl,
      budget: scenario.budget,
      destination: scenario.destination,
      party_type: scenario.partyType,
      selected_products: scenario.selectedProducts,
      metadata: {
        source: 'home_hero_scenario',
        href: scenario.href,
        intent: scenario.intent,
        scenario_key: scenario.key,
        scenario_title: scenario.title,
      },
    });
  }

  const stepTitle: Record<PickerStep, string> = {
    hub: '어디서 출발할까요?',
    when: '언제 떠날까요?',
    where: '어디로 갈까요?',
    budget: '예산은 어느 정도면 좋을까요?',
  };

  function pickBudget(preset: BudgetPreset) {
    const { priceMin: pmin, priceMax: pmax } = applyBudgetPreset(preset);
    setPriceMin(pmin);
    setPriceMax(pmax);
    setStep(null);
  }

  function toggleCustomCalendar() {
    if (!showCustomCalendar) {
      const now = new Date();
      if (monthParam && !monthParam.includes(',')) {
        const [y] = monthParam.split('-').map(Number);
        setCalendarYear(y);
      } else {
        setCalendarYear(now.getFullYear());
      }
    }
    setShowCustomCalendar(v => !v);
  }

  // 콤팩트 검색바: expanded=false 이면 단순 검색 Bar 표시, 탭 시 풀 위자드로 전환
  if (!expanded) {
    return (
      <div className="space-y-4">
        <p id={homeSearchOpenDescriptionId} className="sr-only">
          출발지, 출발 시기, 목적지, 예산을 차례로 선택하는 검색 조건 위자드를 엽니다.
        </p>
        <p id={homeAiConsultDescriptionId} className="sr-only">
          현재 페이지에서 AI 여행 상담창을 열어 목적지와 여행 조건을 대화로 추천받습니다.
        </p>
        <p id={groupInquiryActionId} className="sr-only">
          선택한 출발지, 일정, 목적지, 예산을 단체 견적 문의서에 미리 채웁니다.
        </p>
        <p id={groupInquirySummaryId} className="sr-only">
          {groupInquirySummary}
        </p>
        <p id={groupInquiryReadinessId} className="sr-only" role="status" aria-live="polite" aria-atomic="true">
          {groupInquiryReadinessText}
        </p>
        <p id={groupInquiryHandoffSummaryId} className="sr-only">
          {groupInquiryHandoffSummaryText}
        </p>
        <p id={groupInquiryNextStepId} className="sr-only">
          {groupInquiryNextStepText}
        </p>
        <button
          type="button"
          onClick={() => setExpanded(true)}
          data-testid="home-hero-search-open"
          className="w-full flex items-center gap-3 bg-white border border-[#E5E7EB] rounded-2xl px-4 py-3.5 shadow-[0_4px_16px_rgba(49,130,246,0.07)] hover:border-brand/40 hover:shadow-[0_4px_20px_rgba(49,130,246,0.13)] transition-all card-touch"
          aria-label="여행 검색 열기"
          aria-describedby={homeSearchOpenDescriptionId}
        >
          <span className="text-xl flex-shrink-0">🔍</span>
          <span className="flex-1 text-left">
            <span className="block text-[15px] font-semibold text-text-primary">어디로 떠날까요?</span>
            <span className="block text-[12px] text-text-secondary mt-0.5">출발지 · 시기 · 예산 설정</span>
          </span>
          <span className="text-[13px] font-bold text-brand bg-brand-light px-3 py-1.5 rounded-full flex-shrink-0">검색</span>
        </button>
        <section
          data-testid="home-hero-scenario-rail"
          aria-label="상황별 빠른 견적 문의"
          className="space-y-2"
        >
          <div className="flex items-center justify-between gap-3 px-0.5">
            <p className="text-[12px] font-extrabold text-text-primary">바로 많이 찾는 상담</p>
            <span className="text-[11px] font-bold text-text-secondary">조건 전달됨</span>
          </div>
          <div className="flex snap-x gap-2 overflow-x-auto pb-1 no-scrollbar">
            {scenarioInquiryLinks.map((scenario) => {
              const Icon = scenario.Icon;
              return (
                <Link
                  key={scenario.key}
                  href={scenario.href}
                  data-testid="home-hero-scenario-inquiry"
                  aria-label={`${scenario.title} 견적 문의. ${scenario.summary}. ${scenario.proof}`}
                  onClick={() => trackScenarioInquiryClick(scenario)}
                  className="group flex min-h-[112px] w-[246px] shrink-0 snap-start flex-col justify-between rounded-lg border border-[#E5E7EB] bg-white px-3.5 py-3 text-left shadow-sm transition hover:border-brand/40 hover:bg-[#F8FAFF] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40 focus-visible:ring-offset-2"
                >
                  <span className="flex items-start justify-between gap-3">
                    <span className="flex min-w-0 items-start gap-2.5">
                      <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand-light text-brand">
                        <Icon className="h-4 w-4" aria-hidden />
                      </span>
                      <span className="min-w-0">
                        <span className="block text-[13px] font-extrabold text-text-primary">
                          {scenario.title}
                        </span>
                        <span className="mt-1 block text-[11px] font-semibold leading-4 text-text-secondary">
                          {scenario.summary}
                        </span>
                      </span>
                    </span>
                    <span className="mt-1 shrink-0 text-brand transition group-hover:translate-x-0.5" aria-hidden>
                      <ArrowRight className="h-4 w-4" />
                    </span>
                  </span>
                  <span className="mt-2 block rounded-full bg-[#F8FAFC] px-2.5 py-1 text-[11px] font-extrabold text-text-body">
                    {scenario.proof}
                  </span>
                </Link>
              );
            })}
          </div>
        </section>
        <div className="flex flex-wrap items-center justify-center gap-2 sm:gap-2.5">
          <Link href="/packages?urgency=1" className={`${pillBase} bg-gradient-to-br from-brand to-[#2563EB] text-white shadow-md shadow-brand/20`}>
            <span aria-hidden>🔥</span>마감·특가
          </Link>
          <Link
            href={groupInquiryHref}
            data-testid="home-hero-group-inquiry"
            aria-describedby={groupInquiryDescriptionIds}
            onClick={() => trackGroupInquiryClick('home_hero_compact')}
            className={`${pillBase} bg-white text-text-primary border border-[#E5E7EB] hover:border-brand/40`}
          >
            단체·맞춤 견적
          </Link>
          <button
            type="button"
            onClick={() => openChat('home_hero')}
            data-testid="home-hero-ai-consult"
            aria-describedby={homeAiConsultDescriptionId}
            className={`${pillBase} bg-gradient-to-br from-[#6366F1] to-[#4F46E5] text-white shadow-md shadow-indigo-500/20 hover:shadow-lg hover:shadow-indigo-500/30`}
          >
            <span aria-hidden>🤖</span>AI 여행 상담
          </button>
        </div>
        <div
          data-testid="home-hero-group-inquiry-readiness"
          aria-label={groupInquiryReadinessText}
          className="mx-auto flex max-w-max items-center gap-2 rounded-full border border-[#E5E7EB] bg-white px-3 py-1.5 text-[12px] font-bold text-text-secondary shadow-sm"
        >
          <span className="text-text-primary">견적 준비 {groupInquiryReadyCount}/{groupInquiryReadinessChecklist.length}</span>
          <span className="font-medium">
            {groupInquiryMissingLabels.length > 0 ? `보완: ${groupInquiryMissingLabels.join(', ')}` : '바로 문의 가능'}
          </span>
        </div>
        <p
          data-testid="home-hero-group-inquiry-next-step"
          aria-label={groupInquiryNextStepText}
          className="mx-auto max-w-[min(100%,28rem)] rounded-full bg-blue-50 px-3 py-1.5 text-center text-[11px] font-bold text-blue-700"
        >
          {groupInquiryNextStepText}
        </p>
        <div
          data-testid="home-hero-group-inquiry-handoff-summary"
          aria-label={groupInquiryHandoffSummaryText}
          className="mx-auto flex max-w-full gap-1.5 overflow-x-auto rounded-2xl border border-[#E5E7EB] bg-white px-2.5 py-2 shadow-sm no-scrollbar"
        >
          {groupInquiryHandoffItems.map((item) => (
            <span key={`compact-${item.label}-${item.value}`} className="shrink-0 rounded-full bg-[#F8FAFC] px-2.5 py-1 text-[11px] font-extrabold text-text-body">
              <span className="text-text-secondary">{item.label}</span>
              <span className="mx-1 text-[#CBD5E1]">/</span>
              {item.value}
            </span>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <p id={homeAiConsultDescriptionId} className="sr-only">
        현재 선택한 검색 조건을 참고해 AI 여행 상담창을 열고 추천을 이어갑니다.
      </p>
      <p id={packageSearchActionId} className="sr-only">
        선택한 조건으로 패키지 목록 페이지를 엽니다.
      </p>
      <p id={packageSearchSummaryId} className="sr-only">
        {packageSearchSummary}
      </p>
      <p id={groupInquiryActionId} className="sr-only">
        선택한 출발지, 일정, 목적지, 예산을 단체 견적 문의서에 미리 채웁니다.
      </p>
      <p id={groupInquirySummaryId} className="sr-only">
        {groupInquirySummary}
      </p>
      <p id={groupInquiryReadinessId} className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {groupInquiryReadinessText}
      </p>
      <p id={groupInquiryHandoffSummaryId} className="sr-only">
        {groupInquiryHandoffSummaryText}
      </p>
      <p id={groupInquiryNextStepId} className="sr-only">
        {groupInquiryNextStepText}
      </p>
      <div className="rounded-2xl border border-[#E5E7EB] bg-white px-4 py-4 shadow-[0_12px_40px_rgba(49,130,246,0.08)]">
        <p className="text-[16px] md:text-[17px] leading-[1.75] text-text-primary tracking-[-0.03em]">
          나는{' '}
          <button type="button" className={slotTrigger} onClick={() => setStep('hub')}>
            {hubSlotLabel(hub)} {chevron}
          </button>{' '}
          출발,{' '}
          <button type="button" className={slotTrigger} onClick={() => setStep('when')}>
            {whenClause} {chevron}
          </button>{' '}
          <button type="button" className={slotTrigger} onClick={() => setStep('where')}>
            {whereLabel} {chevron}
          </button>{' '}
          떠날래요.
          {budgetPreset === 'any' ? (
            <>
              {' '}
              예산은{' '}
              <button type="button" className={slotTrigger} onClick={() => setStep('budget')}>
                크게 안 따질래요 {chevron}
              </button>
              .
            </>
          ) : (
            <>
              {' '}
              예산은{' '}
              <button type="button" className={slotTrigger} onClick={() => setStep('budget')}>
                {budgetLabel} {chevron}
              </button>
              가 좋아요.
            </>
          )}
        </p>

        <Link
          href={resultsHref}
          aria-describedby={packageSearchDescriptionIds}
          onClick={() => trackPackageSearchClick('home_hero_sentence_search')}
          className="mt-4 flex w-full items-center justify-center rounded-xl bg-brand text-white text-[15px] font-bold py-3.5 shadow-md shadow-brand/25 hover:bg-brand-dark transition-colors card-touch"
        >
          이 조건으로 패키지 보기
        </Link>

        {children}
        <div
          data-testid="home-hero-group-inquiry-readiness"
          aria-label={groupInquiryReadinessText}
          className="mt-3 flex items-center justify-between gap-3 rounded-xl border border-[#E5E7EB] bg-[#F8FAFC] px-3 py-2 text-[12px] font-bold text-text-secondary"
        >
          <span className="shrink-0 text-text-primary">견적 준비 {groupInquiryReadyCount}/{groupInquiryReadinessChecklist.length}</span>
          <span className="min-w-0 truncate text-right font-medium">
            {groupInquiryMissingLabels.length > 0 ? `보완: ${groupInquiryMissingLabels.join(', ')}` : '바로 문의 가능'}
          </span>
        </div>
        <p
          data-testid="home-hero-group-inquiry-next-step"
          aria-label={groupInquiryNextStepText}
          className="mt-2 rounded-xl bg-blue-50 px-3 py-2 text-[11px] font-bold leading-5 text-blue-700"
        >
          {groupInquiryNextStepText}
        </p>
        <div
          data-testid="home-hero-group-inquiry-handoff-summary"
          aria-label={groupInquiryHandoffSummaryText}
          className="mt-2 flex gap-1.5 overflow-x-auto rounded-xl border border-[#E5E7EB] bg-white px-2.5 py-2 no-scrollbar"
        >
          {groupInquiryHandoffItems.map((item) => (
            <span key={`expanded-${item.label}-${item.value}`} className="shrink-0 rounded-full bg-[#F8FAFC] px-2.5 py-1 text-[11px] font-extrabold text-text-body">
              <span className="text-text-secondary">{item.label}</span>
              <span className="mx-1 text-[#CBD5E1]">/</span>
              {item.value}
            </span>
          ))}
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-center gap-2 sm:gap-2.5">
        <Link
          href="/packages?urgency=1"
          className={`${pillBase} bg-gradient-to-br from-brand to-[#2563EB] text-white shadow-md shadow-brand/20 hover:shadow-lg hover:shadow-brand/25`}
        >
          <span aria-hidden>🔥</span>
          마감·특가
        </Link>
        <Link
          href={groupInquiryHref}
          data-testid="home-hero-group-inquiry"
          aria-describedby={groupInquiryDescriptionIds}
          onClick={() => trackGroupInquiryClick('home_hero_expanded')}
          className={`${pillBase} bg-white text-text-primary border border-[#E5E7EB] hover:border-brand/40 hover:bg-[#F8FAFF]`}
        >
          단체·맞춤 견적
        </Link>
        <button
          type="button"
          onClick={() => openChat('home_hero')}
          data-testid="home-hero-ai-consult"
          aria-describedby={homeAiConsultDescriptionId}
          className={`${pillBase} bg-gradient-to-br from-[#6366F1] to-[#4F46E5] text-white shadow-md shadow-indigo-500/20 hover:shadow-lg hover:shadow-indigo-500/30`}
        >
          <span aria-hidden>🤖</span>AI 여행 상담
        </button>
      </div>


      {step !== null ? (
        <div
          className="fixed inset-0 z-[100] flex items-end justify-center md:items-center md:p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="home-search-sheet-title"
        >
          <button
            type="button"
            className="absolute inset-0 bg-black/45 backdrop-blur-[2px]"
            aria-label="닫기"
            onClick={closeSheet}
          />
          <div ref={sheetRef} className="relative flex w-full max-h-[88vh] md:max-h-[85vh] md:max-w-lg flex-col rounded-t-[24px] md:rounded-2xl bg-white shadow-2xl">
            <div className="flex shrink-0 items-center gap-2 border-b border-admin-border px-2 py-2 md:rounded-t-2xl">
              <button
                type="button"
                ref={sheetCloseButtonRef}
                onClick={closeSheet}
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-text-body hover:bg-bg-section"
                aria-label="닫기"
              >
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <path d="M15 18l-6-6 6-6" />
                </svg>
              </button>
              <h2 id="home-search-sheet-title" className="text-[16px] font-bold text-text-primary tracking-[-0.02em] pr-10 flex-1">
                {stepTitle[step]}
              </h2>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4 pb-[max(1.25rem,env(safe-area-inset-bottom))]">
              {step === 'hub' ? (
                <div className="flex flex-col gap-2">
                  {DEPARTURE_HUB_OPTIONS.map(opt => (
                    <button
                      key={opt.id}
                      type="button"
                      onClick={() => {
                        setHub(opt.id);
                        setStep(null);
                      }}
                      className={`w-full min-h-[48px] rounded-xl border px-4 text-left text-[15px] font-semibold transition card-touch ${
                        hub === opt.id
                          ? 'border-brand bg-brand-light text-blue-700'
                          : 'border-[#E8ECF2] bg-white text-text-primary hover:border-brand/35'
                      }`}
                    >
                      {opt.id === 'busan'
                        ? '부산 출발 (기본)'
                        : opt.id === 'all'
                          ? `${opt.label} 출발 (출발지 무관)`
                          : `${opt.label} 출발`}
                    </button>
                  ))}
                </div>
              ) : null}

              {step === 'when' ? (
                <div className="space-y-5">
                  <button
                    type="button"
                    onClick={() => {
                      setMonthParam('');
                      setWhenDisplayLabel('');
                      setStep(null);
                    }}
                    className={`${chipHeroCls} border-brand/30 bg-[#F0F9FF] text-blue-700`}
                  >
                    <span className="mr-2" aria-hidden>
                      ✅
                    </span>
                    언제든 (전체 보기)
                  </button>

                  <div>
                    <p className="text-micro font-semibold text-text-body mb-2.5">어떤 연휴에 가세요?</p>
                    <div className="flex flex-col gap-2">
                      {contextualWhen.map(c => (
                        <button
                          key={c.key}
                          type="button"
                          onClick={() => {
                            setMonthParam(c.monthParam);
                            setWhenDisplayLabel(c.label);
                            setShowCustomCalendar(false);
                            setStep(null);
                          }}
                          className={
                            monthParam === c.monthParam
                              ? `${chipHeroCls} border-brand bg-brand-light text-blue-700`
                              : `${chipHeroCls} border-[#E8ECF2] bg-white text-text-primary hover:border-brand/35`
                          }
                        >
                          {c.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="pt-1">
                    <button
                      type="button"
                      onClick={toggleCustomCalendar}
                      className={`text-[13px] font-medium flex items-center gap-1.5 mx-auto transition-colors ${showCustomCalendar ? 'text-brand font-semibold' : 'text-[#6B7280] hover:text-brand'}`}
                    >
                      <span aria-hidden>📅</span>
                      달력에서 직접 선택
                      <span className={`transition-transform duration-200 ${showCustomCalendar ? 'rotate-180' : ''}`} aria-hidden>▾</span>
                    </button>

                    {showCustomCalendar && (
                      <div className="mt-3 rounded-2xl border border-[#E0E9F8] bg-white p-4 shadow-[0_4px_20px_rgba(49,130,246,0.10)]">
                        {/* 연도 네비게이션 */}
                        <div className="flex items-center justify-between mb-3">
                          <button
                            type="button"
                            onClick={() => setCalendarYear(y => y - 1)}
                            disabled={calendarYear <= new Date().getFullYear()}
                            aria-label="이전 해"
                            className="w-9 h-9 flex items-center justify-center rounded-full text-h2 text-text-body hover:bg-bg-section disabled:opacity-25 disabled:cursor-not-allowed transition"
                          >
                            ‹
                          </button>
                          <span className="text-[15px] font-bold text-text-primary tracking-tight">
                            {calendarYear}년
                          </span>
                          <button
                            type="button"
                            onClick={() => setCalendarYear(y => y + 1)}
                            disabled={calendarYear >= new Date().getFullYear() + 2}
                            aria-label="다음 해"
                            className="w-9 h-9 flex items-center justify-center rounded-full text-h2 text-text-body hover:bg-bg-section disabled:opacity-25 disabled:cursor-not-allowed transition"
                          >
                            ›
                          </button>
                        </div>

                        {/* 월 그리드 */}
                        <div className="grid grid-cols-4 gap-1.5">
                          {Array.from({ length: 12 }, (_, i) => i + 1).map(m => {
                            const now = new Date();
                            const isPast =
                              calendarYear < now.getFullYear() ||
                              (calendarYear === now.getFullYear() && m < now.getMonth() + 1);
                            const val = `${calendarYear}-${String(m).padStart(2, '0')}`;
                            const isSelected = monthParam === val;
                            const isCurrent =
                              calendarYear === now.getFullYear() && m === now.getMonth() + 1;
                            return (
                              <button
                                key={m}
                                type="button"
                                disabled={isPast}
                                onClick={() => {
                                  setMonthParam(val);
                                  setWhenDisplayLabel(`${calendarYear}년 ${m}월`);
                                  setShowCustomCalendar(false);
                                  setStep(null);
                                }}
                                className={[
                                  'h-12 rounded-xl text-body font-semibold transition-all duration-150 relative',
                                  isPast
                                    ? 'text-[#C8CDD4] cursor-not-allowed'
                                    : isSelected
                                      ? 'bg-brand text-white shadow-sm shadow-brand/30'
                                      : 'text-text-primary hover:bg-brand-light hover:text-brand active:scale-95',
                                  isCurrent && !isSelected && !isPast
                                    ? 'ring-1 ring-brand/40'
                                    : '',
                                ].filter(Boolean).join(' ')}
                              >
                                {m}월
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              ) : null}

              {step === 'where' ? (
                <div className="space-y-5">
                  <div>
                    <button
                      type="button"
                      onClick={() => {
                        setWhereMode('any');
                        setWhereCity('');
                        setWhereRegion('');
                        setStep(null);
                      }}
                      className={`${chipMutedCls} w-full justify-center min-h-[44px]`}
                    >
                      어디로든 · 목적지 나중에
                    </button>
                  </div>
                  <div>
                    <p className="text-micro font-semibold text-text-body mb-2.5">인기 도시</p>
                    <div className="flex flex-wrap gap-2">
                      {POPULAR_DESTINATIONS.map(name => (
                        <button
                          key={name}
                          type="button"
                          onClick={() => {
                            setWhereMode('city');
                            setWhereCity(name);
                            setWhereRegion('');
                            setStep(null);
                          }}
                          className={
                            whereMode === 'city' && whereCity === name
                              ? `${chipBase} bg-brand-light text-brand border-brand`
                              : chipLinkCls
                          }
                        >
                          {name}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div>
                    <p className="text-micro font-semibold text-text-body mb-2.5">권역</p>
                    <div className="flex flex-wrap gap-2">
                      {regionFilters.map(({ label, emoji }) => (
                        <button
                          key={label}
                          type="button"
                          onClick={() => {
                            setWhereMode('region');
                            setWhereRegion(label);
                            setWhereCity('');
                            setStep(null);
                          }}
                          className={
                            whereMode === 'region' && whereRegion === label
                              ? `${chipBase} bg-brand-light text-brand border-brand`
                              : `${chipBase} bg-white text-text-primary border-[#E8ECF2] hover:border-brand/45 hover:bg-[#F0F6FF]`
                          }
                        >
                          <span className="mr-1" aria-hidden>
                            {emoji}
                          </span>
                          {label}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              ) : null}

              {step === 'budget' ? (
                <div className="flex flex-col gap-2">
                  <button
                    type="button"
                    onClick={() => pickBudget('value')}
                    className={`${chipHeroCls} ${budgetPreset === 'value' ? 'border-brand bg-brand-light text-blue-700' : 'border-[#E8ECF2] bg-white'}`}
                  >
                    <span className="mr-2" aria-hidden>
                      🪙
                    </span>
                    가성비 (50만원 이하)
                  </button>
                  <button
                    type="button"
                    onClick={() => pickBudget('standard')}
                    className={`${chipHeroCls} ${budgetPreset === 'standard' ? 'border-brand bg-brand-light text-blue-700' : 'border-[#E8ECF2] bg-white'}`}
                  >
                    <span className="mr-2" aria-hidden>
                      ✨
                    </span>
                    표준 (50~100만원)
                  </button>
                  <button
                    type="button"
                    onClick={() => pickBudget('premium')}
                    className={`${chipHeroCls} ${budgetPreset === 'premium' ? 'border-brand bg-brand-light text-blue-700' : 'border-[#E8ECF2] bg-white'}`}
                  >
                    <span className="mr-2" aria-hidden>
                      💎
                    </span>
                    프리미엄 (100만원 이상)
                  </button>
                  <button
                    type="button"
                    onClick={() => pickBudget('any')}
                    className={`${chipHeroCls} mt-1 border-dashed ${budgetPreset === 'any' ? 'border-brand bg-[#F0F9FF] text-blue-700' : chipMutedCls}`}
                  >
                    <span className="mr-2" aria-hidden>
                      ✅
                    </span>
                    예산 무관
                  </button>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
