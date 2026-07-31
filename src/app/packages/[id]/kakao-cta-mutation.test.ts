import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(new URL('./DetailClient.tsx', import.meta.url), 'utf8');
const kakaoCtaStart = source.indexOf('data-analytics-id="mobile_kakao_consult"');
const primaryCtaStart = source.indexOf('data-analytics-id="mobile_sticky_reservation"');
const kakaoCtaSource = source.slice(kakaoCtaStart, primaryCtaStart);

describe('package detail Kakao CTA mutation boundary', () => {
  it('keeps analytics and channel opening without creating a lead or booking', () => {
    expect(kakaoCtaStart).toBeGreaterThan(-1);
    expect(primaryCtaStart).toBeGreaterThan(kakaoCtaStart);
    expect(kakaoCtaSource).toContain("trackAnalyticsEvent('ysn_kakao_click'");
    expect(kakaoCtaSource).toContain('trackEngagement');
    expect(kakaoCtaSource).toContain("fetch('/api/tracking/recommendation'");
    expect(kakaoCtaSource).toContain('openKakaoChannel');
    expect(kakaoCtaSource).not.toContain('trackLead');
    expect(kakaoCtaSource).not.toContain("fetch('/api/leads'");
    expect(kakaoCtaSource).not.toContain("name: '카카오문의'");
    expect(kakaoCtaSource).not.toContain("phone: '-'");
  });
});
