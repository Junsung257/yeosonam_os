import { describe, expect, it } from 'vitest';
import type { GroundingChunk } from '@google/genai';
import { buildBlogResearchBundleFromGrounding } from '@/lib/blog-auto-research';
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
