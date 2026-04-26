/**
 * 분석/마케팅 동의 게이트 (PIPA / GDPR 대비)
 *
 * 외부 트래커(Meta Pixel, Google Analytics 등)와 식별 가능한 광고 ID(gclid·fbclid)
 * 수집은 사용자 사전 동의가 필요. 이 모듈은 코드 측 가드를 제공하며, 추후 CMP
 * (Iubenda / CookieYes / OneTrust 등) 도입 시 `setAnalyticsConsent(true)`만
 * CMP 콜백에서 호출하면 자동 활성화된다.
 *
 * 기본값: false (동의 없으면 트래커 미발화 — PIPA 안전).
 *
 * 사용:
 *   if (hasAnalyticsConsent()) fbq('init', ...);
 *
 * 또는 React:
 *   const consent = useAnalyticsConsent();
 *   if (!consent) return null;
 */

import { useEffect, useState } from 'react';

const STORAGE_KEY = 'ys_analytics_consent';

/** 클라이언트 전용 — SSR 에서 호출 시 false. */
export function hasAnalyticsConsent(): boolean {
  if (typeof window === 'undefined') return false;
  // 1) 윈도우 객체 (CMP 가 설정 가능)
  const w = window as unknown as { __consent?: { analytics?: boolean } };
  if (w.__consent?.analytics === true) return true;
  if (w.__consent?.analytics === false) return false;
  // 2) localStorage fallback
  try {
    return localStorage.getItem(STORAGE_KEY) === 'true';
  } catch {
    return false;
  }
}

/** CMP 또는 자체 동의 배너에서 호출. */
export function setAnalyticsConsent(granted: boolean): void {
  if (typeof window === 'undefined') return;
  const w = window as unknown as { __consent?: { analytics?: boolean } };
  w.__consent = { ...(w.__consent ?? {}), analytics: granted };
  try {
    localStorage.setItem(STORAGE_KEY, granted ? 'true' : 'false');
  } catch {
    // localStorage 차단 환경 — window 만 사용
  }
  // 다른 컴포넌트에 알림
  window.dispatchEvent(new CustomEvent('ys:consent-changed', { detail: { analytics: granted } }));
}

/** React 훅 — 동의 상태 변화 구독. */
export function useAnalyticsConsent(): boolean {
  const [consent, setConsent] = useState<boolean>(false);

  useEffect(() => {
    setConsent(hasAnalyticsConsent());
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<{ analytics?: boolean }>).detail;
      setConsent(detail?.analytics === true);
    };
    window.addEventListener('ys:consent-changed', handler);
    return () => window.removeEventListener('ys:consent-changed', handler);
  }, []);

  return consent;
}
