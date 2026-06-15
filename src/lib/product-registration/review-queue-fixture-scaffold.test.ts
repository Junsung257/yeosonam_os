import { describe, expect, it } from 'vitest';
import { buildUploadReviewFixtureScaffold } from './review-queue-fixture-scaffold';
import type { UploadReviewFixtureCandidate } from './review-queue-fixture-candidates';

function candidate(): UploadReviewFixtureCandidate {
  return {
    fixtureId: 'upload-review-2026-06-15-jangjiajie-price-dates',
    queueId: '11111111-1111-4111-8111-111111111111',
    createdAt: '2026-06-15T00:00:00.000Z',
    productTitle: '장가계 · 3박4일 · BX371',
    sourceFilename: 'jangjiajie.txt',
    landOperatorId: null,
    severity: 'critical',
    codes: ['PRICE_DATES_MISSING', 'FLIGHT_TIME_MISMATCH', 'CUSTOMER_RENDER_BLOCKED'],
    diagnostics: [{
      code: 'PRICE_DATES_MISSING',
      severity: 'critical',
      message: 'price_dates missing',
      nextAction: 'Recover source-backed departure dates and date-level minimum prices.',
    }],
    nextAction: 'Recover source-backed departure dates and date-level minimum prices.',
    rawTextHash: 'a'.repeat(64),
    fileHash: 'b'.repeat(16),
    normalizedContentHash: 'c'.repeat(16),
    sourceExcerpt: 'BX371 09:00 11:20 상품가 499,000',
    expectedAssertions: [
      'source-backed price_dates align with product_prices',
      'source-backed outbound and inbound flight times are saved and renderable',
    ],
    targetModules: [
      'src/lib/product-registration/price-recovery.ts',
      'src/lib/supplier-raw-deterministic-facts.ts',
    ],
    verificationCommands: [
      'npm run eval:product-registration:ci',
      'npm run type-check',
    ],
  };
}

describe('upload review fixture scaffold', () => {
  it('builds reviewed fixture, expected JSON, and work item files from a candidate', () => {
    const scaffold = buildUploadReviewFixtureScaffold({
      candidate: candidate(),
      baseDir: 'tmp/scaffolds',
    });

    expect(scaffold.files.map(file => file.path)).toEqual([
      'tmp/scaffolds/upload-review-2026-06-15-jangjiajie-price-dates/raw-fixture.txt',
      'tmp/scaffolds/upload-review-2026-06-15-jangjiajie-price-dates/expected.json',
      'tmp/scaffolds/upload-review-2026-06-15-jangjiajie-price-dates/work-item.md',
    ]);
    expect(scaffold.files[0]?.content).toContain('Replace this safe excerpt with the full reviewed supplier raw text');
    expect(scaffold.files[0]?.content).toContain('BX371 09:00 11:20');
    expect(scaffold.files[1]?.content).toContain('"customerDeliverableAfterFix": true');
    expect(scaffold.files[1]?.content).toContain('"PRICE_DATES_MISSING"');
    expect(scaffold.files[2]?.content).toContain('src/lib/product-registration/price-recovery.ts');
    expect(scaffold.files[2]?.content).toContain('npm run eval:product-registration:ci');
  });
});
