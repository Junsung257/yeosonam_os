import { describe, expect, it } from 'vitest';

import {
  analyzeMobileHtml,
  buildAttractionMatchLowMessage,
  buildMobileBrowserProofPayload,
  buildMobileQaImprovementEvent,
  type ExpectedRender,
} from './auto-mobile-qa';
import { evaluateCustomerMobileProof } from './customer-mobile-proof';
import { hashSourceText } from './product-registration/improvement-ledger';

const expectedRender: ExpectedRender = {
  title: '시즈오카 2박 3일',
  destination: '시즈오카',
  tripStyle: '2박 3일',
  duration: 3,
  nights: 2,
  requiresFlightCard: true,
  hotelNames: [],
  hasOptionalTours: false,
  status: 'active',
  shortCode: 'PUS-ETC-FSZ-03-0016',
  internalCode: 'PUS-ETC-FSZ-03-0016',
  rawText: null,
  updatedAt: '2026-06-22T00:00:00.000Z',
  currentPackageRevision: 7,
  proofPackageRevision: 8,
  proofPublicSnapshotHash: 'snapshot-hash',
  proofAppBuildId: 'build-id',
  lastDayNumber: 3,
  lastDayArrivalCity: '부산',
  homeCity: '부산',
};

describe('auto mobile QA learning ledger bridge', () => {
  it('stores proof revision and snapshot hash on both the proof and each surface result', () => {
    const proof = buildMobileBrowserProofPayload({
      status: 'pass',
      checkedAt: '2026-07-10T00:00:00.000Z',
      packageUpdatedAt: '2026-07-09T00:00:00.000Z',
      packageRevision: 8,
      publicSnapshotHash: 'snapshot-hash',
      appBuildId: 'build-id',
      surfaces: [{ surface: 'packages' }, { surface: 'lp' }],
      surfaceProofResults: [
        {
          surface: 'packages',
          status: 'pass',
          page_url: 'https://example.com/packages/pkg',
          screen_hash: 'packages-screen',
          customer_visible_hash: 'packages-visible',
        },
        {
          surface: 'lp',
          status: 'pass',
          page_url: 'https://example.com/lp/pkg',
          screen_hash: 'lp-screen',
          customer_visible_hash: 'lp-visible',
        },
      ],
    });

    expect(proof).toEqual(expect.objectContaining({
      source: 'auto-mobile-fetch-proof',
      package_revision: 8,
      public_snapshot_hash: 'snapshot-hash',
      app_build_id: 'build-id',
    }));
    expect(proof.surface_results).toEqual([
      expect.objectContaining({ surface: 'packages', public_snapshot_hash: 'snapshot-hash' }),
      expect.objectContaining({ surface: 'lp', public_snapshot_hash: 'snapshot-hash' }),
    ]);
    expect(evaluateCustomerMobileProof({ auditReport: { mobile_browser_proof: proof } }).reason)
      .toBe('actual customer mobile browser proof source is auto-mobile-fetch-proof');
  });

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

  it('checks the actual final DAY body instead of the first summary DAY marker', () => {
    const incidents = analyzeMobileHtml(
      [
        '<html><body>',
        '판매가 예약 문의 여행 일정 DAY 1',
        'DAY 5 요약 부산 김해 출발',
        'DAY 5 본문 계림 출발 부산 김해 도착 예약 문의',
        '<img src="https://images.pexels.com/photo.jpg" />',
        '</body></html>',
      ].join(' '),
      {
        ...expectedRender,
        lastDayNumber: 5,
        lastDayArrivalCity: '부산 김해',
        homeCity: '부산 김해',
      },
      'packages',
    );

    expect(incidents).not.toContainEqual(expect.objectContaining({
      id: 'mobile_final_arrival_rendered_as_departure',
    }));
  });

  it('does not fail final arrival proof when a later CTA repeats the departure airport', () => {
    const incidents = analyzeMobileHtml(
      [
        '<html><body>',
        '\uD310\uB9E4\uAC00 \uC5EC\uD589 \uC77C\uC815 \uC608\uC57D \uBB38\uC758',
        'DAY 3 \uCCAD\uB3C4 \uAD6D\uC81C\uACF5\uD56D \uCD9C\uBC1C \uAE40\uD574 \uAD6D\uC81C\uACF5\uD56D \uB3C4\uCC29',
        '\uBD80\uC0B0/\uAE40\uD574 \uCD9C\uBC1C \uC0C1\uB2F4 CTA',
        '<img src="https://images.pexels.com/photo.jpg" />',
        '</body></html>',
      ].join(' '),
      {
        ...expectedRender,
        lastDayNumber: 3,
        lastDayArrivalCity: '\uAE40\uD574',
        homeCity: '\uBD80\uC0B0/\uAE40\uD574',
      },
      'packages',
    );

    expect(incidents).not.toContainEqual(expect.objectContaining({
      id: 'mobile_final_arrival_rendered_as_departure',
    }));
  });

  it('does not treat hidden UUID fragments as customer-visible phone leaks', () => {
    const incidents = analyzeMobileHtml(
      '<html><head><script>{"attraction_id":"8c01-4561-9921-abcdef"}</script></head><body><h1>고객 화면</h1></body></html>',
      { ...expectedRender, title: null, destination: null, hotelNames: [] },
      'lp',
    );

    expect(incidents).not.toContainEqual(expect.objectContaining({
      id: 'lp_leak_internal_phone',
    }));
  });

  it('does not require flight cards for ferry or other non-air packages', () => {
    const incidents = analyzeMobileHtml(
      '<html><body><h1>Ferry package</h1><p>판매가</p><p>여행 일정</p><p>예약 문의</p></body></html>',
      { ...expectedRender, requiresFlightCard: false },
      'packages',
    );

    expect(incidents).not.toContainEqual(expect.objectContaining({
      id: 'mobile_flight_card_missing',
    }));
  });

  it('explains attraction blockers as publish-approval work when masters already exist', () => {
    const message = buildAttractionMatchLowMessage({
      matchedCount: 0,
      denom: 5,
      unmatchedNames: ['단하산', '동천선경', '소선령', '대불사', '망산'],
      attractionMasters: [
        { name: '단하산', is_active: true, customer_publishable: false },
        { name: '동천선경', is_active: true, customer_publishable: false },
        { name: '소선령', is_active: true, customer_publishable: false },
        { name: '대불사', is_active: true, customer_publishable: false },
        { name: '망산', is_active: true, customer_publishable: false },
      ],
    });

    expect(message).toContain('고객 공개 승인 전');
    expect(message).toContain('공개 승인/사진/설명 검수 필요');
    expect(message).not.toContain('시드');
  });

  it('accepts rendered hotel alternatives when the full combined source string is split on screen', () => {
    const incidents = analyzeMobileHtml(
      [
        '<html><body>',
        '\uD310\uB9E4\uAC00 \uC5EC\uD589 \uC77C\uC815 \uC608\uC57D \uBB38\uC758',
        '\uD638\uD154 \uD22C\uC219 \uBC0F \uD734\uC2DD',
        '\uBB34\uC5C9\uD0C4 \uB7ED\uC154\uB9AC (4\uC131) / \uBCA0\uC2A4\uD2B8 \uC6E8\uC2A4\uD134 / \uBAA8\uBCA4\uD53D\uB9AC\uC870\uD2B8',
        '<img src="https://images.pexels.com/photo.jpg" />',
        '</body></html>',
      ].join(' '),
      {
        ...expectedRender,
        hotelNames: ['\uBB34\uC5C9\uD0C4 \uB7ED\uC154\uB9AC (4\uC131) / \uBCA0\uC2A4\uD2B8 \uC6E8\uC2A4\uD134 \uB610\uB294 \uBAA8\uBCA4\uD53D \uBE4C\uB77C&\uB808\uC9C0\uB358\uC2A4 (5\uC131)'],
      },
      'packages',
    );

    expect(incidents).not.toContainEqual(expect.objectContaining({
      id: 'mobile_hotel_all_missing',
    }));
    expect(incidents).not.toContainEqual(expect.objectContaining({
      id: 'mobile_hotel_partial_missing',
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
        requiresFlightCard: true,
        hotelNames: ['테스트 호텔'],
        hasOptionalTours: true,
        status: 'active',
        shortCode: 'TWN-001',
        internalCode: 'PUS-BA-TPE-05-0001',
        rawText: '원문 가격표와 일정표',
        currentPackageRevision: 7,
        proofPackageRevision: 8,
        proofPublicSnapshotHash: 'snapshot-hash',
        proofAppBuildId: 'build-id',
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
