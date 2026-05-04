'use client';

import { useState, useEffect, useRef, type ReactNode } from 'react';
import Link from 'next/link';
import {
  ChevronDown, ChevronUp, MapPin, Utensils, Hotel, Camera, Bus, Star,
  Clock, CheckCircle2, XCircle,
} from 'lucide-react';
import type { ItineraryDay, DayActivity } from '@/lib/map-travel-package-to-lp';
import { getLegalNoticeLinesOrDefault } from '@/lib/legal-notice';

function fmt(n: number) {
  return n.toLocaleString('ko-KR');
}

const ACTIVITY_ICON: Record<DayActivity['type'], ReactNode> = {
  sightseeing: <Camera className="w-4 h-4 text-blue-500" />,
  meal:        <Utensils className="w-4 h-4 text-orange-400" />,
  hotel:       <Hotel className="w-4 h-4 text-purple-500" />,
  flight:      <span className="text-sm">✈️</span>,
  transport:   <Bus className="w-4 h-4 text-gray-400" />,
  optional:    <Star className="w-4 h-4 text-yellow-500" />,
  shopping:    <span className="text-sm">🛍</span>,
};

function IncludeExclude({ includes, excludes }: { includes: string[]; excludes: string[] }) {
  return (
    <section className="px-5 py-5 bg-white border-t border-gray-100">
      <h3 className="text-base font-bold text-gray-500 uppercase tracking-wider mb-4">포함 / 불포함</h3>
      <div className="grid grid-cols-2 gap-x-4 gap-y-2">
        <div className="space-y-2">
          {includes.map(i => (
            <div key={i} className="flex items-start gap-2 text-sm text-gray-700">
              <CheckCircle2 className="w-4 h-4 text-green-500 mt-0.5 shrink-0" />
              {i}
            </div>
          ))}
        </div>
        <div className="space-y-2">
          {excludes.map(e => (
            <div key={e} className="flex items-start gap-2 text-sm text-gray-500">
              <XCircle className="w-4 h-4 text-red-400 mt-0.5 shrink-0" />
              {e}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function LegalNotice({ legalNotices }: { legalNotices: string[] }) {
  const renderLines = getLegalNoticeLinesOrDefault(legalNotices, 3);
  return (
    <section className="px-5 py-4 bg-orange-50 border-t border-orange-100">
      <h3 className="text-sm font-bold text-orange-800 mb-2">특별약관 및 취소수수료 안내</h3>
      <div className="space-y-1.5">
        {renderLines.map((line, idx) => (
          <p key={`${idx}-${line.slice(0, 12)}`} className="text-xs text-orange-900 leading-relaxed">
            • {line}
          </p>
        ))}
      </div>
    </section>
  );
}

function MealRow({ meals }: { meals: ItineraryDay['meals'] }) {
  return (
    <div className="flex gap-3 mt-1">
      <span className={`flex items-center gap-0.5 text-xs ${meals.breakfast ? 'text-orange-500' : 'text-gray-300'}`}>
        <Utensils className="w-3 h-3" /> 조
      </span>
      <span className={`flex items-center gap-0.5 text-xs ${meals.lunch ? 'text-orange-500' : 'text-gray-300'}`}>
        <Utensils className="w-3 h-3" /> 중
      </span>
      <span className={`flex items-center gap-0.5 text-xs ${meals.dinner ? 'text-orange-500' : 'text-gray-300'}`}>
        <Utensils className="w-3 h-3" /> 석
      </span>
    </div>
  );
}

function DayAccordion({ dayData, defaultOpen = false }: { dayData: ItineraryDay; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div className="border-b border-gray-100 last:border-0">
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-start justify-between px-5 py-4 text-left hover:bg-gray-50 transition-colors"
      >
        <div className="flex gap-3 items-start">
          <div className="mt-0.5 w-8 h-8 rounded-full bg-blue-600 flex items-center justify-center text-white text-xs font-bold shrink-0">
            D{dayData.day}
          </div>
          <div>
            <p className="font-semibold text-gray-900 text-base leading-snug">{dayData.title}</p>
            <div className="flex items-center gap-1.5 mt-0.5">
              <MapPin className="w-3 h-3 text-gray-400" />
              <span className="text-sm text-gray-400">{dayData.regions}</span>
            </div>
            <MealRow meals={dayData.meals} />
          </div>
        </div>
        <div className="mt-1 shrink-0 ml-2 text-gray-400">
          {open ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
        </div>
      </button>

      <div className={`overflow-hidden transition-all duration-300 ${open ? 'max-h-[600px] opacity-100' : 'max-h-0 opacity-0'}`}>
        <div className="px-5 pb-4 space-y-2.5 bg-gray-50/60">
          <div className="ml-4 border-l-2 border-blue-100 pl-4 space-y-2.5 pt-1">
            {dayData.activities.map((act, i) => (
              <div key={i} className={`flex items-start gap-2.5 ${act.type === 'optional' ? 'opacity-70' : ''}`}>
                <div className="mt-0.5 shrink-0">{ACTIVITY_ICON[act.type]}</div>
                <div>
                  <p className="text-sm text-gray-800 font-medium leading-snug">{act.label}</p>
                  {act.detail && (
                    <p className="text-xs text-gray-400 mt-0.5">{act.detail}</p>
                  )}
                  {act.type === 'optional' && (
                    <span className="inline-block mt-1 text-xs px-2 py-0.5 bg-yellow-50 text-yellow-700 rounded-full font-medium">선택관광</span>
                  )}
                </div>
              </div>
            ))}
          </div>
          {dayData.hotel && (
            <div className="flex items-center gap-2 pl-0.5 pt-1">
              <Hotel className="w-4 h-4 text-purple-400 shrink-0" />
              <span className="text-xs text-gray-600 font-medium">{dayData.hotel}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function ItinerarySection({
  days,
  onViewed,
}: {
  days: ItineraryDay[];
  onViewed: () => void;
}) {
  const sectionRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const el = sectionRef.current;
    if (!el) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.intersectionRatio >= 0.5) {
          onViewed();
          observer.disconnect();
        }
      },
      { threshold: 0.5 }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [onViewed]);

  return (
    <section ref={sectionRef} className="bg-white border-t border-gray-100 mt-2">
      <div className="px-5 py-4 flex items-center justify-between border-b border-gray-100">
        <h3 className="text-base font-bold text-gray-900">상세 일정</h3>
        <span className="text-xs text-gray-400 flex items-center gap-1">
          <Clock className="w-3.5 h-3.5" /> {days.length}일 전체 일정
        </span>
      </div>
      {days.map((d, i) => (
        <DayAccordion key={d.day} dayData={d} defaultOpen={i === 0} />
      ))}
    </section>
  );
}

function ReviewSummaryStrip({
  packageId,
  score,
  count,
}: {
  packageId: string;
  score: number;
  count: number;
}) {
  if (count < 1) return null;
  return (
    <section className="mt-2 border-t border-[var(--border-mid)] bg-white px-5 py-5">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <Star className="w-5 h-5 shrink-0 fill-yellow-400 text-yellow-400" />
          <span className="text-base font-bold text-[var(--text-primary)]">{score.toFixed(1)}</span>
          <span className="text-sm text-[var(--text-muted)] truncate">({fmt(count)}건)</span>
        </div>
        <Link
          href={`/packages/${packageId}`}
          className="text-sm font-semibold text-[var(--brand)] shrink-0 hover:underline"
        >
          상세·후기 →
        </Link>
      </div>
    </section>
  );
}

export interface LpDeferSectionsProps {
  days: ItineraryDay[];
  onItineraryViewed: () => void;
  includes: string[];
  excludes: string[];
  legalNotices: string[];
  packageId: string;
  reviewScore: number;
  reviewCount: number;
}

/** 일정·포함불포·후기 — 초기 JS 번들 분리용 동적 청크 */
export function LpDeferSections({
  days,
  onItineraryViewed,
  includes,
  excludes,
  legalNotices,
  packageId,
  reviewScore,
  reviewCount,
}: LpDeferSectionsProps) {
  return (
    <>
      <ItinerarySection days={days} onViewed={onItineraryViewed} />
      <IncludeExclude includes={includes} excludes={excludes} />
      <LegalNotice legalNotices={legalNotices} />
      <ReviewSummaryStrip packageId={packageId} score={reviewScore} count={reviewCount} />
    </>
  );
}
