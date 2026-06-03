import type { Metadata } from 'next';
import { Suspense } from 'react';
import FreeTravelClient from './FreeTravelClient';

export const revalidate = 86400;

const BASE_URL = (process.env.NEXT_PUBLIC_BASE_URL || process.env.NEXT_PUBLIC_SITE_URL || 'https://www.yeosonam.com')
  .replace(/\/+$/, '');
const PAGE_URL = `${BASE_URL}/free-travel`;
const SOCIAL_IMAGE_URL = `${BASE_URL}/og-image.png`;

export const metadata: Metadata = {
  title: '자유여행 AI 견적기',
  description: '항공+호텔+액티비티 30초 AI 견적. 마이리얼트립 실시간 최저가 vs 여소남 패키지 비교.',
  alternates: { canonical: PAGE_URL },
  openGraph: {
    title: '자유여행 AI 견적기',
    description: '항공권, 호텔, 액티비티를 직접 골라 더 저렴하게. AI가 30초 안에 견적을 완성해드립니다.',
    url: PAGE_URL,
    siteName: 'Yeosonam',
    type: 'website',
    images: [{ url: SOCIAL_IMAGE_URL, width: 1200, height: 630 }],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Free travel AI quote',
    description: 'Build a free-travel quote with flights, hotels, and activities.',
    images: [SOCIAL_IMAGE_URL],
  },
};

export default function FreeTravelPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-[40vh] flex items-center justify-center text-text-secondary text-sm">
          불러오는 중...
        </div>
      }
    >
      <FreeTravelClient />
    </Suspense>
  );
}
