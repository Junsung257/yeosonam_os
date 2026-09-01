import { describe, expect, it } from 'vitest';

import { buildPublicPackageSnapshot } from '@/lib/package-publication/public-snapshot';
import type { ResolvedTransportForSnapshot } from './shared-fact-orchestrator';
import {
  applyResolvedTransport,
  applySafeLodgingCopy,
  classifyProductRegistrationBrowserProofFailure,
  degradedPackageCopy,
  productRegistrationProofScreenshotPath,
  productRegistrationProofSuiteVersion,
} from './snapshot-publication';

function packageWithFlight() {
  return {
    itinerary_data: {
      flight_segments: [{
        leg: 'outbound',
        flight_no: 'BX134',
        dep_time: '16:30',
        arr_time: '17:35',
        arr_day_offset: 0,
      }],
    },
  };
}

function fact(overrides: Partial<ResolvedTransportForSnapshot> = {}): ResolvedTransportForSnapshot {
  return {
    packageId: 'package-1',
    leg: 'outbound',
    serviceNumber: 'BX134',
    departureAirport: 'PUS',
    arrivalAirport: 'MYJ',
    departureDate: '2026-08-13',
    departureLocalTime: '16:30',
    arrivalLocalTime: '17:35',
    arrivalDayOffset: 0,
    state: 'source_confirmed',
    verifiedByCurrentProviders: false,
    ...overrides,
  };
}

function flight(result: Record<string, unknown>): Record<string, unknown> {
  return ((result.itinerary_data as { flight_segments: Record<string, unknown>[] }).flight_segments[0]);
}

describe('applyResolvedTransport', () => {
  it('keeps times explicitly stated in the current supplier source', () => {
    const result = applyResolvedTransport(packageWithFlight(), 'package-1', [fact()]);

    expect(flight(result)).toMatchObject({
      flight_no: 'BX134',
      dep_time: '16:30',
      arr_time: '17:35',
      v6_fact_state: 'source_confirmed',
      v6_fact_basis: 'source',
    });
  });

  it('uses the single time variant corroborated by current providers', () => {
    const result = applyResolvedTransport(packageWithFlight(), 'package-1', [fact({
      state: 'corroborated',
      verifiedByCurrentProviders: true,
      departureLocalTime: '16:45',
      arrivalLocalTime: '17:50',
    })]);

    expect(flight(result)).toMatchObject({
      dep_time: '16:45',
      arr_time: '17:50',
      arr_day_offset: 0,
      v6_fact_state: 'corroborated',
    });
  });

  it('uses one variant agreed by two independent verified product sources', () => {
    const result = applyResolvedTransport(packageWithFlight(), 'package-1', [fact({
      state: 'corroborated',
      resolutionBasis: 'independent_products',
      trustScore: 0.8,
      independentSourceCount: 2,
      departureLocalTime: '16:45',
      arrivalLocalTime: '17:50',
    })]);
    expect(flight(result)).toMatchObject({
      dep_time: '16:45',
      arr_time: '17:50',
      v6_fact_basis: 'independent_products',
    });
  });

  it('hides an internally inferred time below the trust threshold', () => {
    const result = applyResolvedTransport(packageWithFlight(), 'package-1', [fact({
      state: 'corroborated', resolutionBasis: 'independent_products', trustScore: 0.7, independentSourceCount: 2,
    })]);
    expect(flight(result)).not.toHaveProperty('dep_time');
    expect(flight(result)).toMatchObject({ v6_fact_state: 'degraded' });
  });

  it('hides times when observations conflict', () => {
    const result = applyResolvedTransport(packageWithFlight(), 'package-1', [
      fact({ state: 'conflicting' }),
      fact({
        departureDate: '2026-08-14',
        departureLocalTime: '16:45',
        arrivalLocalTime: '17:50',
        state: 'corroborated',
        verifiedByCurrentProviders: true,
      }),
    ]);

    expect(flight(result)).not.toHaveProperty('dep_time');
    expect(flight(result)).not.toHaveProperty('arr_time');
    expect(flight(result)).toMatchObject({ v6_fact_state: 'conflicting' });
  });

  it('hides source times when route identity could not be resolved', () => {
    const result = applyResolvedTransport({
      ...packageWithFlight(),
      itinerary_data: {
        ...packageWithFlight().itinerary_data,
        days: [{
          day: 1,
          schedule: [{
            type: 'flight',
            transport: 'BX134',
            time: '16:30',
            activity: '부산 공항 출발 (16:30 출발)',
          }],
        }],
      },
    }, 'package-1', []);
    expect(flight(result)).not.toHaveProperty('dep_time');
    expect(flight(result)).not.toHaveProperty('arr_time');
    expect(flight(result)).toMatchObject({
      flight_no: 'BX134',
      v6_fact_state: 'degraded',
      v6_schedule_notice: '운항일 기준 상담 시 최종 확인',
    });
    const day = ((result.itinerary_data as { days: Array<{ schedule: Array<Record<string, unknown>> }> }).days[0]);
    expect(day.schedule[0]).not.toHaveProperty('time');
    expect(day.schedule[0].activity).not.toContain('16:30');

    const { snapshot } = buildPublicPackageSnapshot({
      ...result,
      id: 'package-1',
      title: '부산 출발 여행',
      price: 699000,
      product_registration_disclosure: {
        state: 'published_degraded',
        notice: '항공 운항 시각·미정 호텔 등 일부 정보는 운항일 기준 상담 시 최종 확인해 드립니다.',
      },
    });
    const publicFlight = ((snapshot.package.itinerary_data as { flight_segments: Record<string, unknown>[] }).flight_segments[0]);
    expect(publicFlight).not.toHaveProperty('dep_time');
    expect(JSON.stringify(snapshot.package.itinerary_data)).not.toContain('16:30');
    expect(snapshot.package.customer_notes).toContain('항공 운항 시각과 미정 숙소는 상담 시 최종 확인해 드립니다.');
  });
});

describe('applySafeLodgingCopy', () => {
  it('does not expose an operational lodging placeholder as a confirmed hotel', () => {
    const result = applySafeLodgingCopy({
      itinerary_data: { days: [{ day: 1, regions: ['푸꾸옥', 'HOTEL : 해당숙소'], hotel: { name: '해당숙소', raw_text: '해당숙소' } }] },
    }, [{ day_index: 1, lodging_state: 'to_be_confirmed' }]);
    const day = ((result.itinerary_data as { days: Array<{ hotel: Record<string, unknown> }> }).days[0]);
    expect(day.hotel).toMatchObject({
      name: '숙소 미정 · 상담 시 최종 확인',
      raw_text: '숙소 미정 · 상담 시 최종 확인',
    });
    expect((day as unknown as { regions: string[] }).regions).toEqual(['푸꾸옥']);
  });
});

describe('degradedPackageCopy', () => {
  it('puts every customer-impacting degraded condition in visible highlights', () => {
    const result = degradedPackageCopy({ product_highlights: ['원문 일정'] }, {
      outcome: 'degraded',
      terminalOutcome: 'published_degraded',
      packageIds: ['package-1'],
      revisionIds: ['revision-1'],
      blockers: [],
      degradedReasons: [
        'TICKETING_DEADLINE_EXPIRED_RECONFIRMATION_REQUIRED:2026-08-14',
        'FLIGHT_IDENTITY_OR_ROUTE_UNRESOLVED_HIDDEN',
      ],
    });
    expect(result.product_highlights).toEqual(expect.arrayContaining([
      '발권기한 경과 또는 출발일별 조건 차이로 현재 좌석과 요금은 상담 시 최종 확인해 드립니다.',
      '항공 운항 시각과 미정 숙소는 상담 시 최종 확인해 드립니다.',
    ]));
  });
});

describe('productRegistrationProofScreenshotPath', () => {
  it('keeps proof screenshots tenant scoped and renderer specific', () => {
    expect(productRegistrationProofScreenshotPath({
      tenantId: 'tenant-1',
      snapshotId: 'snapshot-1',
      rendererBuildId: 'build/one',
      surface: 'packages',
      screenshotHash: 'a'.repeat(64),
    })).toBe(`tenant-1/proofs/snapshot-1/build_one/packages-${'a'.repeat(64)}.png`);
  });
});

describe('productRegistrationProofSuiteVersion', () => {
  it('keeps failed and passed browser evidence as separate immutable attempts', () => {
    const surface = {
      surface: 'packages' as const,
      url: 'https://example.test/proof',
      status: 'failed' as const,
      responseStatus: 200,
      snapshotHash: 'a'.repeat(64),
      rendererBuildId: 'build-1',
      screenshotHash: 'b'.repeat(64),
      screenshotPng: null,
      screenshotState: 'customer-first-viewport-before-cta' as const,
      bodyTextHash: 'c'.repeat(64),
      koreanFontReady: true,
      imageCount: 1,
      brokenImageCount: 0,
      ctaOpened: true,
      requiredTextChecked: ['가격'],
      missingRequiredText: ['가격'],
      forbiddenTextFound: [],
      hydrationErrors: [],
      failures: ['REQUIRED_CUSTOMER_FACTS_MISSING_1'],
    };
    const failed = productRegistrationProofSuiteVersion({
      status: 'failed',
      browserMode: 'local-chrome',
      viewport: { width: 390, height: 844, deviceScaleFactor: 3 },
      checkedAt: '2026-08-17T00:00:00Z',
      surfaces: [surface],
    });
    const passed = productRegistrationProofSuiteVersion({
      status: 'passed',
      browserMode: 'local-chrome',
      viewport: { width: 390, height: 844, deviceScaleFactor: 3 },
      checkedAt: '2026-08-17T00:01:00Z',
      surfaces: [{ ...surface, status: 'passed', missingRequiredText: [], failures: [] }],
    });
    expect(failed).not.toBe(passed);
    expect(failed).toMatch(/^product-registration-v6-mobile-chrome-3\+result\.[0-9a-f]{24}$/);
  });
});

describe('classifyProductRegistrationBrowserProofFailure', () => {
  const baseSurface = {
    surface: 'packages' as const,
    url: 'https://example.test/proof',
    status: 'failed' as const,
    responseStatus: 200,
    snapshotHash: 'a'.repeat(64),
    rendererBuildId: 'build-1',
    screenshotHash: 'b'.repeat(64),
    screenshotPng: null,
    screenshotState: 'customer-first-viewport-before-cta' as const,
    bodyTextHash: 'c'.repeat(64),
    koreanFontReady: true,
    imageCount: 1,
    brokenImageCount: 0,
    ctaOpened: true,
    requiredTextChecked: [],
    missingRequiredText: [],
    forbiddenTextFound: [],
    hydrationErrors: [],
    failures: [] as string[],
  };

  it('separates lineage failures from customer-content failures', () => {
    const taxonomy = classifyProductRegistrationBrowserProofFailure({
      status: 'failed',
      browserMode: 'local-chrome',
      viewport: { width: 390, height: 844, deviceScaleFactor: 3 },
      checkedAt: '2026-09-01T00:00:00Z',
      surfaces: [
        { ...baseSurface, failures: ['REQUIRED_CUSTOMER_FACTS_MISSING_1'] },
        { ...baseSurface, surface: 'lp', failures: ['SNAPSHOT_HASH_LINEAGE_MISMATCH'] },
      ],
    });
    expect(taxonomy.primaryCategory).toBe('lineage');
    expect(taxonomy.failures).toEqual(expect.arrayContaining([
      expect.objectContaining({ surface: 'packages', category: 'customer_content' }),
      expect.objectContaining({ surface: 'lp', category: 'lineage' }),
    ]));
  });

  it('marks navigation timeouts as infrastructure instead of an opaque proof failure', () => {
    const taxonomy = classifyProductRegistrationBrowserProofFailure({
      status: 'failed',
      browserMode: 'serverless-chromium',
      viewport: { width: 390, height: 844, deviceScaleFactor: 3 },
      checkedAt: '2026-09-01T00:00:00Z',
      surfaces: [
        { ...baseSurface, failures: ['BROWSER_ASSERTION:Navigation timeout of 60000 ms exceeded'] },
        { ...baseSurface, surface: 'lp', failures: ['BROWSER_ASSERTION:Navigation timeout of 60000 ms exceeded'] },
      ],
    });
    expect(taxonomy.primaryCategory).toBe('infrastructure');
  });
});
