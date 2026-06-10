import type { Metadata } from 'next';

const BASE_URL = (process.env.NEXT_PUBLIC_BASE_URL || process.env.NEXT_PUBLIC_SITE_URL || 'https://www.yeosonam.com')
  .replace(/\/+$/, '');

export const metadata: Metadata = {
  title: '단체여행 견적 문의',
  description: '목적지, 인원, 예산, 일정 조건을 남기면 여소남이 단체여행 견적과 상담을 연결합니다.',
  alternates: { canonical: `${BASE_URL}/group-inquiry` },
  openGraph: {
    title: '단체여행 견적 문의 | 여소남',
    description: '단체여행 조건을 입력하고 맞춤 견적 상담을 받아보세요.',
    url: `${BASE_URL}/group-inquiry`,
    siteName: '여소남',
  },
};

export default function GroupInquiryLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
