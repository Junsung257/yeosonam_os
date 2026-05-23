import { describe, expect, it, vi, beforeEach } from 'vitest';
import {
  buildCatalogChunkText,
  tryExtractUploadViaIr,
} from './upload-ir-extract';
import {
  getIrCanaryConcurrency,
  getIrCanaryMaxProducts,
  isIrCanaryMultiEnabled,
} from './ir-canary';

vi.mock('./normalize-with-llm', () => ({
  normalizeWithLlm: vi.fn(async () => ({
    success: true,
    ir: { meta: { region: '다낭' }, days: [], rawText: 'x', rawTextHash: 'h' },
    tokensUsed: { input: 10, output: 5 },
    retryCount: 0,
  })),
}));

vi.mock('./ir-to-package', () => ({
  convertIntakeToPackage: vi.fn(async () => ({
    pkg: {
      title: '테스트 상품',
      category: 'package',
      confidence: 0.9,
      raw_text: 'chunk',
      itinerary_data: { days: [] },
    },
    unmatchedSegments: [],
  })),
}));

vi.mock('./parser/catalog-pre-split', () => ({
  splitCatalogSmart: vi.fn(async (raw: string) => {
    if (raw.includes('---MULTI---')) {
      return {
        sharedPrefix: '공통 가격표',
        sections: ['상품A 일정', '상품B 일정'],
        source: 'regex' as const,
      };
    }
    return {
      sharedPrefix: '',
      sections: [raw],
      source: 'single' as const,
    };
  }),
}));

describe('buildCatalogChunkText', () => {
  it('sharedPrefix 가 있으면 구분선과 함께 붙인다', () => {
    expect(buildCatalogChunkText('공통', '일정표')).toBe('공통\n\n---\n\n일정표');
  });

  it('prefix 없으면 section 만', () => {
    expect(buildCatalogChunkText('', '단일')).toBe('단일');
  });
});

describe('ir-canary multi knobs', () => {
  const env = process.env;

  beforeEach(() => {
    process.env = { ...env };
  });

  it('IR_CANARY_MULTI=0 이면 multi 비활성', () => {
    process.env.IR_CANARY_MULTI = '0';
    expect(isIrCanaryMultiEnabled()).toBe(false);
  });

  it('max products 기본 8, cap 16', () => {
    delete process.env.IR_CANARY_MAX_PRODUCTS;
    expect(getIrCanaryMaxProducts()).toBe(8);
    process.env.IR_CANARY_MAX_PRODUCTS = '99';
    expect(getIrCanaryMaxProducts()).toBe(16);
  });

  it('concurrency 기본 2, cap 6', () => {
    delete process.env.IR_CANARY_CONCURRENCY;
    expect(getIrCanaryConcurrency()).toBe(2);
    process.env.IR_CANARY_CONCURRENCY = '10';
    expect(getIrCanaryConcurrency()).toBe(6);
  });
});

describe('tryExtractUploadViaIr', () => {
  const sb = {} as never;

  it('단일 섹션 → products 1개', async () => {
    const result = await tryExtractUploadViaIr({
      rawText: '단일 상품 원문',
      landOperator: '베스트아시아',
      commissionRate: 9,
      sb,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.products).toHaveLength(1);
      expect(result.catalogSections).toBe(1);
    }
  });

  it('복수 섹션 → products N개', async () => {
    const result = await tryExtractUploadViaIr({
      rawText: '---MULTI---',
      landOperator: '베스트아시아',
      commissionRate: 9,
      sb,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.products).toHaveLength(2);
      expect(result.products[0].sectionRawText).toContain('공통 가격표');
      expect(result.catalogSections).toBe(2);
    }
  });

  it('IR_CANARY_MULTI=0 이면 복수 카탈로그 거부', async () => {
    process.env.IR_CANARY_MULTI = '0';
    const result = await tryExtractUploadViaIr({
      rawText: '---MULTI---',
      landOperator: '베스트아시아',
      commissionRate: 9,
      sb,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors[0]).toContain('multi-product disabled');
    }
    delete process.env.IR_CANARY_MULTI;
  });
});
