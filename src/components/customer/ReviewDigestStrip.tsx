'use client';

import { useEffect, useState } from 'react';
import { openKakaoChannel } from '@/lib/kakaoChannel';
import { ANALYTICS_EVENTS } from '@/lib/analytics-events';
import { trackEngagement } from '@/lib/tracker';

const REVIEW_DIGEST_KAKAO_DESCRIPTION_ID = 'review-digest-kakao-description';

interface DigestQuote {
  text: string;
  rating: number;
  source_count?: number;
}

interface DigestPayload {
  digest_quotes: DigestQuote[];
  source_count: number;
  avg_rating: number | null;
  generated_at: string | null;
}

interface ReviewDigestStripProps {
  packageId: string;
  productTitle?: string | null;
  internalCode?: string | null;
}

/**
 * 패키지 hero 직하 — 실제 다녀온 분들의 1줄 후기 carousel.
 *
 * 2026-05-16 박제: 후기 0건일 때도 fallback CTA 노출.
 *   기존: `quotes.length === 0` 이면 통째 숨김 → cron 미시드 + 신상품 모두에서 영구 미노출.
 *   변경: fetch 정상 응답 + 0건 → "리뷰 모집 중" strip 으로 노출(카톡 상담 유도).
 *         fetch 실패 (네트워크/500) → 조용히 숨김 (silent fail 차단은 cron 쪽에서).
 */
export default function ReviewDigestStrip({ packageId, productTitle, internalCode }: ReviewDigestStripProps) {
  const [data, setData] = useState<DigestPayload | null>(null);
  const [fetched, setFetched] = useState(false);
  const productLabel = productTitle?.trim() || '선택한 상품';

  useEffect(() => {
    let alive = true;
    fetch(`/api/packages/${packageId}/review-digest`)
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (alive) { setData(d); setFetched(true); } })
      .catch(() => {});
    return () => { alive = false; };
  }, [packageId]);

  const quotes = data?.digest_quotes ?? [];

  const handleKakaoClick = () => {
    trackEngagement({
      event_type: ANALYTICS_EVENTS.kakaoClicked,
      product_id: packageId,
      cta_type: 'review_digest_empty_state',
      page_url: typeof window !== 'undefined' ? window.location.pathname : undefined,
      metadata: { source: 'review_digest_empty_state', internal_code: internalCode ?? null },
    });
    void openKakaoChannel({
      internalCode: internalCode ?? undefined,
      productTitle: productTitle ?? undefined,
      intent: '후기 없는 상품 상담',
      selected_products: [productTitle ?? packageId],
    });
  };

  // fetch 자체가 실패하면 (네트워크/500) 조용히 숨김 — 빈 데이터인지 장애인지 구분 못함.
  if (!fetched) return null;

  // fallback: 정상 응답 + 0건 → 리뷰 모집 중 CTA
  if (quotes.length === 0) {
    return (
      <section className="px-4 py-3 relative z-10">
        <p id={REVIEW_DIGEST_KAKAO_DESCRIPTION_ID} className="sr-only">
          {productLabel}의 포함 비용, 불포함 비용, 출발 가능 여부를 카카오톡 상담에서 확인합니다.
        </p>
        <button
          type="button"
          onClick={handleKakaoClick}
          data-testid="review-digest-kakao"
          aria-label={`${productLabel} 후기와 비용 조건 카카오톡 상담 열기`}
          aria-describedby={REVIEW_DIGEST_KAKAO_DESCRIPTION_ID}
          className="w-full bg-white border border-slate-200 rounded-2xl px-4 py-3 shadow-sm text-left active:scale-[0.99] transition-transform"
        >
          <div className="flex items-center justify-between gap-3">
            <span className="text-xs font-extrabold text-slate-900 flex items-center gap-1">
              ✦ 상담 전 확인할 수 있어요
            </span>
            <span className="text-[11px] text-slate-500 font-semibold">카톡 상담 →</span>
          </div>
          <p className="text-[13px] text-gray-600 leading-snug mt-1">
            아직 후기는 없지만, 포함·불포함 비용과 출발 가능 여부를 상담에서 바로 확인해드립니다.
          </p>
        </button>
      </section>
    );
  }

  return (
    <section className="px-4 py-3 -mt-2 relative z-10">
      <div className="bg-gradient-to-r from-purple-50 via-white to-purple-50 border border-purple-100 rounded-2xl px-4 py-3 shadow-sm">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-semibold text-purple-700 flex items-center gap-1">
            ✦ 여소남 다녀온 분들 한 줄 후기
          </span>
          {data?.avg_rating && (
            <span className="text-xs text-gray-500">
              평균 <strong className="text-gray-800">{data.avg_rating.toFixed(1)}</strong>/5 · {data.source_count}건
            </span>
          )}
        </div>
        <ul className="space-y-1.5">
          {quotes.slice(0, 3).map((q, i) => (
            <li key={i} className="text-sm text-gray-700 leading-snug">
              <span className="text-yellow-500 mr-1">★</span>
              <span>{q.text}</span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
