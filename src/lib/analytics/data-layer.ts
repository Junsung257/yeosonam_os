'use client';

import { getPublicAnalyticsConfig, isProductionAnalyticsRuntime } from './config';
import { hasAnalyticsConsent } from './consent';
import { getAttributionSnapshot } from './attribution';
import type {
  AnalyticsEventMap,
  AnalyticsEventName,
  AnalyticsValue,
  DataLayerEvent,
} from './types';

const BLOCKED_KEYS = new Set([
  'name',
  'full_name',
  'customer_name',
  'phone',
  'phone_number',
  'email',
  'address',
  'passport',
  'passport_number',
  'birth_date',
  'resident_number',
  'message',
  'memo',
  'customer_note',
  'notes',
]);
const EMAIL_RE = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i;
const PHONE_RE = /(?:\+?82[-.\s]?)?0?1[016789][-.\s]?\d{3,4}[-.\s]?\d{4}/;
const sentKeys = new Set<string>();
const debugEvents: DataLayerEvent[] = [];
const blockedEvents: Array<{ event: string; reason: string }> = [];

function sanitizeValue(
  value: unknown,
  key: string,
  seen: WeakSet<object>,
): AnalyticsValue | undefined {
  if (value === undefined || typeof value === 'function' || typeof value === 'symbol') {
    return undefined;
  }
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  if (typeof value === 'string') {
    if (EMAIL_RE.test(value) || PHONE_RE.test(value)) {
      throw new Error(`PII value blocked at ${key}`);
    }
    return value.slice(0, 500);
  }
  if (typeof Node !== 'undefined' && value instanceof Node) return undefined;
  if (Array.isArray(value)) {
    if (seen.has(value)) return undefined;
    seen.add(value);
    return value
      .map((item, index) => sanitizeValue(item, `${key}[${index}]`, seen))
      .filter((item): item is AnalyticsValue => item !== undefined);
  }
  if (typeof value === 'object') {
    if (seen.has(value)) return undefined;
    seen.add(value);
    const output: Record<string, AnalyticsValue> = {};
    for (const [childKey, childValue] of Object.entries(value)) {
      if (BLOCKED_KEYS.has(childKey.toLowerCase())) {
        throw new Error(`PII key blocked: ${childKey}`);
      }
      const sanitized = sanitizeValue(childValue, `${key}.${childKey}`, seen);
      if (sanitized !== undefined) output[childKey] = sanitized;
    }
    return output;
  }
  return undefined;
}

export function sanitizeAnalyticsPayload(
  payload: Record<string, unknown>,
): Record<string, AnalyticsValue> {
  const sanitized = sanitizeValue(payload, 'payload', new WeakSet());
  return sanitized && !Array.isArray(sanitized) && typeof sanitized === 'object'
    ? sanitized
    : {};
}

function runtimeEnabled(): boolean {
  if (typeof window === 'undefined') return false;
  if (typeof window.__YS_ANALYTICS_RUNTIME__ === 'boolean') {
    return window.__YS_ANALYTICS_RUNTIME__;
  }
  const config = getPublicAnalyticsConfig();
  return isProductionAnalyticsRuntime(config, {
    nodeEnv: process.env.NODE_ENV,
    vercelEnv: process.env.NEXT_PUBLIC_VERCEL_ENV ?? process.env.VERCEL_ENV,
    hostname: window.location.hostname,
  });
}

export interface TrackAnalyticsOptions {
  dedupeKey?: string;
  allowWithoutConsent?: boolean;
}

function commonContext(): Record<string, unknown> {
  let referrerHost: string | undefined;
  try {
    referrerHost = document.referrer
      ? new URL(document.referrer).hostname.slice(0, 200)
      : undefined;
  } catch {
    referrerHost = undefined;
  }
  const attribution = getAttributionSnapshot();
  return {
    page_path: window.location.pathname.slice(0, 500),
    page_title: document.title.slice(0, 200),
    referrer_host: referrerHost,
    device_context: window.matchMedia('(max-width: 767px)').matches ? 'mobile' : 'desktop',
    attribution_session_id: attribution?.attributionSessionId,
  };
}

export function trackAnalyticsEvent<K extends AnalyticsEventName>(
  event: K,
  payload: AnalyticsEventMap[K],
  options: TrackAnalyticsOptions = {},
): boolean {
  if (typeof window === 'undefined') return false;
  if (!runtimeEnabled() && !getPublicAnalyticsConfig().debug) return false;
  if (!options.allowWithoutConsent && !hasAnalyticsConsent()) return false;

  const dedupeKey = options.dedupeKey;
  if (dedupeKey && sentKeys.has(`${event}:${dedupeKey}`)) return false;

  try {
    const sanitized = sanitizeAnalyticsPayload({
      ...commonContext(),
      ...(payload as Record<string, unknown>),
    });
    const entry: DataLayerEvent = { event, ...sanitized };
    window.dataLayer = window.dataLayer || [];
    window.dataLayer.push(entry);
    if (dedupeKey) sentKeys.add(`${event}:${dedupeKey}`);
    debugEvents.push(entry);
    if (debugEvents.length > 50) debugEvents.shift();
    if (getPublicAnalyticsConfig().debug) {
      console.debug('[analytics]', entry);
    }
    return true;
  } catch (error) {
    blockedEvents.push({
      event,
      reason: error instanceof Error ? error.message : 'sanitization_failed',
    });
    if (blockedEvents.length > 20) blockedEvents.shift();
    return false;
  }
}

export function resetAnalyticsDedupeForTests(): void {
  sentKeys.clear();
  debugEvents.length = 0;
  blockedEvents.length = 0;
}

export function getAnalyticsDebugSnapshot() {
  return {
    recentEvents: [...debugEvents],
    blockedEvents: [...blockedEvents],
    dedupeCount: sentKeys.size,
  };
}
