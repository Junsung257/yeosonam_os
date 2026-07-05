import { describe, expect, it, vi } from 'vitest';

import { scheduleUploadReviewInsert } from './upload-review-queue';

describe('scheduleUploadReviewInsert', () => {
  it('embeds structured failure diagnostics and source text evidence in the parsed draft JSON payload', () => {
    const insert = vi.fn(() => Promise.resolve({ error: null }));
    const supabase = {
      from: vi.fn(() => ({ insert })),
    };

    scheduleUploadReviewInsert({
      supabase: supabase as never,
      isSupabaseConfigured: true,
      severity: 'critical',
      errorReason: 'Customer landing/A4 blocked: price_dates missing | flight time source mismatch',
      sourceFilename: 'supplier.txt',
      fileHash: 'file-hash',
      normalizedContentHash: 'normalized-hash',
      rawText: 'section raw source',
      originalRawText: 'original supplier raw source with shared price table',
      parserRawText: 'parser raw source with product section',
      documentRawText: 'document raw source with shared price table',
      sectionRawText: 'section raw source',
      analysisNormalizedText: 'analysis normalized source',
      parsedDraftJson: { title: 'Sample package' },
      productTitle: 'Sample package',
      landOperatorId: null,
    });

    expect(supabase.from).toHaveBeenCalledWith('upload_review_queue');
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({
      parsed_draft_json: expect.objectContaining({
        title: 'Sample package',
        _product_registration_failure_diagnostics: expect.objectContaining({
          codes: expect.arrayContaining([
            'CUSTOMER_RENDER_BLOCKED',
            'PRICE_DATES_MISSING',
            'FLIGHT_TIME_MISMATCH',
          ]),
          hasCritical: true,
        }),
        _source_text_evidence_v2: expect.objectContaining({
          version: 2,
          documents: expect.arrayContaining([
            expect.objectContaining({ sourceId: 'original_raw', rawTextHash: expect.any(String), rawTextLength: expect.any(Number) }),
            expect.objectContaining({ sourceId: 'parser_raw', rawTextHash: expect.any(String), rawTextLength: expect.any(Number) }),
            expect.objectContaining({ sourceId: 'document_raw', rawTextHash: expect.any(String), rawTextLength: expect.any(Number) }),
            expect.objectContaining({ sourceId: 'section_raw', rawTextHash: expect.any(String), rawTextLength: expect.any(Number) }),
            expect.objectContaining({ sourceId: 'analysis_normalized', rawTextHash: expect.any(String), rawTextLength: expect.any(Number) }),
          ]),
        }),
      }),
    }));
  });
});
