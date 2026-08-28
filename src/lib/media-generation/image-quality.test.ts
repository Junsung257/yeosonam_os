import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { normalizeAndInspectMediaImage } from './image-quality';

describe('normalizeAndInspectMediaImage', () => {
  it('normalizes a valid source into immutable WebP main and OG variants', async () => {
    const input = await sharp({
      create: { width: 1536, height: 1024, channels: 3, background: '#c8d7e8' },
    }).png().toBuffer();
    const result = await normalizeAndInspectMediaImage(input);
    const [main, og, square, portrait] = await Promise.all([
      sharp(result.bytes).metadata(),
      sharp(result.ogBytes).metadata(),
      sharp(result.squareBytes).metadata(),
      sharp(result.portraitBytes).metadata(),
    ]);

    expect(result.qa.passed).toBe(true);
    expect(result.mimeType).toBe('image/webp');
    expect([main.width, main.height]).toEqual([1536, 864]);
    expect([og.width, og.height]).toEqual([1200, 630]);
    expect([square.width, square.height]).toEqual([1080, 1080]);
    expect([portrait.width, portrait.height]).toEqual([1080, 1350]);
    expect(result.sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it('rejects undersized generated images', async () => {
    const input = await sharp({
      create: { width: 640, height: 480, channels: 3, background: '#ffffff' },
    }).jpeg().toBuffer();
    await expect(normalizeAndInspectMediaImage(input)).rejects.toThrow('image_dimensions_too_small');
  });
});
