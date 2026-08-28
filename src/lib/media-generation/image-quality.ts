import { createHash } from 'node:crypto';
import sharp, { type Metadata } from 'sharp';
import type { MediaQaReportV1 } from './types';

const MAX_INPUT_BYTES = 10 * 1024 * 1024;
const MAX_OUTPUT_BYTES = 6 * 1024 * 1024;

export interface NormalizedMediaImage {
  bytes: Buffer;
  ogBytes: Buffer;
  squareBytes: Buffer;
  portraitBytes: Buffer;
  width: number;
  height: number;
  mimeType: 'image/webp';
  sha256: string;
  ogSha256: string;
  squareSha256: string;
  portraitSha256: string;
  qa: MediaQaReportV1;
}

export async function normalizeAndInspectMediaImage(input: Buffer): Promise<NormalizedMediaImage> {
  const issues: string[] = [];
  const checks = {
    decoded: false,
    allowedMime: false,
    minimumDimensions: false,
    maximumBytes: input.length > 0 && input.length <= MAX_INPUT_BYTES,
    expectedAspectRatio: false,
  };
  if (!checks.maximumBytes) issues.push('input_bytes_out_of_bounds');

  let metadata: Metadata;
  try {
    metadata = await sharp(input, { failOn: 'error' }).metadata();
    checks.decoded = true;
  } catch {
    throw new Error('generated image could not be decoded');
  }
  checks.allowedMime = ['jpeg', 'png', 'webp'].includes(metadata.format ?? '');
  checks.minimumDimensions = (metadata.width ?? 0) >= 1024 && (metadata.height ?? 0) >= 768;
  if (!checks.allowedMime) issues.push('unsupported_image_format');
  if (!checks.minimumDimensions) issues.push('image_dimensions_too_small');

  const [bytes, ogBytes, squareBytes, portraitBytes] = await Promise.all([
    sharp(input, { failOn: 'error' })
      .rotate()
      .resize(1536, 864, { fit: 'cover', position: 'attention' })
      .webp({ quality: 88, effort: 5 })
      .toBuffer(),
    sharp(input, { failOn: 'error' })
      .rotate()
      .resize(1200, 630, { fit: 'cover', position: 'attention' })
      .webp({ quality: 86, effort: 5 })
      .toBuffer(),
    sharp(input, { failOn: 'error' })
      .rotate()
      .resize(1080, 1080, { fit: 'cover', position: 'attention' })
      .webp({ quality: 86, effort: 5 })
      .toBuffer(),
    sharp(input, { failOn: 'error' })
      .rotate()
      .resize(1080, 1350, { fit: 'cover', position: 'attention' })
      .webp({ quality: 86, effort: 5 })
      .toBuffer(),
  ]);
  checks.expectedAspectRatio = true;
  if ([bytes, ogBytes, squareBytes, portraitBytes].some((output) => output.length > MAX_OUTPUT_BYTES)) {
    checks.maximumBytes = false;
    issues.push('normalized_image_too_large');
  }

  const qa: MediaQaReportV1 = {
    version: 'media-qa-v1',
    passed: Object.values(checks).every(Boolean),
    checks,
    issues,
  };
  if (!qa.passed) throw new Error(`generated image failed QA: ${issues.join(',')}`);

  return {
    bytes,
    ogBytes,
    squareBytes,
    portraitBytes,
    width: 1536,
    height: 864,
    mimeType: 'image/webp',
    sha256: createHash('sha256').update(bytes).digest('hex'),
    ogSha256: createHash('sha256').update(ogBytes).digest('hex'),
    squareSha256: createHash('sha256').update(squareBytes).digest('hex'),
    portraitSha256: createHash('sha256').update(portraitBytes).digest('hex'),
    qa,
  };
}
