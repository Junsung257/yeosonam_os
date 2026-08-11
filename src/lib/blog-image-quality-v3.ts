export interface BlogImageAssetV3 {
  assetId: string;
  url: string;
  destinationId?: string | null;
  landmarkEntityId?: string | null;
  imageType: string;
  isFirstParty: boolean;
  isGenerated: boolean;
  perceptualHash?: string | null;
  alt: string;
  width?: number | null;
  height?: number | null;
}

const IMAGE_TYPE_PRIORITY: Record<string, number> = {
  first_party: 700,
  authorized_customer: 650,
  authorized_staff: 640,
  official: 600,
  wikimedia: 500,
  stock: 400,
  generated: 200,
  decorative: 100,
};

const GENERIC_ALT_RE = /^(?:여행\s*준비\s*장면|비용\s*확인\s*장면|월별\s*날씨\s*확인|여행\s*이미지|관광지\s*이미지)$/u;

export function hammingDistanceHexV3(left: string, right: string): number {
  if (!/^[0-9a-f]+$/i.test(left) || left.length !== right.length) return Number.POSITIVE_INFINITY;
  let distance = 0;
  for (let i = 0; i < left.length; i += 1) {
    const xor = Number.parseInt(left[i], 16) ^ Number.parseInt(right[i], 16);
    distance += xor.toString(2).replace(/0/g, '').length;
  }
  return distance;
}

export function evaluateBlogImageAltV3(alt: string, title?: string | null): string[] {
  const clean = alt.replace(/\s+/g, ' ').trim();
  const failures: string[] = [];
  if (!clean) failures.push('alt_missing');
  if (GENERIC_ALT_RE.test(clean)) failures.push('alt_generic_scene');
  if (title && clean === title.replace(/\s+/g, ' ').trim()) failures.push('alt_copies_full_title');
  if (clean.length > 120) failures.push('alt_too_long');
  return failures;
}

export function findCrossDestinationImageDuplicatesV3(
  assets: BlogImageAssetV3[],
  maximumHammingDistance = 4,
): Array<{ leftAssetId: string; rightAssetId: string; distance: number }> {
  const duplicates: Array<{ leftAssetId: string; rightAssetId: string; distance: number }> = [];
  for (let leftIndex = 0; leftIndex < assets.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < assets.length; rightIndex += 1) {
      const left = assets[leftIndex];
      const right = assets[rightIndex];
      if (!left.destinationId || !right.destinationId || left.destinationId === right.destinationId) continue;
      if (!left.perceptualHash || !right.perceptualHash) continue;
      const distance = hammingDistanceHexV3(left.perceptualHash, right.perceptualHash);
      if (distance <= maximumHammingDistance) duplicates.push({ leftAssetId: left.assetId, rightAssetId: right.assetId, distance });
    }
  }
  return duplicates;
}

export function blogImageDisclosureV3(asset: BlogImageAssetV3): string | null {
  return asset.isGenerated ? 'AI 생성 참고 이미지' : null;
}

export function rankBlogImageCandidateV3(asset: BlogImageAssetV3, destinationId?: string | null): number {
  const exactLocation = Boolean(destinationId && asset.destinationId === destinationId);
  const wrongLocation = Boolean(destinationId && asset.destinationId && asset.destinationId !== destinationId);
  return (IMAGE_TYPE_PRIORITY[asset.imageType] || 0)
    + (asset.isFirstParty ? 50 : 0)
    + (exactLocation ? 40 : 0)
    - (wrongLocation ? 1000 : 0)
    - (evaluateBlogImageAltV3(asset.alt).length * 25);
}

/** 64-bit difference hash used for cross-destination duplicate detection. */
export async function computeBlogImagePerceptualHashV3(input: Buffer | string): Promise<string> {
  const { default: sharp } = await import('sharp');
  const { data } = await sharp(input, { animated: false, limitInputPixels: 24_000_000 })
    .rotate()
    .resize(9, 8, { fit: 'fill' })
    .greyscale()
    .raw()
    .toBuffer({ resolveWithObject: true });
  let bits = '';
  for (let row = 0; row < 8; row += 1) {
    for (let column = 0; column < 8; column += 1) {
      bits += data[row * 9 + column] > data[row * 9 + column + 1] ? '1' : '0';
    }
  }
  return BigInt(`0b${bits}`).toString(16).padStart(16, '0');
}
