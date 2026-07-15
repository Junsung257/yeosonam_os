import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  createBlogInformationClaimFingerprint,
  isOfficialInformationAuthority,
  validateBlogInformationResearchBundle,
  type BlogInformationResearchBundle,
} from './blog-information-evidence';

function validBundle(): BlogInformationResearchBundle {
  const claimText = '오사카 공항에서 시내까지 열차로 약 50분이 걸립니다.';
  return {
    contentKey: 'osaka:airport_transport:general:ko-KR',
    sources: [{
      sourceKey: 'kansai-airport-access',
      sourceType: 'airport',
      authorityLevel: 'official_primary',
      sourceUrl: 'https://www.kansai-airport.or.jp/en/access/',
      publisher: 'Kansai Airports',
      retrievedAt: '2026-07-15T08:00:00.000Z',
      validUntil: '2026-08-15T08:00:00.000Z',
      destination: '오사카',
      country: '일본',
      claimTypes: ['duration'],
      riskLevel: 'MEDIUM',
    }],
    evidence: [{
      evidenceKey: 'airport-access-duration',
      sourceKey: 'kansai-airport-access',
      sourceLocator: 'Access > Train',
      excerpt: 'Travel time depends on the destination and train service.',
      claimType: 'duration',
      riskLevel: 'MEDIUM',
      observedAt: '2026-07-15T08:00:00.000Z',
      validUntil: '2026-08-15T08:00:00.000Z',
    }],
    claims: [{
      claimFingerprint: createBlogInformationClaimFingerprint(claimText),
      claimText,
      claimType: 'duration',
      riskLevel: 'MEDIUM',
      requiresEvidence: true,
      evidenceKeys: ['airport-access-duration'],
    }],
  };
}

describe('blog informational evidence contract', () => {
  it('accepts a complete source-evidence-claim chain', () => {
    expect(validateBlogInformationResearchBundle(validBundle())).toEqual({
      passed: true,
      issues: [],
    });
  });

  it('creates a stable normalized SHA-256 claim fingerprint', () => {
    const first = createBlogInformationClaimFingerprint('  공항 이동은 50분  ');
    const second = createBlogInformationClaimFingerprint('공항   이동은 50분');
    expect(first).toBe(second);
    expect(first).toMatch(/^[0-9a-f]{64}$/);
  });

  it('fails closed for unsafe URLs and broken evidence references', () => {
    const bundle = validBundle();
    bundle.sources[0].sourceUrl = 'http://example.com/source';
    bundle.evidence[0].sourceKey = 'missing-source';
    bundle.claims[0].evidenceKeys = ['missing-evidence'];

    const result = validateBlogInformationResearchBundle(bundle);
    expect(result.passed).toBe(false);
    expect(result.issues).toEqual(expect.arrayContaining([
      'source:unsafe_url:kansai-airport-access',
      'evidence:unknown_source:airport-access-duration',
      expect.stringContaining('claim:unknown_evidence:'),
    ]));
  });

  it('requires reviewer identity and review time as a pair', () => {
    const bundle = validBundle();
    bundle.sources[0].reviewerId = 'reviewer-id';
    expect(validateBlogInformationResearchBundle(bundle).issues).toContain(
      'source:incomplete_review:kansai-airport-access',
    );
  });

  it('distinguishes official authority from editorial and internal references', () => {
    expect(isOfficialInformationAuthority('official_primary')).toBe(true);
    expect(isOfficialInformationAuthority('official_secondary')).toBe(true);
    expect(isOfficialInformationAuthority('editorial_secondary')).toBe(false);
    expect(isOfficialInformationAuthority('internal_reference')).toBe(false);
  });

  it('keeps informational persistence isolated from product evidence', () => {
    const contractSource = readFileSync(join(process.cwd(), 'src/lib/blog-information-evidence.ts'), 'utf8');
    const repositorySource = readFileSync(
      join(process.cwd(), 'src/lib/blog-information-evidence-repository.ts'),
      'utf8',
    );
    const combined = `${contractSource}\n${repositorySource}`;
    expect(combined).not.toMatch(/travel_packages|product_snapshot|package-publication|product-registration/);
    expect(repositorySource).toContain("from('blog_information_sources')");
    expect(repositorySource).toContain("from('blog_information_evidence')");
    expect(repositorySource).toContain("from('blog_information_claims')");
  });
});
