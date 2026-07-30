'use client';

/**
 * 마케팅 픽셀 + 트래커를 하나의 청크로 묶는 래퍼.
 * layout.tsx에서 dynamic import + ssr:false 로 불러와 초기 JS 번들을 줄인다.
 * 모든 컴포넌트는 클라이언트 전용(null 반환 또는 lazyOnload)이므로 SEO 영향 없음.
 */
import TrackerBootstrap from '@/components/TrackerBootstrap';
import MetaPixel from '@/components/MetaPixel';
import KakaoMomentPixel from '@/components/KakaoMomentPixel';
import NaverAnalyticsPixel from '@/components/NaverAnalyticsPixel';
import MsClarity from '@/components/MsClarity';
import WebVitalsReporter from '@/components/WebVitalsReporter';
import AnalyticsProvider from '@/components/analytics/AnalyticsProvider';

export default function LayoutTrackers({
  analytics,
}: {
  analytics: {
    containerId: string | null;
    measurementId: string | null;
    runtimeEnabled: boolean;
    expectedHostname: string;
  };
}) {
  return (
    <>
      <AnalyticsProvider
        containerId={analytics.containerId}
        measurementId={analytics.measurementId}
        runtimeEnabled={analytics.runtimeEnabled}
        expectedHostname={analytics.expectedHostname}
      />
      <TrackerBootstrap />
      <MetaPixel />
      <NaverAnalyticsPixel
        runtimeEnabled={analytics.runtimeEnabled}
        expectedHostname={analytics.expectedHostname}
      />
      <KakaoMomentPixel
        runtimeEnabled={analytics.runtimeEnabled}
        expectedHostname={analytics.expectedHostname}
      />
      <MsClarity
        runtimeEnabled={analytics.runtimeEnabled}
        expectedHostname={analytics.expectedHostname}
      />
      <WebVitalsReporter />
    </>
  );
}
