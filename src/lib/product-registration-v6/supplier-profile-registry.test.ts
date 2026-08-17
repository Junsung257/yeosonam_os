import { describe, expect, it } from 'vitest';

import {
  parseCatalogSegmentationProfileHints,
  supplierProfileBenchmarkQualification,
} from './supplier-profile-registry';

describe('supplier profile qualification', () => {
  it('allows only reviewed profiles with enough sections, lineages and no critical defects', () => {
    expect(supplierProfileBenchmarkQualification({
      passed: true,
      metrics: { sectionCount: 30, lineageCount: 10 },
      criticalFalsePublishCount: 0,
      exactMatchRate: 0.995,
    })).toEqual({ sectionCount: 30, lineageCount: 10, criticalFalsePublishCount: 0, exactMatchRate: 0.995 });
    expect(supplierProfileBenchmarkQualification({
      passed: true,
      metrics: { sectionCount: 29, lineageCount: 10 },
      criticalFalsePublishCount: 0,
      exactMatchRate: 1,
    })).toBeNull();
    expect(supplierProfileBenchmarkQualification({
      passed: true,
      metrics: { sectionCount: 40, lineageCount: 12 },
      criticalFalsePublishCount: 1,
      exactMatchRate: 1,
    })).toBeNull();
  });

  it('accepts only bounded literal header tokens', () => {
    expect(parseCatalogSegmentationProfileHints({
      product_header_tokens: ['상품 구분', '', 'A', '상품 구분', 'x'.repeat(81)],
    })).toEqual({ productHeaderTokens: ['상품 구분'] });
  });
});
