import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  createBlogInformationClaimFingerprint,
  isOfficialInformationAuthority,
  isPrimaryInformationAuthority,
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
      excerpt: '2026년 일본 오사카 일반 여행자는 공항에서 시내까지 열차로 약 50분이 걸립니다.',
      claimType: 'duration',
      riskLevel: 'MEDIUM',
      observedAt: '2026-07-15T08:00:00.000Z',
      validUntil: '2026-08-15T08:00:00.000Z',
      scope: {
        country: '일본',
        destination: '오사카',
        applicableTo: '일반 여행자',
        locale: 'ko-KR',
        claimType: 'duration',
        normalizedValue: '50',
        unit: '분',
        currency: null,
        verifiedAt: '2026-07-15T08:00:00.000Z',
        nextReviewAt: '2026-08-15T08:00:00.000Z',
        conditions: ['열차 서비스와 도착역 기준'],
      },
    }],
    claims: [{
      claimFingerprint: createBlogInformationClaimFingerprint(claimText),
      claimText,
      claimType: 'duration',
      riskLevel: 'MEDIUM',
      extractedValue: { normalizedValue: '50', unit: '분', currency: null },
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

  it('rejects source scope drift and excerpt value mismatch', () => {
    const bundle = validBundle();
    bundle.evidence[0].scope.destination = '베이징';
    bundle.evidence[0].scope.normalizedValue = '60';

    const issues = validateBlogInformationResearchBundle(bundle).issues;
    expect(issues).toEqual(expect.arrayContaining([
      'evidence:source_destination_mismatch:airport-access-duration',
      'evidence:scope:excerpt_value_mismatch:airport-access-duration',
      expect.stringContaining('claim:evidence_mismatch:normalized_value_mismatch:'),
    ]));
  });

  it('distinguishes official authority from editorial and internal references', () => {
    expect(isOfficialInformationAuthority('official_primary')).toBe(true);
    expect(isOfficialInformationAuthority('official_secondary')).toBe(true);
    expect(isOfficialInformationAuthority('editorial_secondary')).toBe(false);
    expect(isOfficialInformationAuthority('internal_reference')).toBe(false);
    expect(isPrimaryInformationAuthority('official_primary')).toBe(true);
    expect(isPrimaryInformationAuthority('official_secondary')).toBe(false);
  });

  it.each([
    'https://localhost/source',
    'https://127.0.0.1/source',
    'https://10.0.0.1/source',
    'https://169.254.169.254/latest/meta-data',
    'https://metadata.google.internal/computeMetadata/v1/',
    'ftp://example.com/source',
  ])('rejects non-public or non-HTTPS source URL %s', (sourceUrl) => {
    const bundle = validBundle();
    bundle.sources[0].sourceUrl = sourceUrl;
    expect(validateBlogInformationResearchBundle(bundle).issues)
      .toContain('source:unsafe_url:kansai-airport-access');
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
    expect(repositorySource).toContain('scope: evidence.scope');
  });
});
