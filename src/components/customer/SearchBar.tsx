'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useChatStore } from '@/lib/chat-store';
import type { DepartureHubId } from '@/lib/departure-hub';
import {
  appendDepartureHubToSearchParams,
  DEFAULT_DEPARTURE_HUB,
  DEPARTURE_HUB_OPTIONS,
} from '@/lib/departure-hub';
import { trackSearch } from '@/lib/tracker';

interface Props {
  initialQ?: string;
  initialMonth?: string;
  initialPriceMin?: string;
  initialPriceMax?: string;
  initialDestination?: string;
  /** 메인 전용: 자유 입력 대신 클릭 시 AI 채팅( /api/qa/chat )을 연다 */
  homeAiLead?: boolean;
  /** 메인 히어로: 카드형·여백 있는 레이아웃 */
  variant?: 'default' | 'home' | 'packages';
  /** 패키지 목록: 출발 허브·마감특가 등 쿼리 유지 */
  hub?: DepartureHubId;
  initialIntent?: string;
  urgency?: string;
  category?: string;
}

const MONTHS = (() => {
  const out: { value: string; label: string }[] = [];
  const now = new Date();
  for (let i = 0; i < 12; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
    const ym = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    out.push({ value: ym, label: `${d.getFullYear()}년 ${d.getMonth() + 1}월` });
  }
  return out;
})();

const PRICE_OPTIONS = [
  { value: '', label: '가격 무관' },
  { value: '500000', label: '50만원 이하' },
  { value: '1000000', label: '100만원 이하' },
  { value: '1500000', label: '150만원 이하' },
  { value: '2000000', label: '200만원 이하' },
  { value: '3000000', label: '300만원 이하' },
];

const PACKAGE_INTENT_OPTIONS = [
  { value: '', label: '목적 전체' },
  { value: 'family', label: '부모님/가족' },
  { value: 'no_shopping', label: '쇼핑 적은 상품' },
  { value: 'budget', label: '최저가 우선' },
  { value: 'consult', label: '상담 추천' },
] as const;

export default function SearchBar({
  initialQ = '',
  initialMonth = '',
  initialPriceMin = '',
  initialPriceMax = '',
  initialDestination = '',
  homeAiLead = false,
  variant = 'default',
  hub,
  initialIntent = '',
  urgency = '',
  category = '',
}: Props) {
  const router = useRouter();
  const openChat = useChatStore(s => s.openChat);
  const [q, setQ] = useState(initialQ || initialDestination);
  const [month, setMonth] = useState(initialMonth);
  const [priceMin, setPriceMin] = useState(initialPriceMin);
  const [priceMax, setPriceMax] = useState(initialPriceMax);
  const [hubValue, setHubValue] = useState<DepartureHubId>(hub ?? DEFAULT_DEPARTURE_HUB);
  const [intent, setIntent] = useState(initialIntent);

  useEffect(() => {
    setQ(initialQ || initialDestination);
  }, [initialDestination, initialQ]);

  useEffect(() => {
    setMonth(initialMonth);
  }, [initialMonth]);

  useEffect(() => {
    setPriceMin(initialPriceMin);
  }, [initialPriceMin]);

  useEffect(() => {
    setPriceMax(initialPriceMax);
  }, [initialPriceMax]);

  useEffect(() => {
    setHubValue(hub ?? DEFAULT_DEPARTURE_HUB);
  }, [hub]);

  useEffect(() => {
    setIntent(initialIntent);
  }, [initialIntent]);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const params = new URLSearchParams();
    const trimmedQ = q.trim();
    const effectiveHub = variant === 'packages' ? hubValue : hub;
    if (trimmedQ) params.set('q', trimmedQ);
    if (month) params.set('month', month);
    if (priceMin) params.set('priceMin', priceMin);
    if (priceMax) params.set('priceMax', priceMax);
    if (variant === 'packages') {
      appendDepartureHubToSearchParams(params, hubValue);
      if (intent) params.set('intent', intent);
    } else if (hub) {
      appendDepartureHubToSearchParams(params, hub);
    }
    if (urgency === '1') params.set('urgency', '1');
    if (category) params.set('category', category);

    // 검색 이벤트 트래킹 (fire-and-forget). 빈 쿼리도 필터 검색이면 기록.
    if (trimmedQ || month || priceMax || effectiveHub || intent || category) {
      // lead_time_days: 출발월(YYYY-MM)이 있으면 그 달 1일까지 일수
      let leadTimeDays: number | undefined;
      if (month) {
        const [yy, mm] = month.split('-').map(Number);
        if (yy && mm) {
          const target = new Date(yy, mm - 1, 1).getTime();
          leadTimeDays = Math.max(0, Math.round((target - Date.now()) / 86400000));
        }
      }
      try {
        trackSearch({
          search_query: trimmedQ || `[filter:${category || intent || effectiveHub || 'price'}]`,
          search_category: category || intent || effectiveHub || undefined,
          lead_time_days: leadTimeDays,
        });
      } catch {
        // tracker 실패는 검색 막지 않음
      }
    }

    const qs = params.toString();
    router.push(qs ? `/packages?${qs}` : '/packages');
  }

  const searchField = homeAiLead ? (
    <div className="flex-1 flex items-center gap-2 px-3 md:px-5 py-2 md:py-2.5 md:border-r md:border-admin-border">
      <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="text-text-secondary shrink-0">
        <circle cx="11" cy="11" r="8" />
        <path d="m21 21-4.3-4.3" />
      </svg>
      <button
        type="button"
        onClick={() => openChat()}
        className="flex-1 min-w-0 text-left outline-none text-body text-text-secondary bg-transparent rounded-lg py-0.5 hover:text-brand transition-colors"
      >
        누구와, 어떤 여행을 꿈꾸시나요? AI에게 물어보세요
      </button>
    </div>
  ) : variant === 'home' || variant === 'packages' ? (
    <div className="rounded-xl bg-[#F8FAFC] border border-[#E8ECF2] px-3.5 py-3 flex items-center gap-2.5 transition-colors focus-within:border-brand/40 focus-within:bg-white focus-within:ring-2 focus-within:ring-brand/15">
      <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#8B95A1" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
        <circle cx="11" cy="11" r="8" />
        <path d="m21 21-4.3-4.3" />
      </svg>
      <input
        type="search"
        name="q"
        aria-label={variant === 'packages' ? '목적지 검색' : '여행지 검색'}
        value={q}
        onChange={e => setQ(e.target.value)}
        placeholder={variant === 'packages' ? '목적지 검색 (예: 장가계, 다낭)' : '어디로 떠나시나요? (예: 다낭, 후쿠오카)'}
        className="flex-1 min-w-0 outline-none text-[15px] text-text-primary placeholder:text-[#B0B8C1] bg-transparent tracking-[-0.02em]"
      />
    </div>
  ) : (
    <label className="flex-1 flex items-center gap-2 px-3 md:px-5 py-2 md:py-2.5 md:border-r md:border-admin-border">
      <span className="sr-only">Search destination</span>
      <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="text-text-secondary shrink-0">
        <circle cx="11" cy="11" r="8" />
        <path d="m21 21-4.3-4.3" />
      </svg>
      <input
        type="search"
        name="q"
        value={q}
        onChange={e => setQ(e.target.value)}
        placeholder="목적지 검색 (예: 장가계, 다낭)"
        className="flex-1 min-w-0 outline-none text-body text-text-primary placeholder:text-text-secondary bg-transparent"
      />
    </label>
  );

  const monthSelect = (
    <select
      name="month"
      aria-label="출발월"
      value={month}
      onChange={e => setMonth(e.target.value)}
      className={
        variant === 'home' || variant === 'packages'
          ? 'w-full min-w-0 rounded-xl border border-[#E5E7EB] bg-white px-3 py-2.5 text-body text-text-primary appearance-none cursor-pointer shadow-sm bg-[length:12px] bg-[right_12px_center] bg-no-repeat pr-9'
          : 'flex-1 min-w-0 outline-none text-body text-text-primary bg-transparent appearance-none cursor-pointer'
      }
      style={
        variant === 'home' || variant === 'packages'
          ? {
              backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12'%3E%3Cpath fill='%238B95A1' d='M2 4l4 4 4-4'/%3E%3C/svg%3E")`,
            }
          : undefined
      }
    >
      <option value="">전체</option>
      {MONTHS.map(m => (
        <option key={m.value} value={m.value}>{m.label}</option>
      ))}
    </select>
  );

  const priceSelect = (
    <select
      name="priceMax"
      aria-label={variant === 'home' ? '예산' : '가격'}
      value={priceMax}
      onChange={e => {
        setPriceMax(e.target.value);
        setPriceMin('');
      }}
      className={
        variant === 'home' || variant === 'packages'
          ? 'w-full min-w-0 rounded-xl border border-[#E5E7EB] bg-white px-3 py-2.5 text-body text-text-primary appearance-none cursor-pointer shadow-sm bg-[length:12px] bg-[right_12px_center] bg-no-repeat pr-9'
          : 'flex-1 min-w-0 outline-none text-body text-text-primary bg-transparent appearance-none cursor-pointer'
      }
      style={
        variant === 'home' || variant === 'packages'
          ? {
              backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12'%3E%3Cpath fill='%238B95A1' d='M2 4l4 4 4-4'/%3E%3C/svg%3E")`,
            }
          : undefined
      }
    >
      {PRICE_OPTIONS.map(p => (
        <option key={p.value} value={p.value}>{p.label}</option>
      ))}
    </select>
  );

  const hubSelect = (
    <select
      name="hub"
      aria-label="출발지"
      value={hubValue}
      onChange={e => setHubValue(e.target.value as DepartureHubId)}
      className="w-full min-w-0 rounded-xl border border-[#E5E7EB] bg-white px-3 py-2.5 text-body text-text-primary appearance-none cursor-pointer shadow-sm bg-[length:12px] bg-[right_12px_center] bg-no-repeat pr-9"
      style={{
        backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12'%3E%3Cpath fill='%238B95A1' d='M2 4l4 4 4-4'/%3E%3C/svg%3E")`,
      }}
    >
      {DEPARTURE_HUB_OPTIONS.map(option => (
        <option key={option.id} value={option.id}>{option.label} 출발</option>
      ))}
    </select>
  );

  const intentSelect = (
    <select
      name="intent"
      aria-label="여행 목적"
      value={intent}
      onChange={e => setIntent(e.target.value)}
      className="w-full min-w-0 rounded-xl border border-[#E5E7EB] bg-white px-3 py-2.5 text-body text-text-primary appearance-none cursor-pointer shadow-sm bg-[length:12px] bg-[right_12px_center] bg-no-repeat pr-9"
      style={{
        backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12'%3E%3Cpath fill='%238B95A1' d='M2 4l4 4 4-4'/%3E%3C/svg%3E")`,
      }}
    >
      {PACKAGE_INTENT_OPTIONS.map(option => (
        <option key={option.value || 'all'} value={option.value}>{option.label}</option>
      ))}
    </select>
  );

  if ((variant === 'home' || variant === 'packages') && !homeAiLead) {
    const filterGridClass = variant === 'packages'
      ? 'grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3'
      : 'grid grid-cols-1 sm:grid-cols-2 gap-3';

    return (
      <form
        onSubmit={submit}
        className="w-full max-w-full min-w-0 rounded-2xl border border-[#E5E7EB]/90 bg-white p-4 md:p-5 shadow-[0_12px_40px_rgba(49,130,246,0.08)] space-y-4"
      >
        {searchField}
        <div className={filterGridClass}>
          <div className="space-y-1.5 min-w-0">
            <span className="block text-[11px] font-semibold text-text-secondary uppercase tracking-[0.06em]">출발월</span>
            {monthSelect}
          </div>
          {variant === 'packages' && (
            <div className="space-y-1.5 min-w-0">
              <span className="block text-[11px] font-semibold text-text-secondary uppercase tracking-[0.06em]">출발지</span>
              {hubSelect}
            </div>
          )}
          {variant === 'packages' && (
            <div className="space-y-1.5 min-w-0">
              <span className="block text-[11px] font-semibold text-text-secondary uppercase tracking-[0.06em]">여행 목적</span>
              {intentSelect}
            </div>
          )}
          <div className="space-y-1.5 min-w-0">
            <span className="block text-[11px] font-semibold text-text-secondary uppercase tracking-[0.06em]">{variant === 'packages' ? '가격' : '예산'}</span>
            {priceSelect}
          </div>
        </div>
        <button
          type="submit"
          className="w-full rounded-xl bg-brand text-white text-[15px] font-bold py-3.5 shadow-md shadow-brand/25 hover:bg-brand-dark active:scale-[0.99] transition-all card-touch"
        >
          {variant === 'packages' ? '이 조건으로 검색' : '조건으로 패키지 찾기'}
        </button>
      </form>
    );
  }

  return (
    <form
      onSubmit={submit}
      className="bg-white border border-[#E5E7EB] rounded-[16px] md:rounded-full shadow-card hover:shadow-card-hover transition-shadow p-2 md:p-1.5 flex flex-col md:flex-row gap-2 md:gap-0 md:items-center"
    >
      {searchField}

      <label className="flex items-center gap-2 px-3 md:px-5 py-2 md:py-2.5 md:border-r md:border-admin-border">
        <span className="text-micro md:text-[13px] font-medium text-text-secondary shrink-0">출발월</span>
        {monthSelect}
      </label>

      <label className="flex items-center gap-2 px-3 md:px-5 py-2 md:py-2.5">
        <span className="text-micro md:text-[13px] font-medium text-text-secondary shrink-0">가격</span>
        {priceSelect}
      </label>

      <button
        type="submit"
        className="bg-brand text-white text-body font-bold px-5 md:px-7 h-[48px] rounded-[12px] md:rounded-full card-touch shrink-0 min-w-[48px]"
      >
        검색
      </button>
    </form>
  );
}
