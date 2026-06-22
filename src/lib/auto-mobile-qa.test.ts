import { describe, expect, it } from 'vitest';

import { analyzeMobileHtml, buildMobileQaImprovementEvent, type ExpectedRender } from './auto-mobile-qa';
import { hashSourceText } from './product-registration/improvement-ledger';

const expectedRender: ExpectedRender = {
  title: '시즈오카 2박 3일',
  destination: '시즈오카',
  tripStyle: '2박 3일',
  duration: 3,
  nights: 2,
  hotelNames: [],
  hasOptionalTours: false,
  status: 'active',
  shortCode: 'PUS-ETC-FSZ-03-0016',
  internalCode: 'PUS-ETC-FSZ-03-0016',
  rawText: null,
  updatedAt: '2026-06-22T00:00:00.000Z',
  lastDayNumber: 3,
  lastDayArrivalCity: '부산',
  homeCity: '부산',
};

describe('auto mobile QA learning ledger bridge', () => {
  it('blocks an actual customer package page application error from becoming mobile proof', () => {
    const incidents = analyzeMobileHtml(
      '<html><body>Application error: a client-side exception has occurred while loading www.yeosonam.com</body></html>',
      expectedRender,
      'packages',
    );

    expect(incidents).toEqual([
      expect.objectContaining({
        id: 'mobile_application_error_html',
        severity: 'critical',
      }),
    ]);
  });

  it('requires customer landing core sections on the packages surface', () => {
    const incidents = analyzeMobileHtml(
      '<html><body><h1>시즈오카 2박 3일</h1><p>예약 문의</p></body></html>',
      expectedRender,
      'packages',
    );

    expect(incidents).toContainEqual(expect.objectContaining({
      id: 'mobile_customer_landing_core_markers_missing',
      severity: 'critical',
    }));
  });

  it('turns customer mobile landing incidents into macro-learning ledger evidence without raw text', () => {
    const event = buildMobileQaImprovementEvent({
      packageId: '550e8400-e29b-41d4-a716-446655440000',
      expected: {
        title: '대만 타이베이 3박4일',
        destination: '대만',
        tripStyle: '3박4일',
        duration: 4,
        nights: 3,
        hotelNames: ['테스트 호텔'],
        hasOptionalTours: true,
        status: 'active',
        shortCode: 'TWN-001',
        internalCode: 'PUS-BA-TPE-05-0001',
        rawText: '원문 가격표와 일정표',
        lastDayNumber: 4,
        lastDayArrivalCity: '부산',
        homeCity: '부산',
      },
      incidents: [
        {
          id: 'mobile_flight_time_merged',
          severity: 'high',
          message: '[packages] 항공 시간이 합쳐져 보임',
        },
        {
          id: 'lp_hero_title_partial',
          severity: 'medium',
          message: '[lp] 제목 일부 누락',
        },
      ],
      createdAt: '2026-06-16T00:00:00.000Z',
    });

    expect(event).toEqual(expect.objectContaining({
      uploadId: 'mobile-qa:550e8400-e29b-41d4-a716-446655440000',
      productId: 'PUS-BA-TPE-05-0001',
      packageId: '550e8400-e29b-41d4-a716-446655440000',
      attemptPhase: 'render_payload_audit_repair',
      parserVersion: 'auto-mobile-qa',
      detectedFormat: 'post_save_mobile_landing',
      rawTextHash: hashSourceText('원문 가격표와 일정표'),
      sectionRawTextHash: null,
      finalStatus: 'BLOCKED',
      fixtureCandidate: true,
      ruleCandidate: true,
    }));
    expect(event?.packagesAudit.status).toBe('fail');
    expect(event?.packagesAudit.failures).toEqual([
      'mobile_flight_time_merged: [packages] 항공 시간이 합쳐져 보임',
    ]);
    expect(event?.packagesAudit.warnings).toEqual([
      'lp_hero_title_partial: [lp] 제목 일부 누락',
    ]);
    expect(JSON.stringify(event)).not.toContain('원문 가격표와 일정표');
  });
});
