/**
 * Blog inline image insertion.
 *
 * General topic posts often receive only an OG cover. This helper keeps the
 * on-site article and exported blog body image-rich by inserting safe Pexels
 * images below H2 sections before the SEO score is calculated.
 */

import { destToEnKeyword, isPexelsConfigured, searchPexelsPhotos } from '@/lib/pexels';
import { buildBlogImageSearchQuery, selectRelevantPexelsPhoto } from '@/lib/blog-image-relevance';
import { generateSectionImage, isGeneratedBlogImageUrl } from '@/lib/blog-image-gen';

const IMAGE_RE = /!\[([^\]]*)\]\(([^)]+)\)/g;
const H2_RE = /^##\s+(.+)$/;

interface BlogInlineImageOptions {
  markdown: string;
  destination?: string | null;
  primaryKeyword?: string | null;
  ogImageUrl?: string | null;
  minImages?: number;
  maxImages?: number;
  fallbackImageUrls?: string[];
  preferFallbackImages?: boolean;
  allowPexelsSearch?: boolean;
  allowGeneratedFallback?: boolean;
  maxExternalAssetAttempts?: number;
}

export interface BlogInlineImageResult {
  markdown: string;
  inserted: number;
  imageCount: number;
}

function getMarkdownImages(markdown: string): Array<{ alt: string; url: string }> {
  const images: Array<{ alt: string; url: string }> = [];
  let match: RegExpExecArray | null;
  while ((match = IMAGE_RE.exec(markdown)) !== null) {
    images.push({ alt: match[1] ?? '', url: match[2] ?? '' });
  }
  return images;
}

export function extractBlogInlineImageUrls(markdown: string | null | undefined): string[] {
  if (!markdown) return [];
  return [...new Set(getMarkdownImages(markdown)
    .map((image) => image.url.trim())
    .filter((url) => /^https:\/\//i.test(url)))];
}

function cleanHeading(raw: string): string {
  return raw
    .replace(/[#*_`[\]【】|]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 60);
}

function buildAlt(destination: string | null | undefined, heading: string, fallback: string): string {
  const dest = (destination || fallback || '여행').trim();
  const title = cleanHeading(heading).replace(/^\d+[.)]\s*/, '');
  const alt = title && !title.includes(dest) ? `${dest} ${title}` : `${dest} 여행 이미지`;
  return alt.replace(/\s+/g, ' ').slice(0, 44).trim();
}

function buildImageLabel(baseAlt: string, url: string): { alt: string; caption: string } {
  if (!isGeneratedBlogImageUrl(url)) return { alt: baseAlt, caption: baseAlt };
  const disclosure = 'AI 생성 참고 이미지';
  return {
    alt: `${disclosure}: ${baseAlt}`.slice(0, 80),
    caption: `${disclosure} · 실제 현장 기록이나 최신 운영 상황의 증거로 사용하지 않습니다.`,
  };
}

function sectionAlreadyHasImage(lines: string[], headingIndex: number): boolean {
  for (let i = headingIndex + 1; i < Math.min(lines.length, headingIndex + 5); i += 1) {
    const line = lines[i]?.trim() ?? '';
    if (line.startsWith('## ')) break;
    if (IMAGE_RE.test(line)) {
      IMAGE_RE.lastIndex = 0;
      return true;
    }
    IMAGE_RE.lastIndex = 0;
  }
  return false;
}

export async function findRelevantBlogPexelsImage(input: {
  destination?: string | null;
  primaryKeyword?: string | null;
  sectionTitle?: string | null;
  usedUrls?: Set<string>;
  minimumScore?: number;
}): Promise<string | null> {
  if (!isPexelsConfigured()) return null;
  try {
    const destinationQuery = input.destination
      ? destToEnKeyword(input.destination)
      : (input.primaryKeyword || 'travel destination');
    const query = buildBlogImageSearchQuery({
      destinationQuery,
      primaryKeyword: input.primaryKeyword,
      sectionTitle: cleanHeading(input.sectionTitle ?? ''),
    });
    const photos = await searchPexelsPhotos(query, 18, 1);
    const photo = selectRelevantPexelsPhoto(photos, {
      destinationQuery,
      primaryKeyword: input.primaryKeyword,
      sectionTitle: input.sectionTitle,
      usedUrls: input.usedUrls,
      minimumScore: input.minimumScore,
    });
    return photo
      ? photo.src.landscape || photo.src.large2x || photo.src.large || photo.src.original
      : null;
  } catch {
    return null;
  }
}

export async function ensureBlogInlineImages(options: BlogInlineImageOptions): Promise<BlogInlineImageResult> {
  const minImages = Math.max(1, options.minImages ?? 2);
  const maxImages = Math.max(minImages, options.maxImages ?? 3);
  const existingImages = getMarkdownImages(options.markdown);
  if (existingImages.length >= minImages) {
    return { markdown: options.markdown, inserted: 0, imageCount: existingImages.length };
  }

  const usedUrls = new Set(existingImages.map((image) => image.url).filter(Boolean));
  const fallbackImageUrls = [
    ...(options.fallbackImageUrls ?? []),
    ...(options.ogImageUrl ? [options.ogImageUrl] : []),
  ].filter((url) => /^https:\/\//i.test(url));
  const takeFallbackImage = (): string | null =>
    fallbackImageUrls.find((url) => !usedUrls.has(url)) ?? null;
  const lines = options.markdown.split('\n');
  const h2Indexes = lines
    .map((line, index) => ({ line, index, match: line.match(H2_RE) }))
    .filter((item): item is { line: string; index: number; match: RegExpMatchArray } => !!item.match);

  let inserted = 0;
  let imageCount = existingImages.length;
  let externalAssetAttempts = 0;
  const maxExternalAssetAttempts = Math.max(0, options.maxExternalAssetAttempts ?? maxImages);

  for (const h2 of h2Indexes) {
    if (imageCount >= minImages || inserted >= maxImages) break;
    if (sectionAlreadyHasImage(lines, h2.index)) continue;

    const heading = h2.match[1] ?? '';
    let url: string | null = null;
    if (options.preferFallbackImages) {
      url = takeFallbackImage();
    }
    const canAttemptExternalAsset = externalAssetAttempts < maxExternalAssetAttempts;
    if (!url && canAttemptExternalAsset && options.allowPexelsSearch !== false) {
      externalAssetAttempts += 1;
      url = await findRelevantBlogPexelsImage({
        destination: options.destination,
        primaryKeyword: options.primaryKeyword,
        sectionTitle: heading,
        usedUrls,
      });
    }
    if (!url && canAttemptExternalAsset && options.allowGeneratedFallback !== false) {
      if (options.allowPexelsSearch === false) externalAssetAttempts += 1;
      url = await generateSectionImage(
        heading,
        options.primaryKeyword || heading,
        options.destination || undefined,
        { skipPexelsFallback: true },
      );
    }
    if (!url) {
      url = takeFallbackImage();
    }

    if (!url) continue;
    usedUrls.add(url);
    const baseAlt = buildAlt(options.destination, heading, options.primaryKeyword || '');
    const label = buildImageLabel(baseAlt, url);
    const caption = `<figcaption>${label.caption}</figcaption>`;
    lines.splice(h2.index + 1 + inserted * 2, 0, `![${label.alt}](${url})`, caption);
    inserted += 1;
    imageCount += 1;
  }

  const finalFallbackUrl = takeFallbackImage();
  if (imageCount < minImages && finalFallbackUrl) {
    const baseAlt = buildAlt(options.destination, '여행 핵심 이미지', options.primaryKeyword || '');
    const label = buildImageLabel(baseAlt, finalFallbackUrl);
    lines.push('', `![${label.alt}](${finalFallbackUrl})`, `<figcaption>${label.caption}</figcaption>`);
    inserted += 1;
    imageCount += 1;
  }

  return {
    markdown: lines.join('\n').replace(/\n{4,}/g, '\n\n\n'),
    inserted,
    imageCount,
  };
}
