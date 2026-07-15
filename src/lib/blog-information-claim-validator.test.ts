import { describe, expect, it } from 'vitest';
import {
  extractBlogInformationClaims,
  validateBlogInformationClaims,
  type PersistedBlogInformationClaimRecord,
} from './blog-information-claim-validator';

const NOW = new Date('2026-07-15T09:00:00.000Z');

function supportedRecord(
  markdown: string,
  options: {
    authorityLevel?: 'official_primary' | 'editorial_secondary';
    retrievedAt?: string;
    validUntil?: string | null;
    validationStatus?: PersistedBlogInformationClaimRecord['validationStatus'];
  } = {},
): PersistedBlogInformationClaimRecord {
  const claim = extractBlogInformationClaims(markdown)[0];
  if (!claim) throw new Error('fixture did not produce a claim');
  return {
    claimFingerprint: claim.claimFingerprint,
    claimType: claim.claimType,
    validationStatus: options.validationStatus ?? 'supported',
    evidence: [{
      evidenceKey: 'evidence-1',
      claimType: claim.claimType,
      observedAt: '2026-07-15T08:00:00.000Z',
      validUntil: options.validUntil ?? '2026-08-15T00:00:00.000Z',
      source: {
        authorityLevel: options.authorityLevel ?? 'official_primary',
        retrievedAt: options.retrievedAt ?? '2026-07-15T08:00:00.000Z',
        validUntil: options.validUntil ?? '2026-08-15T00:00:00.000Z',
        status: 'active',
      },
    }],
  };
}

describe('blog information claim validator', () => {
  it.each([
    ['식비는 하루 8,000엔입니다.', 'price'],
    ['공항에서 시내까지 약 50분이 걸립니다.', 'duration'],
    ['서비스 수수료는 3.5%입니다.', 'percentage'],
    ['7월 평균 기온은 28℃입니다.', 'climate'],
    ['면세 한도는 800달러까지 허용됩니다.', 'customs'],
    ['한국인은 관광 비자가 필요하지 않습니다.', 'entry_visa'],
    ['여행자 보험은 해외 의료비를 보장합니다.', 'insurance'],
    ['이 지역이 가장 저렴합니다.', 'superlative'],
  ] as const)('extracts %s as %s', (markdown, claimType) => {
    expect(extractBlogInformationClaims(markdown)).toEqual([
      expect.objectContaining({ claimType, claimText: markdown }),
    ]);
  });

  it('does not treat ordinary narrative as a verifiable claim', () => {
    expect(extractBlogInformationClaims('골목을 천천히 걸으며 현지 분위기를 살펴보세요.')).toEqual([]);
    expect(extractBlogInformationClaims('3일 차에는 가장 먼저 시장을 둘러보세요.')).toEqual([]);
    expect(extractBlogInformationClaims('여권 사본은 필수 준비물입니다.')).toEqual([]);
  });

  it('blocks a numeric claim without evidence', () => {
    const report = validateBlogInformationClaims({
      markdown: '공항에서 시내까지 약 50분이 걸립니다.',
      persistedClaims: [],
      now: NOW,
    });
    expect(report.passed).toBe(false);
    expect(report.coverage).toBe(0);
    expect(report.issues[0]?.code).toBe('missing_evidence');
  });

  it('blocks evidence after its validity window', () => {
    const markdown = '공항에서 시내까지 약 50분이 걸립니다.';
    const report = validateBlogInformationClaims({
      markdown,
      persistedClaims: [supportedRecord(markdown, { validUntil: '2026-07-14T00:00:00.000Z' })],
      now: NOW,
    });
    expect(report.passed).toBe(false);
    expect(report.issues[0]?.code).toBe('stale_evidence');
  });

  it('blocks policy claims backed only by a secondary editorial source', () => {
    const markdown = '면세 한도는 800달러까지 허용됩니다.';
    const report = validateBlogInformationClaims({
      markdown,
      persistedClaims: [supportedRecord(markdown, { authorityLevel: 'editorial_secondary' })],
      reviewStatus: 'approved',
      now: NOW,
    });
    expect(report.passed).toBe(false);
    expect(report.issues[0]?.code).toBe('official_source_required');
  });

  it('blocks an official high-risk claim until human approval exists', () => {
    const markdown = '한국인은 관광 비자가 필요하지 않습니다.';
    const report = validateBlogInformationClaims({
      markdown,
      persistedClaims: [supportedRecord(markdown)],
      reviewStatus: 'pending_review',
      now: NOW,
    });
    expect(report.passed).toBe(false);
    expect(report.requiresHumanReview).toBe(true);
    expect(report.issues[0]?.code).toBe('human_approval_required');
  });

  it('passes a current official high-risk claim after human approval', () => {
    const markdown = '한국인은 관광 비자가 필요하지 않습니다.';
    const report = validateBlogInformationClaims({
      markdown,
      persistedClaims: [supportedRecord(markdown)],
      reviewStatus: 'approved',
      now: NOW,
    });
    expect(report.passed).toBe(true);
    expect(report.coverage).toBe(1);
  });

  it('does not apply the information validator to product content at the runtime boundary', async () => {
    const { evaluateBlogInformationClaimPublishGate } = await import('./blog-information-claim-publish-gate');
    const report = await evaluateBlogInformationClaimPublishGate({
      contentKey: 'product-post',
      markdown: '가격은 1,000,000원입니다.',
      productId: 'product-1',
    });
    expect(report).toMatchObject({ passed: true, skipped: 'product_content' });
  });
});
