import { createHash } from 'crypto';
import sharp from 'sharp';
import { destToEnKeyword, isPexelsConfigured, searchPexelsPhotos } from '@/lib/pexels';
import { supabaseAdmin } from '@/lib/supabase';

const MARKDOWN_IMAGE_RE = /!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
const FIGCAPTION_LINE_RE = /^\s*<figcaption\b[\s\S]*<\/figcaption>\s*$/i;
const DEFAULT_TIMEOUT_MS = 3500;
const MAX_SOURCE_BYTES = 10 * 1024 * 1024;
const MIN_IMAGE_WIDTH = 900;
const MIN_IMAGE_HEIGHT = 500;
const MIN_LANDSCAPE_RATIO = 1.25;
const MAX_LANDSCAPE_RATIO = 2.25;
const STORAGE_BUCKET = 'blog-assets';

const MIRRORABLE_HOSTS = new Set([
  'images.pexels.com',
  'upload.wikimedia.org',
  'commons.wikimedia.org',
  'dry7pvlp22cox.cloudfront.net',
]);

export interface BlogMarkdownImage {
  alt: string;
  url: string;
  raw: string;
  index: number;
}

export interface BlogImageAssetEntry {
  alt: string;
  originalUrl: string;
  finalUrl?: string;
  status: 'mirrored' | 'kept' | 'removed' | 'failed';
  reason?: string;
  width?: number;
  height?: number;
  storagePath?: string;
}

export interface BlogImageAssetReport {
  markdown: string;
  changed: boolean;
  entries: BlogImageAssetEntry[];
  mirrored: number;
  removed: number;
  failed: number;
}

interface DownloadedImage {
  buffer: Buffer;
  contentType: string;
  width?: number;
  height?: number;
}

type FetchLike = typeof fetch;

export interface StabilizeBlogMarkdownImagesOptions {
  markdown: string;
  slug: string;
  baseUrl?: string;
  maxImages?: number;
  timeoutMs?: number;
  removeBroken?: boolean;
  requireMirroredExternal?: boolean;
  fetchImpl?: FetchLike;
  uploadAsset?: (input: {
    buffer: Buffer;
    path: string;
    contentType: string;
    sourceUrl: string;
  }) => Promise<string>;
  destination?: string | null;
  primaryKeyword?: string | null;
}

function normalizeBaseUrl(value?: string | null): string {
  return (value || process.env.NEXT_PUBLIC_BASE_URL || 'https://www.yeosonam.com').replace(/\/$/, '');
}

function extractMarkdownImages(markdown: string): BlogMarkdownImage[] {
  const images: BlogMarkdownImage[] = [];
  let match: RegExpExecArray | null;
  while ((match = MARKDOWN_IMAGE_RE.exec(markdown)) !== null) {
    images.push({
      alt: (match[1] ?? '').trim(),
      url: (match[2] ?? '').trim(),
      raw: match[0],
      index: match.index,
    });
  }
  return images;
}

function resolveImageUrl(rawUrl: string, baseUrl: string): string | null {
  try {
    if (/^https?:\/\//i.test(rawUrl)) return rawUrl;
    if (rawUrl.startsWith('/')) return new URL(rawUrl, baseUrl).toString();
    return null;
  } catch {
    return null;
  }
}

function isSupabaseStorageUrl(rawUrl: string): boolean {
  try {
    const url = new URL(rawUrl);
    return url.hostname.endsWith('.supabase.co') && url.pathname.includes('/storage/v1/object/public/');
  } catch {
    return false;
  }
}

function isInternalSiteUrl(rawUrl: string, baseUrl: string): boolean {
  try {
    const url = new URL(rawUrl, baseUrl);
    const base = new URL(baseUrl);
    return url.hostname === base.hostname;
  } catch {
    return rawUrl.startsWith('/');
  }
}

function shouldMirrorImageUrl(rawUrl: string, baseUrl: string): boolean {
  if (isSupabaseStorageUrl(rawUrl) || isInternalSiteUrl(rawUrl, baseUrl)) return false;
  try {
    const url = new URL(rawUrl);
    return MIRRORABLE_HOSTS.has(url.hostname) || url.hostname.endsWith('.wikimedia.org');
  } catch {
    return false;
  }
}

function safeSlugPart(value: string): string {
  const ascii = value
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80);
  return ascii || 'blog-post';
}

function buildStoragePath(slug: string, image: BlogMarkdownImage, ordinal: number): string {
  const hash = createHash('sha256').update(image.url).digest('hex').slice(0, 12);
  return `blog-inline/${safeSlugPart(slug)}/${String(ordinal + 1).padStart(2, '0')}-${hash}.webp`;
}

async function fetchWithTimeout(fetchImpl: FetchLike, url: string, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchImpl(url, {
      headers: {
        accept: 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
        'user-agent': 'yeosonam-blog-image-assets/1.0',
      },
      signal: controller.signal,
      cache: 'no-store',
    });
  } finally {
    clearTimeout(timer);
  }
}

async function downloadImage(url: string, fetchImpl: FetchLike, timeoutMs: number): Promise<DownloadedImage> {
  const response = await fetchWithTimeout(fetchImpl, url, timeoutMs);
  if (!response.ok) throw new Error(`image_fetch_${response.status}`);

  const contentType = response.headers.get('content-type') || 'application/octet-stream';
  if (!contentType.toLowerCase().startsWith('image/')) throw new Error('not_image_content_type');

  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.byteLength === 0) throw new Error('empty_image');
  if (buffer.byteLength > MAX_SOURCE_BYTES) throw new Error('image_too_large');

  const metadata = await sharp(buffer, { animated: false, limitInputPixels: 24_000_000 }).metadata();
  const width = metadata.width;
  const height = metadata.height;
  if ((width ?? 0) < MIN_IMAGE_WIDTH || (height ?? 0) < MIN_IMAGE_HEIGHT) {
    throw new Error(`image_too_small:${width ?? 0}x${height ?? 0}`);
  }
  const ratio = width && height ? width / height : 0;
  if (ratio < MIN_LANDSCAPE_RATIO || ratio > MAX_LANDSCAPE_RATIO) {
    throw new Error(`image_bad_ratio:${width ?? 0}x${height ?? 0}`);
  }

  return { buffer, contentType, width, height };
}

async function defaultUploadAsset(input: {
  buffer: Buffer;
  path: string;
  contentType: string;
}): Promise<string> {
  const { error } = await supabaseAdmin.storage
    .from(STORAGE_BUCKET)
    .upload(input.path, input.buffer, { contentType: input.contentType, upsert: true });
  if (error) throw new Error(`storage_upload_failed:${error.message}`);

  const {
    data: { publicUrl },
  } = supabaseAdmin.storage.from(STORAGE_BUCKET).getPublicUrl(input.path);
  if (!publicUrl) throw new Error('storage_public_url_missing');
  return publicUrl;
}

function replaceImageUrl(markdown: string, image: BlogMarkdownImage, nextUrl: string): string {
  return markdown.replace(image.raw, `![${image.alt}](${nextUrl})`);
}

function removeImages(markdown: string, urls: Set<string>): string {
  const lines = markdown.split('\n');
  const result: string[] = [];
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? '';
    const match = line.match(MARKDOWN_IMAGE_RE);
    MARKDOWN_IMAGE_RE.lastIndex = 0;
    if (match) {
      const urlMatch = line.match(/!\[[^\]]*]\(([^)\s]+)(?:\s+"[^"]*")?\)/);
      const url = urlMatch?.[1]?.trim();
      if (url && urls.has(url)) {
        const nextLine = lines[i + 1] ?? '';
        if (FIGCAPTION_LINE_RE.test(nextLine)) i += 1;
        continue;
      }
    }
    result.push(line);
  }
  return result.join('\n').replace(/\n{4,}/g, '\n\n\n');
}

function buildReplacementQuery(options: {
  destination?: string | null;
  primaryKeyword?: string | null;
  alt?: string | null;
}): string {
  const base = options.destination
    ? destToEnKeyword(options.destination)
    : (options.primaryKeyword || 'travel destination');
  const altHint = options.alt?.replace(/[^\p{Script=Hangul}\p{Letter}\p{Number}\s]+/gu, ' ').trim();
  const context = altHint && altHint.length <= 60 ? altHint : options.primaryKeyword;
  return `${base} ${context || ''} travel landscape landmark`.replace(/\s+/g, ' ').trim();
}

async function pickQualityPexelsReplacement(options: {
  destination?: string | null;
  primaryKeyword?: string | null;
  alt?: string | null;
  usedUrls: Set<string>;
}): Promise<string | null> {
  if (!isPexelsConfigured()) return null;
  try {
    const query = buildReplacementQuery(options);
    const photos = await searchPexelsPhotos(query, 12, 1, { orientation: 'landscape', locale: 'ko-KR' });
    const candidates = photos
      .map((photo) => {
        const width = photo.width || 0;
        const height = photo.height || 0;
        const ratio = height > 0 ? width / height : 0;
        const url = photo.src.landscape || photo.src.large2x || photo.src.large || photo.src.original;
        const score =
          (width >= 1600 ? 4 : width >= 1200 ? 3 : width >= MIN_IMAGE_WIDTH ? 1 : -4) +
          (ratio >= MIN_LANDSCAPE_RATIO && ratio <= MAX_LANDSCAPE_RATIO ? 3 : -5) +
          (photo.alt && options.alt && photo.alt.toLowerCase().includes(options.alt.toLowerCase().slice(0, 12)) ? 1 : 0);
        return { url, score };
      })
      .filter((candidate) => candidate.url && !options.usedUrls.has(candidate.url))
      .sort((a, b) => b.score - a.score);
    return candidates[0]?.url ?? null;
  } catch {
    return null;
  }
}

async function mirrorResolvedImage(options: {
  resolvedUrl: string;
  image: BlogMarkdownImage;
  slug: string;
  ordinal: number;
  fetchImpl: FetchLike;
  timeoutMs: number;
  uploadAsset: NonNullable<StabilizeBlogMarkdownImagesOptions['uploadAsset']>;
}): Promise<{ publicUrl: string; width?: number; height?: number; storagePath: string }> {
  const downloaded = await downloadImage(options.resolvedUrl, options.fetchImpl, options.timeoutMs);
  const optimized = await sharp(downloaded.buffer, { animated: false, limitInputPixels: 24_000_000 })
    .rotate()
    .resize({ width: 1200, height: 675, fit: 'cover', withoutEnlargement: true })
    .webp({ quality: 78, effort: 4 })
    .toBuffer();
  const storagePath = buildStoragePath(options.slug, {
    ...options.image,
    url: options.resolvedUrl,
  }, options.ordinal);
  const publicUrl = await options.uploadAsset({
    buffer: optimized,
    path: storagePath,
    contentType: 'image/webp',
    sourceUrl: options.resolvedUrl,
  });
  return { publicUrl, width: downloaded.width, height: downloaded.height, storagePath };
}

export async function stabilizeBlogMarkdownImages(
  options: StabilizeBlogMarkdownImagesOptions,
): Promise<BlogImageAssetReport> {
  const baseUrl = normalizeBaseUrl(options.baseUrl);
  const fetchImpl = options.fetchImpl ?? fetch;
  const uploadAsset = options.uploadAsset ?? defaultUploadAsset;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const removeBroken = options.removeBroken ?? true;
  const requireMirroredExternal = options.requireMirroredExternal ?? false;
  const maxImages = Math.max(1, options.maxImages ?? 8);
  const images = extractMarkdownImages(options.markdown).slice(0, maxImages);

  let markdown = options.markdown;
  const entries: BlogImageAssetEntry[] = [];
  const removeUrls = new Set<string>();
  const usedUrls = new Set(images.map((image) => image.url));

  for (let ordinal = 0; ordinal < images.length; ordinal += 1) {
    const image = images[ordinal];
    const resolvedUrl = resolveImageUrl(image.url, baseUrl);
    if (!resolvedUrl) {
      entries.push({ alt: image.alt, originalUrl: image.url, status: 'removed', reason: 'invalid_url' });
      removeUrls.add(image.url);
      continue;
    }

    const mirror = shouldMirrorImageUrl(resolvedUrl, baseUrl);
    try {
      const downloaded = await downloadImage(resolvedUrl, fetchImpl, timeoutMs);
      if (!mirror) {
        entries.push({
          alt: image.alt,
          originalUrl: image.url,
          finalUrl: image.url,
          status: 'kept',
          width: downloaded.width,
          height: downloaded.height,
        });
        continue;
      }

      const mirrored = await mirrorResolvedImage({
        resolvedUrl,
        image,
        slug: options.slug,
        ordinal,
        fetchImpl,
        timeoutMs,
        uploadAsset,
      });
      markdown = replaceImageUrl(markdown, image, mirrored.publicUrl);
      entries.push({
        alt: image.alt,
        originalUrl: image.url,
        finalUrl: mirrored.publicUrl,
        status: 'mirrored',
        width: mirrored.width,
        height: mirrored.height,
        storagePath: mirrored.storagePath,
      });
      usedUrls.add(mirrored.publicUrl);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      const replacementUrl = await pickQualityPexelsReplacement({
        destination: options.destination,
        primaryKeyword: options.primaryKeyword,
        alt: image.alt,
        usedUrls,
      });
      if (replacementUrl) {
        try {
          const mirrored = await mirrorResolvedImage({
            resolvedUrl: replacementUrl,
            image: { ...image, url: replacementUrl },
            slug: options.slug,
            ordinal,
            fetchImpl,
            timeoutMs,
            uploadAsset,
          });
          markdown = replaceImageUrl(markdown, image, mirrored.publicUrl);
          usedUrls.add(replacementUrl);
          usedUrls.add(mirrored.publicUrl);
          entries.push({
            alt: image.alt,
            originalUrl: image.url,
            finalUrl: mirrored.publicUrl,
            status: 'mirrored',
            reason: `replacement_for:${reason}`,
            width: mirrored.width,
            height: mirrored.height,
            storagePath: mirrored.storagePath,
          });
          continue;
        } catch (replacementError) {
          const replacementReason = replacementError instanceof Error ? replacementError.message : String(replacementError);
          const status = removeBroken || (requireMirroredExternal && mirror) ? 'removed' : 'failed';
          entries.push({
            alt: image.alt,
            originalUrl: image.url,
            status,
            reason: `${reason};replacement_failed:${replacementReason}`,
          });
          if (status === 'removed') removeUrls.add(image.url);
          continue;
        }
      }
      const status = removeBroken || (requireMirroredExternal && mirror) ? 'removed' : 'failed';
      entries.push({ alt: image.alt, originalUrl: image.url, status, reason });
      if (status === 'removed') removeUrls.add(image.url);
    }
  }

  if (removeUrls.size > 0) {
    markdown = removeImages(markdown, removeUrls);
  }

  return {
    markdown,
    changed: markdown !== options.markdown,
    entries,
    mirrored: entries.filter((entry) => entry.status === 'mirrored').length,
    removed: entries.filter((entry) => entry.status === 'removed').length,
    failed: entries.filter((entry) => entry.status === 'failed').length,
  };
}

export function inspectStableBlogImageAssets(report: BlogImageAssetReport): {
  passed: boolean;
  reason?: string;
  evidence: Record<string, unknown>;
} {
  const unresolvedExternal = report.entries.filter((entry) =>
    ['failed', 'removed'].includes(entry.status),
  );
  return {
    passed: unresolvedExternal.length === 0,
    reason: unresolvedExternal.length > 0
      ? `blog image asset stabilization failed: ${unresolvedExternal.map((entry) => entry.reason || entry.status).join(', ')}`
      : undefined,
    evidence: {
      mirrored: report.mirrored,
      removed: report.removed,
      failed: report.failed,
      entries: report.entries,
    },
  };
}
