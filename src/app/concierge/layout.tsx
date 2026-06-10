import type { Metadata } from 'next';

const BASE_URL = (process.env.NEXT_PUBLIC_BASE_URL || process.env.NEXT_PUBLIC_SITE_URL || 'https://www.yeosonam.com')
  .replace(/\/+$/, '');

export const metadata: Metadata = {
  title: 'AI 여행 컨시어지',
  description: '여소남 AI 컨시어지가 여행 조건에 맞는 상품, 일정, 상담 흐름을 도와드립니다.',
  alternates: { canonical: `${BASE_URL}/concierge` },
  openGraph: {
    title: 'AI 여행 컨시어지 | 여소남',
    description: '여행 조건에 맞는 상품과 상담 흐름을 AI로 빠르게 찾아보세요.',
    url: `${BASE_URL}/concierge`,
    siteName: '여소남',
  },
};

export default function ConciergeLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
