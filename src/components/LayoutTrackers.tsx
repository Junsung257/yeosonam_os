'use client';

/**
 * 마케팅 픽셀 + 트래커를 하나의 청크로 묶는 래퍼.
 * layout.tsx에서 dynamic import + ssr:false 로 불러와 초기 JS 번들을 줄인다.
 * 모든 컴포넌트는 클라이언트 전용(null 반환 또는 lazyOnload)이므로 SEO 영향 없음.
 */
import TrackerBootstrap from '@/components/TrackerBootstrap';
import GA4Tracker from '@/components/GA4Tracker';
import MetaPixel from '@/components/MetaPixel';
import KakaoMomentPixel from '@/components/KakaoMomentPixel';
import MsClarity from '@/components/MsClarity';
import WebVitalsReporter from '@/components/WebVitalsReporter';

export default function LayoutTrackers() {
  return (
    <>
      <TrackerBootstrap />
      <GA4Tracker />
      <MetaPixel />
      <KakaoMomentPixel />
      <MsClarity />
      <WebVitalsReporter />
    </>
  );
}
