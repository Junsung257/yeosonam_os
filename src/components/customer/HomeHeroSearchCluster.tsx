'use client';

import type { ReactNode } from 'react';
import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { useChatStore } from '@/lib/chat-store';
import { REGIONS } from '@/lib/regions';
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

  useEffect(() => {
    if (step === null) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      setStep(null);
    };
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = prevOverflow;
      window.removeEventListener('keydown', onKey);
    };
  }, [step]);

  const closeSheet = () => { setStep(null); setShowCustomCalendar(false); };

  const chipLinkCls = `${chipBase} bg-[#F8FAFC] text-text-primary border-[#E8ECF2] hover:border-brand/45 hover:bg-[#F0F6FF] hover:text-brand`;
  const chipMutedCls = `${chipBase} bg-white text-text-secondary border-dashed border-[#D1D6DB] hover:border-brand/40 hover:text-brand`;
  const chipHeroCls = `${chipBase} w-full justify-start min-h-[48px] px-4 text-left text-body font-semibold`;

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

  return (
    <div className="space-y-4">
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
          className="mt-4 flex w-full items-center justify-center rounded-xl bg-brand text-white text-[15px] font-bold py-3.5 shadow-md shadow-brand/25 hover:bg-brand-dark transition-colors card-touch"
        >
          이 조건으로 패키지 보기
        </Link>

        {children}
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
          href="/group-inquiry"
          className={`${pillBase} bg-white text-text-primary border border-[#E5E7EB] hover:border-brand/40 hover:bg-[#F8FAFF]`}
        >
          단체·맞춤 견적
        </Link>
        <button
          type="button"
          onClick={() => openChat()}
          className={`${pillBase} bg-bg-section text-text-body hover:bg-[#E8ECF0]`}
        >
          채팅 상담
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
          <div className="relative flex w-full max-h-[88vh] md:max-h-[85vh] md:max-w-lg flex-col rounded-t-[24px] md:rounded-2xl bg-white shadow-2xl">
            <div className="flex shrink-0 items-center gap-2 border-b border-admin-border px-2 py-2 md:rounded-t-2xl">
              <button
                type="button"
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
