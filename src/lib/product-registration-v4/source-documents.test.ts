import { describe, expect, it } from 'vitest';

import { resolveProductSourceStorageMime, validateSourceBytes } from './source-documents';

describe('product registration V4 source preflight', () => {
  it('accepts canonical HWP OLE bytes', () => {
    expect(validateSourceBytes({
      sourceType: 'hwp',
      buffer: Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0x00]),
    })).toEqual([]);
  });

  it('rejects an HWP file with a mismatched signature', () => {
    expect(validateSourceBytes({ sourceType: 'hwp', buffer: Buffer.from('not-hwp') })).toContain('HWP_OLE_SIGNATURE_REQUIRED');
  });

  it('accepts HWPX ZIP and PDF signatures', () => {
    expect(validateSourceBytes({ sourceType: 'hwpx', buffer: Buffer.from([0x50, 0x4b, 0x03, 0x04]) })).toEqual([]);
    expect(validateSourceBytes({ sourceType: 'pdf', buffer: Buffer.from('%PDF-1.7') })).toEqual([]);
  });

  it('rejects unsupported image bytes before OCR/parser work', () => {
    expect(validateSourceBytes({ sourceType: 'image', buffer: Buffer.from('html') })).toContain('IMAGE_SIGNATURE_REQUIRED');
  });

  it('uses a verified HWP storage MIME when the browser declares octet-stream', () => {
    expect(resolveProductSourceStorageMime({
      sourceType: 'hwp',
      buffer: Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]),
      declaredMime: 'application/octet-stream',
    })).toBe('application/x-hwp');
  });

  it('keeps an explicit allowed MIME and infers image MIME from verified bytes', () => {
    expect(resolveProductSourceStorageMime({
      sourceType: 'pdf',
      buffer: Buffer.from('%PDF-1.7'),
      declaredMime: 'application/pdf',
    })).toBe('application/pdf');
    expect(resolveProductSourceStorageMime({
      sourceType: 'image',
      buffer: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    })).toBe('image/png');
  });
});
