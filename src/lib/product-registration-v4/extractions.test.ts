import { describe, expect, it } from 'vitest';

import { extractSourceDocumentToIR } from './extractions';

describe('product registration V4 extraction profiles', () => {
  it('fails closed for image OCR unless the profile is explicitly enabled', async () => {
    const previous = process.env.PRODUCT_REGISTRATION_V4_OCR_ENABLED;
    process.env.PRODUCT_REGISTRATION_V4_OCR_ENABLED = '0';
    try {
      await expect(extractSourceDocumentToIR({
        buffer: Buffer.from('not-an-image'),
        filename: 'supplier.png',
        sourceType: 'image',
      })).rejects.toThrow('OCR_PROFILE_DISABLED');
    } finally {
      if (previous === undefined) delete process.env.PRODUCT_REGISTRATION_V4_OCR_ENABLED;
      else process.env.PRODUCT_REGISTRATION_V4_OCR_ENABLED = previous;
    }
  });
});
