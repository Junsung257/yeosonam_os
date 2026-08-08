"use client";

import QRCode from "react-qr-code";
import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

type Product = {
  id: string;
  title: string;
  customer_price_krw: number | null;
  next_departure: string | null;
  availability: { sellable: boolean; code: string };
  expected_commission: { state: string; amount_krw: number | null };
};
type Channel = {
  id: string;
  channel_type: string;
  channel_url: string;
  display_name: string | null;
  verification_status: string;
};
type Publication = {
  id: string;
  product_id: string;
  channel_type: string;
  placement_name: string;
  status: string;
};

const CHANNEL_LABELS: Record<string, string> = {
  BLOG: "블로그",
  WEBSITE: "홈페이지",
  INSTAGRAM: "인스타그램",
  YOUTUBE: "유튜브",
  FACEBOOK: "페이스북",
  THREADS: "스레드",
  KAKAO: "카카오",
  OFFLINE: "오프라인",
  OTHER: "기타",
};

function idempotency(prefix: string) {
  return `${prefix}:${crypto.randomUUID()}`;
}

export default function PartnerPublishPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const requestedProduct = searchParams.get("product") || "";
  const [products, setProducts] = useState<Product[]>([]);
  const [channels, setChannels] = useState<Channel[]>([]);
  const [productId, setProductId] = useState(requestedProduct);
  const [channelId, setChannelId] = useState("");
  const [channelType, setChannelType] = useState("BLOG");
  const [placement, setPlacement] = useState("블로그 본문");
  const [publication, setPublication] = useState<Publication | null>(null);
  const [shortUrl, setShortUrl] = useState("");
  const [publishedUrl, setPublishedUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    Promise.all([
      fetch(
        `/api/partner/catalog?limit=48${requestedProduct ? `&product_id=${encodeURIComponent(requestedProduct)}` : ""}`,
        { cache: "no-store" },
      ),
      fetch("/api/partner/channels", { cache: "no-store" }),
    ])
      .then(async ([catalogResponse, channelResponse]) => {
        if (catalogResponse.status === 401 || channelResponse.status === 401)
          return router.replace("/partner/login");
        if (!catalogResponse.ok || !channelResponse.ok)
          throw new Error("load failed");
        const catalog = await catalogResponse.json();
        const channelResult = await channelResponse.json();
        setProducts(catalog.products || []);
        setChannels(channelResult.channels || []);
        if (!requestedProduct && catalog.products?.[0])
          setProductId(catalog.products[0].id);
      })
      .catch(() => setError("게시 준비 정보를 불러오지 못했습니다."));
  }, [requestedProduct, router]);

  const product = useMemo(
    () => products.find((item) => item.id === productId) || null,
    [products, productId],
  );
  const embedCode =
    shortUrl && product
      ? `<a href="${shortUrl}" rel="sponsored nofollow">${product.title}</a>`
      : "";

  function selectChannel(id: string) {
    setChannelId(id);
    const channel = channels.find((item) => item.id === id);
    if (channel) setChannelType(channel.channel_type);
  }

  async function createPublication() {
    setError("");
    if (!product || !product.availability.sellable)
      return setError("판매 가능한 상품을 선택해 주세요.");
    if (!placement.trim()) return setError("게시 위치 이름을 입력해 주세요.");
    setBusy(true);
    try {
      const response = await fetch("/api/partner/publications", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": idempotency("publication"),
        },
        body: JSON.stringify({
          product_id: product.id,
          channel_id: channelId || null,
          channel_type: channelType,
          placement_name: placement.trim(),
        }),
      });
      const result = await response.json();
      if (!response.ok)
        throw new Error(
          result.error || result.code || "PUBLICATION_CREATE_FAILED",
        );
      setPublication(result.publication);
      setShortUrl(result.short_url);
    } catch (caught) {
      setError(
        caught instanceof Error && caught.message === "CHANNEL_NOT_ELIGIBLE"
          ? "등록한 채널과 선택한 채널 유형이 일치하지 않습니다."
          : "게시 자산을 만들지 못했습니다. 입력값과 상품 상태를 확인해 주세요.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function changeStatus(status: "TESTED" | "PUBLISHED") {
    if (!publication) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch(
        `/api/partner/publications/${publication.id}`,
        {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            "Idempotency-Key": idempotency(
              `publication-${status.toLowerCase()}`,
            ),
          },
          body: JSON.stringify({
            status,
            published_url: status === "PUBLISHED" ? publishedUrl : null,
          }),
        },
      );
      const result = await response.json();
      if (!response.ok) {
        if (result.error === "TEST_CLICK_NOT_OBSERVED")
          throw new Error("TEST_CLICK_NOT_OBSERVED");
        if (result.error === "VERIFIED_DOMAIN_REQUIRED")
          throw new Error("VERIFIED_DOMAIN_REQUIRED");
        throw new Error("update failed");
      }
      setPublication((current) => (current ? { ...current, status } : current));
    } catch (caught) {
      const code = caught instanceof Error ? caught.message : "";
      setError(
        code === "TEST_CLICK_NOT_OBSERVED"
          ? "테스트 클릭이 아직 확인되지 않았습니다. 테스트 링크를 새 창에서 연 뒤 다시 확인해 주세요."
          : code === "VERIFIED_DOMAIN_REQUIRED"
            ? "블로그·홈페이지 게시 URL은 설정에서 소유권 확인된 도메인이어야 합니다."
            : "게시 상태를 저장하지 못했습니다.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function copy(value: string) {
    await navigator.clipboard.writeText(value);
  }

  return (
    <div className="space-y-6">
      <header>
        <p className="text-sm font-bold text-blue-700">게시하기</p>
        <h1 className="mt-1 text-3xl font-black">
          검증 가능한 게시 링크 만들기
        </h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">
          게시 위치 하나마다 고유 ID를 만들고, 테스트 클릭부터 예약·정산까지
          같은 ID로 연결합니다.
        </p>
      </header>
      {error ? (
        <p
          role="alert"
          className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm font-bold text-red-800"
        >
          {error}
        </p>
      ) : null}

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
        <section className="space-y-5 rounded-2xl border border-slate-200 bg-white p-5 sm:p-6">
          <label className="block">
            <span className="mb-2 block text-sm font-bold">1. 상품</span>
            <select
              value={productId}
              onChange={(event) => {
                setProductId(event.target.value);
                setPublication(null);
                setShortUrl("");
              }}
              className="min-h-12 w-full rounded-xl border border-slate-300 bg-white px-3"
            >
              <option value="">상품 선택</option>
              {products.map((item) => (
                <option
                  key={item.id}
                  value={item.id}
                  disabled={!item.availability.sellable}
                >
                  {item.title}
                  {!item.availability.sellable ? " (게시 불가)" : ""}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="mb-2 block text-sm font-bold">2. 등록 채널</span>
            <select
              value={channelId}
              onChange={(event) => selectChannel(event.target.value)}
              className="min-h-12 w-full rounded-xl border border-slate-300 bg-white px-3"
            >
              <option value="">채널을 나중에 연결</option>
              {channels.map((channel) => (
                <option key={channel.id} value={channel.id}>
                  {channel.display_name ||
                    CHANNEL_LABELS[channel.channel_type] ||
                    channel.channel_type}{" "}
                  · {channel.verification_status}
                </option>
              ))}
            </select>
            <span className="mt-2 block text-xs text-slate-500">
              채널이 없으면 설정에서 먼저 등록할 수 있습니다.
            </span>
          </label>
          {!channelId ? (
            <label className="block">
              <span className="mb-2 block text-sm font-bold">채널 유형</span>
              <select
                value={channelType}
                onChange={(event) => setChannelType(event.target.value)}
                className="min-h-12 w-full rounded-xl border border-slate-300 bg-white px-3"
              >
                {Object.entries(CHANNEL_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          <label className="block">
            <span className="mb-2 block text-sm font-bold">
              3. 게시 위치 이름
            </span>
            <input
              value={placement}
              onChange={(event) => setPlacement(event.target.value)}
              maxLength={80}
              placeholder="예: 9월 가족여행 글 본문"
              className="min-h-12 w-full rounded-xl border border-slate-300 px-4"
            />
            <span className="mt-2 block text-xs text-slate-500">
              기술적인 Sub-ID 대신 나중에도 알아볼 수 있는 이름을 사용하세요.
            </span>
          </label>

          {!publication ? (
            <button
              type="button"
              onClick={() => void createPublication()}
              disabled={busy || !product}
              className="min-h-12 w-full rounded-xl bg-blue-600 px-5 font-bold text-white disabled:bg-slate-300"
            >
              {busy ? "만드는 중" : "4. 게시 링크 만들기"}
            </button>
          ) : (
            <div className="space-y-4 border-t border-slate-200 pt-5">
              <div className="rounded-xl bg-slate-50 p-4">
                <p className="text-xs font-bold text-slate-500">고유 게시 ID</p>
                <p className="mt-1 break-all font-mono text-sm">
                  {publication.id}
                </p>
              </div>
              <div>
                <p className="text-sm font-bold">5. 테스트 클릭</p>
                <p className="mt-1 text-xs leading-5 text-slate-500">
                  새 창에서 링크를 연 뒤, 서버에 유효 클릭이 저장됐는지
                  확인합니다.
                </p>
                <div className="mt-3 grid gap-2 sm:grid-cols-2">
                  <a
                    href={shortUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="flex min-h-12 items-center justify-center rounded-xl border border-blue-300 font-bold text-blue-700"
                  >
                    테스트 링크 열기
                  </a>
                  <button
                    type="button"
                    onClick={() => void changeStatus("TESTED")}
                    disabled={busy || publication.status !== "DRAFT"}
                    className="min-h-12 rounded-xl bg-slate-950 px-4 font-bold text-white disabled:bg-slate-300"
                  >
                    {publication.status === "DRAFT"
                      ? "테스트 확인"
                      : "테스트 완료"}
                  </button>
                </div>
              </div>
              {publication.status !== "DRAFT" ? (
                <div>
                  <label className="block">
                    <span className="mb-2 block text-sm font-bold">
                      6. 실제 게시 URL
                    </span>
                    <input
                      type="url"
                      value={publishedUrl}
                      onChange={(event) => setPublishedUrl(event.target.value)}
                      placeholder="https://내-블로그.example.com/post"
                      className="min-h-12 w-full rounded-xl border border-slate-300 px-4"
                    />
                  </label>
                  <button
                    type="button"
                    onClick={() => void changeStatus("PUBLISHED")}
                    disabled={
                      busy ||
                      !publishedUrl ||
                      publication.status === "PUBLISHED"
                    }
                    className="mt-3 min-h-12 w-full rounded-xl bg-emerald-600 px-4 font-bold text-white disabled:bg-slate-300"
                  >
                    {publication.status === "PUBLISHED"
                      ? "게시 등록 완료"
                      : "7. 실제 게시 URL 등록"}
                  </button>
                </div>
              ) : null}
            </div>
          )}
        </section>

        <aside className="h-fit rounded-2xl border border-slate-200 bg-white p-5">
          <p className="text-sm font-bold text-blue-700">고객 화면 미리보기</p>
          <h2 className="mt-3 text-xl font-black">
            {product?.title || "상품을 선택해 주세요"}
          </h2>
          {product ? (
            <>
              <p className="mt-3 text-sm text-slate-600">
                출발 {product.next_departure || "확인 필요"} ·{" "}
                {product.customer_price_krw?.toLocaleString("ko-KR") ||
                  "가격 확인 필요"}
                원
              </p>
              <p className="mt-2 text-sm font-bold text-blue-700">
                예상 수익{" "}
                {product.expected_commission.amount_krw?.toLocaleString(
                  "ko-KR",
                ) || "계산 보류"}
                원
              </p>
            </>
          ) : null}
          <div className="mt-5 rounded-xl bg-amber-50 p-3 text-xs font-semibold leading-5 text-amber-900">
            광고·제휴 링크가 포함되어 있으며, 예약이 발생하면 파트너에게
            수수료가 지급될 수 있습니다.
          </div>
          {shortUrl ? (
            <div className="mt-5 space-y-3">
              <div className="mx-auto w-fit rounded-xl border border-slate-200 bg-white p-3">
                <QRCode
                  value={shortUrl}
                  size={128}
                  aria-label="게시 링크 QR 코드"
                />
              </div>
              <p className="break-all rounded-xl bg-slate-50 p-3 text-xs">
                {shortUrl}
              </p>
              <button
                type="button"
                onClick={() => void copy(shortUrl)}
                className="min-h-11 w-full rounded-xl border border-slate-300 font-bold"
              >
                링크 복사
              </button>
              <button
                type="button"
                onClick={() => void copy(embedCode)}
                className="min-h-11 w-full rounded-xl border border-slate-300 font-bold"
              >
                HTML 상품 블록 복사
              </button>
            </div>
          ) : null}
        </aside>
      </div>
    </div>
  );
}
