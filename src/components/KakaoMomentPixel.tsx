'use client';

import { useEffect, useState } from 'react';
import Script from 'next/script';
import { useMarketingConsent } from '@/lib/consent';
import { trackKakaoPixelPageView } from '@/lib/kakao-moment-events';

const PIXEL_ID = process.env.NEXT_PUBLIC_KAKAO_PIXEL_ID;

/**
 * 카카오 모먼트 픽셀 — NEXT_PUBLIC_KAKAO_PIXEL_ID 없으면 미렌더.
 * PIPA: 마케팅 동의 후에만 스크립트 로드·pageView.
 */
export default function KakaoMomentPixel() {
  const marketing = useMarketingConsent();
  const [scriptReady, setScriptReady] = useState(false);

  useEffect(() => {
    if (!PIXEL_ID || !marketing || !scriptReady) return;
    trackKakaoPixelPageView();
  }, [marketing, scriptReady]);

  if (!PIXEL_ID || !marketing) return null;

  return (
    <Script
      id="kakao-moment-kp"
      src="//t1.kakaocdn.net/adfit/static/kp.js"
      strategy="lazyOnload"
      onLoad={() => setScriptReady(true)}
    />
  );
}
