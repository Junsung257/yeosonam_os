import { describe, expect, it } from 'vitest';
import { buildRecentInfoDuplicateScope } from './blog-info-duplicate-scope';

describe('buildRecentInfoDuplicateScope', () => {
  it('keeps distinct micro angles separate within one destination and broad angle', () => {
    expect(buildRecentInfoDuplicateScope({
      destination: '세부',
      angle_type: 'value',
      meta: { micro_angle: 'budget_family' },
    })).toEqual({
      destination: '세부',
      angleType: 'value',
      microAngle: 'budget_family',
    });
  });

  it('falls back to the broad destination and angle scope for legacy candidates', () => {
    expect(buildRecentInfoDuplicateScope({ destination: '괌', angle_type: null }))
      .toEqual({ destination: '괌', angleType: 'value', microAngle: null });
  });

  it('does not apply information duplicate rules to product-backed candidates', () => {
    expect(buildRecentInfoDuplicateScope({
      product_id: 'product-1',
      destination: '세부',
      meta: { micro_angle: 'budget_family' },
    })).toBeNull();
  });
});
