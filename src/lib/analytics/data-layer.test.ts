import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  resetAnalyticsDedupeForTests,
  sanitizeAnalyticsPayload,
  trackAnalyticsEvent,
} from './data-layer';
import { CONSENT_STORAGE_KEY } from './consent';

class MemoryStorage {
  private values = new Map<string, string>();
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
  removeItem(key: string) { this.values.delete(key); }
}

describe('analytics payload sanitizer', () => {
  beforeEach(() => {
    resetAnalyticsDedupeForTests();
    const storage = new MemoryStorage();
    storage.setItem(CONSENT_STORAGE_KEY, JSON.stringify({
      analytics_storage: 'granted',
      ad_storage: 'denied',
      ad_user_data: 'denied',
      ad_personalization: 'denied',
      decided: true,
      updatedAt: '2026-07-29T00:00:00.000Z',
    }));
    vi.stubGlobal('localStorage', storage);
    vi.stubGlobal('sessionStorage', new MemoryStorage());
    vi.stubGlobal('document', { title: 'Test', referrer: 'https://www.google.com/search' });
    vi.stubGlobal('window', {
      __YS_ANALYTICS_RUNTIME__: true,
      dataLayer: [],
      localStorage: storage,
      location: { pathname: '/packages/pkg-1', hostname: 'www.yeosonam.com', search: '' },
      matchMedia: () => ({ matches: false }),
    });
  });

  it('removes undefined and non-serializable values', () => {
    const cycle: Record<string, unknown> = { keep: 'yes', skip: undefined };
    cycle.self = cycle;
    expect(sanitizeAnalyticsPayload(cycle)).toEqual({ keep: 'yes' });
  });

  it('blocks PII keys and obvious PII values', () => {
    expect(() => sanitizeAnalyticsPayload({ phone: '01012345678' })).toThrow();
    expect(() => sanitizeAnalyticsPayload({ label: 'person@example.com' })).toThrow();
    expect(() => sanitizeAnalyticsPayload({ label: '010-1234-5678' })).toThrow();
  });

  it('keeps ecommerce item names and KRW values', () => {
    expect(sanitizeAnalyticsPayload({
      currency: 'KRW',
      value: 1200000,
      items: [{ item_id: 'pkg-1', item_name: '다낭 5일' }],
    })).toEqual({
      currency: 'KRW',
      value: 1200000,
      items: [{ item_id: 'pkg-1', item_name: '다낭 5일' }],
    });
  });

  it('deduplicates the same event key without interrupting the caller', () => {
    const payload = {
      lead_source: 'website' as const,
      lead_type: 'package_inquiry' as const,
      package_id: 'pkg-1',
    };
    expect(trackAnalyticsEvent('generate_lead', payload, { dedupeKey: 'lead-1' })).toBe(true);
    expect(trackAnalyticsEvent('generate_lead', payload, { dedupeKey: 'lead-1' })).toBe(false);
    expect((window.dataLayer ?? []).filter(
      entry => (entry as { event?: string }).event === 'generate_lead',
    )).toHaveLength(1);
  });
});
