import type { Metadata } from 'next';
import { Suspense } from 'react';
import PackagesClient from './PackagesClient';
import Loading from './loading';

// 옵션 4a — Page 가 searchParams 안 받음 → 정적 prerender (`○`).
//   클라이언트(PackagesClient) 가 useSearchParams + SWR 로 `/api/packages/search` fetch.
//   API route 응답에 Cache-Control: s-maxage=60, swr=300 헤더 → Vercel Edge CDN cache.
//
// 트레이드오프: 첫 hydration 시 skeleton, hydration 후 결과 fetch.
//   metadata: 정적 (`searchParams` access 하면 모든 page/segment 가 dynamic 됨 —
//             https://www.buildwithmatija.com/blog/nextjs-searchparams-static-generation-fix).
//             검색어별 title 동적 못함 = SEO 측 손해. 검색 결과 URL 은 indexable 의도 없음.
//   장기 (Next.js 16 PPR stable): server searchParams + 정적 shell 양립 가능.

export const metadata: Metadata = {
  title: '패키지 상품 | 여소남',
  description: '여소남 단체·패키지 여행 상품. 중국·일본·동남아·마카오 등 인기 여행지 — 확정일·요금 비교.',
  alternates: { canonical: '/packages' },
};

export const dynamic = 'force-dynamic';

export default function PackagesPage() {
  // useSearchParams 사용 client component 는 Suspense boundary 필수
  // (Next.js 공식: https://nextjs.org/docs/app/api-reference/functions/use-search-params#prerendering)
  // 이게 있어야 Page 본문이 정적 prerender (`○`) 되고 PackagesClient 만 client-side render.
  return (
    <Suspense fallback={<Loading />}>
      <PackagesClient />
    </Suspense>
  );
}
