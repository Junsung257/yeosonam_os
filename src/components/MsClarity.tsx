'use client';

import Script from 'next/script';
import { useAnalyticsConsent } from '@/lib/consent';
import { thirdPartyScriptType } from '@/lib/third-party-script-type';

const CLARITY_ID = process.env.NEXT_PUBLIC_CLARITY_PROJECT_ID;

/**
 * Microsoft Clarity — 세션 리플레이·히트맵 (분석 동의 시에만 로드, PIPA 대비).
 * 프로젝트 ID: Clarity 대시보드 → 설정. Vercel에 NEXT_PUBLIC_CLARITY_PROJECT_ID 설정.
 */
export default function MsClarity() {
  const consent = useAnalyticsConsent();
  if (!CLARITY_ID || !consent) return null;

  const safeId = CLARITY_ID.replace(/[^a-zA-Z0-9_-]/g, '');

  return (
    <Script
      id="ms-clarity"
      type={thirdPartyScriptType()}
      strategy="lazyOnload"
      dangerouslySetInnerHTML={{
        __html: `(function(c,l,a,r,i,t,y){
c[a]=c[a]||function(){(c[a].q=c[a].q||[]).push(arguments)};
t=l.createElement(r);t.async=1;t.src="https://www.clarity.ms/tag/"+i;
y=l.getElementsByTagName(r)[0];y.parentNode.insertBefore(t,y);
})(window, document, "clarity", "script", "${safeId}");`,
      }}
    />
  );
}
