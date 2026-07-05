import type { Metadata } from 'next';
import BlogData from './BlogData';
import { resolveBlogCanonicalOrigin } from '@/lib/blog-canonical-url';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;
export const revalidate = 0;

const BASE_URL = resolveBlogCanonicalOrigin();

export const metadata: Metadata = {
  title: '여행 매거진',
  description: '여소남 운영팀이 직접 검증한 여행지 가이드와 엄선 패키지를 목적지별·스타일별로 큐레이션합니다.',
  alternates: { canonical: `${BASE_URL}/blog` },
  openGraph: {
    title: '여행 매거진',
    description: '여소남 운영팀이 직접 검증한 여행지 가이드와 엄선 패키지.',
    url: `${BASE_URL}/blog`,
    type: 'website',
    images: [{ url: `${BASE_URL}/og-image.png`, width: 1200, height: 630 }],
  },
};

export default function BlogListPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; destination?: string; angle?: string }>;
}) {
  return <BlogData searchParams={searchParams} />;
}
