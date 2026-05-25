import type { Metadata } from 'next';
import { Suspense } from 'react';
import BlogData from './BlogData';
import Loading from './loading';

export const experimental_ppr = true;
export const revalidate = 86400;

const BASE_URL = process.env.NEXT_PUBLIC_BASE_URL || 'https://www.yeosonam.com';

export const metadata: Metadata = {
  title: '여행 매거진',
  description: '여소남 운영팀이 직접 검증한 여행지 가이드와 엄선 패키지 — 목적지별 · 스타일별 큐레이션',
  alternates: { canonical: `${BASE_URL}/blog` },
  openGraph: {
    title: '여행 매거진 | 여소남',
    description: '여소남 운영팀이 직접 검증한 여행지 가이드와 엄선 패키지.',
    url: `${BASE_URL}/blog`,
    type: 'website',
    images: [{ url: `${BASE_URL}/og-image.png`, width: 1200, height: 630 }],
  },
};

// Vercel 공식 PPR 패턴 (https://nextjs.org/docs/15/app/getting-started/partial-prerendering):
//   "Components only opt into dynamic rendering when the value is accessed."
//   Page 는 searchParams 를 prop 으로 받기만 하고 access 안 함 → 정적 shell prerender 가능.
//   Suspense 안 BlogData 만 dynamic, Featured/Posts/Destinations streaming.
export default function BlogListPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; destination?: string; angle?: string }>;
}) {
  return (
    <Suspense fallback={<Loading />}>
      <BlogData searchParams={searchParams} />
    </Suspense>
  );
}
