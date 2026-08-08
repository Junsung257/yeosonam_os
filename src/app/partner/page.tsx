"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { formatSettlementTimestamp } from "@/lib/settlement-date-format";

type Overview = {
  state: "ready";
  affiliate: { name: string; referral_code: string };
  onboarding: {
    completed: number;
    total: number;
    steps: Array<{ key: string; label: string; complete: boolean }>;
  };
  metrics: Record<string, number>;
  definitions: Record<string, string>;
  updated_at: string;
};

const STEP_LINKS: Record<string, string> = {
  terms: "/partner/settings",
  channel: "/partner/settings",
  domain: "/partner/settings",
  payout: "/partner/settings",
  tax: "/partner/settings",
  product: "/partner/products",
  publication: "/partner/publish",
  published: "/partner/publications",
};

function krw(value: number) {
  return `${Math.round(value || 0).toLocaleString("ko-KR")}원`;
}

export default function PartnerHomePage() {
  const router = useRouter();
  const [overview, setOverview] = useState<Overview | null>(null);
  const [unavailable, setUnavailable] = useState(false);

  useEffect(() => {
    fetch("/api/partner/overview", { cache: "no-store" })
      .then(async (response) => {
        if (response.status === 401) return router.replace("/partner/login");
        if (!response.ok) return setUnavailable(true);
        setOverview(await response.json());
      })
      .catch(() => setUnavailable(true));
  }, [router]);

  if (unavailable) {
    return (
      <section
        role="alert"
        className="rounded-2xl border border-red-200 bg-red-50 p-5"
      >
        <h1 className="font-black text-red-800">
          데이터를 불러오지 못했습니다
        </h1>
        <p className="mt-2 text-sm text-red-700">
          숫자를 0으로 대신 표시하지 않았습니다. 잠시 후 다시 시도해 주세요.
        </p>
      </section>
    );
  }
  if (!overview)
    return (
      <div
        aria-label="파트너 홈 불러오는 중"
        className="h-72 animate-pulse rounded-2xl bg-slate-200"
      />
    );

  const remaining = overview.onboarding.steps.filter((step) => !step.complete);
  const cards = [
    [
      "유효 클릭",
      overview.metrics.valid_clicks_30d,
      "건",
      overview.definitions.valid_clicks_30d,
    ],
    [
      "귀속 예약",
      overview.metrics.attributed_bookings_30d,
      "건",
      overview.definitions.attributed_bookings_30d,
    ],
    [
      "미정산 커미션",
      overview.metrics.pending_commission_krw,
      "원",
      overview.definitions.pending_commission_krw,
    ],
    [
      "정산 가능액",
      overview.metrics.settlement_ready_krw,
      "원",
      overview.definitions.settlement_ready_krw,
    ],
  ] as const;

  return (
    <div className="space-y-8">
      <section className="rounded-3xl bg-slate-950 p-6 text-white sm:p-8">
        <p className="text-sm font-bold text-blue-300">
          계정 활성화 {overview.onboarding.completed}/
          {overview.onboarding.total} 완료
        </p>
        <h1 className="mt-2 text-2xl font-black sm:text-3xl">
          {overview.affiliate.name}님, 다음 할 일을 이어가세요
        </h1>
        <p className="mt-3 text-sm text-slate-300">
          파트너 코드 {overview.affiliate.referral_code}
        </p>
        <div
          className="mt-5 h-2 overflow-hidden rounded-full bg-slate-700"
          aria-label={`온보딩 ${overview.onboarding.completed}/${overview.onboarding.total}`}
        >
          <div
            className="h-full rounded-full bg-blue-400"
            style={{
              width: `${(overview.onboarding.completed / overview.onboarding.total) * 100}%`,
            }}
          />
        </div>
      </section>

      <section>
        <div className="flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-end">
          <div>
            <p className="text-sm font-bold text-blue-700">다음 할 일</p>
            <h2 className="mt-1 text-2xl font-black">첫 게시 링크 테스트를 완성하세요</h2>
          </div>
          <Link
            href="/partner/products"
            className="inline-flex min-h-12 items-center rounded-xl bg-blue-600 px-5 text-sm font-bold text-white"
          >
            첫 상품 찾기
          </Link>
        </div>
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          {overview.onboarding.steps.map((step, index) => (
            <Link
              key={step.key}
              href={STEP_LINKS[step.key] || "/partner"}
              className="flex min-h-20 items-center gap-4 rounded-2xl border border-slate-200 bg-white p-4 hover:border-blue-300 focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <span
                className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sm font-black ${step.complete ? "bg-emerald-100 text-emerald-800" : "bg-slate-100"}`}
              >
                {step.complete ? "✓" : index + 1}
              </span>
              <span className="min-w-0 flex-1 font-bold">{step.label}</span>
              <span
                className={`text-sm font-bold ${step.complete ? "text-emerald-700" : "text-slate-500"}`}
              >
                {step.complete ? "완료" : "미완료"}
              </span>
            </Link>
          ))}
        </div>
        {remaining.length === 0 ? (
          <p className="mt-3 rounded-xl bg-emerald-50 p-4 font-bold text-emerald-800">
            온보딩을 모두 완료했습니다.
          </p>
        ) : null}
      </section>

      <section>
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-black">최근 성과</h2>
          <Link
            href="/partner/performance"
            className="text-sm font-bold text-blue-700"
          >
            자세히 보기
          </Link>
        </div>
        <div className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {cards.map(([label, value, unit, definition]) => (
            <div
              key={label}
              className="rounded-2xl border border-slate-200 bg-white p-5"
              title={definition}
            >
              <p className="text-sm font-semibold text-slate-500">{label}</p>
              <p className="mt-2 text-2xl font-black">
                {unit === "원"
                  ? krw(value)
                  : `${value.toLocaleString("ko-KR")}건`}
              </p>
              <p className="mt-2 text-xs leading-5 text-slate-500">
                최근 30일 · {definition}
              </p>
            </div>
          ))}
        </div>
        <p className="mt-3 text-xs text-slate-500">
          마지막 갱신 {formatSettlementTimestamp(overview.updated_at, { includeYear: true })}
        </p>
      </section>
    </div>
  );
}
