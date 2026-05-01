'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

interface Props {
  initialQ?: string;
  initialMonth?: string;
  initialPriceMax?: string;
  initialDestination?: string;
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

export default function SearchBar({ initialQ = '', initialMonth = '', initialPriceMax = '', initialDestination = '' }: Props) {
  const router = useRouter();
  const [q, setQ] = useState(initialQ || initialDestination);
  const [month, setMonth] = useState(initialMonth);
  const [priceMax, setPriceMax] = useState(initialPriceMax);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const params = new URLSearchParams();
    if (q.trim()) params.set('q', q.trim());
    if (month) params.set('month', month);
    if (priceMax) params.set('priceMax', priceMax);
    const qs = params.toString();
    router.push(qs ? `/packages?${qs}` : '/packages');
  }

  return (
    <form
      onSubmit={submit}
      className="bg-white border border-[#E5E7EB] rounded-[16px] md:rounded-full shadow-card hover:shadow-card-hover transition-shadow p-2 md:p-1.5 flex flex-col md:flex-row gap-2 md:gap-0 md:items-center"
    >
      {/* 자유 검색 */}
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

      {/* 출발월 */}
      <label className="flex items-center gap-2 px-3 md:px-5 py-2 md:py-2.5 md:border-r md:border-[#F2F4F6]">
        <span className="text-[12px] md:text-[13px] font-medium text-[#8B95A1] shrink-0">출발월</span>
        <select
          name="month"
          value={month}
          onChange={e => setMonth(e.target.value)}
          className="flex-1 min-w-0 outline-none text-[14px] text-[#191F28] bg-transparent appearance-none cursor-pointer tracking-[-0.02em]"
        >
          <option value="">전체</option>
          {MONTHS.map(m => (
            <option key={m.value} value={m.value}>{m.label}</option>
          ))}
        </select>
      </label>

      {/* 가격대 */}
      <label className="flex items-center gap-2 px-3 md:px-5 py-2 md:py-2.5">
        <span className="text-[12px] md:text-[13px] font-medium text-[#8B95A1] shrink-0">가격</span>
        <select
          name="priceMax"
          value={priceMax}
          onChange={e => setPriceMax(e.target.value)}
          className="flex-1 min-w-0 outline-none text-[14px] text-[#191F28] bg-transparent appearance-none cursor-pointer tracking-[-0.02em]"
        >
          {PRICE_OPTIONS.map(p => (
            <option key={p.value} value={p.value}>{p.label}</option>
          ))}
        </select>
      </label>

      {/* 검색 버튼 — 48px 터치 타겟 보장 */}
      <button
        type="submit"
        className="bg-[#3182F6] text-white text-[14px] font-bold px-5 md:px-7 h-[48px] rounded-[12px] md:rounded-full card-touch shrink-0 min-w-[48px]"
      >
        검색
      </button>
    </form>
  );
}
