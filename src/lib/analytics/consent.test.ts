import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  CONSENT_STORAGE_KEY,
  consentStateToPreferences,
  preferencesToConsentState,
  readConsentState,
} from './consent';

class MemoryStorage {
  private values = new Map<string, string>();
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('Consent Mode v2 mapping', () => {
  it('maps analytics and advertising choices to all four consent signals', () => {
    const state = preferencesToConsentState({ analytics: true, advertising: false });
    expect(state).toMatchObject({
      analytics_storage: 'granted',
      ad_storage: 'denied',
      ad_user_data: 'denied',
      ad_personalization: 'denied',
      decided: true,
    });
    expect(consentStateToPreferences(state)).toEqual({
      analytics: true,
      advertising: false,
    });
  });
});

describe('analytics consent persistence', () => {
  it('uses the compact consent cookie when local storage is empty', () => {
    const localStorage = new MemoryStorage();
    vi.stubGlobal('window', { localStorage });
    vi.stubGlobal('document', { cookie: 'other=value; ys_consent_v2=a-; theme=light' });

    expect(readConsentState()).toMatchObject({
      analytics_storage: 'granted',
      ad_storage: 'denied',
      decided: true,
    });
  });

  it('uses the compact consent cookie when browser storage throws', () => {
    vi.stubGlobal('window', {
      localStorage: { getItem: () => { throw new Error('blocked'); } },
    });
    vi.stubGlobal('document', { cookie: 'ys_consent_v2=-m' });

    expect(readConsentState()).toMatchObject({
      analytics_storage: 'denied',
      ad_storage: 'granted',
      decided: true,
    });
  });

  it('keeps valid local storage authoritative over the cookie fallback', () => {
    const localStorage = new MemoryStorage();
    localStorage.setItem(CONSENT_STORAGE_KEY, JSON.stringify({
      analytics_storage: 'denied',
      ad_storage: 'granted',
      ad_user_data: 'granted',
      ad_personalization: 'granted',
      decided: true,
      updatedAt: '2026-09-01T00:00:00.000Z',
    }));
    vi.stubGlobal('window', { localStorage });
    vi.stubGlobal('document', { cookie: 'ys_consent_v2=a-' });

    expect(readConsentState()).toMatchObject({
      analytics_storage: 'denied',
      ad_storage: 'granted',
      decided: true,
    });
  });

  it('rejects malformed compact consent cookies', () => {
    const localStorage = new MemoryStorage();
    vi.stubGlobal('window', { localStorage });
    vi.stubGlobal('document', { cookie: 'ys_consent_v2=allow-all' });

    expect(readConsentState().decided).toBe(false);
  });
});
