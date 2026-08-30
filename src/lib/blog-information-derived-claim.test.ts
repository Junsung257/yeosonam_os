import { describe, expect, it } from 'vitest';
import { createBlogInformationClaimFingerprint } from './blog-information-evidence';
import { validateBlogInformationClaims, type PersistedBlogInformationClaimRecord } from './blog-information-claim-validator';

function priceClaim(text: string, amount: string): PersistedBlogInformationClaimRecord {
  return {
    claimFingerprint: createBlogInformationClaimFingerprint(text),
    claimText: text,
    claimType: 'price',
    extractedValue: { normalizedValue: amount, unit: '1회', currency: 'USD' },
    validationStatus: 'supported',
    evidence: [{
      evidenceKey: `e-${amount}`,
      sourceVersionId: `version-${amount}`,
      claimType: 'price',
      observedAt: '2026-08-29T00:00:00.000Z',
      excerpt: text,
      scope: {
        country: 'GU',
        destination: '괌',
        applicableTo: '한국인 여행자',
        locale: 'ko-KR',
        claimType: 'price',
        normalizedValue: amount,
        unit: '1회',
        currency: 'USD',
        conditions: [],
      },
      source: {
        authorityLevel: 'editorial_secondary',
        retrievedAt: '2026-08-29T00:00:00.000Z',
        status: 'active',
      },
    }],
  };
}

describe('derived blog information claims', () => {
  it('accepts only a deterministic sum whose operands match supported current claims', () => {
    const breakfast = priceClaim('조식은 14.50 USD이다.', '14.5');
    const lunch = priceClaim('점심은 15.00 USD이다.', '15');
    const row = '절약형 | 조식 + 점심 | 14.50 + 15 = 29.50 USD';
    const derived: PersistedBlogInformationClaimRecord = {
      claimFingerprint: createBlogInformationClaimFingerprint(row),
      claimText: row,
      claimType: 'price',
      extractedValue: {
        normalizedValue: '29.5',
        unit: '1인 하루',
        currency: 'USD',
        derivation: {
          version: 'blog-claim-derivation-v1',
          operation: 'sum',
          operandClaimFingerprints: [breakfast.claimFingerprint, lunch.claimFingerprint],
          operandValues: ['14.5', '15'],
          formula: '14.50 + 15 = 29.50 USD',
          assumptions: ['1인 기준'],
        },
      },
      validationStatus: 'supported',
      evidence: [...breakfast.evidence, ...lunch.evidence],
    };
    const report = validateBlogInformationClaims({
      markdown: `| ${row} |`,
      persistedClaims: [breakfast, lunch, derived],
      claimLedger: [{
        claimFingerprint: derived.claimFingerprint,
        claimText: row,
        claimType: 'price',
        riskLevel: 'MEDIUM',
      }],
      now: new Date('2026-08-30T00:00:00.000Z'),
    });
    expect(report.passed).toBe(true);
    expect(report.coverage).toBe(1);
  });

  it('fails closed when the declared sum does not equal its operands', () => {
    const breakfast = priceClaim('조식은 14.50 USD이다.', '14.5');
    const lunch = priceClaim('점심은 15.00 USD이다.', '15');
    const row = '절약형 | 조식 + 점심 | 14.50 + 15 = 39.50 USD';
    const derived: PersistedBlogInformationClaimRecord = {
      claimFingerprint: createBlogInformationClaimFingerprint(row),
      claimText: row,
      claimType: 'price',
      extractedValue: {
        normalizedValue: '39.5',
        unit: '1인 하루',
        currency: 'USD',
        derivation: {
          version: 'blog-claim-derivation-v1',
          operation: 'sum',
          operandClaimFingerprints: [breakfast.claimFingerprint, lunch.claimFingerprint],
          operandValues: ['14.5', '15'],
          formula: '14.50 + 15 = 39.50 USD',
          assumptions: ['1인 기준'],
        },
      },
      validationStatus: 'supported',
      evidence: [...breakfast.evidence, ...lunch.evidence],
    };
    const report = validateBlogInformationClaims({
      markdown: `| ${row} |`,
      persistedClaims: [breakfast, lunch, derived],
      claimLedger: [{
        claimFingerprint: derived.claimFingerprint,
        claimText: row,
        claimType: 'price',
        riskLevel: 'MEDIUM',
      }],
      now: new Date('2026-08-30T00:00:00.000Z'),
    });
    expect(report.passed).toBe(false);
    expect(report.issues.map((issue) => issue.code)).toContain('invalid_derivation');
  });
});
