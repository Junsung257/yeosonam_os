'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import DOMPurify from 'isomorphic-dompurify';

interface DayPlanHotelOption {
  type: 'recommended' | 'alternative';
  name: string;
  pricePerNight: number;
  location?: string;
  reason: string;
  affiliateLink?: string;
}

interface DayPlanActivity {
  title: string;
  price: number;
  reason: string;
  affiliateLink?: string;
}

interface DayPlanStop {
  id: string;
  timeHint: string;
  label: string;
  kind?: string;
  affiliateLink?: string;
}

interface DayPlan {
  day: number;
  date: string;
  title: string;
  move: string;
  highlight: string;
  stops?: DayPlanStop[];
  hotels: DayPlanHotelOption[];
  activities: DayPlanActivity[];
}

interface VoucherPreview {
  title: string;
  html?: string | null;
}

export default function GuideTimeline({
  guideRef,
  dayPlans,
  voucher,
}: {
  guideRef: string;
  dayPlans: DayPlan[];
  voucher: VoucherPreview | null;
}) {
  const [openVoucher, setOpenVoucher] = useState(false);
  const toGoogleMapsLink = (query: string) => `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;

  type GuideAction =
    | 'guide_open'
    | 'voucher_open'
    | 'directions_hotel'
    | 'book_hotel'
    | 'directions_activity'
    | 'book_activity';

  const trackGuidebook = useCallback(
    (action: GuideAction, meta?: Record<string, unknown>) => {
      void fetch('/api/tracking/guidebook', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ guide_ref: guideRef, action, meta: meta ?? {} }),
      }).catch(() => {});
    },
    [guideRef],
  );

  const hasVoucher = !!voucher;
  const openTracked = useRef(false);
  useEffect(() => {
    if (openTracked.current) return;
    openTracked.current = true;
    const k = `gb_open_${guideRef}`;
    try {
      if (typeof window !== 'undefined' && sessionStorage.getItem(k)) return;
      sessionStorage.setItem(k, '1');
    } catch {
      // private mode 등 — 중복 1회 허용
    }
    trackGuidebook('guide_open', { dayCount: dayPlans.length, hasVoucher });
  }, [guideRef, dayPlans.length, hasVoucher, trackGuidebook]);

  return (
    <div className="min-h-screen bg-slate-50 px-4 py-5">
      <div className="mx-auto max-w-[640px] space-y-4">
        <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-xs font-semibold text-blue-600">여소남 스마트 가이드북</p>
          <h1 className="mt-1 text-lg font-bold text-slate-900">여행 일정표 · 바우처</h1>
          <p className="mt-1 text-xs text-slate-500">
            일정표는 저장된 견적과 동일하게 보여 드려요. 아래에서 호텔·투어 예약 링크와 길찾기를 눌러 이어가면 됩니다.
          </p>
          {voucher && (
            <button
              type="button"
              onClick={() => {
                trackGuidebook('voucher_open');
                setOpenVoucher(true);
              }}
              className="mt-3 rounded-full bg-blue-600 px-4 py-2 text-xs font-semibold text-white"
            >
              호텔/투어 바우처 보기
            </button>
          )}
        </section>

        <section className="space-y-3">
          {dayPlans.map((plan) => (
            <article key={plan.day} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-bold text-slate-900">{plan.day}일차 · {plan.title}</h2>
                <span className="text-xs text-slate-500">{plan.date}</span>
              </div>
              <p className="mt-1 text-xs text-slate-600">{plan.move}</p>
              <p className="mt-1 text-xs text-slate-500">{plan.highlight}</p>

              {plan.stops && plan.stops.length > 0 && (
                <ul className="mt-2 space-y-1 rounded-lg border border-slate-100 bg-slate-50/80 p-2">
                  {plan.stops.map(s => (
                    <li key={s.id} className="flex flex-wrap items-baseline gap-x-2 text-[11px] text-slate-800">
                      <span className="shrink-0 font-semibold text-slate-500">{s.timeHint}</span>
                      <span className="min-w-0 flex-1">{s.label}</span>
                      {s.kind === 'bookable' && (
                        <span className="text-[9px] font-bold uppercase text-blue-700">예약 연계</span>
                      )}
                      {s.affiliateLink && (
                        <a
                          href={s.affiliateLink}
                          target="_blank"
                          rel="noreferrer"
                          className="text-[10px] text-blue-600 underline"
                          onClick={() => trackGuidebook('book_activity', { day: plan.day, label: s.label })}
                        >
                          예약
                        </a>
                      )}
                    </li>
                  ))}
                </ul>
              )}

              <div className="mt-2 space-y-1.5">
                {plan.hotels.map((hotel, idx) => (
                  <div key={idx} className="rounded-lg border border-slate-200 bg-slate-50 p-2">
                    <p className="text-xs font-semibold text-slate-900">
                      {hotel.type === 'recommended' ? '추천 호텔' : '대안 호텔'}: {hotel.name}
                    </p>
                    <p className="text-[11px] text-slate-500">{hotel.reason}</p>
                    <div className="mt-1 flex items-center justify-between">
                      <span className="text-xs font-bold text-blue-600">{hotel.pricePerNight.toLocaleString()}원/박</span>
                      <div className="flex items-center gap-2">
                        {(hotel.location || hotel.name) && (
                          <a
                            href={toGoogleMapsLink(hotel.location || hotel.name)}
                            target="_blank"
                            rel="noreferrer"
                            className="text-[11px] text-slate-600 underline"
                            onClick={() =>
                              trackGuidebook('directions_hotel', { day: plan.day, label: hotel.name })
                            }
                          >
                            길찾기
                          </a>
                        )}
                        {hotel.affiliateLink && (
                          <a
                            href={hotel.affiliateLink}
                            target="_blank"
                            rel="noreferrer"
                            className="text-[11px] text-blue-600 underline"
                            onClick={() => trackGuidebook('book_hotel', { day: plan.day, label: hotel.name })}
                          >
                            예약 링크
                          </a>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              <div className="mt-2 space-y-1.5">
                {plan.activities.map((activity, idx) => (
                  <div key={idx} className="rounded-lg border border-blue-200 bg-blue-50 p-2">
                    <p className="text-xs font-semibold text-slate-900">액티비티: {activity.title}</p>
                    <div className="mt-1 flex items-center justify-between">
                      <span className="text-xs font-bold text-blue-600">{activity.price.toLocaleString()}원~</span>
                      <div className="flex items-center gap-2">
                        <a
                          href={toGoogleMapsLink(activity.title)}
                          target="_blank"
                          rel="noreferrer"
                          className="text-[11px] text-slate-600 underline"
                          onClick={() =>
                            trackGuidebook('directions_activity', { day: plan.day, label: activity.title })
                          }
                        >
                          길찾기
                        </a>
                        {activity.affiliateLink && (
                          <a
                            href={activity.affiliateLink}
                            target="_blank"
                            rel="noreferrer"
                            className="text-[11px] text-blue-600 underline"
                            onClick={() =>
                              trackGuidebook('book_activity', { day: plan.day, label: activity.title })
                            }
                          >
                            예약
                          </a>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </article>
          ))}
        </section>
      </div>

      {openVoucher && voucher && (
        <div className="fixed inset-0 z-40 bg-black/50 px-4 py-8">
          <div className="mx-auto max-w-[640px] rounded-2xl bg-white p-4 shadow-xl">
            <div className="mb-2 flex items-center justify-between">
              <h3 className="text-sm font-bold text-slate-900">{voucher.title}</h3>
              <button type="button" onClick={() => setOpenVoucher(false)} className="text-xs text-slate-500">닫기</button>
            </div>
            <div className="max-h-[70vh] overflow-auto rounded-xl border border-slate-200 p-2">
              {voucher.html ? (
                <div
                  className="text-xs"
                  dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(voucher.html || '') }}
                />
              ) : (
                <p className="text-xs text-slate-500">등록된 바우처 미리보기가 없습니다.</p>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
