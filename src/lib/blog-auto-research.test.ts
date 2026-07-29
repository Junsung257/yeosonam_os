import { describe, expect, it, vi } from 'vitest';
import type { GroundingChunk } from '@google/genai';
import {
  augmentGuamFoodBudgetPayload,
  augmentGuamFamilyMealPayload,
  augmentGuamShoppingPayload,
  augmentGrtaAirportTransportPayload,
  buildBlogGroundingResearchPrompt,
  buildGuamCurrencyPaymentPayload,
  buildGuamHotelAreasPayload,
  buildBlogResearchBundleFromGrounding,
  buildBlogStructuredResearchPrompt,
  buildPagasaMonthlyWeatherPayload,
  buildWmoMonthlyWeatherPayload,
  extractReviewedPageTextForResearch,
  fetchReviewedDirectPages,
  sanitizeGroundedResearchPayload,
  selectReputableResearchRegistryForIntent,
} from '@/lib/blog-auto-research';
import { evaluateBlogGenerationResearchReadiness } from '@/lib/blog-generation-research';

const sourcePolicy = {
  minimumClaimSourceCoverage: 0.9,
  primarySourcesRequired: false,
  exactNumbersRequireSource: true,
  retrievedAtRequired: true,
  sourceTypes: ['reputable_price_source'],
};

const reputableRegistry = [
  {
    id: 'prices',
    hostname: 'example.com',
    sourceTypes: ['reputable_price_source' as const],
    intents: ['food_budget'],
    allowSubdomains: true,
  },
];

const priceEvidence = [
  ['절약 아침', '500'],
  ['일반 점심', '1200'],
  ['여유 저녁', '3000'],
  ['간식 카페', '700'],
  ['절약 점심', '900'],
  ['일반 저녁', '1800'],
  ['여유 아침', '1500'],
].map(([label, value], index) => ({
  sourceIndex: index % 2,
  excerpt: `2026년 일본 오사카 한국인 여행자 ${label} 식사 기준은 ${value} JPY 1끼이며 매장 조건을 확인해야 한다.`,
  sourceLocator: `price-${index + 1}`,
  claimType: 'price',
  riskLevel: 'MEDIUM',
  country: '일본',
  destination: '오사카',
  applicableTo: '한국인 여행자',
  normalizedValue: value,
  unit: '1끼',
  currency: 'JPY',
  validFrom: '2026-07-23T00:00:00.000Z',
  validUntil: '2026-08-20T00:00:00.000Z',
  conditions: ['매장별 가격 변동'],
}));

describe('buildBlogGroundingResearchPrompt', () => {
  it('prioritizes required decision facts and rejects contact-directory filler', () => {
    const prompt = buildBlogGroundingResearchPrompt({
      destination: '괌',
      locale: 'ko-KR',
      brief: {
        intentType: 'airport_transport',
        readerQuestion: '괌 공항에서 투몬까지 비용과 시간은?',
        sourcePolicy: {
          ...sourcePolicy,
          sourceTypes: ['airport', 'transport_operator', 'reputable_price_source'],
        },
        plan: {
          requiredFacts: [
            { id: 'airport_distance', label: '공항과 주요 숙박 지역 거리' },
            { id: 'transport_comparison', label: '교통수단별 요금과 소요시간' },
          ],
        },
      } as never,
      reviewedSources: ['rome2rio.com (reputable_price_source)'],
      now: new Date('2026-07-28T00:00:00.000Z'),
    });

    expect(prompt).toContain('Run separate searches for each required decision fact');
    expect(prompt).toContain('telephone numbers, email addresses, or street addresses');
    expect(prompt).toContain('at least two supported fare or price-range claims');
    expect(prompt).toContain('a taxi-company directory is not transport-cost evidence');
  });
});

describe('extractReviewedPageTextForResearch', () => {
  it('keeps airport and Tumon schedule evidence from late in a long document', () => {
    const text = [
      'general schedule '.repeat(1_200),
      'GIAA Departures, Airport 5:55',
      'GTA Upper Tumon 6:03',
      'fare one ride USD 1.50',
    ].join('\n');

    const extracted = extractReviewedPageTextForResearch(text);

    expect(extracted.length).toBeLessThanOrEqual(12_000);
    expect(extracted).toContain('GIAA Departures, Airport 5:55');
    expect(extracted).toContain('GTA Upper Tumon 6:03');
    expect(extracted).toContain('fare one ride USD 1.50');
  });
});

describe('fetchReviewedDirectPages', () => {
  it('shares an in-flight reviewed URL fetch across concurrent research candidates', async () => {
    const fetchMock = vi.fn(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
      return new Response(`<main>${'reviewed source content '.repeat(10)}</main>`, {
        status: 200,
        headers: { 'content-type': 'text/html' },
      });
    });
    vi.stubGlobal('fetch', fetchMock);
    const registry = [{
      hostname: 'example.com',
      allowSubdomains: false,
      researchUrls: ['https://example.com/research'],
    }];

    try {
      const [first, second] = await Promise.all([
        fetchReviewedDirectPages(registry),
        fetchReviewedDirectPages(registry),
      ]);
      expect(first.pages).toHaveLength(1);
      expect(second.pages).toHaveLength(1);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('retries a transient reviewed-source timeout once', async () => {
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new Error('The operation was aborted due to timeout'))
      .mockResolvedValueOnce(new Response(
        `<main>${'official climate source content '.repeat(10)}</main>`,
        {
          status: 200,
          headers: { 'content-type': 'text/html' },
        },
      ));
    vi.stubGlobal('fetch', fetchMock);
    const registry = [{
      hostname: 'weather.example',
      allowSubdomains: false,
      researchUrls: ['https://weather.example/climate'],
    }];

    try {
      const result = await fetchReviewedDirectPages(registry);
      expect(result.pages).toHaveLength(1);
      expect(result.failures).toHaveLength(0);
      expect(fetchMock).toHaveBeenCalledTimes(2);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe('selectReputableResearchRegistryForIntent', () => {
  it('keeps only intent- and destination-scoped reviewed documents before the fetch cap', () => {
    const registry = [
      {
        id: 'food-guam',
        hostname: 'menuguam.com',
        sourceTypes: ['reputable_price_source' as const],
        intents: ['food_budget', 'family_budget'],
        allowSubdomains: true,
        researchUrls: ['https://chinfe.menuguam.com/'],
        researchDestinations: ['괌'],
      },
      {
        id: 'shopping-guam',
        hostname: 'guamroute.com',
        sourceTypes: ['reputable_price_source' as const],
        intents: ['shopping_souvenirs'],
        allowSubdomains: true,
        researchUrls: ['https://guamroute.com/'],
        researchDestinations: ['괌'],
      },
      {
        id: 'food-osaka',
        hostname: 'example.jp',
        sourceTypes: ['reputable_price_source' as const],
        intents: ['food_budget'],
        allowSubdomains: false,
        researchUrls: ['https://example.jp/menu'],
        researchDestinations: ['오사카'],
      },
    ];

    expect(selectReputableResearchRegistryForIntent(registry, 'family_budget', '괌'))
      .toEqual([registry[0]]);
  });
});

describe('augmentGuamShoppingPayload', () => {
  it('adds deterministic official product-authenticity and purchase-location facts', () => {
    const payload = augmentGuamShoppingPayload([{
      url: 'https://www.visitguam.com/blog/post/3376/',
      title: 'Authentic Made in Guam Souvenirs',
      text: [
        'Look for the official Made in Guam product seal on the packaging.',
        'Chamorro Village includes Guam Art Boutique.',
        'The shop features jewelry, soaps, coconut oils, books, hand-woven accessories, gifts and souvenirs.',
      ].join(' '),
    }], '괌', {
      sources: [{
        sourceKey: 'visit-guam',
        groundingChunkIndex: 0,
        publisher: 'Guam Visitors Bureau',
        sourceType: 'official_tourism',
        claimTypes: ['factual'],
      }],
      evidence: [],
      claims: [],
    });

    expect(payload.claims?.filter((claim) => claim.claimType === 'factual')).toHaveLength(2);
    expect(payload.evidence?.map((item) => item.evidenceKey)).toEqual([
      'visit-guam-official-product-seal',
      'visit-guam-chamorro-village-products',
    ]);
    expect(payload.sources?.[0]).toMatchObject({
      sourceKey: 'visit-guam',
      groundingChunkIndex: 0,
      sourceType: 'official_tourism',
    });
  });
});

describe('augmentGrtaAirportTransportPayload', () => {
  const schedulePage = {
    url: 'https://grta.guam.gov/sites/default/files/master_-_fixed_route_schedule_updated112625.pdf',
    title: 'GRTA fixed route schedule',
    text: [
      'Route 14 stops: 8 GIAA Departures, Airport 9 Kmart Traffic Light 10 GTA Upper Tumon',
      'first run 85:55 96:00 106:03',
    ].join('\n'),
  };

  it('derives two airport durations only from the exact official schedule sequence', () => {
    const payload = augmentGrtaAirportTransportPayload([schedulePage], '괌', {
      sources: [{
        sourceKey: 's1',
        groundingChunkIndex: 0,
        publisher: 'GRTA',
        sourceType: 'transport_operator',
        claimTypes: ['duration'],
        country: '괌',
      }],
      evidence: [],
      claims: [],
    });

    expect(payload.evidence?.map((item) => item.normalizedValue)).toEqual(['5', '8']);
    expect(payload.claims?.map((item) => item.evidenceKeys?.[0])).toEqual([
      'grta-giaa-kmart-duration',
      'grta-giaa-upper-tumon-duration',
    ]);
    expect(payload.sources?.[0]).toMatchObject({
      sourceKey: 's1',
      groundingChunkIndex: 0,
      sourceType: 'transport_operator',
    });
  });

  it('does not infer durations when a published timetable value changes', () => {
    const payload = augmentGrtaAirportTransportPayload([{
      ...schedulePage,
      text: schedulePage.text.replace('106:03', '106:04'),
    }], '괌', {
      sources: [],
      evidence: [],
      claims: [],
    });

    expect(payload).toEqual({ sources: [], evidence: [], claims: [] });
  });

  it('preserves price claims when the model payload reaches the claim limit', () => {
    const originalClaims = Array.from({ length: 12 }, (_, index) => ({
      claimText: `claim ${index}`,
      claimType: index < 2 ? 'price' : 'factual',
      evidenceKeys: [`e${index}`],
    }));
    const payload = augmentGrtaAirportTransportPayload([schedulePage], 'Guam', {
      sources: [],
      evidence: originalClaims.map((claim, index) => ({
        evidenceKey: claim.evidenceKeys[0],
        sourceKey: 'other',
        excerpt: claim.claimText,
        claimType: claim.claimType,
        normalizedValue: String(index),
      })),
      claims: originalClaims,
    });

    expect(payload.claims).toHaveLength(12);
    expect(payload.claims?.filter((claim) => claim.claimType === 'duration')).toHaveLength(2);
    expect(payload.claims?.filter((claim) => claim.claimType === 'price')).toHaveLength(2);
  });

  it('prefers the current GRTA fare sheet over conflicting tourism-summary bus fares', () => {
    const evidence = (evidenceKey: string, sourceKey: string, excerpt: string, value: string) => ({
      evidenceKey,
      sourceKey,
      excerpt,
      claimType: 'price',
      normalizedValue: value,
      currency: 'USD',
    });
    const claim = (evidenceKey: string, claimText: string, value: string) => ({
      claimText,
      claimType: 'price',
      evidenceKeys: [evidenceKey],
      normalizedValue: value,
      currency: 'USD',
    });
    const payload = augmentGrtaAirportTransportPayload([
      schedulePage,
      {
        url: 'https://grta.guam.gov/sites/default/files/grta_bus_pass_sales_information_sheet.pdf',
        title: 'GRTA fare sheet',
        text: 'One Day Pass USD 4.00',
      },
      {
        url: 'https://www.visitguam.com/transportation',
        title: 'Tourism transport summary',
        text: 'Bus daily pass USD 3.00. Taxi starts at USD 2.40.',
      },
    ], '괌', {
      sources: [
        { sourceKey: 'schedule', groundingChunkIndex: 0, sourceType: 'transport_operator' },
        { sourceKey: 'fare', groundingChunkIndex: 1, sourceType: 'transport_operator' },
        { sourceKey: 'tourism', groundingChunkIndex: 2, sourceType: 'official_tourism' },
      ],
      evidence: [
        evidence('current-bus', 'fare', '괌 버스 일반 1일권은 4.00 USD이다.', '4.00'),
        evidence('old-bus', 'tourism', '괌 버스 일반 하루 이용권은 3.00 USD이다.', '3.00'),
        evidence('taxi', 'tourism', '괌 택시 기본요금은 2.40 USD이다.', '2.40'),
      ],
      claims: [
        claim('current-bus', '괌 버스 일반 1일권은 4.00 USD이다.', '4.00'),
        claim('old-bus', '괌 버스 일반 하루 이용권은 3.00 USD이다.', '3.00'),
        claim('taxi', '괌 택시 기본요금은 2.40 USD이다.', '2.40'),
      ],
    });

    expect(payload.claims?.map((item) => item.normalizedValue)).toEqual(['5', '8', '4.00', '2.40']);
    expect(payload.evidence?.some((item) => item.evidenceKey === 'old-bus')).toBe(false);
  });
});

describe('sanitizeGroundedResearchPayload', () => {
  it('removes off-intent and value-mismatched model output while preserving linked evidence', () => {
    const payload = sanitizeGroundedResearchPayload({
      sources: [
        { sourceKey: 's1', groundingChunkIndex: 0, sourceType: 'official_tourism' },
        { sourceKey: 's2', groundingChunkIndex: 1, sourceType: 'official_tourism' },
      ],
      evidence: [
        {
          evidenceKey: 'e1',
          sourceKey: 's1',
          excerpt: '괌 어린이 수족관 입장료는 12 USD이다.',
          claimType: 'price',
          normalizedValue: '12',
          currency: 'USD',
        },
        {
          evidenceKey: 'e2',
          sourceKey: 's2',
          excerpt: '괌의 연평균 기온은 27도이다.',
          claimType: 'climate',
          normalizedValue: '27',
          unit: '°C',
        },
      ],
      claims: [
        {
          claimText: '괌 어린이 수족관 입장료는 12 USD이다.',
          claimType: 'price',
          evidenceKeys: ['e1'],
          normalizedValue: '12',
          currency: 'USD',
        },
        {
          claimText: '괌 어린이 수족관 입장료는 13 USD이다.',
          claimType: 'price',
          evidenceKeys: ['e1'],
          normalizedValue: '13',
          currency: 'USD',
        },
        {
          claimText: '괌의 연평균 기온은 27도이다.',
          claimType: 'climate',
          evidenceKeys: ['e2'],
          normalizedValue: '27',
          unit: '°C',
        },
      ],
    }, 'itinerary');

    expect(payload.sources?.map((source) => source.sourceKey)).toEqual(['s1']);
    expect(payload.evidence?.map((evidence) => evidence.evidenceKey)).toEqual(['e1']);
    expect(payload.claims?.map((claim) => claim.normalizedValue)).toEqual(['12']);
  });
});

describe('augmentGuamFoodBudgetPayload', () => {
  it('adds the exact reviewed breakfast sample and deterministic comparison tiers', () => {
    const payload = augmentGuamFoodBudgetPayload([{
      url: 'https://chinfe.menuguam.com/',
      title: 'House of Chin Fe menu',
      text: [
        'Breakfast Weekdays 6:30 AM - 10:30 AM Weekends 6:30 AM - 01:30 PM',
        'Corned Beef Fried Rice $14.50',
        'Beverages Coffee* $2.50',
      ].join(' '),
    }], '괌', {
      sources: [{
        sourceKey: 'rootz',
        groundingChunkIndex: 0,
        sourceType: 'reputable_price_source',
      }],
      evidence: [
        { evidenceKey: 'e1', sourceKey: 'rootz', excerpt: '간식 12 USD', claimType: 'price', normalizedValue: '12', currency: 'USD' },
        { evidenceKey: 'e2', sourceKey: 'rootz', excerpt: '점심 38 USD', claimType: 'price', normalizedValue: '38', currency: 'USD' },
        { evidenceKey: 'e3', sourceKey: 'rootz', excerpt: '저녁 55 USD', claimType: 'price', normalizedValue: '55', currency: 'USD' },
      ],
      claims: [
        { claimText: '[간식] 가격 12 USD', claimType: 'price', evidenceKeys: ['e1'], normalizedValue: '12', currency: 'USD' },
        { claimText: '[점심] 가격 38 USD', claimType: 'price', evidenceKeys: ['e2'], normalizedValue: '38', currency: 'USD' },
        { claimText: '[저녁] 가격 55 USD', claimType: 'price', evidenceKeys: ['e3'], normalizedValue: '55', currency: 'USD' },
      ],
    });
    const claimText = payload.claims?.map((claim) => claim.claimText).join('\n') ?? '';

    expect(claimText).toContain('아침');
    expect(claimText).toContain('14.50 USD');
    expect(claimText).toContain('간식');
    expect(claimText).toContain('2.50 USD');
    expect(claimText).toContain('절약');
    expect(claimText).toContain('일반');
    expect(claimText).toContain('여유');
    expect(payload.evidence?.some((evidence) =>
      evidence.evidenceKey === 'chin-fe-breakfast-corned-beef-rice')).toBe(true);
    expect(payload.evidence?.some((evidence) =>
      evidence.evidenceKey === 'chin-fe-snack-coffee')).toBe(true);
  });
});

describe('augmentGuamFamilyMealPayload', () => {
  it('adds one exact checked-date meal sample without editorial price tiers', () => {
    const payload = augmentGuamFamilyMealPayload([{
      url: 'https://chinfe.menuguam.com/',
      title: 'House of Chin Fe menu',
      text: 'Breakfast Corned Beef Fried Rice $14.50',
    }], '괌', { sources: [], evidence: [], claims: [] });

    expect(payload.claims).toHaveLength(1);
    expect(payload.claims?.[0]?.claimText).toContain('가족 식사 예산');
    expect(payload.claims?.[0]?.claimText).toContain('14.50 USD');
    expect(payload.claims?.[0]?.claimText).not.toMatch(/절약|일반|여유/);
  });
});

describe('buildGuamHotelAreasPayload', () => {
  it('builds checked-date nightly samples and named-area facts from two reviewed domains', () => {
    const payload = buildGuamHotelAreasPayload([
      {
        url: 'https://www.booking.com/family/country/gu.ko.html',
        title: '괌 가족 호텔',
        text: [
          '투몬가족 호텔 12개 타무닝가족 호텔 5개',
          'The Tsubaki Tower투몬 가족 호텔 설명 더 보기1박 최저 ₩543,251',
          'Slice of Paradise with Private BeachAgat 가족 호텔 설명 더 보기1박 최저 ₩425,791',
          'Ocean View Agat Marina Private AccommodationAgat 가족 호텔 설명 더 보기1박 최저 ₩536,497',
        ].join(' '),
      },
      {
        url: 'https://www.agoda.com/ko-kr/travel-guides/guam/where-to-stay-in-guam-best-hotels/',
        title: '괌 숙소 추천',
        text: '힐튼 괌 리조트 앤 스파는 투몬 베이 남쪽 끝자락에 있으며 어린이 전용 키즈풀이 있다.',
      },
    ], '괌');

    expect(payload?.sources).toHaveLength(2);
    expect(payload?.claims?.filter((claim) => claim.claimType === 'price')).toHaveLength(3);
    expect(payload?.claims?.filter((claim) => claim.claimType === 'factual')).toHaveLength(3);
    expect(payload?.claims?.map((claim) => claim.claimText).join('\n')).toContain('1박');
    expect(payload?.claims?.map((claim) => claim.claimText).join('\n')).toContain('투몬');
    expect(payload?.evidence?.every((evidence) => evidence.conditions?.length)).toBe(true);
  });

  it('fails closed when either reviewed domain or an exact source phrase is missing', () => {
    expect(buildGuamHotelAreasPayload([{
      url: 'https://www.booking.com/family/country/gu.ko.html',
      title: '괌 가족 호텔',
      text: '투몬가족 호텔 12개 타무닝가족 호텔 5개',
    }], '괌')).toBeNull();
  });
});

describe('buildGuamCurrencyPaymentPayload', () => {
  it('builds currency, cash denomination, and credit-card facts from official pages', () => {
    const payload = buildGuamCurrencyPaymentPayload([
      {
        url: 'https://www.usa.gov/currency',
        title: 'American money',
        text: [
          'The United States dollar is the official currency of the U.S. and its territories.',
          'American paper currency comes in seven denominations: $1, $2, $5, $10, $20, $50, and $100.',
          'United States coin denominations include 1¢, 5¢, 10¢, 25¢, 50¢, and $1.',
        ].join(' '),
      },
      {
        url: 'https://www.visitguam.com/smscormoranguam/sms-diving-in-guam/',
        title: 'Diving in Guam',
        text: 'Money: Guam is a U.S. territory and uses the U.S. dollar. Major credit cards are accepted.',
      },
    ], '괌');

    expect(payload?.sources?.map((source) => source.sourceType)).toEqual([
      'government',
      'official_tourism',
    ]);
    expect(payload?.claims?.filter((claim) => claim.claimType === 'currency')).toHaveLength(1);
    expect(payload?.claims?.filter((claim) => claim.claimType === 'factual')).toHaveLength(3);
    expect(payload?.claims?.map((claim) => claim.claimText).join('\n')).toMatch(/신용카드|credit card/i);
  });

  it('fails closed when the official card-acceptance statement is absent', () => {
    expect(buildGuamCurrencyPaymentPayload([
      {
        url: 'https://www.usa.gov/currency',
        title: 'American money',
        text: 'The United States dollar is the official currency of the U.S. and its territories.',
      },
      {
        url: 'https://www.visitguam.com/smscormoranguam/sms-diving-in-guam/',
        title: 'Diving in Guam',
        text: 'Guam information',
      },
    ], '괌')).toBeNull();
  });
});

describe('buildBlogStructuredResearchPrompt', () => {
  const base = {
    destination: '괌',
    locale: 'ko-KR',
    digest: 'reviewed extracts',
    sourceCatalog: [],
    now: new Date('2026-07-28T00:00:00.000Z'),
  };

  it('prioritizes semantic food slots before beverage filler', () => {
    const prompt = buildBlogStructuredResearchPrompt({
      ...base,
      brief: {
        intentType: 'food_budget',
        sourcePolicy,
        plan: { requiredFacts: [] },
      } as never,
    });

    expect(prompt).toContain('Choose supported meal prices before beverages');
    expect(prompt).toContain('explicit breakfast, lunch, dinner, and snack/cafe samples');
    expect(prompt).toContain('절약, 일반, 여유, 아침, 점심, 저녁, 간식');
  });

  it('prioritizes transport durations and insurance coverage over marketing filler', () => {
    const transportPrompt = buildBlogStructuredResearchPrompt({
      ...base,
      brief: {
        intentType: 'airport_transport',
        sourcePolicy,
        plan: { requiredFacts: [] },
      } as never,
    });
    const insurancePrompt = buildBlogStructuredResearchPrompt({
      ...base,
      brief: {
        intentType: 'travel_insurance',
        sourcePolicy,
        plan: { requiredFacts: [] },
      } as never,
    });

    expect(transportPrompt).toContain('two route-duration claims');
    expect(transportPrompt).toContain('vehicle marketing');
    expect(insurancePrompt).toContain('at least four insurance claims');
    expect(insurancePrompt).toContain('Exclude signup discounts');
  });

  it('rejects resident-cost and generic-shopping filler for family, itinerary, and souvenir research', () => {
    const promptFor = (intentType: string) => buildBlogStructuredResearchPrompt({
      ...base,
      brief: {
        intentType,
        sourcePolicy,
        plan: { requiredFacts: [] },
      } as never,
    });

    expect(promptFor('family_budget')).toContain('Exclude rent, gym membership, preschool tuition');
    expect(promptFor('family_budget')).toContain('newest reviewed official operator fare sheet');
    expect(promptFor('itinerary')).toContain('A visa stay limit is not an itinerary duration');
    expect(promptFor('shopping_souvenirs')).toContain('Exclude generic clothing, shoes, rent, restaurant');
    expect(promptFor('hotel_areas')).toContain('nightly price samples');
  });

  it('turns validation issues into a compact semantic retry contract', () => {
    const prompt = buildBlogStructuredResearchPrompt({
      ...base,
      brief: {
        intentType: 'food_budget',
        sourcePolicy,
        plan: { requiredFacts: [] },
      } as never,
      retry: true,
      retryIssues: [
        'claim_semantic_coverage_missing:food_budget:breakfast',
        'claim_semantic_coverage_missing:food_budget:dinner',
      ],
    });

    expect(prompt).toContain('Keep every evidence excerpt and claimText under 240 characters');
    expect(prompt).toContain('Return a smaller valid JSON object');
    expect(prompt).toContain('claim_semantic_coverage_missing:food_budget:breakfast');
  });
});

describe('buildBlogResearchBundleFromGrounding', () => {
  it('builds a publish-gate-ready low-risk bundle only from grounded URLs', () => {
    const groundingChunks: GroundingChunk[] = [
      { web: { uri: 'https://prices.example.com/osaka-breakfast', title: 'Osaka price guide' } },
      { web: { uri: 'https://local.example.com/osaka-meals', title: 'Osaka local prices' } },
    ];
    const result = buildBlogResearchBundleFromGrounding({
      contentKey: 'osaka-food-budget',
      destination: '오사카',
      locale: 'ko-KR',
      brief: { sourcePolicy, intentType: 'food_budget' },
      payload: {
        sources: [
          {
            groundingChunkIndex: 0,
            publisher: 'Price source',
            sourceType: 'reputable_price_source',
            claimTypes: ['price'],
            country: '일본',
            destination: '오사카',
          },
          {
            groundingChunkIndex: 1,
            publisher: 'Local source',
            sourceType: 'reputable_price_source',
            claimTypes: ['price'],
            country: '일본',
            destination: '오사카',
          },
        ],
        evidence: priceEvidence,
        claims: priceEvidence.map((evidence, index) => ({
          claimText: evidence.excerpt,
          claimType: 'price',
          riskLevel: 'MEDIUM',
          evidenceIndexes: [index],
          normalizedValue: evidence.normalizedValue,
          unit: evidence.unit,
          currency: evidence.currency,
        })),
      },
      groundingChunks,
      reputableRegistry,
      now: new Date('2026-07-23T12:00:00.000Z'),
    });

    expect(result.issues).toEqual([]);
    expect(result.bundle?.sources).toHaveLength(2);
    expect(result.bundle?.sources.every((source) => source.authorityLevel === 'editorial_secondary')).toBe(true);

    const readiness = evaluateBlogGenerationResearchReadiness({
      meta: { information_research_bundle: result.bundle },
      expectedContentKey: 'osaka-food-budget',
      destination: '오사카',
      intent: 'food_budget',
      locale: 'ko-KR',
      sourcePolicy,
      now: new Date('2026-07-23T12:00:00.000Z'),
    });
    expect(readiness.passed).toBe(true);
    expect(readiness.summary.claimSourceCoverage).toBe(1);
  });

  it('rejects a source URL that was not present in grounding metadata', () => {
    const result = buildBlogResearchBundleFromGrounding({
      contentKey: 'osaka-food-budget',
      destination: '오사카',
      locale: 'ko-KR',
      brief: { sourcePolicy, intentType: 'food_budget' },
      payload: {
        sources: [{
          groundingChunkIndex: 9,
          publisher: 'Invented source',
          sourceType: 'reputable_price_source',
          claimTypes: ['price'],
          country: '일본',
          destination: '오사카',
        }],
        evidence: priceEvidence.slice(0, 1),
        claims: [],
      },
      groundingChunks: [
        { web: { uri: 'https://prices.example.com/osaka', title: 'Osaka prices' } },
      ],
      now: new Date('2026-07-23T12:00:00.000Z'),
    });

    expect(result.bundle).toBeNull();
    expect(result.issues).toContain('source_rejected:0');
  });

  it('uses stable payload keys and locks evidence to the requested destination', () => {
    const result = buildBlogResearchBundleFromGrounding({
      contentKey: 'cebu-food-budget',
      destination: '세부',
      locale: 'ko-KR',
      brief: { sourcePolicy, intentType: 'food_budget' },
      payload: {
        sources: [{
          sourceKey: 's1',
          groundingChunkIndex: 0,
          publisher: 'Cebu menu',
          sourceType: 'restaurant_menu',
          claimTypes: ['price'],
          country: '필리핀',
          destination: 'Cebu',
        }],
        evidence: [{
          evidenceKey: 'e1',
          sourceKey: 's1',
          excerpt: '2026 Cebu breakfast budget is PHP 150 per meal.',
          claimType: 'price',
          country: '필리핀',
          destination: 'Cebu',
          applicableTo: '여행자',
          normalizedValue: '150',
          unit: '1끼',
          currency: 'PHP',
          conditions: ['menu checked online'],
        }],
        claims: [{
          claimText: 'Budget breakfast costs PHP 150.',
          claimType: 'price',
          evidenceKeys: ['e1'],
          normalizedValue: '150',
          unit: '1끼',
          currency: 'PHP',
        }],
      },
      groundingChunks: [
        { web: { uri: 'https://menu.example.com/cebu', title: 'Cebu menu' } },
      ],
      reputableRegistry,
      now: new Date('2026-07-23T12:00:00.000Z'),
    });

    expect(result.bundle?.evidence[0]?.scope?.destination).toBe('세부');
    expect(result.bundle?.claims[0]?.evidenceKeys).toEqual([
      result.bundle?.evidence[0]?.evidenceKey,
    ]);
  });

  it('rejects an official source label when the URL has no reviewed registry match', () => {
    const result = buildBlogResearchBundleFromGrounding({
      contentKey: 'guam-airport',
      destination: '괌',
      locale: 'ko-KR',
      brief: {
        sourcePolicy: {
          ...sourcePolicy,
          primarySourcesRequired: true,
          sourceTypes: ['airport'],
        },
      },
      payload: {
        sources: [{
          sourceKey: 's1',
          groundingChunkIndex: 0,
          publisher: 'Unreviewed airport label',
          sourceType: 'airport',
          claimTypes: ['duration'],
          country: '괌',
        }],
        evidence: [{
          evidenceKey: 'e1',
          sourceKey: 's1',
          excerpt: '괌 공항에서 투몬까지 이동 시간은 15분이다.',
          claimType: 'duration',
          normalizedValue: '15',
          unit: '분',
        }],
        claims: [],
      },
      groundingChunks: [
        { web: { uri: 'https://personal.example.com/guam-airport', title: 'Personal page' } },
      ],
      officialRegistry: [],
      now: new Date('2026-07-23T12:00:00.000Z'),
    });

    expect(result.bundle).toBeNull();
    expect(result.issues).toContain('source_rejected:0:official_registry_required:airport');
  });

  it('rejects a reputable source label when the URL has no reviewed registry match', () => {
    const result = buildBlogResearchBundleFromGrounding({
      contentKey: 'osaka-food-budget',
      destination: 'Osaka',
      locale: 'ko-KR',
      brief: { sourcePolicy, intentType: 'food_budget' },
      payload: {
        sources: [{
          sourceKey: 's1',
          groundingChunkIndex: 0,
          publisher: 'Unreviewed price site',
          sourceType: 'reputable_price_source',
          claimTypes: ['price'],
          country: 'Japan',
          destination: 'Osaka',
        }],
        evidence: [{
          evidenceKey: 'e1',
          sourceKey: 's1',
          excerpt: 'A 2026 Osaka meal price is JPY 500 per person.',
          claimType: 'price',
          normalizedValue: '500',
          unit: 'per person',
          currency: 'JPY',
        }],
        claims: [],
      },
      groundingChunks: [
        { web: { uri: 'https://prices.invalid.example/osaka', title: 'Unreviewed prices' } },
      ],
      reputableRegistry: [],
      now: new Date('2026-07-23T12:00:00.000Z'),
    });

    expect(result.bundle).toBeNull();
    expect(result.issues).toContain(
      'source_rejected:0:reputable_registry_required:reputable_price_source',
    );
  });

  it('corrects a model source label only to a reviewed type allowed by policy', () => {
    const result = buildBlogResearchBundleFromGrounding({
      contentKey: 'guam-hotel-areas',
      destination: '괌',
      locale: 'ko-KR',
      brief: {
        intentType: 'hotel_areas',
        sourcePolicy: {
          ...sourcePolicy,
          sourceTypes: ['reputable_booking_data', 'reputable_local_source'],
        },
      },
      payload: {
        sources: [{
          sourceKey: 's1',
          groundingChunkIndex: 0,
          publisher: 'Booking source',
          sourceType: 'reputable_local_source',
          claimTypes: ['price'],
          country: '괌',
        }],
        evidence: [{
          evidenceKey: 'e1',
          sourceKey: 's1',
          excerpt: '2026년 괌 여행자의 가족 호텔 1박 최저가는 279406 KRW이다.',
          claimType: 'price',
          country: '괌',
          applicableTo: '괌 여행자',
          normalizedValue: '279406',
          unit: '1박',
          currency: 'KRW',
        }],
        claims: [{
          claimText: '2026년 괌 가족 호텔 1박 최저가는 279406 KRW이다.',
          claimType: 'price',
          evidenceKeys: ['e1'],
          normalizedValue: '279406',
          unit: '1박',
          currency: 'KRW',
        }],
      },
      groundingChunks: [{
        web: { uri: 'https://www.booking.com/family/country/gu.ko.html', title: 'Guam family hotels' },
      }],
      reputableRegistry: [{
        id: 'booking',
        hostname: 'booking.com',
        sourceTypes: ['reputable_price_source'],
        intents: ['hotel_areas'],
        allowSubdomains: true,
      }],
      now: new Date('2026-07-28T00:00:00.000Z'),
    });

    expect(result.bundle?.sources[0]?.sourceType).toBe('reputable_price_source');
    expect(result.issues).toEqual([]);
  });

  it('uses the reviewed source jurisdiction for territory-scoped official evidence', () => {
    const result = buildBlogResearchBundleFromGrounding({
      contentKey: 'guam-entry',
      destination: '괌',
      locale: 'ko-KR',
      brief: {
        intentType: 'entry_requirements',
        sourcePolicy: {
          ...sourcePolicy,
          primarySourcesRequired: true,
          sourceTypes: ['government'],
        },
      },
      payload: {
        sources: [{
          sourceKey: 's1',
          groundingChunkIndex: 0,
          publisher: 'US Government',
          sourceType: 'government',
          claimTypes: ['entry_visa'],
          country: '미국',
        }],
        evidence: [{
          evidenceKey: 'e1',
          sourceKey: 's1',
          excerpt: '2026년 미국 괌의 대한민국 여권 관광객은 공식 입국 규정을 확인해야 한다.',
          claimType: 'entry_visa',
          country: '괌',
          applicableTo: '대한민국 여권 관광객',
          normalizedValue: '공식 입국 규정 확인',
        }],
        claims: [{
          claimText: '대한민국 여권 관광객은 괌 공식 입국 규정을 확인해야 한다.',
          claimType: 'entry_visa',
          evidenceKeys: ['e1'],
          normalizedValue: '공식 입국 규정 확인',
        }],
      },
      groundingChunks: [{
        web: { uri: 'https://www.ecfr.gov/current/title-8', title: 'eCFR Title 8' },
      }],
      officialRegistry: [{
        id: 'ecfr',
        hostname: 'ecfr.gov',
        sourceType: 'government',
        authorityLevel: 'official_primary',
        allowSubdomains: true,
      }],
      now: new Date('2026-07-28T00:00:00.000Z'),
    });

    expect(result.bundle?.sources[0]?.country).toBe('미국');
    expect(result.bundle?.evidence[0]?.scope?.country).toBe('미국');
    expect(result.issues.some((issue) => issue.includes('country_mismatch'))).toBe(false);
  });

  it('keeps evidence spans valid after Unicode normalization', () => {
    const result = buildBlogResearchBundleFromGrounding({
      contentKey: 'osaka-food-budget',
      destination: 'Osaka',
      locale: 'ko-KR',
      brief: { sourcePolicy, intentType: 'food_budget' },
      payload: {
        sources: [{
          sourceKey: 's1',
          groundingChunkIndex: 0,
          publisher: 'Reviewed price site',
          sourceType: 'reputable_price_source',
          claimTypes: ['price'],
          country: 'Japan',
          destination: 'Osaka',
        }],
        evidence: [{
          evidenceKey: 'e1',
          sourceKey: 's1',
          excerpt: 'Osaka meal price is ＪＰＹ ５００ per person.',
          claimType: 'price',
          normalizedValue: '500',
          unit: 'per person',
          currency: 'JPY',
        }],
        claims: [{
          claimText: 'Osaka meal price is JPY 500 per person.',
          claimType: 'price',
          evidenceKeys: ['e1'],
          normalizedValue: '500',
          unit: 'per person',
          currency: 'JPY',
        }],
      },
      groundingChunks: [
        { web: { uri: 'https://prices.example.com/osaka', title: 'Reviewed prices' } },
      ],
      reputableRegistry,
      now: new Date('2026-07-23T12:00:00.000Z'),
    });

    expect(result.issues.some((issue) => issue.includes('snapshot_span_mismatch'))).toBe(false);
    expect(result.bundle?.evidence[0]?.excerpt).toContain('JPY 500');
  });

  it('grants official authority only for an exact reviewed hostname and type', () => {
    const result = buildBlogResearchBundleFromGrounding({
      contentKey: 'guam-airport',
      destination: '괌',
      locale: 'ko-KR',
      brief: {
        sourcePolicy: {
          ...sourcePolicy,
          primarySourcesRequired: true,
          sourceTypes: ['airport'],
        },
      },
      payload: {
        sources: [{
          sourceKey: 's1',
          groundingChunkIndex: 0,
          publisher: 'Guam Airport',
          sourceType: 'airport',
          claimTypes: ['duration'],
          country: '괌',
        }],
        evidence: [{
          evidenceKey: 'e1',
          sourceKey: 's1',
          excerpt: '2026년 괌 공항의 공식 교통 안내 확인 대상은 한국인 여행자이며 1개 도착 택시 승강장을 안내한다.',
          claimType: 'duration',
          normalizedValue: '1',
          unit: '승강장',
        }],
        claims: [{
          claimText: '괌 공항은 도착 택시 승강장 1개 위치를 안내한다.',
          claimType: 'duration',
          evidenceKeys: ['e1'],
          normalizedValue: '1',
          unit: '승강장',
        }],
      },
      groundingChunks: [
        { web: { uri: 'https://www.guamairport.com/passenger/ground-transportation', title: 'Guam Airport' } },
      ],
      officialRegistry: [{
        id: 'registry-guam-airport',
        hostname: 'guamairport.com',
        sourceType: 'airport',
        authorityLevel: 'official_primary',
        allowSubdomains: true,
      }],
      now: new Date('2026-07-23T12:00:00.000Z'),
    });

    expect(result.bundle?.sources[0]?.authorityLevel).toBe('official_primary');
  });
});

describe('buildWmoMonthlyWeatherPayload', () => {
  it('extracts all 12 monthly climate rows without model truncation', () => {
    const climateMonth = Array.from({ length: 12 }, (_, index) => ({
      month: index + 1,
      maxTemp: String(29 + index / 10),
      minTemp: String(24 + index / 10),
      raindays: String(18 + index / 10),
      rainfall: String(100 + index * 20),
    }));
    const payload = buildWmoMonthlyWeatherPayload([
      {
        url: 'https://worldweather.wmo.int/kr/city.html?cityId=1954',
        title: 'WMO Guam city page',
        text: '괌의 공식 기후 페이지입니다.',
      },
      {
        url: 'https://worldweather.wmo.int/kr/json/1954_kr.xml',
        title: 'WMO Guam climate',
        text: JSON.stringify({
          city: {
            cityName: '아가냐, 괌',
            member: { memName: '미국', orgName: '미국기상청' },
            climate: {
              datab: 1981,
              datae: 2010,
              climateMonth,
            },
          },
        }),
      },
    ], '괌');

    expect(payload?.evidence).toHaveLength(12);
    expect(payload?.claims).toHaveLength(12);
    expect(payload?.claims?.[0]?.claimText).toContain(
      '1981~2010 평년값: 1월 최고기온 29°C, 최저기온 24°C, 강수량 100mm, 강수일수 18일',
    );
    expect(payload?.evidence?.[0]).toMatchObject({
      normalizedValue: '29|24|100|18',
      unit: '월별 기후 지표',
    });
    expect(payload?.claims?.[0]).toMatchObject({
      normalizedValue: '29|24|100|18',
      unit: '월별 기후 지표',
    });
    expect(payload?.claims?.[11]?.claimText).toContain('12월');
  });

  it('refuses an incomplete monthly source', () => {
    const payload = buildWmoMonthlyWeatherPayload([{
      url: 'https://worldweather.wmo.int/kr/json/1954_kr.xml',
      title: 'WMO Guam climate',
      text: JSON.stringify({
        city: {
          cityName: '아가냐, 괌',
          member: { memName: '미국', orgName: '미국기상청' },
          climate: {
            datab: 1981,
            datae: 2010,
            climateMonth: [{ month: 1, maxTemp: '29', minTemp: '24', raindays: '18', rainfall: '100' }],
          },
        },
      }),
    }], '괌');

    expect(payload).toBeNull();
  });

  it('selects only the WMO feed that matches the requested destination', () => {
    const climateMonth = Array.from({ length: 12 }, (_, index) => ({
      month: index + 1,
      maxTemp: String(10 + index),
      minTemp: String(2 + index),
      raindays: String(5 + index),
      rainfall: String(30 + index),
    }));
    const page = (cityName: string, cityId: number) => ({
      url: `https://worldweather.wmo.int/kr/json/${cityId}_kr.xml`,
      title: `WMO ${cityName} climate`,
      text: JSON.stringify({
        city: {
          cityName,
          member: { memName: cityName === '도쿄' ? '일본' : '태국', orgName: '공식 기상기관' },
          climate: { datab: 1991, datae: 2020, climateMonth },
        },
      }),
    });

    const payload = buildWmoMonthlyWeatherPayload([
      page('방콕', 233),
      page('도쿄', 183),
    ], '도쿄');

    expect(payload?.sources?.[0]?.destination).toBe('도쿄');
    expect(payload?.sources?.[0]?.country).toBe('일본');
    expect(payload?.evidence?.every((evidence) => evidence.destination === '도쿄')).toBe(true);
  });

  it('refuses a complete WMO feed for a different destination', () => {
    const climateMonth = Array.from({ length: 12 }, (_, index) => ({
      month: index + 1,
      maxTemp: '30',
      minTemp: '24',
      raindays: '12',
      rainfall: '100',
    }));
    const payload = buildWmoMonthlyWeatherPayload([{
      url: 'https://worldweather.wmo.int/kr/json/233_kr.xml',
      title: 'WMO Bangkok climate',
      text: JSON.stringify({
        city: {
          cityName: '방콕',
          member: { memName: '태국', orgName: '태국 기상청' },
          climate: { datab: 1961, datae: 1990, climateMonth },
        },
      }),
    }], '도쿄');

    expect(payload).toBeNull();
  });
});

const PAGASA_MACTAN_ROWS = [
  'JAN135.11229.724.026.8',
  'FEB88.9930.024.027.0',
  'MAR60.9731.024.627.8',
  'APR55.6532.225.528.8',
  'MAY94.4932.826.029.4',
  'JUN180.71332.325.528.9',
  'JUL210.61531.625.128.3',
  'AUG157.91331.925.228.5',
  'SEP190.41431.925.028.4',
  'OCT207.61531.424.928.2',
  'NOV131.01231.025.028.0',
  'DEC171.91430.324.627.4',
];

describe('buildPagasaMonthlyWeatherPayload', () => {
  it('extracts every decision field from a reviewed PAGASA PDF table', () => {
    const payload = buildPagasaMonthlyWeatherPayload([{
      url: 'https://pubfiles.pagasa.dost.gov.ph/pagasaweb/files/cad/MACTAN.pdf',
      title: 'PAGASA Mactan climate normals',
      text: [
        'PERIOD: 1991 - 2020',
        ...PAGASA_MACTAN_ROWS,
        'STATION: MACTAN INTERNATIONAL AIRPORT, CEBU',
      ].join('\n'),
    }], '세부');

    expect(payload?.evidence).toHaveLength(12);
    expect(payload?.claims?.[0]?.claimText).toBe(
      '1991~2020 평년값: 1월 최고기온 29.7°C, 최저기온 24.0°C, 강수량 135.1mm, 강수일수 12일',
    );
    expect(payload?.claims?.[11]?.claimText).toContain('12월');
  });

  it('refuses a PAGASA station for a different destination', () => {
    const payload = buildPagasaMonthlyWeatherPayload([{
      url: 'https://pubfiles.pagasa.dost.gov.ph/pagasaweb/files/cad/MACTAN.pdf',
      title: 'PAGASA Mactan climate normals',
      text: [
        'PERIOD: 1991 - 2020',
        ...PAGASA_MACTAN_ROWS,
        'STATION: MACTAN INTERNATIONAL AIRPORT, CEBU',
      ].join('\n'),
    }], '보홀');

    expect(payload).toBeNull();
  });
});
