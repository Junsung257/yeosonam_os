'use client';

import type {
  AnalyticsConsentState,
  ConsentGrant,
  ConsentPreferences,
} from './types';

export const CONSENT_STORAGE_KEY = 'ys_consent_preferences_v2';
export const CONSENT_COOKIE_KEY = 'ys_consent_v2';
export const CONSENT_EVENT = 'ys:consent-change';
const LEGACY_ANALYTICS_KEY = 'ys_analytics_consent';
const LEGACY_MARKETING_KEY = 'ys_marketing_consent';
const MAX_AGE_SECONDS = 180 * 24 * 60 * 60;

const deniedState: AnalyticsConsentState = {
  analytics_storage: 'denied',
  ad_storage: 'denied',
  ad_user_data: 'denied',
  ad_personalization: 'denied',
  decided: false,
  updatedAt: null,
};

function grant(value: boolean): ConsentGrant {
  return value ? 'granted' : 'denied';
}

export function preferencesToConsentState(
  preferences: ConsentPreferences,
  decided = true,
): AnalyticsConsentState {
  return {
    analytics_storage: grant(preferences.analytics),
    ad_storage: grant(preferences.advertising),
    ad_user_data: grant(preferences.advertising),
    ad_personalization: grant(preferences.advertising),
    decided,
    updatedAt: decided ? new Date().toISOString() : null,
  };
}

export function consentStateToPreferences(
  state: AnalyticsConsentState,
): ConsentPreferences {
  return {
    analytics: state.analytics_storage === 'granted',
    advertising:
      state.ad_storage === 'granted'
      && state.ad_user_data === 'granted'
      && state.ad_personalization === 'granted',
  };
}

function parseStored(value: string | null): AnalyticsConsentState | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as Partial<AnalyticsConsentState>;
    const values = [
      parsed.analytics_storage,
      parsed.ad_storage,
      parsed.ad_user_data,
      parsed.ad_personalization,
    ];
    if (!values.every(item => item === 'granted' || item === 'denied')) return null;
    return {
      analytics_storage: parsed.analytics_storage as ConsentGrant,
      ad_storage: parsed.ad_storage as ConsentGrant,
      ad_user_data: parsed.ad_user_data as ConsentGrant,
      ad_personalization: parsed.ad_personalization as ConsentGrant,
      decided: parsed.decided === true,
      updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : null,
    };
  } catch {
    return null;
  }
}

function readConsentCookie(): AnalyticsConsentState | null {
  if (typeof document === 'undefined' || typeof document.cookie !== 'string') return null;
  try {
    const prefix = `${CONSENT_COOKIE_KEY}=`;
    const encoded = document.cookie
      .split(';')
      .map(part => part.trim())
      .find(part => part.startsWith(prefix))
      ?.slice(prefix.length);
    if (!encoded || !/^[a-][m-]$/.test(encoded)) return null;
    return preferencesToConsentState({
      analytics: encoded.startsWith('a'),
      advertising: encoded.endsWith('m'),
    });
  } catch {
    return null;
  }
}

export function readConsentState(): AnalyticsConsentState {
  if (typeof window === 'undefined') return deniedState;
  try {
    const stored = parseStored(window.localStorage.getItem(CONSENT_STORAGE_KEY));
    if (stored) return stored;
  } catch {
    // Cookie fallback remains available when browser storage is blocked.
  }

  const cookieState = readConsentCookie();
  if (cookieState) return cookieState;

  try {
    const legacyAnalytics = window.localStorage.getItem(LEGACY_ANALYTICS_KEY);
    const legacyMarketing = window.localStorage.getItem(LEGACY_MARKETING_KEY);
    if (legacyAnalytics !== null || legacyMarketing !== null) {
      return preferencesToConsentState({
        analytics: legacyAnalytics === 'true',
        advertising: legacyMarketing === 'true',
      });
    }
  } catch {
    return deniedState;
  }
  return deniedState;
}

function queueConsentCommand(
  command: 'default' | 'update',
  state: AnalyticsConsentState,
): void {
  if (typeof window === 'undefined') return;
  window.dataLayer = window.dataLayer || [];
  window.gtag = window.gtag || function gtag(...args: unknown[]) {
    window.dataLayer?.push(args);
  };
  window.gtag('consent', command, {
    analytics_storage: state.analytics_storage,
    ad_storage: state.ad_storage,
    ad_user_data: state.ad_user_data,
    ad_personalization: state.ad_personalization,
    security_storage: 'granted',
    wait_for_update: command === 'default' ? 500 : undefined,
  });
}

export function initializeConsentMode(): AnalyticsConsentState {
  const stored = readConsentState();
  queueConsentCommand('default', deniedState);
  if (stored.decided) queueConsentCommand('update', stored);
  return stored;
}

export function setConsentPreferences(
  preferences: ConsentPreferences,
): AnalyticsConsentState {
  const state = preferencesToConsentState(preferences);
  if (typeof window === 'undefined') return state;
  try {
    window.localStorage.setItem(CONSENT_STORAGE_KEY, JSON.stringify(state));
    window.localStorage.setItem(LEGACY_ANALYTICS_KEY, String(preferences.analytics));
    window.localStorage.setItem(LEGACY_MARKETING_KEY, String(preferences.advertising));
    document.cookie = `${LEGACY_MARKETING_KEY}=${preferences.advertising}; Path=/; Max-Age=${MAX_AGE_SECONDS}; SameSite=Lax; Secure`;
    document.cookie = `${CONSENT_COOKIE_KEY}=${preferences.analytics ? 'a' : '-'}${preferences.advertising ? 'm' : '-'}; Path=/; Max-Age=${MAX_AGE_SECONDS}; SameSite=Lax; Secure`;
  } catch {
    // Consent persistence failure must not interrupt the UI.
  }
  queueConsentCommand('update', state);
  window.dataLayer = window.dataLayer || [];
  window.dataLayer.push({
    event: 'ysn_consent_update',
    analytics_storage: state.analytics_storage,
    ad_storage: state.ad_storage,
    ad_user_data: state.ad_user_data,
    ad_personalization: state.ad_personalization,
  });
  window.dispatchEvent(new CustomEvent(CONSENT_EVENT, { detail: state }));
  return state;
}

export function hasAnalyticsConsent(): boolean {
  return readConsentState().analytics_storage === 'granted';
}

export function hasMarketingConsent(): boolean {
  const state = readConsentState();
  return state.ad_storage === 'granted' && state.ad_user_data === 'granted';
}

export function shouldLoadGoogleTagManager(state = readConsentState()): boolean {
  return state.decided
    && (state.analytics_storage === 'granted' || state.ad_storage === 'granted');
}

declare global {
  interface Window {
    dataLayer?: unknown[];
    gtag?: (...args: unknown[]) => void;
    __YS_ANALYTICS_RUNTIME__?: boolean;
  }
}
