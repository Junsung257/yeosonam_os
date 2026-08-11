import { describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { computeBlogImagePerceptualHashV3, evaluateBlogImageAltV3, findCrossDestinationImageDuplicatesV3, hammingDistanceHexV3, rankBlogImageCandidateV3 } from './blog-image-quality-v3';

describe('blog image quality v3', () => {
  it('detects perceptually identical images across destinations', () => {
    const duplicates = findCrossDestinationImageDuplicatesV3([
      { assetId: 'a', url: 'a', destinationId: 'osaka', imageType: 'stock', isFirstParty: false, isGenerated: false, perceptualHash: 'ffffffffffffffff', alt: '난바역 앞 교차로' },
      { assetId: 'b', url: 'b', destinationId: 'paris', imageType: 'stock', isFirstParty: false, isGenerated: false, perceptualHash: 'fffffffffffffffe', alt: '에펠탑 전경' },
    ]);
    expect(duplicates).toHaveLength(1);
    expect(hammingDistanceHexV3('f', 'e')).toBe(1);
  });
  it('rejects generic and title-copy alt text', () => {
    expect(evaluateBlogImageAltV3('여행 준비 장면')).toContain('alt_generic_scene');
    expect(evaluateBlogImageAltV3('오사카 숙소 위치', '오사카 숙소 위치')).toContain('alt_copies_full_title');
  });

  it('computes a stable perceptual hash and prioritizes exact first-party assets', async () => {
    const image = await sharp({ create: { width: 32, height: 32, channels: 3, background: '#336699' } }).png().toBuffer();
    await expect(computeBlogImagePerceptualHashV3(image)).resolves.toMatch(/^[0-9a-f]{16}$/);
    const base = { assetId: 'a', url: 'https://example.com/a.jpg', alt: '오사카성 해자와 천수각', isGenerated: false, perceptualHash: null, width: 1200, height: 800 };
    expect(rankBlogImageCandidateV3({ ...base, destinationId: 'osaka', imageType: 'first_party', isFirstParty: true }, 'osaka'))
      .toBeGreaterThan(rankBlogImageCandidateV3({ ...base, assetId: 'b', destinationId: 'paris', imageType: 'stock', isFirstParty: false }, 'osaka'));
  });
});
