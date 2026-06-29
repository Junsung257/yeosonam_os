'use client';

import { useState, useEffect, useRef, type ReactNode } from 'react';
import Link from 'next/link';
import {
  ChevronDown,
  ChevronUp,
  MapPin,
  Utensils,
  Hotel,
  Camera,
  Bus,
  Star,
  Clock,
  CheckCircle2,
  XCircle,
} from 'lucide-react';
import type { ItineraryDay, DayActivity, LandingProductData } from '@/lib/map-travel-package-to-lp';
import { getLegalNoticeLinesOrDefault } from '@/lib/legal-notice';

function fmt(n: number) {
  return n.toLocaleString('ko-KR');
}

const ACTIVITY_ICON: Record<DayActivity['type'], ReactNode> = {
  sightseeing: <Camera className="h-4 w-4 text-blue-500" />,
  meal: <Utensils className="h-4 w-4 text-orange-400" />,
  hotel: <Hotel className="h-4 w-4 text-purple-500" />,
  flight: <span className="text-sm" aria-hidden="true">✈</span>,
  transport: <Bus className="h-4 w-4 text-gray-400" />,
  optional: <Star className="h-4 w-4 text-yellow-500" />,
  shopping: <span className="text-sm" aria-hidden="true">🛍</span>,
};

function IncludeExclude({ includes, excludes }: { includes: string[]; excludes: string[] }) {
  return (
    <section className="border-t border-gray-100 bg-white px-5 py-5">
      <h3 className="mb-4 text-base font-bold uppercase tracking-wider text-gray-500">포함 / 불포함</h3>
      <div className="grid grid-cols-2 gap-x-4 gap-y-2">
        <div className="space-y-2">
          {includes.map(item => (
            <div key={item} className="flex items-start gap-2 text-sm text-gray-700">
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-green-500" />
              {item}
            </div>
          ))}
        </div>
        <div className="space-y-2">
          {excludes.map(item => (
            <div key={item} className="flex items-start gap-2 text-sm text-gray-500">
              <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-400" />
              {item}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function OptionalToursSection({ tours }: { tours: LandingProductData['itinerary']['optionalTours'] }) {
  if (!tours.length) return null;
  return (
    <section className="border-t border-pink-100 bg-white px-5 py-5">
      <div className="mb-3 flex items-center gap-2">
        <Star className="h-4 w-4 text-pink-500" />
        <h3 className="text-base font-bold text-gray-900">선택관광</h3>
        <span className="rounded-full bg-pink-50 px-2 py-0.5 text-xs font-semibold text-pink-700">별도 비용</span>
      </div>
      <div className="space-y-2">
        {tours.map((tour, index) => (
          <div key={`${tour.displayName}-${index}`} className="rounded-lg border border-pink-50 bg-pink-50/40 px-3 py-2">
            <div className="flex items-start justify-between gap-3">
              <p className="text-sm font-semibold leading-snug text-gray-900">{tour.displayName}</p>
              {tour.price && <p className="shrink-0 text-sm font-black text-pink-700">{tour.price}</p>}
            </div>
            {tour.note && <p className="mt-1 text-xs leading-relaxed text-gray-500">{tour.note}</p>}
          </div>
        ))}
      </div>
    </section>
  );
}

function LegalNotice({ legalNotices }: { legalNotices: string[] }) {
  const renderLines = getLegalNoticeLinesOrDefault(legalNotices, 3);
  return (
    <section className="border-t border-orange-100 bg-orange-50 px-5 py-4">
      <h3 className="mb-2 text-sm font-bold text-orange-800">약관 및 취소 수수료 안내</h3>
      <div className="space-y-1.5">
        {renderLines.map((line, index) => (
          <p key={`${index}-${line.slice(0, 12)}`} className="text-xs leading-relaxed text-orange-900">
            · {line}
          </p>
        ))}
      </div>
    </section>
  );
}

function CleanMealRow({ meals }: { meals: ItineraryDay['meals'] }) {
  const rows = [
    { label: '조식', active: meals.breakfast },
    { label: '중식', active: meals.lunch },
    { label: '석식', active: meals.dinner },
  ];

  return (
    <div className="mt-1 flex gap-3">
      {rows.map(row => (
        <span
          key={row.label}
          className={`flex items-center gap-0.5 text-xs ${row.active ? 'text-orange-500' : 'text-gray-300'}`}
        >
          <Utensils className="h-3 w-3" /> {row.label}
        </span>
      ))}
    </div>
  );
}

function DayAccordion({ dayData, defaultOpen = false }: { dayData: ItineraryDay; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div className="border-b border-gray-100 last:border-0">
      <button
        type="button"
        onClick={() => setOpen(value => !value)}
        className="flex w-full items-start justify-between px-5 py-4 text-left transition-colors hover:bg-gray-50"
      >
        <div className="flex items-start gap-3">
          <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-blue-600 text-xs font-bold text-white">
            D{dayData.day}
          </div>
          <div>
            <p className="text-base font-semibold leading-snug text-gray-900">{dayData.title}</p>
            <div className="mt-0.5 flex items-center gap-1.5">
              <MapPin className="h-3 w-3 text-gray-400" />
              <span className="text-sm text-gray-400">{dayData.regions}</span>
            </div>
            {(dayData.meals.breakfast || dayData.meals.lunch || dayData.meals.dinner) && (
              <CleanMealRow meals={dayData.meals} />
            )}
          </div>
        </div>
        <div className="ml-2 mt-1 shrink-0 text-gray-400">
          {open ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        </div>
      </button>

      <div className={`overflow-hidden transition-all duration-300 ${open ? 'max-h-[600px] opacity-100' : 'max-h-0 opacity-0'}`}>
        <div className="space-y-2.5 bg-gray-50/60 px-5 pb-4">
          <div className="ml-4 space-y-2.5 border-l-2 border-blue-100 pl-4 pt-1">
            {dayData.activities.map((activity, index) => (
              <div key={`${activity.type}-${index}-${activity.label}`} className={`flex items-start gap-2.5 ${activity.type === 'optional' ? 'opacity-70' : ''}`}>
                <div className="mt-0.5 shrink-0">{ACTIVITY_ICON[activity.type]}</div>
                <div>
                  <p className="text-sm font-medium leading-snug text-gray-800">{activity.label}</p>
                  {activity.detail && (
                    <p className="mt-0.5 text-xs text-gray-400">{activity.detail}</p>
                  )}
                  {activity.attractionNames && activity.attractionNames.length > 0 && (
                    <div className="mt-1 flex flex-wrap gap-1">
                      {activity.attractionNames.map((name, attractionIndex) => (
                        <span key={`${name}-${attractionIndex}`} className="inline-block rounded-full bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-700">
                          {name}
                        </span>
                      ))}
                    </div>
                  )}
                  {activity.type === 'optional' && (
                    <span className="mt-1 inline-block rounded-full bg-yellow-50 px-2 py-0.5 text-xs font-medium text-yellow-700">선택 관광</span>
                  )}
                </div>
              </div>
            ))}
          </div>
          {dayData.hotel && (
            <div className="flex items-center gap-2 pl-0.5 pt-1">
              <Hotel className="h-4 w-4 shrink-0 text-purple-400" />
              <span className="text-xs font-medium text-gray-600">{dayData.hotel}</span>
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
      { threshold: 0.5 },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [onViewed]);

  return (
    <section ref={sectionRef} className="mt-2 border-t border-gray-100 bg-white">
      <div className="flex items-center justify-between border-b border-gray-100 px-5 py-4">
        <h3 className="text-base font-bold text-gray-900">상세 일정</h3>
        <span className="flex items-center gap-1 text-xs text-gray-400">
          <Clock className="h-3.5 w-3.5" /> {days.length}일 전체 일정
        </span>
      </div>
      {days.map((day, index) => (
        <DayAccordion key={day.day} dayData={day} defaultOpen={index === 0} />
      ))}
    </section>
  );
}

function ReviewSummaryStrip({
  packageId,
  score,
  count,
  recommendation,
}: {
  packageId: string;
  score: number;
  count: number;
  recommendation?: LandingProductData['recommendation'];
}) {
  if (count < 1 && !recommendation) return null;
  if (count < 1 && recommendation) {
    return (
      <section className="mt-2 border-t border-[var(--border-mid)] bg-white px-5 py-5">
        <div className="flex items-start gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-blue-50 text-lg">
            Pick
          </div>
          <div className="min-w-0">
            <p className="text-base font-bold text-[var(--text-primary)]">{recommendation.label}</p>
            <p className="mt-1 break-keep text-sm leading-relaxed text-[var(--text-muted)]">
              {recommendation.comparisonSummary}
            </p>
          </div>
        </div>
      </section>
    );
  }
  return (
    <section className="mt-2 border-t border-[var(--border-mid)] bg-white px-5 py-5">
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <Star className="h-5 w-5 shrink-0 fill-yellow-400 text-yellow-400" />
          <span className="text-base font-bold text-[var(--text-primary)]">{score.toFixed(1)}</span>
          <span className="truncate text-sm text-[var(--text-muted)]">({fmt(count)}건 후기)</span>
        </div>
        <Link
          href={`/packages/${encodeURIComponent(packageId)}`}
          className="shrink-0 text-sm font-semibold text-[var(--brand)] hover:underline"
        >
          상세·후기 보기
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
  optionalTours: LandingProductData['itinerary']['optionalTours'];
  legalNotices: string[];
  packageId: string;
  reviewScore: number;
  reviewCount: number;
  recommendation?: LandingProductData['recommendation'];
}

export function LpDeferSections({
  days,
  onItineraryViewed,
  includes,
  excludes,
  optionalTours,
  legalNotices,
  packageId,
  reviewScore,
  reviewCount,
  recommendation,
}: LpDeferSectionsProps) {
  return (
    <>
      <ItinerarySection days={days} onViewed={onItineraryViewed} />
      <OptionalToursSection tours={optionalTours} />
      <IncludeExclude includes={includes} excludes={excludes} />
      <LegalNotice legalNotices={legalNotices} />
      <ReviewSummaryStrip packageId={packageId} score={reviewScore} count={reviewCount} recommendation={recommendation} />
    </>
  );
}
