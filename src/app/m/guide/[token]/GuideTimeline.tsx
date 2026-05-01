'use client';

import { useState } from 'react';

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

interface DayPlan {
  day: number;
  date: string;
  title: string;
  move: string;
  highlight: string;
  hotels: DayPlanHotelOption[];
  activities: DayPlanActivity[];
}

interface VoucherPreview {
  title: string;
  html?: string | null;
}

export default function GuideTimeline({
  dayPlans,
  voucher,
}: {
  dayPlans: DayPlan[];
  voucher: VoucherPreview | null;
}) {
  const [openVoucher, setOpenVoucher] = useState(false);

  return (
    <div className="min-h-screen bg-slate-50 px-4 py-5">
      <div className="mx-auto max-w-[640px] space-y-4">
        <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-xs font-semibold text-blue-600">여소남 스마트 가이드북</p>
          <h1 className="mt-1 text-lg font-bold text-slate-900">일정 + 바우처 허브</h1>
          <p className="mt-1 text-xs text-slate-500">링크 하나로 호텔/투어 바우처와 일정을 확인하세요.</p>
          {voucher && (
            <button
              type="button"
              onClick={() => setOpenVoucher(true)}
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

              <div className="mt-2 space-y-1.5">
                {plan.hotels.map((hotel, idx) => (
                  <div key={idx} className="rounded-lg border border-slate-200 bg-slate-50 p-2">
                    <p className="text-xs font-semibold text-slate-900">
                      {hotel.type === 'recommended' ? '추천 호텔' : '대안 호텔'}: {hotel.name}
                    </p>
                    <p className="text-[11px] text-slate-500">{hotel.reason}</p>
                    <div className="mt-1 flex items-center justify-between">
                      <span className="text-xs font-bold text-blue-600">{hotel.pricePerNight.toLocaleString()}원/박</span>
                      {hotel.affiliateLink && (
                        <a href={hotel.affiliateLink} target="_blank" rel="noreferrer" className="text-[11px] text-blue-600 underline">
                          예약 링크
                        </a>
                      )}
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
                      {activity.affiliateLink && (
                        <a href={activity.affiliateLink} target="_blank" rel="noreferrer" className="text-[11px] text-blue-600 underline">
                          길찾기/예약
                        </a>
                      )}
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
                <div className="text-xs" dangerouslySetInnerHTML={{ __html: voucher.html }} />
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
