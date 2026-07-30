'use client';

import { getPublicAnalyticsConfig } from './config';
import {
  CONSENT_EVENT,
  hasAnalyticsConsent,
  hasMarketingConsent,
} from './consent';
import type {
  AttributionClickIds,
  AttributionSnapshot,
  AttributionTouch,
} from './types';

const STORAGE_KEY = 'ys_attribution_v1';
const ALLOWED_KEYS = [
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_term',
  'utm_content',
] as const;
const CLICK_KEYS = ['gclid', 'gbraid', 'wbraid', 'nclid'] as const;
const VALUE_RE = /^[\p{L}\p{N} _./:+-]{1,200}$/u;
const CLICK_ID_RE = /^[A-Za-z0-9._~-]{3,256}$/;
const PHONE_RE = /(?:\+?82[-.\s]?)?0?1[016789][-.\s]?\d{3,4}[-.\s]?\d{4}/;

function clean(value: string | null, clickId = false): string | undefined {
  if (!value) return undefined;
  const normalized = value.trim();
  const pattern = clickId ? CLICK_ID_RE : VALUE_RE;
  if (!pattern.test(normalized)) return undefined;
  if (!clickId && PHONE_RE.test(normalized)) return undefined;
  return normalized;
}

export function sanitizeAttributionCampaignValue(
  value: string | null,
): string | null {
  return clean(value) ?? null;
}

function sessionId(): string {
  const key = 'ys_attribution_session_id';
  try {
    const existing = sessionStorage.getItem(key);
    if (existing) return existing;
    const created = crypto.randomUUID();
    sessionStorage.setItem(key, created);
    return created;
  } catch {
    return crypto.randomUUID();
  }
}

function referrerHost(): string | undefined {
  if (!document.referrer) return undefined;
  try {
    const host = new URL(document.referrer).hostname;
    return host === window.location.hostname ? undefined : host.slice(0, 200);
  } catch {
    return undefined;
  }
}

function readStored(now = Date.now()): AttributionSnapshot | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as AttributionSnapshot;
    if (parsed.version !== 1 || Date.parse(parsed.expiresAt) <= now) {
      localStorage.removeItem(STORAGE_KEY);
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function currentTouch(nowIso: string): AttributionTouch | undefined {
  const params = new URLSearchParams(window.location.search);
  const values = Object.fromEntries(
    ALLOWED_KEYS.map(key => [key, clean(params.get(key))]),
  );
  const host = referrerHost();
  const hasCampaign = Object.values(values).some(Boolean);
  if (!hasCampaign && !host) return undefined;
  return {
    source: values.utm_source,
    medium: values.utm_medium,
    campaign: values.utm_campaign,
    term: values.utm_term,
    content: values.utm_content,
    landingPath: window.location.pathname.slice(0, 500),
    referrerHost: host,
    occurredAt: nowIso,
  };
}

function currentClickIds(): AttributionClickIds | undefined {
  if (!hasMarketingConsent()) return undefined;
  const params = new URLSearchParams(window.location.search);
  const ids = Object.fromEntries(
    CLICK_KEYS.map(key => [key, clean(params.get(key), true)]),
  ) as AttributionClickIds;
  return Object.values(ids).some(Boolean) ? ids : undefined;
}

export function captureAttribution(now = Date.now()): AttributionSnapshot | null {
  if (typeof window === 'undefined') return null;
  const analyticsAllowed = hasAnalyticsConsent();
  const marketingAllowed = hasMarketingConsent();
  if (!analyticsAllowed && !marketingAllowed) return null;
  const nowIso = new Date(now).toISOString();
  const existing = readStored(now);
  const touch = analyticsAllowed ? currentTouch(nowIso) : undefined;
  const clicks = marketingAllowed ? currentClickIds() : undefined;
  const ttl = getPublicAnalyticsConfig().attributionTtlDays * 24 * 60 * 60 * 1000;
  const snapshot: AttributionSnapshot = {
    version: 1,
    attributionSessionId: existing?.attributionSessionId || sessionId(),
    firstTouch: analyticsAllowed ? existing?.firstTouch || touch : undefined,
    lastTouch: analyticsAllowed ? touch || existing?.lastTouch : undefined,
    clickIds: marketingAllowed
      ? clicks
        ? { ...existing?.clickIds, ...clicks }
        : existing?.clickIds
      : undefined,
    gaClientId: analyticsAllowed ? existing?.gaClientId : undefined,
    expiresAt: new Date(now + ttl).toISOString(),
  };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
  } catch {
    return null;
  }
  return snapshot;
}

export function getAttributionSnapshot(): AttributionSnapshot | null {
  if (typeof window === 'undefined') return null;
  const analyticsAllowed = hasAnalyticsConsent();
  const marketingAllowed = hasMarketingConsent();
  if (!analyticsAllowed && !marketingAllowed) return null;
  const snapshot = readStored();
  if (!snapshot) return null;
  return {
    ...snapshot,
    firstTouch: analyticsAllowed ? snapshot.firstTouch : undefined,
    lastTouch: analyticsAllowed ? snapshot.lastTouch : undefined,
    clickIds: marketingAllowed ? snapshot.clickIds : undefined,
    gaClientId: analyticsAllowed ? snapshot.gaClientId : undefined,
  };
}

export function setGaClientId(clientId: string): void {
  if (!hasAnalyticsConsent() || !/^\d+\.\d+$/.test(clientId)) return;
  const snapshot = captureAttribution();
  if (!snapshot) return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...snapshot, gaClientId: clientId }));
  } catch {
    // Best-effort attribution must not break navigation.
  }
}

export function clearDisallowedAttribution(): void {
  const snapshot = readStored();
  if (!snapshot) return;
  const analyticsAllowed = hasAnalyticsConsent();
  const marketingAllowed = hasMarketingConsent();
  if (!analyticsAllowed && !marketingAllowed) {
    localStorage.removeItem(STORAGE_KEY);
    return;
  }
  localStorage.setItem(STORAGE_KEY, JSON.stringify({
    ...snapshot,
    firstTouch: analyticsAllowed ? snapshot.firstTouch : undefined,
    lastTouch: analyticsAllowed ? snapshot.lastTouch : undefined,
    clickIds: marketingAllowed ? snapshot.clickIds : undefined,
    gaClientId: analyticsAllowed ? snapshot.gaClientId : undefined,
  }));
}

export function installAttributionCapture(): () => void {
  if (typeof window === 'undefined') return () => {};
  const capture = () => {
    clearDisallowedAttribution();
    captureAttribution();
  };
  capture();
  window.addEventListener(CONSENT_EVENT, capture);
  return () => window.removeEventListener(CONSENT_EVENT, capture);
}

export const attributionAllowlist = {
  campaign: ALLOWED_KEYS,
  clickIds: CLICK_KEYS,
};
