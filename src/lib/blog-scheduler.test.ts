import { describe, expect, it } from 'vitest';
import {
  buildMicroAnglePrimaryKeyword,
  countPublishableQueueCandidates,
} from './blog-scheduler';

describe('blog scheduler queue refill helpers', () => {
  it('keeps English micro-angle ids out of reader-facing keywords', () => {
    const keyword = buildMicroAnglePrimaryKeyword('발리', { keywordSuffix: '가족여행 예산' });

    expect(keyword).toBe('발리 가족여행 예산');
    expect(keyword).not.toMatch(/family budget|transport cost|hotel area budget|weather packing|local mobility/i);
  });

  it('does not count duplicate active rows as publishable candidates', () => {
    const stats = countPublishableQueueCandidates({
      recentPublished: [
        { destination: '발리', angle_type: 'value', generation_meta: { micro_angle: 'budget_family' } },
      ],
      activeQueue: [
        { destination: '발리', angle_type: 'value', meta: { micro_angle: 'budget_family' } },
        { destination: '발리', angle_type: 'value', meta: { micro_angle: 'transport_cost' } },
        { destination: '발리', angle_type: 'value', meta: { micro_angle: 'transport_cost' } },
        { source: 'pillar', topic: '발리 완전 가이드', meta: { expected_slug: 'bali-complete-guide' } },
      ],
    });

    expect(stats).toEqual({
      publishableCount: 1,
      blockedRecentDuplicate: 1,
      duplicateQueued: 1,
      evidenceInsufficient: 0,
      productOpenContractBlocked: 0,
    });
  });

  it('separates writer type and product dedup keys in publishable candidate counting', () => {
    const stats = countPublishableQueueCandidates({
      recentPublished: [],
      activeQueue: [
        { destination: '발리', angle_type: 'value', meta: { micro_angle: 'budget_family', writer_type: 'info_writer' } },
        { destination: '발리', angle_type: 'value', meta: { micro_angle: 'budget_family', writer_type: 'product_consultant_writer', product_dedup_key: 'pkg|2026-07-01|5d|YSN' } },
        { destination: '발리', angle_type: 'value', meta: { micro_angle: 'budget_family', writer_type: 'product_consultant_writer', product_dedup_key: 'pkg|2026-07-01|5d|YSN' } },
        { destination: '발리', angle_type: 'value', meta: { micro_angle: 'transport_cost', evidence_insufficient: true } },
      ],
    });

    expect(stats).toEqual({
      publishableCount: 2,
      blockedRecentDuplicate: 0,
      duplicateQueued: 1,
      evidenceInsufficient: 1,
      productOpenContractBlocked: 0,
    });
  });

  it('excludes product rows blocked by the customer-open contract from publishable counts', () => {
    const stats = countPublishableQueueCandidates({
      recentPublished: [],
      activeQueue: [
        { product_id: 'pkg-ok', meta: { product_dedup_key: 'pkg-ok|2026-07-01|4d|YSN' } },
        { product_id: 'pkg-blocked', meta: { failure_code: 'product_open_contract' } },
        { product_id: 'pkg-blocked-2', meta: { quarantine_reason: 'product_open_contract' } },
      ],
    });

    expect(stats).toEqual({
      publishableCount: 1,
      blockedRecentDuplicate: 0,
      duplicateQueued: 0,
      evidenceInsufficient: 0,
      productOpenContractBlocked: 2,
    });
  });
});
