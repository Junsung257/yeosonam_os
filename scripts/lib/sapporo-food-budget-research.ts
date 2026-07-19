import {
  createBlogInformationClaimFingerprint,
  createBlogInformationSourceContentHash,
  type BlogInformationResearchBundle,
} from '../../src/lib/blog-information-evidence';

export const SAPPORO_FOOD_BUDGET_SOURCE_URL = 'https://www.budgetyourtrip.com/japan/sapporo';

const FACTS = [
  {
    key: 'daily-budget',
    label: 'Food budget, Budget',
    value: '3460',
    currency: 'JPY',
    claim: 'Budget Your Trip 집계에서 삿포로 일반 여행자의 절약형 1인 하루 식비는 3,460 JPY입니다.',
  },
  {
    key: 'daily-midrange',
    label: 'Food budget, Mid-Range',
    value: '7974',
    currency: 'JPY',
    claim: 'Budget Your Trip 집계에서 삿포로 일반 여행자의 일반형 1인 하루 식비는 7,974 JPY입니다.',
  },
  {
    key: 'daily-luxury',
    label: 'Food budget, Luxury',
    value: '15644',
    currency: 'JPY',
    claim: 'Budget Your Trip 집계에서 삿포로 일반 여행자의 여유형 1인 하루 식비는 15,644 JPY입니다.',
  },
  {
    key: 'breakfast',
    label: 'Breakfast',
    value: '5-15',
    currency: 'USD',
    claim: 'Budget Your Trip 집계에서 삿포로 일반 여행자의 아침 식사 범위는 5-15 USD입니다.',
  },
  {
    key: 'lunch',
    label: 'Lunch',
    value: '8-20',
    currency: 'USD',
    claim: 'Budget Your Trip 집계에서 삿포로 일반 여행자의 점심 식사 범위는 8-20 USD입니다.',
  },
  {
    key: 'dinner',
    label: 'Dinner',
    value: '15-36',
    currency: 'USD',
    claim: 'Budget Your Trip 집계에서 삿포로 일반 여행자의 저녁 식사 범위는 15-36 USD입니다.',
  },
  {
    key: 'coffee',
    label: 'Coffee',
    value: '4',
    currency: 'USD',
    claim: 'Budget Your Trip 집계에서 삿포로 일반 여행자의 간식·커피 기준 가격은 4 USD입니다.',
  },
] as const;

function addDays(date: Date, days: number): string {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000).toISOString();
}

function spanFor(snapshotContent: string, excerpt: string): { spanStart: number; spanEnd: number } {
  const index = snapshotContent.indexOf(excerpt);
  if (index < 0) throw new Error(`Research excerpt is missing from snapshot: ${excerpt}`);
  const spanStart = Array.from(snapshotContent.slice(0, index)).length;
  return { spanStart, spanEnd: spanStart + Array.from(excerpt).length };
}

export function buildSapporoFoodBudgetResearchBundle(checkedAt = new Date()): BlogInformationResearchBundle {
  const retrievedAt = checkedAt.toISOString();
  const reviewAt = addDays(checkedAt, 30);
  const date = retrievedAt.slice(0, 10);
  const sourceKey = 'budget-your-trip-sapporo-food';
  const excerpts = FACTS.map((fact) =>
    `${date} Japan Sapporo travelers - ${fact.label}: ${fact.value} ${fact.currency}.`);
  const snapshotContent = [
    'Structured fact capture from Budget Your Trip, Food Budget in Sapporo.',
    ...excerpts,
  ].join('\n');

  return {
    contentKey: 'sapporo-food-budget',
    creativeId: '4c5e0bf9-5dd9-49f5-9bf7-055c6a2d4e0c',
    siteScope: 'www.yeosonam.com',
    sources: [{
      sourceKey,
      sourceType: 'reputable_price_source',
      authorityLevel: 'editorial_secondary',
      sourceUrl: SAPPORO_FOOD_BUDGET_SOURCE_URL,
      publisher: 'Budget Your Trip',
      retrievedAt,
      snapshotContent,
      contentHash: createBlogInformationSourceContentHash(snapshotContent),
      validUntil: reviewAt,
      destination: '삿포로',
      country: 'Japan',
      claimTypes: ['price'],
      riskLevel: 'MEDIUM',
      metadata: {
        capture_method: 'structured_fact_extract',
        source_section: 'Food Budget in Sapporo',
        source_currency_preserved: true,
      },
    }],
    evidence: FACTS.map((fact, index) => ({
      evidenceKey: `sapporo-food-${fact.key}`,
      sourceKey,
      sourceLocator: `Food Budget in Sapporo / ${fact.label}`,
      excerpt: excerpts[index],
      ...spanFor(snapshotContent, excerpts[index]),
      claimType: 'price' as const,
      riskLevel: 'MEDIUM' as const,
      observedAt: retrievedAt,
      validUntil: reviewAt,
      scope: {
        country: 'Japan',
        destination: '삿포로',
        applicableTo: 'travelers',
        locale: 'ko-KR',
        claimType: 'price' as const,
        normalizedValue: fact.value,
        unit: null,
        currency: fact.currency,
        verifiedAt: retrievedAt,
        nextReviewAt: reviewAt,
        conditions: [`Budget Your Trip ${fact.label}; source currency as displayed`],
      },
      capturedBy: 'codex-r18-sapporo-canary',
    })),
    claims: FACTS.map((fact) => ({
      claimFingerprint: createBlogInformationClaimFingerprint(fact.claim),
      claimText: fact.claim,
      claimType: 'price' as const,
      riskLevel: 'MEDIUM' as const,
      extractedValue: {
        normalizedValue: fact.value,
        unit: null,
        currency: fact.currency,
      },
      requiresEvidence: true,
      evidenceKeys: [`sapporo-food-${fact.key}`],
    })),
  };
}
