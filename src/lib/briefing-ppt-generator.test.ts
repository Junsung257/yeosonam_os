import { describe, expect, it } from 'vitest';

import {
  detectSafeBriefingImageMime,
  isAllowedBriefingImageUrl,
} from './briefing-ppt-generator';

describe('briefing PPT image boundary', () => {
  it('only permits the approved HTTPS image host', () => {
    expect(isAllowedBriefingImageUrl('https://images.unsplash.com/photo-safe?w=1600')).toBe(true);
    expect(isAllowedBriefingImageUrl('http://images.unsplash.com/photo-safe')).toBe(false);
    expect(isAllowedBriefingImageUrl('https://example.com/payload.icns')).toBe(false);
    expect(isAllowedBriefingImageUrl('file:///etc/passwd')).toBe(false);
  });

  it('accepts safe raster signatures and rejects vulnerable formats', () => {
    expect(detectSafeBriefingImageMime(Uint8Array.from([0xff, 0xd8, 0xff, 0x00]))).toBe('image/jpeg');
    expect(detectSafeBriefingImageMime(Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe('image/png');
    expect(detectSafeBriefingImageMime(Buffer.from('GIF89a', 'ascii'))).toBe('image/gif');
    expect(detectSafeBriefingImageMime(Buffer.from('RIFF0000WEBP', 'ascii'))).toBe('image/webp');
    expect(detectSafeBriefingImageMime(Buffer.from('icns0000', 'ascii'))).toBeNull();
    expect(detectSafeBriefingImageMime(Buffer.from('JXL 0000', 'ascii'))).toBeNull();
  });
});
