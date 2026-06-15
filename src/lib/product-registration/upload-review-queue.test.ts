import { describe, expect, it, vi } from 'vitest';
import { scheduleUploadReviewInsert } from './upload-review-queue';

describe('scheduleUploadReviewInsert', () => {
  it('embeds structured failure diagnostics in the existing parsed draft JSON payload', () => {
    const insert = vi.fn(() => Promise.resolve({ error: null }));
    const supabase = {
      from: vi.fn(() => ({ insert })),
    };

    scheduleUploadReviewInsert({
      supabase: supabase as never,
      isSupabaseConfigured: true,
      severity: 'critical',
      errorReason: 'Customer landing/A4 blocked: price_dates missing | flight time source mismatch',
      sourceFilename: 'jangjiajie.txt',
      fileHash: 'file-hash',
      normalizedContentHash: 'normalized-hash',
      rawText: 'raw source',
      parsedDraftJson: { title: '장가계' },
      productTitle: '장가계',
      landOperatorId: null,
    });

    expect(supabase.from).toHaveBeenCalledWith('upload_review_queue');
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({
      parsed_draft_json: expect.objectContaining({
        title: '장가계',
        _product_registration_failure_diagnostics: expect.objectContaining({
          codes: expect.arrayContaining([
            'CUSTOMER_RENDER_BLOCKED',
            'PRICE_DATES_MISSING',
            'FLIGHT_TIME_MISMATCH',
          ]),
          hasCritical: true,
        }),
      }),
    }));
  });
});
