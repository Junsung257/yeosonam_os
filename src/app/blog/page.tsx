import type { Metadata } from 'next';
import { Suspense } from 'react';
import BlogData from './BlogData';
import Loading from './loading';

export const revalidate = 86400;

const BASE_URL = process.env.NEXT_PUBLIC_BASE_URL || 'https://www.yeosonam.com';

export const metadata: Metadata = {
  title: '여행 매거진',
  description: '여소남 운영팀이 직접 검증한 여행지 가이드와 엄선 패키지 — 목적지별 · 스타일별 큐레이션',
  alternates: { canonical: `${BASE_URL}/blog` },
  openGraph: {
    title: '여행 매거진',
    description: '여소남 운영팀이 직접 검증한 여행지 가이드와 엄선 패키지.',
    url: `${BASE_URL}/blog`,
    type: 'website',
    images: [{ url: `${BASE_URL}/og-image.png`, width: 1200, height: 630 }],
  },
};

// 블로그 목록은 검색/필터 query와 공개 DB 목록이 SEO 진입점이다.
// 실험적 PPR에서는 dev/prod 캐시 경계에서 간헐 404가 발생할 수 있어 일반 ISR로 유지한다.
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
