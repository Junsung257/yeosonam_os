'use client';

import type { TrackingData } from '@/hooks/useTracking';
import type {
  RevenueConsentState,
  RevenueFunnelEventType,
} from '@/lib/revenue-funnel-events';

const FIRST_TOUCH_KEY = 'yeosonam_revenue_first_touch_v1';

type Touch = {
  source: string;
  medium: string | null;
  campaign: string | null;
  content: string | null;
  term: string | null;
  referrer: string;
  landingPath: string;
};

function currentTouch(tracking: TrackingData): Touch {
  let landingPath = tracking.landingUrl;
  try {
    const url = new URL(tracking.landingUrl);
    landingPath = `${url.pathname}${url.search}`;
  } catch {
    // Keep the bounded URL supplied by the tracking hook.
  }
  return {
    source: tracking.utmSource ?? 'direct',
    medium: tracking.utmMedium,
    campaign: tracking.utmCampaign,
    content: tracking.utmContent,
    term: tracking.utmTerm,
    referrer: tracking.referrer,
    landingPath,
  };
}

function firstTouch(current: Touch): Touch {
  try {
    const saved = window.localStorage.getItem(FIRST_TOUCH_KEY);
    if (saved) return JSON.parse(saved) as Touch;
    window.localStorage.setItem(FIRST_TOUCH_KEY, JSON.stringify(current));
  } catch {
    // Storage can be unavailable in privacy modes; current touch remains valid.
  }
  return current;
}

function readClickIds(): Record<string, string> {
  if (typeof window === 'undefined') return {};
  const params = new URLSearchParams(window.location.search);
  return Object.fromEntries(
    ['gclid', 'fbclid', 'ttclid', 'msclkid']
      .map((key) => [key, params.get(key)] as const)
      .filter((entry): entry is readonly [string, string] => Boolean(entry[1])),
  );
}

export function getRevenueConsentState(): RevenueConsentState {
  if (typeof window === 'undefined') return 'unknown';
  try {
    const consent = window.localStorage.getItem('tc_consent');
    if (consent === 'true') return 'granted';
    if (consent === 'false') return 'denied';
  } catch {
    // Preserve an explicit unknown state when storage is unavailable.
  }
  return 'unknown';
}

export async function trackRevenueFunnelEvent(input: {
  eventType: RevenueFunnelEventType;
  offerId: string;
  tracking: TrackingData;
  consentState: RevenueConsentState;
  dedupeKey: string;
}): Promise<boolean> {
  const current = currentTouch(input.tracking);
  const first = firstTouch(current);
  const body = {
    eventType: input.eventType,
    offerId: input.offerId,
    sessionId: input.tracking.sessionId,
    consentState: input.consentState,
    dedupeKey: input.dedupeKey,
    source: current.source,
    medium: current.medium,
    campaign: current.campaign,
    content: current.content,
    term: current.term,
    referrer: current.referrer,
    landingPath: current.landingPath,
    firstTouch: JSON.stringify(first),
    lastTouch: JSON.stringify(current),
    clickIds: input.consentState === 'granted' ? readClickIds() : {},
  };

  try {
    const response = await fetch('/api/revenue-events', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      keepalive: true,
    });
    return response.ok;
  } catch {
    return false;
  }
}
