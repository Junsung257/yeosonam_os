'use client';

import { useEffect, useRef } from 'react';

interface AbTestTrackerProps {
  experimentId: string;
  visitorId: string;
  variantId: string;
}

/**
 * A/B 테스트 전환 추적 클라이언트 컴포넌트
 *
 * - 스크롤 50% 도달 시 recordConversion 호출 (1회만)
 * - window.__abTestConvertCta 함수를 window에 노출하여 CTA 클릭 시 호출 가능
 *
 * Server Component에서 분리해야 하는 이유:
 *   recordConversion은 서버 액션이지만, 스크롤/CTA 이벤트는 클라이언트에서만 감지 가능.
 *   이 컴포넌트만 'use client'로 분리하여 나머지 페이지는 Server Component 유지.
 */
export default function AbTestTracker({ experimentId, visitorId, variantId }: AbTestTrackerProps) {
  const recordedRef = useRef(false);
  const ctaRecordedRef = useRef(false);

  useEffect(() => {
    // 이미 기록됐으면 스킵
    if (recordedRef.current) return;

    const handleScroll = () => {
      const scrollTop = window.scrollY;
      const docHeight = document.documentElement.scrollHeight - window.innerHeight;
      if (docHeight <= 0) return;

      const scrollPercent = (scrollTop / docHeight) * 100;
      if (scrollPercent >= 50 && !recordedRef.current) {
        recordedRef.current = true;
        // fetch로 서버 API 호출 (recordConversion 직접 호출은 서버 전용)
        fetch('/api/ab-test/conversion', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            experimentId,
            visitorId,
            variantId,
            eventType: 'scroll_depth',
          }),
        }).catch(() => {
          // 실패해도 사용자 경험에 영향 없음
        });
        window.removeEventListener('scroll', handleScroll);
      }
    };

    window.addEventListener('scroll', handleScroll, { passive: true });

    // CTA 클릭을 위한 전역 함수 노출
    window.__abTestRecordCta = () => {
      if (ctaRecordedRef.current) return;
      ctaRecordedRef.current = true;
      fetch('/api/ab-test/conversion', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          experimentId,
          visitorId,
          variantId,
          eventType: 'cta_click',
        }),
      }).catch(() => {});
    };

    return () => {
      window.removeEventListener('scroll', handleScroll);
      delete window.__abTestRecordCta;
    };
  }, [experimentId, visitorId, variantId]);

  return null;
}

// TypeScript로 window 확장
declare global {
  interface Window {
    __abTestRecordCta?: () => void;
  }
}
