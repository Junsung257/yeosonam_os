'use client';

import { useState } from 'react';
import Link from 'next/link';
import SectionHeader from '@/components/customer/SectionHeader';
import PackageCard from '@/components/customer/PackageCard';

interface PackageRow {
  id: string;
  title: string;
  destination: string;
  duration: number | null;
  nights: number | null;
  price: number | null;
  airline: string | null;
  departure_airport: string | null;
  avg_rating: number | null;
  review_count: number;
  price_dates: Array<{ date?: string }> | null;
  [key: string]: unknown;
}

interface Props {
  destination: string;
  packages: PackageRow[];
  /** 출발지가 2개 이상일 때만 전달됨. 빈 배열이면 탭 미노출 */
  departureCities: string[];
}

function extractDepartureCity(airport: string | null): string | null {
  if (!airport) return null;
  return airport.split('(')[0].trim();
}

export default function DestinationPackagesSection({ destination, packages, departureCities }: Props) {
  const [selectedCity, setSelectedCity] = useState<string | null>(null);
  const showTabs = departureCities.length >= 2;

  const filtered =
    selectedCity === null
      ? packages
      : packages.filter(p => extractDepartureCity(p.departure_airport) === selectedCity);

  const visible = filtered.slice(0, 6);

  return (
    <section id="packages" className="scroll-mt-28">
      <SectionHeader
        title={`${destination} 여행, 추천 패키지로 한 번에`}
        subtitle="가성비 · 중가 · 프리미엄 · 운영팀 검증 완료"
        actionHref={`/packages?destination=${encodeURIComponent(destination)}`}
        actionLabel="전체 보기 →"
      />

      {/* 출발지 필터 탭 (Sticky + blur) */}
      {showTabs && (
        <div className="sticky top-28 z-20 bg-white/95 backdrop-blur-sm border-b border-slate-100 -mx-4 px-4 md:-mx-6 md:px-6 py-3 mb-6">
          <div className="flex gap-2 overflow-x-auto scrollbar-hide">
            <button
              onClick={() => setSelectedCity(null)}
              className={`flex-shrink-0 text-sm font-semibold px-4 py-2 rounded-full transition-all ${
                selectedCity === null
                  ? 'bg-slate-900 text-white shadow-sm'
                  : 'bg-white text-slate-600 border border-slate-200 hover:border-slate-400'
              }`}
            >
              전체
            </button>
            {departureCities.map(c => (
              <button
                key={c}
                onClick={() => setSelectedCity(c)}
                className={`flex-shrink-0 text-sm font-semibold px-4 py-2 rounded-full transition-all whitespace-nowrap ${
                  selectedCity === c
                    ? 'bg-brand text-white shadow-sm'
                    : 'bg-white text-slate-600 border border-slate-200 hover:border-brand hover:text-brand'
                }`}
              >
                {c} 출발
              </button>
            ))}
          </div>
        </div>
      )}

      {/* 패키지 그리드 */}
      {visible.length > 0 ? (
        <div className="grid gap-4 md:gap-5 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
          {visible.map((p, index) => (
            <PackageCard
              key={p.id}
              pkg={p as any}
              isYeosonamPick={index === 0}
              rankBadge={index === 0 ? '이 일정 1위' : index === 1 ? '이 일정 2위' : undefined}
            />
          ))}
        </div>
      ) : (
        <div className="text-center py-16 text-slate-400">
          <p className="text-base font-medium">
            {selectedCity ? `${selectedCity} 출발 상품이 아직 없습니다.` : '상품 준비 중입니다.'}
          </p>
          {selectedCity && (
            <button
              onClick={() => setSelectedCity(null)}
              className="mt-3 text-sm text-brand font-semibold hover:underline"
            >
              전체 상품 보기
            </button>
          )}
        </div>
      )}

      {filtered.length > 6 && (
        <div className="mt-6 text-center">
          <Link
            href={`/packages?destination=${encodeURIComponent(destination)}${selectedCity ? `&departure=${encodeURIComponent(selectedCity)}` : ''}`}
            className="inline-flex items-center gap-1.5 px-6 py-3 bg-white border border-slate-200 text-slate-700 font-semibold text-sm rounded-full hover:border-slate-400 hover:shadow-sm transition"
          >
            {filtered.length - 6}개 더 보기 →
          </Link>
        </div>
      )}
    </section>
  );
}
