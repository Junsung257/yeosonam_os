import { describe, expect, it } from 'vitest';

import { compareCriticalHwpParserParity, extractSourceDocumentToIR } from './extractions';

describe('product registration V4 extraction profiles', () => {
  it('blocks a fallback parser result when a critical price token disagrees', () => {
    const parity = compareCriticalHwpParserParity(
      '출발일 8/28 성인 899,000원 포함 호텔',
      '출발일 8/28 성인 999,000원 포함 호텔',
    );

    expect(parity.matches).toBe(false);
    expect(parity.missingFromPrimary).toContain('999,000원');
    expect(parity.missingFromFallback).toContain('899,000원');
  });

  it('fails closed for image OCR unless the profile is explicitly enabled', async () => {
    const previous = process.env.PRODUCT_REGISTRATION_V6_OCR_ENABLED;
    process.env.PRODUCT_REGISTRATION_V6_OCR_ENABLED = '0';
    try {
      await expect(extractSourceDocumentToIR({
        buffer: Buffer.from('not-an-image'),
        filename: 'supplier.png',
        sourceType: 'image',
      })).rejects.toThrow('OCR_PROFILE_DISABLED');
    } finally {
      if (previous === undefined) delete process.env.PRODUCT_REGISTRATION_V6_OCR_ENABLED;
      else process.env.PRODUCT_REGISTRATION_V6_OCR_ENABLED = previous;
    }
  });
});
