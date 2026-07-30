import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const analyticsMocks = vi.hoisted(() => ({
  getAttributionSnapshot: vi.fn(() => null),
  trackAnalyticsEvent: vi.fn(),
}));
const metaMocks = vi.hoisted(() => ({
  trackLead: vi.fn(),
}));
const windowMocks = vi.hoisted(() => ({
  safeOpenNewWindow: vi.fn(),
}));

vi.mock('@/lib/analytics', () => analyticsMocks);
vi.mock('@/components/MetaPixel', () => metaMocks);
vi.mock('@/lib/safe-window-open', () => windowMocks);

import { submitLeadPipeline, type LeadFormData } from './submitPipeline';
import type { TrackingData } from '@/hooks/useTracking';

const form: LeadFormData = {
  desiredDate: '2026-09-01',
  adults: 2,
  children: 0,
  name: '테스트',
  phone: '010-0000-0000',
  privacyConsent: true,
};
const tracking: TrackingData = {
  sessionId: 'session-1',
  utmSource: null,
  utmMedium: null,
  utmCampaign: null,
  utmContent: null,
  utmTerm: null,
  referrer: '',
  landingUrl: '/lp/pkg-1',
  scrollDepthReached: 0,
  timeOnPageSeconds: 0,
  itineraryViewed: false,
};

describe('submitLeadPipeline conversion contract', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('navigator', {
      userAgent: 'desktop-test',
      clipboard: { writeText: vi.fn().mockResolvedValue(undefined) },
    });
    vi.stubGlobal('window', {
      location: { href: 'https://www.yeosonam.com/lp/pkg-1' },
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('emits generate_lead only after the API confirms persistence', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: vi.fn().mockResolvedValue({
        data: { ok: true, lead_id: 'lead-1' },
      }),
    }));

    await submitLeadPipeline(
      'pkg-1',
      form,
      tracking,
      'https://pf.kakao.com/_xcFxkBG/chat',
    );

    expect(analyticsMocks.trackAnalyticsEvent).toHaveBeenCalledWith(
      'generate_lead',
      expect.objectContaining({
        lead_source: 'website',
        lead_type: 'package_inquiry',
        package_id: 'pkg-1',
      }),
      { dedupeKey: 'lead-1' },
    );
    expect(metaMocks.trackLead).toHaveBeenCalledOnce();
  });

  it('does not emit a lead conversion when persistence fails', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: vi.fn().mockResolvedValue({ error: { message: 'save failed' } }),
    }));

    const submission = submitLeadPipeline(
      'pkg-1',
      form,
      tracking,
      'https://pf.kakao.com/_xcFxkBG/chat',
    );
    const rejection = expect(submission).rejects.toThrow('save failed');
    await vi.runAllTimersAsync();
    await rejection;

    expect(analyticsMocks.trackAnalyticsEvent).not.toHaveBeenCalled();
    expect(metaMocks.trackLead).not.toHaveBeenCalled();
    expect(windowMocks.safeOpenNewWindow).not.toHaveBeenCalled();
  });
});
