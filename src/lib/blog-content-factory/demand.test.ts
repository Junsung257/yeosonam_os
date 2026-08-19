import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import { decideBlogDemandMaterializationV4, normalizeBlogDemandQueryV4 } from './demand';
import type { BlogDemandMaterializationInputV4 } from './types';

function input(overrides: Partial<BlogDemandMaterializationInputV4> = {}): BlogDemandMaterializationInputV4 {
  const sourceReference = 'gsc:2026-08-18:다낭 10월 날씨';
  return {
    primaryQuery: '다낭 10월 날씨',
    destinationId: 'danang',
    operationDayKst: '2026-08-19',
    signal: {
      provider: 'google_search_console',
      signalKey: '다낭 10월 날씨',
      sourceReference,
      sourceRowHash: createHash('sha256').update(sourceReference).digest('hex'),
      observedAt: '2026-08-18T00:00:00.000Z',
      expiresAt: '2026-09-18T00:00:00.000Z',
      verifiedAt: '2026-08-18T01:00:00.000Z',
      metrics: { impressions: 144, clicks: 3 },
    },
    ...overrides,
  };
}

describe('Blog V4 demand materializer', () => {
  it('normalizes boilerplate and years without inventing a new query', () => {
    expect(normalizeBlogDemandQueryV4('  다낭 여행 가이드 2026 — 완벽 총정리 ')).toBe('다낭');
  });

  it('creates a new informational operation from fresh observed demand', () => {
    const result = decideBlogDemandMaterializationV4(input(), new Date('2026-08-19T00:00:00.000Z'));
    expect(result).toMatchObject({
      intent: 'monthly_weather',
      decision: 'new',
      operationType: 'new_info',
      createsNewUrl: true,
      riskLevel: 'LOW',
    });
    expect(result.demandScore).toBeGreaterThan(0);
    expect(result.scoreComponents).toMatchObject({
      impressions: expect.any(Number),
      ctr_opportunity: expect.any(Number),
      source_freshness: expect.any(Number),
      cannibalization_penalty: 0,
      template_saturation_penalty: 0,
    });
  });

  it('chooses material refresh when an active representative already owns the intent', () => {
    const result = decideBlogDemandMaterializationV4(input({
      representative: {
        representativeKey: 'v1|danang|monthly_weather|general|ko-KR',
        canonicalCreativeId: '11111111-1111-4111-8111-111111111111',
        canonicalSlug: 'danang-october-weather',
        status: 'active',
      },
    }), new Date('2026-08-19T00:00:00.000Z'));
    expect(result).toMatchObject({
      decision: 'refresh',
      operationType: 'material_refresh',
      createsNewUrl: false,
      canonicalCreativeId: '11111111-1111-4111-8111-111111111111',
    });
  });

  it('pins a commercial operation to an immutable package snapshot', () => {
    const result = decideBlogDemandMaterializationV4(input({
      primaryQuery: '세부 가족여행 호텔 추천',
      packageSnapshot: {
        packageId: '22222222-2222-4222-8222-222222222222',
        snapshotId: '33333333-3333-4333-8333-333333333333',
        revision: 7,
        hash: 'snapshot-sha256',
      },
    }), new Date('2026-08-19T00:00:00.000Z'));
    expect(result).toMatchObject({
      decision: 'commercial_companion',
      operationType: 'new_commercial',
      createsNewUrl: true,
      packageSnapshot: { revision: 7, hash: 'snapshot-sha256' },
    });
  });

  it('turns an explicitly pinned commercial canonical into a product refresh', () => {
    const result = decideBlogDemandMaterializationV4(input({
      primaryQuery: '세부 가족여행 호텔 추천',
      refreshTargetCreativeId: '44444444-4444-4444-8444-444444444444',
      packageSnapshot: {
        packageId: '22222222-2222-4222-8222-222222222222',
        snapshotId: '33333333-3333-4333-8333-333333333333',
        revision: 8,
        hash: 'snapshot-sha256-v8',
      },
    }), new Date('2026-08-19T00:00:00.000Z'));
    expect(result).toMatchObject({
      decision: 'refresh',
      operationType: 'product_refresh',
      createsNewUrl: false,
      canonicalCreativeId: '44444444-4444-4444-8444-444444444444',
    });
  });

  it('rejects expired or unverified demand instead of manufacturing volume', () => {
    expect(() => decideBlogDemandMaterializationV4(input({
      signal: { ...input().signal, expiresAt: '2026-08-18T00:00:00.000Z' },
    }), new Date('2026-08-19T00:00:00.000Z'))).toThrow('verified_blog_demand_signal_missing_or_expired');
    expect(() => decideBlogDemandMaterializationV4(input({
      signal: { ...input().signal, verifiedAt: '' },
    }), new Date('2026-08-19T00:00:00.000Z'))).toThrow('verified_blog_demand_signal_missing_or_expired');
  });

  it('is idempotent for the same KST day, cluster, type and package snapshot', () => {
    const first = decideBlogDemandMaterializationV4(input(), new Date('2026-08-19T00:00:00.000Z'));
    const second = decideBlogDemandMaterializationV4(input(), new Date('2026-08-19T03:00:00.000Z'));
    expect(first.idempotencyKey).toBe(second.idempotencyKey);
    expect(first.clusterKey).toBe(second.clusterKey);
  });
});
