import type { Metadata } from 'next';
import { Suspense } from 'react';
import FreeTravelClient from './FreeTravelClient';

export const metadata: Metadata = {
  title: '자유여행 AI 견적기 | 여소남',
  description: '항공+호텔+액티비티 30초 AI 견적. 마이리얼트립 실시간 최저가 vs 여소남 패키지 비교.',
  openGraph: {
    title: '자유여행 AI 견적기 | 여소남',
    description: '항공권, 호텔, 액티비티를 직접 골라 더 저렴하게. AI가 30초 안에 견적을 완성해드립니다.',
    type: 'website',
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
