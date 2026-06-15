import { describe, expect, it } from 'vitest';
import {
  buildUploadReviewFixtureCandidate,
  buildUploadReviewFixtureCandidateReport,
  type UploadReviewQueueFixtureRow,
} from './review-queue-fixture-candidates';

function row(overrides: Partial<UploadReviewQueueFixtureRow> = {}): UploadReviewQueueFixtureRow {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    created_at: '2026-06-15T00:00:00.000Z',
    status: 'pending',
    severity: 'critical',
    error_reason: 'Customer landing/A4 blocked: price_dates missing | flight time source mismatch',
    source_filename: 'jangjiajie.txt',
    file_hash: 'a'.repeat(64),
    normalized_content_hash: 'b'.repeat(64),
    raw_text_chunk: '장가계 원문 BX371 09:00 11:20 상품가 499,000',
    parsed_draft_json: null,
    product_title: '장가계 · 3박4일 · BX371',
    land_operator_id: null,
    ...overrides,
  };
}

describe('upload review fixture candidates', () => {
  it('turns a failed upload review row into a regression fixture candidate', () => {
    const candidate = buildUploadReviewFixtureCandidate(row());

    expect(candidate.fixtureId).toContain('upload-review-2026-06-15');
    expect(candidate.codes).toEqual(expect.arrayContaining([
      'CUSTOMER_RENDER_BLOCKED',
      'PRICE_DATES_MISSING',
      'FLIGHT_TIME_MISMATCH',
    ]));
    expect(candidate.expectedAssertions).toEqual(expect.arrayContaining([
      'source-backed price_dates align with product_prices',
      'source-backed outbound and inbound flight times are saved and renderable',
    ]));
    expect(candidate.targetModules).toEqual(expect.arrayContaining([
      'src/lib/product-registration/price-recovery.ts',
      'src/lib/supplier-raw-deterministic-facts.ts',
    ]));
    expect(candidate.sourceExcerpt).toContain('장가계 원문');
  });

  it('prefers structured diagnostics already stored in parsed_draft_json', () => {
    const candidate = buildUploadReviewFixtureCandidate(row({
      error_reason: 'generic failure',
      parsed_draft_json: {
        _product_registration_failure_diagnostics: {
          diagnostics: [{
            code: 'DESTINATION_UNRESOLVED',
            severity: 'critical',
            message: 'destination_code:UNK',
            nextAction: 'Resolve destination.',
          }],
        },
      },
    }));

    expect(candidate.codes[0]).toBe('DESTINATION_UNRESOLVED');
    expect(candidate.nextAction).toBe('Resolve destination.');
    expect(candidate.targetModules).toContain('src/lib/product-registration/destination-resolution.ts');
  });

  it('deduplicates repeated rows by normalized content hash, product title, and codes', () => {
    const report = buildUploadReviewFixtureCandidateReport({
      generatedAt: '2026-06-15T00:00:00.000Z',
      rows: [
        row(),
        row({ id: '22222222-2222-4222-8222-222222222222' }),
      ],
    });

    expect(report.sourceRows).toBe(2);
    expect(report.candidateCount).toBe(1);
    expect(report.dedupedCount).toBe(1);
    expect(report.codeCounts.FLIGHT_TIME_MISMATCH).toBe(1);
  });
});
