"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { formatSettlementTimestamp } from "@/lib/settlement-date-format";

type Product = {
  id: string;
  title: string;
  destination: string;
  country: string;
  summary: string;
  tags: string[];
  availability: { code: string; sellable: boolean };
  next_departure: string | null;
  customer_price_krw: number | null;
  required_local_costs: unknown;
  cancellation_risk: "HIGH" | "NORMAL" | "REVIEW_REQUIRED";
  expected_commission: {
    state: string;
    amount_krw: number | null;
    rate: number | null;
    formula: string | null;
  };
  saved: boolean;
  updated_at: string | null;
};

type CatalogResponse = {
  state: "ready" | "empty";
  products: Product[];
  last_synced_at: string | null;
  updated_at: string;
};

const STATE_LABELS: Record<string, string> = {
  SELLABLE: "판매 가능",
  SOLD_OUT: "품절",
  DEPARTURE_DATE_MISSING: "출발일 없음",
  PRICE_REVIEW_REQUIRED: "가격 검수 필요",
};

function krw(value: number | null) {
  return value == null ? "확인 필요" : `${value.toLocaleString("ko-KR")}원`;
}

export default function PartnerProductsPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const initialQuery = searchParams.get("q") || "";
  const [query, setQuery] = useState(initialQuery);
  const [catalog, setCatalog] = useState<CatalogResponse | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const [saving, setSaving] = useState<string | null>(null);

  async function load(q = query) {
    setUnavailable(false);
    setCatalog(null);
    const response = await fetch(
      `/api/partner/catalog?q=${encodeURIComponent(q)}`,
      { cache: "no-store" },
    );
    if (response.status === 401) return router.replace("/partner/login");
    if (!response.ok) return setUnavailable(true);
    setCatalog(await response.json());
  }

  useEffect(() => {
    load(initialQuery).catch(() => setUnavailable(true));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function toggleSaved(product: Product) {
    setSaving(product.id);
    try {
      const response = await fetch(
        product.saved
          ? `/api/partner/saved-products?product_id=${product.id}`
          : "/api/partner/saved-products",
        {
          method: product.saved ? "DELETE" : "POST",
          headers: product.saved
            ? undefined
            : { "Content-Type": "application/json" },
          body: product.saved
            ? undefined
            : JSON.stringify({ product_id: product.id }),
        },
      );
      if (!response.ok) throw new Error("save failed");
      setCatalog((current) =>
        current
          ? {
              ...current,
              products: current.products.map((row) =>
                row.id === product.id ? { ...row, saved: !row.saved } : row,
              ),
            }
          : current,
      );
    } catch {
      alert("상품 저장 상태를 바꾸지 못했습니다. 잠시 후 다시 시도해 주세요.");
    } finally {
      setSaving(null);
    }
  }

  return (
    <div className="space-y-6">
      <header>
        <p className="text-sm font-bold text-blue-700">상품 찾기</p>
        <h1 className="mt-1 text-3xl font-black">
          팔고 싶은 여행을 찾아보세요
        </h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">
          고객에게 판매 가능한 상태와 예약 시점 예상 커미션을 같은 기준으로
          보여줍니다.
        </p>
      </header>

      <form
        onSubmit={(event) => {
          event.preventDefault();
          void load(query);
        }}
        className="flex flex-col gap-2 rounded-2xl border border-slate-200 bg-white p-4 sm:flex-row"
      >
        <label className="flex-1">
          <span className="sr-only">상품명 또는 여행지 검색</span>
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            maxLength={80}
            placeholder="상품명, 여행지, 국가 검색"
            className="min-h-12 w-full rounded-xl border border-slate-300 px-4 text-base outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-200"
          />
        </label>
        <button
          type="submit"
          className="min-h-12 rounded-xl bg-slate-950 px-6 font-bold text-white"
        >
          검색
        </button>
      </form>

      {unavailable ? (
        <section
          role="alert"
          className="rounded-2xl border border-red-200 bg-red-50 p-5"
        >
          <h2 className="font-black text-red-800">
            상품 데이터를 불러오지 못했습니다
          </h2>
          <p className="mt-2 text-sm text-red-700">
            상품 0건으로 처리하지 않았습니다.
          </p>
          <button
            type="button"
            onClick={() => void load()}
            className="mt-4 min-h-11 rounded-xl bg-red-700 px-4 font-bold text-white"
          >
            다시 시도
          </button>
        </section>
      ) : !catalog ? (
        <div
          aria-label="상품 불러오는 중"
          className="grid gap-4 md:grid-cols-2"
        >
          <div className="h-80 animate-pulse rounded-2xl bg-slate-200" />
          <div className="h-80 animate-pulse rounded-2xl bg-slate-200" />
        </div>
      ) : catalog.state === "empty" ? (
        <section className="rounded-2xl border border-slate-200 bg-white p-8 text-center">
          <h2 className="text-xl font-black">조건에 맞는 상품이 없습니다</h2>
          <p className="mt-2 text-sm text-slate-600">
            검색어를 줄이거나 운영팀에 판매 가능 상품 동기화를 요청해 주세요.
          </p>
          <button
            type="button"
            onClick={() => {
              setQuery("");
              void load("");
            }}
            className="mt-5 min-h-11 rounded-xl border border-slate-300 px-4 font-bold"
          >
            전체 상품 보기
          </button>
        </section>
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="font-bold">
              판매 가능 후보 {catalog.products.length}개
            </p>
            <p className="text-xs text-slate-500">
              마지막 동기화{" "}
              {catalog.last_synced_at
                ? formatSettlementTimestamp(catalog.last_synced_at, { includeYear: true })
                : "확인 불가"}
            </p>
          </div>
          <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
            {catalog.products.map((product) => (
              <article
                key={product.id}
                className="flex min-w-0 flex-col rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"
              >
                <div className="flex flex-wrap gap-2">
                  <span
                    className={`rounded-full px-2.5 py-1 text-xs font-bold ${product.availability.sellable ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-800"}`}
                  >
                    {STATE_LABELS[product.availability.code] ||
                      product.availability.code}
                  </span>
                  {product.destination ? (
                    <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-bold text-slate-700">
                      {product.destination}
                    </span>
                  ) : null}
                </div>
                <h2 className="mt-4 text-xl font-black leading-7">
                  {product.title}
                </h2>
                {product.summary ? (
                  <p className="mt-2 line-clamp-3 text-sm leading-6 text-slate-600">
                    {product.summary}
                  </p>
                ) : null}
                <dl className="mt-5 grid grid-cols-2 gap-3 border-y border-slate-100 py-4 text-sm">
                  <div>
                    <dt className="text-slate-500">다음 출발</dt>
                    <dd className="mt-1 font-bold">
                      {product.next_departure || "확인 필요"}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-slate-500">고객 예상 총액</dt>
                    <dd className="mt-1 font-bold">
                      {krw(product.customer_price_krw)}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-slate-500">내 예상 수익</dt>
                    <dd className="mt-1 font-bold text-blue-700">
                      {product.expected_commission.state === "available"
                        ? krw(product.expected_commission.amount_krw)
                        : "계산 보류"}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-slate-500">취소 위험</dt>
                    <dd className="mt-1 font-bold">
                      {product.cancellation_risk === "HIGH"
                        ? "높음"
                        : product.cancellation_risk === "NORMAL"
                          ? "보통"
                          : "검토 필요"}
                    </dd>
                  </div>
                </dl>
                <p className="mt-3 text-xs leading-5 text-slate-500">
                  현지 필수비용:{" "}
                  {product.required_local_costs
                    ? "상품 상세에서 확인"
                    : "등록 정보 없음"}
                </p>
                <p className="text-xs leading-5 text-slate-500">
                  계산:{" "}
                  {product.expected_commission.formula || "정책 확인 필요"}
                </p>
                <div className="mt-auto grid grid-cols-2 gap-2 pt-5">
                  <button
                    type="button"
                    onClick={() => void toggleSaved(product)}
                    disabled={saving === product.id}
                    className="min-h-12 rounded-xl border border-slate-300 px-3 text-sm font-bold disabled:opacity-50"
                  >
                    {product.saved ? "저장 해제" : "저장"}
                  </button>
                  {product.availability.sellable ? (
                    <Link
                      href={`/partner/publish?product=${product.id}`}
                      className="flex min-h-12 items-center justify-center rounded-xl bg-blue-600 px-3 text-center text-sm font-bold text-white"
                    >
                      게시 만들기
                    </Link>
                  ) : (
                    <button
                      type="button"
                      disabled
                      className="min-h-12 rounded-xl bg-slate-200 px-3 text-sm font-bold text-slate-500"
                    >
                      게시 불가
                    </button>
                  )}
                </div>
              </article>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
