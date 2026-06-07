/**
 * Blog inline image insertion.
 *
 * General topic posts often receive only an OG cover. This helper keeps the
 * on-site article and exported blog body image-rich by inserting safe Pexels
 * images below H2 sections before the SEO score is calculated.
 */

import { destToEnKeyword, isPexelsConfigured, searchPexelsPhotos } from '@/lib/pexels';

const IMAGE_RE = /!\[([^\]]*)\]\(([^)]+)\)/g;
const H2_RE = /^##\s+(.+)$/;

const SECTION_QUERY_HINTS: Array<[RegExp, string]> = [
  [/날씨|계절|우기|건기|기온|옷차림/, 'weather season travel'],
  [/맛집|식사|음식|레스토랑|미식/, 'local food restaurant'],
  [/호텔|숙소|리조트|객실|투숙/, 'hotel resort accommodation'],
  [/교통|이동|공항|항공|비행|픽업/, 'transport airport travel'],
  [/비용|가격|예산|환전|경비|가성비/, 'travel budget money'],
  [/일정|코스|동선|Day|일차/, 'itinerary sightseeing landmark'],
  [/쇼핑|시장|기념품|면세/, 'shopping market travel'],
  [/준비|체크리스트|준비물|팁|주의/, 'travel preparation checklist'],
  [/관광|명소|투어|액티비티|체험/, 'sightseeing attraction landmark'],
];

interface BlogInlineImageOptions {
  markdown: string;
  destination?: string | null;
  primaryKeyword?: string | null;
  ogImageUrl?: string | null;
  minImages?: number;
  maxImages?: number;
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

function buildPexelsQuery(destination: string | null | undefined, primaryKeyword: string | null | undefined, heading: string): string {
  const base = destination ? destToEnKeyword(destination) : (primaryKeyword || 'travel destination');
  const clean = cleanHeading(heading);
  const hint = SECTION_QUERY_HINTS.find(([re]) => re.test(clean))?.[1] ?? 'travel destination landscape';
  return `${base} ${hint}`.trim();
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

async function pickPexelsImage(query: string, usedUrls: Set<string>, seed = query): Promise<string | null> {
  if (!isPexelsConfigured()) return null;
  try {
    const page = 1 + (stableHash(seed) % 5);
    const photos = await searchPexelsPhotos(query, 10, page);
    const startIndex = stableHash(`${seed}:image`) % Math.max(1, photos.length);
    const rotated = photos.slice(startIndex).concat(photos.slice(0, startIndex));
    const picked = photos
      .length > 0
      ? rotated
      : photos;
    const url = picked
      .map((photo) => photo.src.landscape || photo.src.large2x || photo.src.large || photo.src.original)
      .find((url) => url && !usedUrls.has(url));
    return url ?? null;
  } catch {
    return null;
  }
}

function stableHash(value: string): number {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export async function ensureBlogInlineImages(options: BlogInlineImageOptions): Promise<BlogInlineImageResult> {
  const minImages = Math.max(1, options.minImages ?? 2);
  const maxImages = Math.max(minImages, options.maxImages ?? 3);
  const existingImages = getMarkdownImages(options.markdown);
  if (existingImages.length >= minImages) {
    return { markdown: options.markdown, inserted: 0, imageCount: existingImages.length };
  }

  const usedUrls = new Set(existingImages.map((image) => image.url).filter(Boolean));
  const lines = options.markdown.split('\n');
  const h2Indexes = lines
    .map((line, index) => ({ line, index, match: line.match(H2_RE) }))
    .filter((item): item is { line: string; index: number; match: RegExpMatchArray } => !!item.match);

  let inserted = 0;
  let imageCount = existingImages.length;

  for (const h2 of h2Indexes) {
    if (imageCount >= minImages || inserted >= maxImages) break;
    if (sectionAlreadyHasImage(lines, h2.index)) continue;

    const heading = h2.match[1] ?? '';
    let url: string | null = null;
    if (options.ogImageUrl && !usedUrls.has(options.ogImageUrl)) {
      url = options.ogImageUrl;
    } else {
      url = await pickPexelsImage(
        buildPexelsQuery(options.destination, options.primaryKeyword, heading),
        usedUrls,
        `${options.destination || ''}|${options.primaryKeyword || ''}|${heading}`,
      );
    }

    if (!url) continue;
    usedUrls.add(url);
    const alt = buildAlt(options.destination, heading, options.primaryKeyword || '');
    const caption = `<figcaption>${alt}</figcaption>`;
    lines.splice(h2.index + 1 + inserted * 2, 0, `![${alt}](${url})`, caption);
    inserted += 1;
    imageCount += 1;
  }

  if (imageCount < minImages && options.ogImageUrl && !usedUrls.has(options.ogImageUrl)) {
    const alt = buildAlt(options.destination, '여행 핵심 이미지', options.primaryKeyword || '');
    lines.push('', `![${alt}](${options.ogImageUrl})`, `<figcaption>${alt}</figcaption>`);
    inserted += 1;
    imageCount += 1;
  }

  return {
    markdown: lines.join('\n').replace(/\n{4,}/g, '\n\n\n'),
    inserted,
    imageCount,
  };
}
