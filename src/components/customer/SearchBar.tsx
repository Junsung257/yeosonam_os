'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useChatStore } from '@/lib/chat-store';
import type { DepartureHubId } from '@/lib/departure-hub';
import { appendDepartureHubToSearchParams } from '@/lib/departure-hub';

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

export default function SearchBar({
  initialQ = '',
  initialMonth = '',
  initialPriceMin = '',
  initialPriceMax = '',
  initialDestination = '',
  homeAiLead = false,
  variant = 'default',
  hub,
  urgency = '',
  category = '',
}: Props) {
  const router = useRouter();
  const openChat = useChatStore(s => s.openChat);
  const [q, setQ] = useState(initialQ || initialDestination);
  const [month, setMonth] = useState(initialMonth);
  const [priceMin, setPriceMin] = useState(initialPriceMin);
  const [priceMax, setPriceMax] = useState(initialPriceMax);

  useEffect(() => {
    setPriceMin(initialPriceMin);
  }, [initialPriceMin]);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const params = new URLSearchParams();
    if (q.trim()) params.set('q', q.trim());
    if (month) params.set('month', month);
    if (priceMin) params.set('priceMin', priceMin);
    if (priceMax) params.set('priceMax', priceMax);
    if (hub) appendDepartureHubToSearchParams(params, hub);
    if (urgency === '1') params.set('urgency', '1');
    if (category) params.set('category', category);
    const qs = params.toString();
    router.push(qs ? `/packages?${qs}` : '/packages');
  }

  const searchField = homeAiLead ? (
    <div className="flex-1 flex items-center gap-2 px-3 md:px-5 py-2 md:py-2.5 md:border-r md:border-[#F2F4F6]">
      <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="text-[#8B95A1] shrink-0">
        <circle cx="11" cy="11" r="8" />
        <path d="m21 21-4.3-4.3" />
      </svg>
      <button
        type="button"
        onClick={() => openChat()}
        className="flex-1 min-w-0 text-left outline-none text-[14px] text-[#8B95A1] bg-transparent tracking-[-0.02em] rounded-lg py-0.5 hover:text-[#3182F6] transition-colors"
      >
        누구와, 어떤 여행을 꿈꾸시나요? AI에게 물어보세요
      </button>
    </div>
  ) : variant === 'home' || variant === 'packages' ? (
    <div className="rounded-xl bg-[#F8FAFC] border border-[#E8ECF2] px-3.5 py-3 flex items-center gap-2.5 transition-colors focus-within:border-[#3182F6]/40 focus-within:bg-white focus-within:ring-2 focus-within:ring-[#3182F6]/15">
      <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#8B95A1" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
        <circle cx="11" cy="11" r="8" />
        <path d="m21 21-4.3-4.3" />
      </svg>
      <input
        type="search"
        name="q"
        value={q}
        onChange={e => setQ(e.target.value)}
        placeholder={variant === 'packages' ? '목적지 검색 (예: 장가계, 다낭)' : '어디로 떠나시나요? (예: 다낭, 후쿠오카)'}
        className="flex-1 min-w-0 outline-none text-[15px] text-[#191F28] placeholder:text-[#B0B8C1] bg-transparent tracking-[-0.02em]"
      />
    </div>
  ) : (
    <label className="flex-1 flex items-center gap-2 px-3 md:px-5 py-2 md:py-2.5 md:border-r md:border-[#F2F4F6]">
      <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="text-[#8B95A1] shrink-0">
        <circle cx="11" cy="11" r="8" />
        <path d="m21 21-4.3-4.3" />
      </svg>
      <input
        type="search"
        name="q"
        value={q}
        onChange={e => setQ(e.target.value)}
        placeholder="목적지 검색 (예: 장가계, 다낭)"
        className="flex-1 min-w-0 outline-none text-[14px] md:text-[14px] text-[#191F28] placeholder:text-[#8B95A1] bg-transparent tracking-[-0.02em]"
      />
    </label>
  );

  const monthSelect = (
    <select
      name="month"
      value={month}
      onChange={e => setMonth(e.target.value)}
      className={
        variant === 'home' || variant === 'packages'
          ? 'w-full min-w-0 rounded-xl border border-[#E5E7EB] bg-white px-3 py-2.5 text-[14px] text-[#191F28] appearance-none cursor-pointer tracking-[-0.02em] shadow-sm bg-[length:12px] bg-[right_12px_center] bg-no-repeat pr-9'
          : 'flex-1 min-w-0 outline-none text-[14px] text-[#191F28] bg-transparent appearance-none cursor-pointer tracking-[-0.02em]'
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
      value={priceMax}
      onChange={e => {
        setPriceMax(e.target.value);
        setPriceMin('');
      }}
      className={
        variant === 'home' || variant === 'packages'
          ? 'w-full min-w-0 rounded-xl border border-[#E5E7EB] bg-white px-3 py-2.5 text-[14px] text-[#191F28] appearance-none cursor-pointer tracking-[-0.02em] shadow-sm bg-[length:12px] bg-[right_12px_center] bg-no-repeat pr-9'
          : 'flex-1 min-w-0 outline-none text-[14px] text-[#191F28] bg-transparent appearance-none cursor-pointer tracking-[-0.02em]'
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

  if ((variant === 'home' || variant === 'packages') && !homeAiLead) {
    return (
      <form
        onSubmit={submit}
        className="w-full max-w-full min-w-0 rounded-2xl border border-[#E5E7EB]/90 bg-white p-4 md:p-5 shadow-[0_12px_40px_rgba(49,130,246,0.08)] space-y-4"
      >
        {searchField}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="space-y-1.5 min-w-0">
            <span className="block text-[11px] font-semibold text-[#8B95A1] uppercase tracking-[0.06em]">출발월</span>
            {monthSelect}
          </div>
          <div className="space-y-1.5 min-w-0">
            <span className="block text-[11px] font-semibold text-[#8B95A1] uppercase tracking-[0.06em]">{variant === 'packages' ? '가격' : '예산'}</span>
            {priceSelect}
          </div>
        </div>
        <button
          type="submit"
          className="w-full rounded-xl bg-[#3182F6] text-white text-[15px] font-bold py-3.5 shadow-md shadow-[#3182F6]/25 hover:bg-[#1b6cf2] active:scale-[0.99] transition-all card-touch"
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

      <label className="flex items-center gap-2 px-3 md:px-5 py-2 md:py-2.5 md:border-r md:border-[#F2F4F6]">
        <span className="text-[12px] md:text-[13px] font-medium text-[#8B95A1] shrink-0">출발월</span>
        {monthSelect}
      </label>

      <label className="flex items-center gap-2 px-3 md:px-5 py-2 md:py-2.5">
        <span className="text-[12px] md:text-[13px] font-medium text-[#8B95A1] shrink-0">가격</span>
        {priceSelect}
      </label>

      <button
        type="submit"
        className="bg-[#3182F6] text-white text-[14px] font-bold px-5 md:px-7 h-[48px] rounded-[12px] md:rounded-full card-touch shrink-0 min-w-[48px]"
      >
        검색
      </button>
    </form>
  );
}
