import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  buildCatalogChunkText,
  tryExtractUploadViaIr,
} from './upload-ir-extract';
import {
  getIrCanaryConcurrency,
  getIrCanaryMaxProducts,
  isIrCanaryMultiEnabled,
} from './ir-canary';
import { buildIntakeSectionCacheEntries } from './intake-section-cache';
import { buildSupplierFormatFingerprint } from './supplier-format-fingerprint';
import { normalizeWithLlm } from './normalize-with-llm';
import type { NormalizedIntake } from './intake-normalizer';

function makeBaseIr(rawText: string): NormalizedIntake {
  return {
    meta: {
      landOperator: 'supplier',
      region: 'UNK',
      country: 'VN',
      tripStyle: 'UNK',
      productType: '패키지',
      commissionRate: 9,
      ticketingDeadline: null,
      minParticipants: 1,
      departureAirport: 'UNK',
      airline: 'UNK',
      departureDays: null,
    },
    flights: { outbound: [], inbound: [] },
    priceGroups: [],
    hotels: [],
    inclusions: [],
    excludes: [],
    surcharges: [],
    optionalTours: [],
    days: [],
    notices: { manual: [], auto: [] },
    rawText,
    rawTextHash: 'h',
    sourceEvidence: {},
    normalizerVersion: 'ir-normalizer-v1.0-sonnet-4.6',
    extractedAt: '2026-05-31T00:00:00.000Z',
  };
}

vi.mock('./normalize-with-llm', () => ({
  normalizeWithLlm: vi.fn(async (input: { rawText: string }) => ({
    success: true,
    ir: makeBaseIr(input.rawText),
    tokensUsed: { input: 10, output: 5 },
    retryCount: 0,
  })),
}));

vi.mock('./ir-to-package', () => ({
  convertIntakeToPackage: vi.fn(async (ir: NormalizedIntake) => ({
    pkg: {
      title: '테스트 상품',
      category: 'package',
      product_type: '패키지',
      trip_style: ir.meta.tripStyle,
      destination: ir.meta.region,
      duration: 5,
      departure_airport: ir.meta.departureAirport,
      airline: ir.meta.airline,
      min_participants: ir.meta.minParticipants,
      price: ir.priceGroups[0]?.adultPrice ?? 0,
      price_tiers: ir.priceGroups.map(pg => ({
        period_label: pg.label,
        adult_price: pg.adultPrice,
        child_price: pg.childPrice,
        status: 'available',
      })),
      inclusions: ir.inclusions,
      excludes: ir.excludes,
      confidence: 0.9,
      raw_text: ir.rawText,
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
  it('joins shared prefix and section with a divider', () => {
    expect(buildCatalogChunkText('공통', '일정')).toBe('공통\n\n---\n\n일정');
  });

  it('returns only section when prefix is empty', () => {
    expect(buildCatalogChunkText('', '단일')).toBe('단일');
  });
});

describe('ir-canary multi knobs', () => {
  const env = process.env;

  beforeEach(() => {
    process.env = { ...env };
  });

  it('disables multi when IR_CANARY_MULTI=0', () => {
    process.env.IR_CANARY_MULTI = '0';
    expect(isIrCanaryMultiEnabled()).toBe(false);
  });

  it('uses max products default 8 and cap 16', () => {
    delete process.env.IR_CANARY_MAX_PRODUCTS;
    expect(getIrCanaryMaxProducts()).toBe(8);
    process.env.IR_CANARY_MAX_PRODUCTS = '99';
    expect(getIrCanaryMaxProducts()).toBe(16);
  });

  it('uses concurrency default 2 and cap 6', () => {
    delete process.env.IR_CANARY_CONCURRENCY;
    expect(getIrCanaryConcurrency()).toBe(2);
    process.env.IR_CANARY_CONCURRENCY = '10';
    expect(getIrCanaryConcurrency()).toBe(6);
  });
});

describe('tryExtractUploadViaIr', () => {
  const sb = {} as never;

  beforeEach(() => {
    vi.mocked(normalizeWithLlm).mockClear();
    delete process.env.IR_CANARY_MULTI;
    delete process.env.RAW_UPLOAD_SECTION_CACHE_ENABLED;
    delete process.env.RAW_UPLOAD_SECTION_CACHE_REDUCE_INPUT;
  });

  it('extracts one product from a single section', async () => {
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

  it('extracts N products from multiple catalog sections', async () => {
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

  it('rejects multiple catalog sections when IR_CANARY_MULTI=0', async () => {
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
  });

  it('reduces LLM input and merges exact section cache hits when canary is enabled', async () => {
    process.env.RAW_UPLOAD_SECTION_CACHE_ENABLED = '1';
    process.env.RAW_UPLOAD_SECTION_CACHE_REDUCE_INPUT = '1';
    const raw = `상품명: [CACHE] 나트랑 3박5일
출발공항 부산 / 항공 LJ
출발편 LJ115 21:35 부산 출발 00:25 나트랑 도착
귀국편 LJ116 01:00 나트랑 출발 06:40 부산 도착
최소출발 6명 이상

요금표
성인 889,000원 / 아동 889,000원

공지
현지 사정에 따라 변경될 수 있습니다.`;
    const fingerprint = buildSupplierFormatFingerprint(raw);
    const cachedIr: NormalizedIntake = {
      ...makeBaseIr(raw),
      meta: {
        ...makeBaseIr(raw).meta,
        region: '나트랑',
        tripStyle: '3박5일',
        minParticipants: 6,
        departureAirport: '부산',
        airline: 'LJ',
      },
      flights: {
        outbound: [{ code: 'LJ115', departure: { time: '21:35', airport: '부산' }, arrival: { time: '00:25', airport: '나트랑' } }],
        inbound: [{ code: 'LJ116', departure: { time: '01:00', airport: '나트랑' }, arrival: { time: '06:40', airport: '부산' } }],
      },
      priceGroups: [{
        label: 'base',
        dates: [],
        dateRange: null,
        dayOfWeek: null,
        adultPrice: 889000,
        childPrice: 889000,
        confirmed: false,
        surchargeIncluded: false,
        surchargeNote: null,
      }],
      rawTextHash: 'cached-raw',
      sourceMeta: { sectionFingerprints: fingerprint.sections },
    };
    const cacheRows = buildIntakeSectionCacheEntries(cachedIr).map((entry, index) => ({
      id: `cache-${index}`,
      label: entry.label,
      exact_hash: entry.exactHash,
      format_hash: entry.formatHash,
      char_length: entry.charLength,
      raw_text_hash: entry.rawTextHash,
      normalizer_version: entry.normalizerVersion,
      patch: entry.patch,
      hit_count: 0,
    }));

    const fakeSupabase = makeUploadSectionCacheSupabase(cacheRows);
    const result = await tryExtractUploadViaIr({
      rawText: raw,
      landOperator: 'supplier',
      commissionRate: 9,
      sb: fakeSupabase as never,
    });

    expect(result.ok).toBe(true);
    expect(vi.mocked(normalizeWithLlm).mock.calls[0][0].rawText).toContain('SECTION_CACHE_HIT label=header');
    expect(vi.mocked(normalizeWithLlm).mock.calls[0][0].rawText).toContain('SECTION_CACHE_HIT label=price');
    if (result.ok) {
      expect(result.products[0].extractedData.price_tiers?.[0]?.adult_price).toBe(889000);
      expect(result.products[0].extractedData._llm_meta?.section_cache_reduce_ready).toBe(true);
      expect(result.products[0].extractedData._llm_meta?.section_cache_reduced_chars).toBeGreaterThan(0);
    }
    expect(fakeSupabase.storedIntakes).toHaveLength(1);
    expect(fakeSupabase.storedSectionRows.length).toBeGreaterThan(cacheRows.length);
  });
});

function makeUploadSectionCacheSupabase(sectionRows: Array<Record<string, unknown>>) {
  const storedIntakes: unknown[] = [];
  const storedSectionRows = [...sectionRows];
  return {
    storedIntakes,
    storedSectionRows,
    from(table: string) {
      if (table === 'normalized_intakes') {
        return {
          select: () => ({
            eq: () => ({
              neq: () => ({
                order: () => ({
                  limit: () => ({
                    maybeSingle: async () => ({ data: null, error: null }),
                  }),
                }),
              }),
            }),
          }),
          insert: async (row: unknown) => {
            storedIntakes.push(row);
            return { error: null };
          },
        };
      }
      if (table === 'normalized_intake_section_cache') {
        return {
          select: () => {
            let filtered = [...storedSectionRows];
            return {
              eq(column: string, value: unknown) {
                filtered = filtered.filter(row => row[column] === value);
                return this;
              },
              maybeSingle: async () => ({ data: filtered[0] ?? null, error: null }),
            };
          },
          update: (values: Record<string, unknown>) => ({
            eq: (column: string, value: unknown) => {
              const row = storedSectionRows.find(candidate => candidate[column] === value);
              if (row) Object.assign(row, values);
              return { error: null };
            },
          }),
          upsert: async (rows: unknown[]) => {
            storedSectionRows.push(...(rows as Array<Record<string, unknown>>));
            return { error: null };
          },
        };
      }
      return {};
    },
  };
}
