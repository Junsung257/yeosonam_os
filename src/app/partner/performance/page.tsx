"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { formatSettlementTimestamp } from "@/lib/settlement-date-format";

type Overview = {
  metrics: Record<string, number>;
  booking_trend_7d: Array<{
    date: string;
    bookings: number;
    booking_amount_krw: number;
    commission_krw: number;
  }>;
  definitions: Record<string, string>;
  updated_at: string;
};
function krw(value: number) {
  return `${Math.round(value || 0).toLocaleString("ko-KR")}원`;
}

export default function PartnerPerformancePage() {
  const router = useRouter();
  const [data, setData] = useState<Overview | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  useEffect(() => {
    fetch("/api/partner/overview", { cache: "no-store" })
      .then(async (response) => {
        if (response.status === 401) return router.replace("/partner/login");
        if (!response.ok) return setUnavailable(true);
        setData(await response.json());
      })
      .catch(() => setUnavailable(true));
  }, [router]);
  if (unavailable)
    return (
      <p
        role="alert"
        className="rounded-2xl border border-red-200 bg-red-50 p-5 font-bold text-red-800"
      >
        성과 데이터를 불러오지 못했습니다. 조회 실패를 0으로 표시하지
        않았습니다.
      </p>
    );
  if (!data)
    return <div className="h-72 animate-pulse rounded-2xl bg-slate-200" />;
  const maxBookings = Math.max(
    1,
    ...data.booking_trend_7d.map((row) => row.bookings),
  );
  const cards = [
    [
      "유효 클릭",
      data.metrics.valid_clicks_30d,
      "건",
      data.definitions.valid_clicks_30d,
    ],
    [
      "귀속 예약",
      data.metrics.attributed_bookings_30d,
      "건",
      data.definitions.attributed_bookings_30d,
    ],
    [
      "활성 게시물",
      data.metrics.active_publications,
      "개",
      "테스트 완료 또는 실제 게시 상태인 게시 위치",
    ],
    [
      "커미션 보류",
      data.metrics.commission_hold_krw,
      "원",
      "정책 또는 계산 근거가 부족해 확정하지 않은 금액",
    ],
  ] as const;
  return (
    <div className="space-y-7">
      <header>
        <p className="text-sm font-bold text-blue-700">성과</p>
        <h1 className="mt-1 text-3xl font-black">실제 클릭과 예약 흐름</h1>
        <p className="mt-2 text-sm text-slate-600">
          콘텐츠 생성 횟수가 아니라 귀속된 예약만 예약 지표로 집계합니다.
        </p>
      </header>
      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {cards.map(([label, value, unit, definition]) => (
          <article
            key={label}
            className="rounded-2xl border border-slate-200 bg-white p-5"
          >
            <p className="text-sm font-bold text-slate-500">{label}</p>
            <p className="mt-2 text-2xl font-black">
              {unit === "원"
                ? krw(value)
                : `${value.toLocaleString("ko-KR")}${unit}`}
            </p>
            <p className="mt-2 text-xs leading-5 text-slate-500">
              최근 30일 · {definition}
            </p>
          </article>
        ))}
      </section>
      <section className="rounded-2xl border border-slate-200 bg-white p-5 sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-xl font-black">7일 예약 추이</h2>
            <p className="mt-1 text-xs text-slate-500">
              원천: bookings.affiliate_id · 일자: 예약 생성 시각
            </p>
          </div>
          <p className="text-xs text-slate-500">
            갱신 {formatSettlementTimestamp(data.updated_at, { includeYear: true })}
          </p>
        </div>
        <div
          className="mt-6 grid grid-cols-7 gap-2"
          aria-label="최근 7일 예약 막대그래프"
        >
          {data.booking_trend_7d.map((row) => (
            <div key={row.date} className="flex min-w-0 flex-col items-center">
              <div className="flex h-40 w-full items-end justify-center rounded-lg bg-slate-50 p-1">
                <div
                  className="w-full max-w-10 rounded-md bg-blue-500"
                  style={{
                    height: `${Math.max(row.bookings ? 12 : 2, (row.bookings / maxBookings) * 100)}%`,
                  }}
                  title={`${row.date}: 예약 ${row.bookings}건`}
                />
              </div>
              <p className="mt-2 text-[10px] font-bold text-slate-500">
                {row.date.slice(5)}
              </p>
              <p className="text-xs font-black">{row.bookings}</p>
            </div>
          ))}
        </div>
        <div className="mt-5 overflow-x-auto">
          <table className="w-full min-w-[520px] text-left text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-slate-500">
                <th className="py-3">일자</th>
                <th>예약</th>
                <th>예약금액</th>
                <th>커미션</th>
              </tr>
            </thead>
            <tbody>
              {data.booking_trend_7d.map((row) => (
                <tr key={row.date} className="border-b border-slate-100">
                  <td className="py-3 font-bold">{row.date}</td>
                  <td>{row.bookings}건</td>
                  <td>{krw(row.booking_amount_krw)}</td>
                  <td>{krw(row.commission_krw)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
