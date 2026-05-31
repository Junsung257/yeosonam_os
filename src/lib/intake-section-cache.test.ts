import { afterEach, describe, expect, it } from 'vitest';
import type { NormalizedIntake } from './intake-normalizer';
import { splitSupplierFormatSections } from './supplier-format-fingerprint';
import {
  applyIntakeSectionCacheEntries,
  buildIntakeSectionCacheEntries,
  buildSectionCacheReducedRawText,
  evaluateSectionCacheCoverage,
  findReusableSectionEntry,
  lookupIntakeSectionCacheEntry,
  storeIntakeSectionCacheEntries,
} from './intake-section-cache';

function makeFakeSupabase() {
  const rows: unknown[] = [];
  return {
    rows,
    sb: {
      from: () => ({
        upsert: async (nextRows: unknown[]) => {
          rows.push(...nextRows.map((row, index) => ({ id: `row-${rows.length + index + 1}`, hit_count: 0, ...(row as object) })));
          return { error: null };
        },
        update: (values: Record<string, unknown>) => ({
          eq: (column: string, value: unknown) => {
            const row = rows.find(candidate => (candidate as Record<string, unknown>)[column] === value) as Record<string, unknown> | undefined;
            if (row) Object.assign(row, values);
            return { error: null };
          },
        }),
        select: () => ({
          eq: function eq(column: string, value: unknown) {
            rows.splice(0, rows.length, ...rows.filter(row => (row as Record<string, unknown>)[column] === value));
            return this;
          },
          maybeSingle: async () => ({ data: rows[0] ?? null, error: null }),
        }),
      }),
    },
  };
}

function makeIr(overrides: Partial<NormalizedIntake> = {}): NormalizedIntake {
  return {
    meta: {
      landOperator: 'supplier',
      region: 'region-a',
      country: 'country-a',
      tripStyle: '3N5D',
      productType: '패키지',
      commissionRate: 10,
      ticketingDeadline: null,
      minParticipants: 6,
      departureAirport: 'PUS',
      airline: 'LJ',
      departureDays: null,
    },
    flights: {
      outbound: [],
      inbound: [],
    },
    priceGroups: [
      {
        label: 'base',
        dates: ['2027-02-04'],
        dateRange: null,
        dayOfWeek: null,
        adultPrice: 889000,
        childPrice: 889000,
        confirmed: false,
        surchargeIncluded: false,
        surchargeNote: null,
      },
    ],
    hotels: [],
    inclusions: [],
    excludes: [],
    surcharges: [],
    optionalTours: [],
    days: [],
    notices: { manual: [], auto: [] },
    rawText: 'raw',
    rawTextHash: 'raw-hash-a',
    sourceEvidence: {},
    sourceMeta: {
      formatFingerprint: 'format-a',
      sectionFingerprints: [
        { label: 'price', hash: 'masked-price-hash', exactHash: 'exact-price-a', charLength: 50 },
      ],
    },
    normalizerVersion: 'ir-normalizer-test',
    extractedAt: '2026-05-31T00:00:00.000Z',
    ...overrides,
  };
}

describe('intake section cache', () => {
  afterEach(() => {
    delete process.env.RAW_UPLOAD_SECTION_CACHE_ENABLED;
    delete process.env.RAW_UPLOAD_SECTION_CACHE_REDUCE_INPUT;
  });

  it('builds reusable entries only from exact section hashes', () => {
    const entries = buildIntakeSectionCacheEntries(makeIr());

    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      label: 'price',
      formatHash: 'masked-price-hash',
      exactHash: 'exact-price-a',
      rawTextHash: 'raw-hash-a',
      normalizerVersion: 'ir-normalizer-test',
    });
    expect(entries[0].patch.priceGroups?.[0].adultPrice).toBe(889000);
  });

  it('does not reuse a section when only the masked format hash matches', () => {
    const entries = buildIntakeSectionCacheEntries(makeIr());
    const reusable = findReusableSectionEntry(
      entries,
      { label: 'price', exactHash: 'exact-price-b' },
      'ir-normalizer-test',
    );

    expect(reusable).toBeNull();
  });

  it('reuses a section only when label, exact hash, and normalizer version all match', () => {
    const entries = buildIntakeSectionCacheEntries(makeIr());

    expect(findReusableSectionEntry(
      entries,
      { label: 'price', exactHash: 'exact-price-a' },
      'ir-normalizer-test',
    )?.patch.priceGroups?.[0].adultPrice).toBe(889000);

    expect(findReusableSectionEntry(
      entries,
      { label: 'terms', exactHash: 'exact-price-a' },
      'ir-normalizer-test',
    )).toBeNull();

    expect(findReusableSectionEntry(
      entries,
      { label: 'price', exactHash: 'exact-price-a' },
      'ir-normalizer-next',
    )).toBeNull();
  });

  it('applies cached patches only to the matching section surface', () => {
    const base = makeIr({
      priceGroups: [],
      days: [],
      hotels: [],
      flights: { outbound: [], inbound: [] },
    });
    const source = makeIr({
      days: [
        {
          day: 1,
          regions: ['region-a'],
          flight: null,
          hotelName: null,
          meals: {
            breakfast: false,
            lunch: false,
            dinner: false,
            breakfastNote: null,
            lunchNote: null,
            dinnerNote: null,
          },
          segments: [],
        },
      ],
      hotels: [{ name: 'cached hotel', grade: '5성', nights: 3 }],
      flights: {
        outbound: [{ code: 'LJ115', departure: { time: '21:35', airport: 'PUS' }, arrival: { time: '00:25', airport: 'CXR' } }],
        inbound: [],
      },
      sourceMeta: {
        sectionFingerprints: [
          { label: 'price', hash: 'masked-price-hash', exactHash: 'exact-price-a', charLength: 50 },
          { label: 'itinerary', hash: 'masked-itinerary-hash', exactHash: 'exact-itinerary-a', charLength: 500 },
        ],
      },
    });
    const entries = buildIntakeSectionCacheEntries(source);

    const priceOnly = applyIntakeSectionCacheEntries(
      base,
      entries.filter(entry => entry.label === 'price'),
    );
    expect(priceOnly.priceGroups).toHaveLength(1);
    expect(priceOnly.days).toHaveLength(0);
    expect(priceOnly.flights.outbound).toHaveLength(0);

    const itineraryOnly = applyIntakeSectionCacheEntries(
      base,
      entries.filter(entry => entry.label === 'itinerary'),
    );
    expect(itineraryOnly.priceGroups).toHaveLength(0);
    expect(itineraryOnly.days).toHaveLength(1);
    expect(itineraryOnly.flights.outbound[0].code).toBe('LJ115');
  });

  it('requires the full customer-field matrix before LLM input reduction', () => {
    const source = makeIr({
      sourceMeta: {
        sectionFingerprints: [
          { label: 'header', hash: 'masked-header-hash', exactHash: 'exact-header-a', charLength: 300 },
          { label: 'price', hash: 'masked-price-hash', exactHash: 'exact-price-a', charLength: 50 },
        ],
      },
    });
    const entries = buildIntakeSectionCacheEntries(source);

    const priceOnly = evaluateSectionCacheCoverage(entries.filter(entry => entry.label === 'price'));
    expect(priceOnly.covered).toBe(1);
    expect(priceOnly.canReduceLlmInput).toBe(false);
    expect(priceOnly.missing).toContain('meta.region');

    const full = evaluateSectionCacheCoverage(entries);
    expect(full.covered).toBe(full.total);
    expect(full.missing).toHaveLength(0);
    expect(full.canReduceLlmInput).toBe(true);
  });

  it('reduces raw LLM input only when enabled and all required fields are covered', () => {
    const raw = `상품명: cached header
출발공항 부산 / 항공 LJ
출발편 LJ115 21:35 부산 출발 00:25 나트랑 도착
귀국편 LJ116 01:00 나트랑 출발 06:40 부산 도착
최소출발 6명 이상

요금표
성인 889,000원 / 아동 889,000원

공지
현지 사정에 따라 변경될 수 있습니다.`;
    const source = makeIr({
      sourceMeta: {
        sectionFingerprints: [
          { label: 'header', hash: 'masked-header-hash', exactHash: 'unused', charLength: 1 },
          { label: 'price', hash: 'masked-price-hash', exactHash: 'unused', charLength: 1 },
        ],
      },
    });
    const blocks = buildIntakeSectionCacheEntries({
      ...source,
      sourceMeta: {
        sectionFingerprints: [
          ...source.sourceMeta!.sectionFingerprints!,
        ],
      },
    });

    expect(buildSectionCacheReducedRawText(raw, blocks)).toBeNull();
    process.env.RAW_UPLOAD_SECTION_CACHE_REDUCE_INPUT = '1';
    expect(buildSectionCacheReducedRawText(raw, blocks)).toBeNull();

    const realBlocks = buildIntakeSectionCacheEntries({
      ...source,
      sourceMeta: {
        sectionFingerprints: splitSupplierFormatSections(raw),
      },
    });
    const reduced = buildSectionCacheReducedRawText(raw, realBlocks);

    expect(reduced?.reducedRawText).toContain('SECTION_CACHE_HIT label=header');
    expect(reduced?.reducedRawText).toContain('SECTION_CACHE_HIT label=price');
    expect(reduced?.reducedRawText).toContain('공지');
    expect(reduced?.replacedLabels).toEqual(['header', 'price']);
  });

  it('does not touch storage unless the section cache flag is enabled', async () => {
    const fake = makeFakeSupabase();
    const result = await storeIntakeSectionCacheEntries(
      fake.sb,
      buildIntakeSectionCacheEntries(makeIr()),
    );

    expect(result).toEqual({ attempted: false, stored: 0, warnings: [] });
    expect(fake.rows).toHaveLength(0);
  });

  it('stores and looks up exact section cache rows when enabled', async () => {
    process.env.RAW_UPLOAD_SECTION_CACHE_ENABLED = '1';
    const fake = makeFakeSupabase();
    const entries = buildIntakeSectionCacheEntries(makeIr());

    const stored = await storeIntakeSectionCacheEntries(fake.sb, entries);
    const hit = await lookupIntakeSectionCacheEntry(
      fake.sb,
      { label: 'price', exactHash: 'exact-price-a' },
      'ir-normalizer-test',
    );

    expect(stored).toEqual({ attempted: true, stored: 1, warnings: [] });
    expect(fake.rows).toHaveLength(1);
    expect(hit?.patch.priceGroups?.[0].adultPrice).toBe(889000);
    expect((fake.rows[0] as { hit_count?: number }).hit_count).toBe(1);
  });

  it('reports reduced characters and labels for telemetry', () => {
    process.env.RAW_UPLOAD_SECTION_CACHE_REDUCE_INPUT = '1';
    const raw = `상품명: cached header
출발공항 부산 / 항공 LJ
출발편 LJ115 21:35 부산 출발 00:25 나트랑 도착
귀국편 LJ116 01:00 나트랑 출발 06:40 부산 도착
최소출발 6명 이상

요금표
성인 889,000원 / 아동 889,000원`;
    const entries = buildIntakeSectionCacheEntries({
      ...makeIr(),
      sourceMeta: {
        sectionFingerprints: splitSupplierFormatSections(raw),
      },
    });

    const reduced = buildSectionCacheReducedRawText(raw, entries);

    expect(reduced?.reducedCharCount).toBeGreaterThan(0);
    expect(reduced?.replacedLabels).toEqual(['header', 'price']);
  });
});
