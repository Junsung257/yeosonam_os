"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { formatSettlementTimestamp } from "@/lib/settlement-date-format";

type Publication = {
  id: string;
  product_id: string;
  channel_type: string;
  placement_name: string;
  sub_id: string | null;
  status: string;
  published_url: string | null;
  short_url: string;
  click_count: number;
  unique_visitor_count: number;
  conversion_count: number;
  health_status: string;
  first_published_at: string | null;
  last_checked_at: string | null;
  created_at: string;
};

const STATUS: Record<string, string> = {
  DRAFT: "초안",
  TESTED: "테스트 완료",
  PUBLISHED: "게시 중",
  PAUSED: "일시 중지",
  BROKEN: "링크 오류",
  RETIRED: "종료",
};
const HEALTH: Record<string, string> = {
  UNCHECKED: "미점검",
  HEALTHY: "정상",
  REDIRECTED: "리디렉션",
  BROKEN: "깨진 링크",
  PRODUCT_UNAVAILABLE: "상품 판매 중지",
  DISCLOSURE_MISSING: "광고 표시 누락",
};

function key(prefix: string) {
  return `${prefix}:${crypto.randomUUID()}`;
}

export default function PublicationsPage() {
  const router = useRouter();
  const [rows, setRows] = useState<Publication[] | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  async function load() {
    const response = await fetch("/api/partner/publications", {
      cache: "no-store",
    });
    if (response.status === 401) return router.replace("/partner/login");
    if (!response.ok) return setUnavailable(true);
    const result = await response.json();
    setRows(result.publications || []);
  }
  useEffect(() => {
    load().catch(() => setUnavailable(true));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function pause(publication: Publication) {
    setBusy(publication.id);
    try {
      const response = await fetch(
        `/api/partner/publications/${publication.id}`,
        {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            "Idempotency-Key": key("pause-publication"),
          },
          body: JSON.stringify({ status: "PAUSED" }),
        },
      );
      if (!response.ok) throw new Error("pause failed");
      setRows(
        (current) =>
          current?.map((row) =>
            row.id === publication.id ? { ...row, status: "PAUSED" } : row,
          ) || null,
      );
    } catch {
      alert("게시물을 중지하지 못했습니다.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <p className="text-sm font-bold text-blue-700">게시물 관리</p>
          <h1 className="mt-1 text-3xl font-black">
            어디에 올렸는지 한눈에 보세요
          </h1>
          <p className="mt-2 text-sm text-slate-600">
            게시 위치별 클릭과 예약 전환이 독립적으로 집계됩니다.
          </p>
        </div>
        <Link
          href="/partner/publish"
          className="inline-flex min-h-12 items-center rounded-xl bg-blue-600 px-5 font-bold text-white"
        >
          새 게시 만들기
        </Link>
      </header>
      {unavailable ? (
        <section
          role="alert"
          className="rounded-2xl border border-red-200 bg-red-50 p-5 font-bold text-red-800"
        >
          게시물 데이터를 불러오지 못했습니다. 0건으로 대신 표시하지 않았습니다.
        </section>
      ) : !rows ? (
        <div className="h-64 animate-pulse rounded-2xl bg-slate-200" />
      ) : rows.length === 0 ? (
        <section className="rounded-2xl border border-slate-200 bg-white p-8 text-center">
          <h2 className="text-xl font-black">아직 만든 게시물이 없습니다</h2>
          <p className="mt-2 text-sm text-slate-600">
            상품을 고르고 첫 링크를 테스트해 보세요.
          </p>
          <Link
            href="/partner/publish"
            className="mt-5 inline-flex min-h-12 items-center rounded-xl bg-blue-600 px-5 font-bold text-white"
          >
            첫 게시 만들기
          </Link>
        </section>
      ) : (
        <div className="grid gap-4">
          {rows.map((row) => {
            const warning =
              !["HEALTHY", "UNCHECKED"].includes(row.health_status) ||
              row.status === "BROKEN";
            return (
              <article
                key={row.id}
                className={`rounded-2xl border bg-white p-5 ${warning ? "border-amber-300" : "border-slate-200"}`}
              >
                <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-start">
                  <div className="min-w-0">
                    <div className="flex flex-wrap gap-2">
                      <span className="rounded-full bg-blue-50 px-2.5 py-1 text-xs font-bold text-blue-800">
                        {STATUS[row.status] || row.status}
                      </span>
                      <span
                        className={`rounded-full px-2.5 py-1 text-xs font-bold ${warning ? "bg-amber-100 text-amber-900" : "bg-slate-100 text-slate-700"}`}
                      >
                        {HEALTH[row.health_status] || row.health_status}
                      </span>
                    </div>
                    <h2 className="mt-3 text-xl font-black">
                      {row.placement_name}
                    </h2>
                    <p className="mt-1 text-sm text-slate-500">
                      {row.channel_type} · 게시 ID{" "}
                      <span className="font-mono">{row.id.slice(0, 8)}</span>
                    </p>
                  </div>
                  <div className="grid grid-cols-3 gap-3 text-center">
                    <div>
                      <p className="text-xs text-slate-500">클릭</p>
                      <p className="mt-1 text-lg font-black">
                        {Number(row.click_count).toLocaleString()}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs text-slate-500">방문자</p>
                      <p className="mt-1 text-lg font-black">
                        {Number(row.unique_visitor_count).toLocaleString()}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs text-slate-500">예약</p>
                      <p className="mt-1 text-lg font-black">
                        {Number(row.conversion_count).toLocaleString()}
                      </p>
                    </div>
                  </div>
                </div>
                {warning ? (
                  <p className="mt-4 rounded-xl bg-amber-50 p-3 text-sm font-bold text-amber-900">
                    확인이 필요합니다:{" "}
                    {HEALTH[row.health_status] || row.health_status}
                  </p>
                ) : null}
                <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                  <button
                    type="button"
                    onClick={() => navigator.clipboard.writeText(row.short_url)}
                    className="min-h-11 rounded-xl border border-slate-300 px-3 text-sm font-bold"
                  >
                    추적 링크 복사
                  </button>
                  {row.published_url ? (
                    <a
                      href={row.published_url}
                      target="_blank"
                      rel="noreferrer"
                      className="flex min-h-11 items-center justify-center rounded-xl border border-slate-300 px-3 text-center text-sm font-bold"
                    >
                      실제 게시물 열기
                    </a>
                  ) : (
                    <span className="flex min-h-11 items-center justify-center rounded-xl bg-slate-100 px-3 text-sm text-slate-500">
                      게시 URL 미등록
                    </span>
                  )}
                  {row.status === "PUBLISHED" ? (
                    <button
                      type="button"
                      onClick={() => void pause(row)}
                      disabled={busy === row.id}
                      className="min-h-11 rounded-xl border border-amber-300 px-3 text-sm font-bold text-amber-800 disabled:opacity-50"
                    >
                      일시 중지
                    </button>
                  ) : (
                    <Link
                      href={`/partner/publish?product=${row.product_id}`}
                      className="flex min-h-11 items-center justify-center rounded-xl border border-blue-300 px-3 text-center text-sm font-bold text-blue-700"
                    >
                      새 위치에 게시
                    </Link>
                  )}
                  <Link
                    href="/partner/performance"
                    className="flex min-h-11 items-center justify-center rounded-xl bg-slate-950 px-3 text-center text-sm font-bold text-white"
                  >
                    성과 보기
                  </Link>
                </div>
                <p className="mt-3 text-xs text-slate-500">
                  마지막 점검{" "}
                  {row.last_checked_at
                    ? formatSettlementTimestamp(row.last_checked_at, { includeYear: true })
                    : "아직 미실행"}
                </p>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
