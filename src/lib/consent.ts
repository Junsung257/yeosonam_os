/**
 * 분석/마케팅 동의 게이트 (PIPA 2026 시행 / GDPR 대비)
 *
 * 카테고리:
 *   - analytics: GA, PostHog, 자체 트래커 (체류시간/스크롤)
 *   - marketing: Meta Pixel, gclid/fbclid, **어필리에이트 30일 쿠키(aff_ref)**
 *
 * 2026-09 PIPA 개정: 마케팅 쿠키도 명시적 동의 필요. 동의 없으면 세션 쿠키만 가능.
 *
 * 사용:
 *   if (hasAnalyticsConsent()) fbq('init', ...);
 *   if (hasMarketingConsent()) /* aff_ref 30일 발급 *⁄ else /* 세션 쿠키만 *⁄
 */

import { useEffect, useState } from 'react';

const STORAGE_KEY = 'ys_analytics_consent';
const MARKETING_KEY = 'ys_marketing_consent';

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

/** 마케팅 쿠키(어필리에이트 30일·Meta Pixel 등) 동의 여부. PIPA 2026-09 시행 대응. */
export function hasMarketingConsent(): boolean {
  if (typeof window === 'undefined') return false;
  const w = window as unknown as { __consent?: { marketing?: boolean } };
  if (w.__consent?.marketing === true) return true;
  if (w.__consent?.marketing === false) return false;
  try {
    return localStorage.getItem(MARKETING_KEY) === 'true';
  } catch {
    return false;
  }
}

/** CMP 또는 자체 동의 배너에서 호출. */
export function setAnalyticsConsent(granted: boolean): void {
  if (typeof window === 'undefined') return;
  const w = window as unknown as { __consent?: { analytics?: boolean; marketing?: boolean } };
  w.__consent = { ...(w.__consent ?? {}), analytics: granted };
  try {
    localStorage.setItem(STORAGE_KEY, granted ? 'true' : 'false');
  } catch {
    // localStorage 차단 환경 — window 만 사용
  }
  // 다른 컴포넌트에 알림
  window.dispatchEvent(new CustomEvent('ys:consent-changed', { detail: { analytics: granted } }));
}

export function setMarketingConsent(granted: boolean): void {
  if (typeof window === 'undefined') return;
  const w = window as unknown as { __consent?: { analytics?: boolean; marketing?: boolean } };
  w.__consent = { ...(w.__consent ?? {}), marketing: granted };
  try {
    localStorage.setItem(MARKETING_KEY, granted ? 'true' : 'false');
  } catch { /* */ }
  // 서버에서 쿠키로 동의 여부 판단할 수 있도록 동기 (1년)
  document.cookie = `ys_marketing_consent=${granted ? 'true' : 'false'}; path=/; Max-Age=${granted ? 60 * 60 * 24 * 365 : 0}; SameSite=Lax`;
  window.dispatchEvent(new CustomEvent('ys:consent-changed', { detail: { marketing: granted } }));
  // 동의 철회 시 즉시 마케팅 쿠키 제거
  if (!granted) {
    document.cookie = 'aff_ref=; Max-Age=0; path=/';
    document.cookie = 'aff_sub=; Max-Age=0; path=/';
  }
}

/** 서버 측에서 쿠키로 동의 상태 추정 (request.cookies 에서 호출).
 *  ys_marketing_consent='true' 쿠키가 있으면 동의로 간주. 클라이언트 setMarketingConsent 가 동시에 쿠키도 세팅하도록 권장. */
export function readMarketingConsentCookie(req: { cookies: { get: (k: string) => { value: string } | undefined } }): boolean {
  return req.cookies.get('ys_marketing_consent')?.value === 'true';
}

/** React 훅 — 동의 상태 변화 구독. */
export function useAnalyticsConsent(): boolean {
  const [consent, setConsent] = useState<boolean>(false);

  useEffect(() => {
    setConsent(hasAnalyticsConsent());
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<{ analytics?: boolean }>).detail;
      if (detail?.analytics !== undefined) setConsent(detail.analytics === true);
    };
    window.addEventListener('ys:consent-changed', handler);
    return () => window.removeEventListener('ys:consent-changed', handler);
  }, []);

  return consent;
}

export function useMarketingConsent(): boolean {
  const [consent, setConsent] = useState<boolean>(false);
  useEffect(() => {
    setConsent(hasMarketingConsent());
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<{ marketing?: boolean }>).detail;
      if (detail?.marketing !== undefined) setConsent(detail.marketing === true);
    };
    window.addEventListener('ys:consent-changed', handler);
    return () => window.removeEventListener('ys:consent-changed', handler);
  }, []);
  return consent;
}
