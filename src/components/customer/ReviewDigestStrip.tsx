'use client';

import { useEffect, useState } from 'react';

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

/**
 * 패키지 hero 직하 — 실제 다녀온 분들의 1줄 후기 carousel
 * - cron(`review-digest`)이 채운 package_review_digests 에서 fetch
 * - 데이터 없으면 렌더링 자체 안 함 (UI 정합성)
 */
export default function ReviewDigestStrip({ packageId }: { packageId: string }) {
  const [data, setData] = useState<DigestPayload | null>(null);

  useEffect(() => {
    let alive = true;
    fetch(`/api/packages/${packageId}/review-digest`)
      .then(r => r.json())
      .then(d => { if (alive) setData(d); })
      .catch(() => {});
    return () => { alive = false; };
  }, [packageId]);

  const quotes = data?.digest_quotes ?? [];
  if (quotes.length === 0) return null;

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
