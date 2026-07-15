import { describe, expect, it } from 'vitest';
import { createBlogInformationClaimFingerprint, type BlogInformationResearchBundle } from './blog-information-evidence';
import { extractBlogInformationClaims } from './blog-information-claim-validator';
import {
  createBlogInformationContentFingerprint,
  evaluateBlogInformationReviewPublishability,
  executeBlogInformationEvidenceWorkflow,
  type BlogInformationEvidenceWorkflowStore,
} from './blog-information-review-workflow';

const NOW = new Date('2026-07-15T09:00:00.000Z');

function bundleFor(input: {
  markdown: string;
  authorityLevel?: 'official_primary' | 'official_secondary' | 'editorial_secondary';
  validUntil?: string;
}): BlogInformationResearchBundle {
  const claim = extractBlogInformationClaims(input.markdown)[0];
  if (!claim) throw new Error(`fixture did not produce a claim: ${input.markdown}`);
  const validUntil = input.validUntil ?? '2026-08-15T00:00:00.000Z';
  return {
    contentKey: 'untrusted-caller-key',
    sources: [{
      sourceKey: 'official-source',
      sourceType: 'government',
      authorityLevel: input.authorityLevel ?? 'official_primary',
      sourceUrl: 'https://www.example.go.jp/travel',
      publisher: 'Official Travel Authority',
      retrievedAt: '2026-07-15T08:00:00.000Z',
      contentHash: 'a'.repeat(64),
      validUntil,
      destination: 'Tokyo',
      country: 'Japan',
      claimTypes: [claim.claimType],
      riskLevel: claim.riskLevel,
    }],
    evidence: [{
      evidenceKey: 'evidence-1',
      sourceKey: 'official-source',
      excerpt: `Japan Tokyo KR 2026 ${input.markdown}`,
      claimType: claim.claimType,
      riskLevel: claim.riskLevel,
      observedAt: '2026-07-15T08:00:00.000Z',
      validUntil,
      scope: {
        country: 'Japan',
        destination: 'Tokyo',
        applicableTo: 'KR',
        locale: 'ko-KR',
        claimType: claim.claimType,
        normalizedValue: claim.extractedValue.normalizedValue,
        unit: claim.extractedValue.unit,
        currency: claim.extractedValue.currency,
        verifiedAt: '2026-07-15T08:00:00.000Z',
        nextReviewAt: validUntil,
        conditions: ['general traveler'],
      },
    }],
    claims: [{
      claimFingerprint: createBlogInformationClaimFingerprint(input.markdown),
      claimText: input.markdown,
      claimType: claim.claimType,
      riskLevel: claim.riskLevel,
      extractedValue: claim.extractedValue,
      requiresEvidence: true,
      evidenceKeys: ['evidence-1'],
    }],
  };
}

function storeSpy(saved: Array<Record<string, unknown>>): BlogInformationEvidenceWorkflowStore {
  return {
    async save(input) {
      saved.push(input as unknown as Record<string, unknown>);
      return { reviewCaseId: 'review-case-1' };
    },
  };
}

async function run(input: {
  markdown: string;
  intentType?: 'food_budget' | 'entry_requirements';
  research: BlogInformationResearchBundle | null;
}) {
  const saved: Array<Record<string, unknown>> = [];
  const result = await executeBlogInformationEvidenceWorkflow({
    creativeId: 'creative-1',
    contentKey: 'tokyo-guide',
    markdown: input.markdown,
    seoTitle: 'Tokyo guide',
    seoDescription: 'Practical Tokyo information',
    slug: 'tokyo-guide',
    plannerInput: {
      intentType: input.intentType ?? 'food_budget',
      destination: 'Tokyo',
      topic: input.markdown,
      primaryKeyword: 'Tokyo travel',
      travelerNationality: 'KR',
      locale: 'ko-KR',
    },
    expectedScope: { country: 'Japan', destination: 'Tokyo', applicableTo: 'KR', locale: 'ko-KR' },
    now: NOW,
  }, {
    researcher: { research: async () => input.research },
    store: storeSpy(saved),
  });
  return { result, saved };
}

describe('blog information evidence review workflow', () => {
  it('moves a food-budget claim with current scoped evidence to publish-ready', async () => {
    const markdown = 'Estimated food cost: USD 50.';
    const { result, saved } = await run({ markdown, research: bundleFor({ markdown }) });

    expect(result).toMatchObject({ state: 'ready', reviewCaseId: 'review-case-1' });
    expect(result.report.passed).toBe(true);
    expect(saved[0]).toMatchObject({ state: 'ready' });
  });

  it('keeps an evidence-less draft private and in review', async () => {
    const { result } = await run({ markdown: 'Estimated food cost: USD 50.', research: null });
    expect(result.state).toBe('pending_review');
    expect(result.report.passed).toBe(false);
  });

  it('sends expired evidence to review instead of publishing', async () => {
    const markdown = 'Estimated food cost: USD 50.';
    const { result } = await run({
      markdown,
      research: bundleFor({ markdown, validUntil: '2024-12-31T00:00:00.000Z' }),
    });
    expect(result.state).toBe('pending_review');
    expect(result.report.issues.map((issue) => issue.code)).toContain('stale_evidence');
  });

  it('allows high-risk publishing only after primary evidence and explicit approval', async () => {
    const markdown = '한국인은 일본 입국 비자가 필요합니다.';
    const { result } = await run({
      markdown,
      intentType: 'entry_requirements',
      research: bundleFor({ markdown }),
    });
    expect(result.report.passed).toBe(true);
    expect(result.state).toBe('pending_review');
    expect(evaluateBlogInformationReviewPublishability({
      state: 'approved',
      riskLevel: 'HIGH',
      reviewedFingerprint: result.contentFingerprint,
      currentFingerprint: result.contentFingerprint,
      report: result.report,
    })).toEqual({ passed: true, reasons: [] });
  });

  it('blocks high-risk research backed only by a secondary source', async () => {
    const markdown = '한국인은 일본 입국 비자가 필요합니다.';
    const { result } = await run({
      markdown,
      intentType: 'entry_requirements',
      research: bundleFor({ markdown, authorityLevel: 'official_secondary' }),
    });
    expect(result.state).toBe('pending_review');
    expect(result.report.issues.map((issue) => issue.code)).toContain('official_primary_required');
  });

  it('requires reapproval when a claim changes after approval', async () => {
    const reviewed = createBlogInformationContentFingerprint({
      blogHtml: 'Estimated food cost: USD 50.',
      seoTitle: 'Tokyo guide',
      slug: 'tokyo-guide',
    });
    const changed = createBlogInformationContentFingerprint({
      blogHtml: 'Estimated food cost: USD 80.',
      seoTitle: 'Tokyo guide',
      slug: 'tokyo-guide',
    });
    const markdown = 'Estimated food cost: USD 50.';
    const { result } = await run({ markdown, research: bundleFor({ markdown }) });
    const publishability = evaluateBlogInformationReviewPublishability({
      state: 'approved',
      riskLevel: 'LOW',
      reviewedFingerprint: reviewed,
      currentFingerprint: changed,
      report: result.report,
    });
    expect(publishability).toEqual({ passed: false, reasons: ['content_changed_reapproval_required'] });
  });
});
