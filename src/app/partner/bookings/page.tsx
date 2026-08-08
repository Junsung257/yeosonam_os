"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

type Booking = {
  id: string;
  booking_no: string;
  product_name: string;
  departure_date: string | null;
  booking_status: string | null;
  payment_status: string | null;
  booking_amount_krw: number | null;
  commission_amount_krw: number | null;
  commission_status: string;
  commission_policy_version: string | null;
  attribution: {
    reason_code: string;
    policy_version: string;
    publication: { channel_type: string; placement_name: string } | null;
  } | null;
  created_at: string | null;
};
function krw(value: number | null) {
  return value == null ? "확인 필요" : `${value.toLocaleString("ko-KR")}원`;
}

export default function PartnerBookingsPage() {
  const router = useRouter();
  const [rows, setRows] = useState<Booking[] | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  useEffect(() => {
    fetch("/api/partner/affiliate-bookings", { cache: "no-store" })
      .then(async (response) => {
        if (response.status === 401) return router.replace("/partner/login");
        if (!response.ok) return setUnavailable(true);
        const result = await response.json();
        setRows(result.bookings || []);
      })
      .catch(() => setUnavailable(true));
  }, [router]);
  return (
    <div className="space-y-6">
      <header>
        <p className="text-sm font-bold text-blue-700">예약</p>
        <h1 className="mt-1 text-3xl font-black">귀속 예약과 커미션 근거</h1>
        <p className="mt-2 text-sm text-slate-600">
          고객 개인정보 없이 예약·게시 위치·정책 버전만 확인할 수 있습니다.
        </p>
      </header>
      {unavailable ? (
        <p
          role="alert"
          className="rounded-2xl border border-red-200 bg-red-50 p-5 font-bold text-red-800"
        >
          예약 데이터를 불러오지 못했습니다.
        </p>
      ) : !rows ? (
        <div className="h-64 animate-pulse rounded-2xl bg-slate-200" />
      ) : rows.length === 0 ? (
        <section className="rounded-2xl border border-slate-200 bg-white p-8 text-center">
          <h2 className="text-xl font-black">아직 귀속된 예약이 없습니다</h2>
          <p className="mt-2 text-sm text-slate-600">
            테스트 완료한 게시 링크의 성과는 게시물 관리에서 확인하세요.
          </p>
        </section>
      ) : (
        <div className="grid gap-4">
          {rows.map((row) => (
            <article
              key={row.id}
              className="rounded-2xl border border-slate-200 bg-white p-5"
            >
              <div className="flex flex-col justify-between gap-4 md:flex-row">
                <div>
                  <p className="text-xs font-bold text-slate-500">
                    예약번호 {row.booking_no}
                  </p>
                  <h2 className="mt-2 text-lg font-black">
                    {row.product_name}
                  </h2>
                  <p className="mt-2 text-sm text-slate-600">
                    출발 {row.departure_date || "확인 필요"} · 예약{" "}
                    {row.booking_status || "상태 확인 필요"} · 결제{" "}
                    {row.payment_status || "상태 확인 필요"}
                  </p>
                </div>
                <dl className="grid grid-cols-2 gap-5 md:text-right">
                  <div>
                    <dt className="text-xs text-slate-500">예약금액</dt>
                    <dd className="mt-1 font-black">
                      {krw(row.booking_amount_krw)}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-slate-500">커미션</dt>
                    <dd
                      className={`mt-1 font-black ${row.commission_status === "CALCULATED" ? "text-blue-700" : "text-amber-700"}`}
                    >
                      {row.commission_status === "CALCULATED"
                        ? krw(row.commission_amount_krw)
                        : "계산 보류"}
                    </dd>
                  </div>
                </dl>
              </div>
              <div className="mt-4 rounded-xl bg-slate-50 p-4 text-sm">
                <p className="font-bold">귀속 근거</p>
                {row.attribution ? (
                  <p className="mt-1 leading-6 text-slate-600">
                    {row.attribution.publication
                      ? `${row.attribution.publication.channel_type} · ${row.attribution.publication.placement_name}`
                      : "추천 코드 또는 레거시 접점"}{" "}
                    · {row.attribution.reason_code} · 정책{" "}
                    {row.attribution.policy_version}
                  </p>
                ) : (
                  <p className="mt-1 text-amber-700">
                    귀속 결정 스냅샷이 없습니다. 이의제기 대상이 될 수 있습니다.
                  </p>
                )}
                <p className="mt-1 text-xs text-slate-500">
                  커미션 정책 {row.commission_policy_version || "계산 보류"}
                </p>
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
