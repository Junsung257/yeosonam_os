import { describe, expect, it } from 'vitest';
import type { BlogInformationSourcePolicy } from './blog-information-contract';
import {
  BLOG_INFORMATION_RESEARCH_META_KEY,
  evaluateBlogGenerationResearchReadiness,
} from './blog-generation-research';
import { validateBlogInformationResearchBundle } from './blog-information-evidence';
import { buildSapporoFoodBudgetResearchBundle } from '../../scripts/lib/sapporo-food-budget-research';

const FOOD_POLICY: BlogInformationSourcePolicy = {
  minimumClaimSourceCoverage: 0.9,
  primarySourcesRequired: false,
  exactNumbersRequireSource: true,
  retrievedAtRequired: true,
  sourceTypes: ['official', 'field_research', 'reputable_local_source', 'reputable_price_source'],
};

describe('Sapporo food-budget research canary', () => {
  it('builds a complete, fresh and exact research bundle', () => {
    const now = new Date('2026-07-19T04:00:00.000Z');
    const bundle = buildSapporoFoodBudgetResearchBundle(now);
    const result = evaluateBlogGenerationResearchReadiness({
      meta: { [BLOG_INFORMATION_RESEARCH_META_KEY]: bundle },
      expectedContentKey: 'sapporo-food-budget',
      destination: '삿포로',
      intent: 'food_budget',
      locale: 'ko-KR',
      sourcePolicy: FOOD_POLICY,
      now,
    });

    expect(validateBlogInformationResearchBundle(bundle)).toEqual({ passed: true, issues: [] });
    expect(result).toMatchObject({
      passed: true,
      issues: [],
      summary: {
        sourceCount: 1,
        evidenceCount: 7,
        claimCount: 7,
        supportedClaimCount: 7,
        claimSourceCoverage: 1,
        distinctNormalizedValueCount: 7,
      },
    });
  });
});
