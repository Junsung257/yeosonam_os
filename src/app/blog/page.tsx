import type { Metadata } from 'next';
import BlogData from './BlogData';
import { resolveBlogCanonicalOrigin } from '@/lib/blog-canonical-url';

export const runtime = 'nodejs';
export const maxDuration = 60;
export const revalidate = 300;

const BASE_URL = resolveBlogCanonicalOrigin();

type BlogListSearchParams = { page?: string; destination?: string; angle?: string };

export async function generateMetadata({
  searchParams,
}: {
  searchParams: Promise<BlogListSearchParams>;
}): Promise<Metadata> {
  const params = await searchParams;
  const hasQueryFilter = ['page', 'destination', 'angle'].some((key) => {
    const value = params[key as keyof BlogListSearchParams];
    return typeof value === 'string' && value.trim().length > 0;
  });

  return {
    title: '여행 매거진',
    description: '여행 준비에 필요한 목적지 가이드와 판매 중인 패키지 정보를 목적지별·스타일별로 모았습니다.',
    alternates: { canonical: `${BASE_URL}/blog` },
    ...(hasQueryFilter ? { robots: { index: false, follow: true } } : {}),
    openGraph: {
      title: '여행 매거진',
      description: '여행 준비에 필요한 목적지 가이드와 판매 중인 패키지 정보.',
      url: `${BASE_URL}/blog`,
      type: 'website',
      images: [{ url: `${BASE_URL}/og-image.png`, width: 1200, height: 630 }],
    },
  };
}

export default function BlogListPage({
  searchParams,
}: {
  searchParams: Promise<BlogListSearchParams>;
}) {
  return <BlogData searchParams={searchParams} />;
}
