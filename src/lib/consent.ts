'use client';

import { useEffect, useState } from 'react';
import {
  CONSENT_EVENT,
  consentStateToPreferences,
  hasAnalyticsConsent,
  hasMarketingConsent,
  readConsentState,
  setConsentPreferences,
} from '@/lib/analytics/consent';

export {
  hasAnalyticsConsent,
  hasMarketingConsent,
  readConsentState,
  setConsentPreferences,
};

/** Backward-compatible setter for existing pixel components. */
export function setAnalyticsConsent(granted: boolean): void {
  const current = consentStateToPreferences(readConsentState());
  setConsentPreferences({ ...current, analytics: granted });
}

/** Backward-compatible setter for affiliate and pixel components. */
export function setMarketingConsent(granted: boolean): void {
  const current = consentStateToPreferences(readConsentState());
  setConsentPreferences({ ...current, advertising: granted });
  if (!granted && typeof document !== 'undefined') {
    document.cookie = 'aff_ref=; Max-Age=0; Path=/; SameSite=Lax';
    document.cookie = 'aff_sub=; Max-Age=0; Path=/; SameSite=Lax';
  }
}

export function readMarketingConsentCookie(req: {
  cookies: { get: (key: string) => { value: string } | undefined };
}): boolean {
  return req.cookies.get('ys_marketing_consent')?.value === 'true';
}

function useConsentValue(selector: () => boolean): boolean {
  const [value, setValue] = useState(false);
  useEffect(() => {
    const update = () => setValue(selector());
    update();
    window.addEventListener(CONSENT_EVENT, update);
    return () => window.removeEventListener(CONSENT_EVENT, update);
  }, [selector]);
  return value;
}

export function useAnalyticsConsent(): boolean {
  return useConsentValue(hasAnalyticsConsent);
}

export function useMarketingConsent(): boolean {
  return useConsentValue(hasMarketingConsent);
}
