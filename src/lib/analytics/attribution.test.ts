import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  captureAttribution,
  sanitizeAttributionCampaignValue,
} from './attribution';
import { CONSENT_STORAGE_KEY } from './consent';

class MemoryStorage {
  private values = new Map<string, string>();
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
  removeItem(key: string) { this.values.delete(key); }
}

function consent(analytics: boolean, advertising: boolean) {
  localStorage.setItem(CONSENT_STORAGE_KEY, JSON.stringify({
    analytics_storage: analytics ? 'granted' : 'denied',
    ad_storage: advertising ? 'granted' : 'denied',
    ad_user_data: advertising ? 'granted' : 'denied',
    ad_personalization: advertising ? 'granted' : 'denied',
    decided: true,
    updatedAt: '2026-07-29T00:00:00.000Z',
  }));
}

describe('attribution capture', () => {
  beforeEach(() => {
    const storage = new MemoryStorage();
    const session = new MemoryStorage();
    vi.stubGlobal('localStorage', storage);
    vi.stubGlobal('sessionStorage', session);
    vi.stubGlobal('crypto', { randomUUID: () => '00000000-0000-4000-8000-000000000001' });
    vi.stubGlobal('document', { referrer: 'https://blog.naver.com/yeosonam' });
    vi.stubGlobal('window', {
      localStorage: storage,
      location: {
        hostname: 'www.yeosonam.com',
        pathname: '/packages/pkg-1',
        search: '?utm_source=naver&utm_medium=blog&utm_campaign=summer&gclid=abc123',
      },
    });
  });

  it('keeps first touch, updates last touch, and stores click IDs only with advertising consent', () => {
    consent(true, false);
    const first = captureAttribution(Date.parse('2026-07-29T00:00:00.000Z'));
    expect(first?.firstTouch?.source).toBe('naver');
    expect(first?.lastTouch?.medium).toBe('blog');
    expect(first?.clickIds).toBeUndefined();

    consent(true, true);
    window.location.search = '?utm_source=google&utm_medium=cpc&utm_campaign=brand&gclid=google-click-1';
    const second = captureAttribution(Date.parse('2026-07-29T01:00:00.000Z'));
    expect(second?.firstTouch?.source).toBe('naver');
    expect(second?.lastTouch?.source).toBe('google');
    expect(second?.clickIds?.gclid).toBe('google-click-1');
  });

  it('does not persist attribution before analytics consent', () => {
    consent(false, false);
    expect(captureAttribution()).toBeNull();
  });

  it('preserves only advertising click IDs when advertising alone is allowed', () => {
    consent(false, true);
    const snapshot = captureAttribution(Date.parse('2026-07-29T00:00:00.000Z'));
    expect(snapshot?.clickIds?.gclid).toBe('abc123');
    expect(snapshot?.firstTouch).toBeUndefined();
    expect(snapshot?.lastTouch).toBeUndefined();
    expect(snapshot?.gaClientId).toBeUndefined();
  });

  it('drops an obvious phone number embedded in an allowlisted UTM field', () => {
    consent(true, false);
    window.location.search = '?utm_source=naver&utm_term=010-1234-5678';
    const snapshot = captureAttribution(Date.parse('2026-07-29T00:00:00.000Z'));
    expect(snapshot?.lastTouch?.source).toBe('naver');
    expect(snapshot?.lastTouch?.term).toBeUndefined();
  });

  it('sanitizes legacy UTM values before lead persistence', () => {
    expect(sanitizeAttributionCampaignValue('naver')).toBe('naver');
    expect(sanitizeAttributionCampaignValue('010-1234-5678')).toBeNull();
    expect(sanitizeAttributionCampaignValue('person@example.com')).toBeNull();
  });
});
