import { describe, expect, it } from 'vitest';
import type { BlogInformationSourcePolicy } from './blog-information-contract';
import {
  createBlogInformationClaimFingerprint,
  createBlogInformationSourceContentHash,
  type BlogInformationResearchBundle,
} from './blog-information-evidence';
import {
  BLOG_INFORMATION_RESEARCH_META_KEY,
  buildBlogGenerationResearchPromptBlock,
  evaluateBlogGenerationResearchReadiness,
  summarizeBlogGenerationResearch,
} from './blog-generation-research';

const CONTENT_KEY = 'sapporo-food-budget';
const CHECKED_AT = '2026-07-19T00:00:00.000Z';

const FOOD_POLICY: BlogInformationSourcePolicy = {
  minimumClaimSourceCoverage: 0.9,
  primarySourcesRequired: false,
  exactNumbersRequireSource: true,
  retrievedAtRequired: true,
  sourceTypes: ['official', 'field_research', 'reputable_local_source', 'reputable_price_source'],
};

function foodBudgetBundle(priceCount = 7): BlogInformationResearchBundle {
  const values = ['3000', '5000', '8000', '700', '1200', '2000', '600'].slice(0, priceCount);
  const labels = ['절약형 하루 예산', '일반형 하루 예산', '여유형 하루 예산', '아침', '점심', '저녁', '간식'];
  const excerpts = values.map((value, index) =>
    `2026년 일본 삿포로 일반 여행자의 ${labels[index]} 기준값은 ${value} JPY입니다.`);
  const snapshotContent = ['삿포로 식비 현장 조사', ...excerpts].join('\n');

  return {
    contentKey: CONTENT_KEY,
    sources: [{
      sourceKey: 'sapporo-food-field-research',
      sourceType: 'field_research',
      authorityLevel: 'field_observation',
      internalIdentifier: 'field-research:sapporo-food:2026-07',
      publisher: '여소남 현장 가격 조사',
      retrievedAt: CHECKED_AT,
      snapshotContent,
      contentHash: createBlogInformationSourceContentHash(snapshotContent),
      validUntil: '2026-08-19T00:00:00.000Z',
      destination: '삿포로',
      country: '일본',
      claimTypes: ['price'],
      riskLevel: 'MEDIUM',
    }],
    evidence: excerpts.map((excerpt, index) => ({
      evidenceKey: `sapporo-food-price-${index + 1}`,
      sourceKey: 'sapporo-food-field-research',
      sourceLocator: `price-row-${index + 1}`,
      excerpt,
      spanStart: Array.from(snapshotContent.slice(0, snapshotContent.indexOf(excerpt))).length,
      spanEnd: Array.from(snapshotContent.slice(0, snapshotContent.indexOf(excerpt))).length
        + Array.from(excerpt).length,
      claimType: 'price',
      riskLevel: 'MEDIUM',
      observedAt: CHECKED_AT,
      validUntil: '2026-08-19T00:00:00.000Z',
      scope: {
        country: '일본',
        destination: '삿포로',
        applicableTo: '일반 여행자',
        locale: 'ko-KR',
        claimType: 'price',
        normalizedValue: values[index],
        unit: null,
        currency: 'JPY',
        verifiedAt: CHECKED_AT,
        nextReviewAt: '2026-08-19T00:00:00.000Z',
        conditions: [`${labels[index]} 기준`],
      },
    })),
    claims: values.map((value, index) => {
      const claimText = `삿포로 일반 여행자의 ${labels[index]} 기준값은 ${value} JPY입니다.`;
      return {
        claimFingerprint: createBlogInformationClaimFingerprint(claimText),
        claimText,
        claimType: 'price' as const,
        riskLevel: 'MEDIUM' as const,
        extractedValue: { normalizedValue: value, unit: null, currency: 'JPY' },
        requiresEvidence: true,
        evidenceKeys: [`sapporo-food-price-${index + 1}`],
      };
    }),
  };
}

function readiness(bundle: BlogInformationResearchBundle | null) {
  return evaluateBlogGenerationResearchReadiness({
    meta: bundle ? { [BLOG_INFORMATION_RESEARCH_META_KEY]: bundle } : {},
    expectedContentKey: CONTENT_KEY,
    destination: '삿포로',
    intent: 'food_budget',
    locale: 'ko-KR',
    sourcePolicy: FOOD_POLICY,
    now: new Date('2026-07-19T12:00:00.000Z'),
  });
}

describe('blog generation research preflight', () => {
  it('blocks missing research before writing starts', () => {
    expect(readiness(null)).toMatchObject({
      passed: false,
      issues: ['research_bundle_missing_or_invalid_shape'],
    });
  });

  it('accepts a complete food-budget evidence pack', () => {
    const result = readiness(foodBudgetBundle());
    expect(result.passed).toBe(true);
    expect(result.summary).toMatchObject({
      sourceCount: 1,
      evidenceCount: 7,
      claimCount: 7,
      supportedClaimCount: 7,
      distinctNormalizedValueCount: 7,
    });
  });

  it('blocks content scope drift and incomplete meal/tier coverage', () => {
    const bundle = foodBudgetBundle(6);
    bundle.contentKey = 'wrong-slug';
    bundle.evidence[0].scope.destination = '도쿄';
    const result = readiness(bundle);

    expect(result.passed).toBe(false);
    expect(result.issues).toEqual(expect.arrayContaining([
      'content_key_mismatch',
      'evidence_destination_mismatch:sapporo-food-price-1',
      'claim_type_below_minimum:price:6/7',
    ]));
  });

  it('blocks stale or unclassified sources', () => {
    const bundle = foodBudgetBundle();
    bundle.sources[0].retrievedAt = '2026-01-01T00:00:00.000Z';
    bundle.sources[0].claimTypes = [];
    bundle.sources[0].contentHash = createBlogInformationSourceContentHash(bundle.sources[0].snapshotContent);
    const result = readiness(bundle);

    expect(result.issues).toEqual(expect.arrayContaining([
      'source_claim_types_missing:sapporo-food-field-research',
      'source_stale:sapporo-food-field-research',
    ]));
  });

  it('accepts a current reputable price source for food budgets', () => {
    const bundle = foodBudgetBundle();
    bundle.sources[0].sourceType = 'reputable_price_source';
    bundle.sources[0].authorityLevel = 'editorial_secondary';
    bundle.sources[0].sourceUrl = 'https://www.budgetyourtrip.com/japan/sapporo';
    delete bundle.sources[0].internalIdentifier;

    expect(readiness(bundle).issues).not.toContain(
      'source_type_not_allowed:sapporo-food-field-research',
    );
  });

  it('blocks seven unrelated price claims that do not cover the required food-budget decisions', () => {
    const bundle = foodBudgetBundle();
    bundle.claims = bundle.claims.map((claim, index) => {
      const claimText = `삿포로 일반 여행자의 가격 참고값 ${index + 1}은 ${claim.extractedValue?.normalizedValue} JPY입니다.`;
      return {
        ...claim,
        claimText,
        claimFingerprint: createBlogInformationClaimFingerprint(claimText),
      };
    });

    const result = readiness(bundle);
    expect(result.passed).toBe(false);
    expect(result.issues).toEqual(expect.arrayContaining([
      'claim_semantic_coverage_missing:food_budget:budget_tier',
      'claim_semantic_coverage_missing:food_budget:breakfast',
      'claim_semantic_coverage_missing:food_budget:snack',
    ]));
  });

  it('injects exact approved evidence and claims without copying snapshots into compact metadata', () => {
    const result = readiness(foodBudgetBundle());
    const prompt = buildBlogGenerationResearchPromptBlock(result);
    const summary = JSON.stringify(summarizeBlogGenerationResearch(result));

    expect(prompt).toContain('Verified research evidence pack');
    expect(prompt).toContain('2026년 일본 삿포로 일반 여행자의 절약형 하루 예산 기준값은 3000 JPY입니다.');
    expect(prompt).toContain('삿포로 일반 여행자의 절약형 하루 예산 기준값은 3000 JPY입니다.');
    expect(prompt).toContain('never add a new number');
    expect(summary).not.toContain('삿포로 식비 현장 조사');
    expect(summary).not.toContain('절약형 하루 예산 기준값');
  });
});
