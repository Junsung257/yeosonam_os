const MARKDOWN_IMAGE_RE = /!\[([^\]]*)\]\(([^)\s]+)[^)]*\)/g;
const FIGCAPTION_RE = /<figcaption[^>]*>([\s\S]*?)<\/figcaption>/i;

const GENERIC_ALT_RE = /^(?:image|photo|picture|travel|travel image|여행|이미지|사진|여행 이미지|여행 사진)$/i;
const MALFORMED_PEXELS_RE = /https:\/\/(?:images\/pexels\.com|images-pexels\.com)/i;

const STOP_WORDS = new Set([
  '여소남',
  '여행',
  '완벽',
  '가이드',
  '총정리',
  '체크리스트',
  '추천',
  '기준',
  '최신',
  '날씨',
  '옷차림',
  '준비물',
  '비용',
  '일정',
]);

export interface BlogImageQualityOptions {
  destination?: string | null;
  primaryKeyword?: string | null;
  blogType?: 'product' | 'info';
  minImages?: number;
}

interface MarkdownImage {
  alt: string;
  url: string;
  caption: string;
}

export interface BlogImageQualityReport {
  passed: boolean;
  reason?: string;
  evidence: {
    imageCount: number;
    minImages: number;
    missingAlt: number;
    genericAlt: number;
    malformedUrls: string[];
    duplicateUrls: string[];
    contextTokens: string[];
    contextMatchedImages: number;
    issues: string[];
  };
}

function stripHtml(value: string): string {
  return value.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

function normalizeToken(value: string): string {
  return value.toLowerCase().replace(/[^\p{Script=Hangul}\p{Letter}\p{Number}]+/gu, '');
}

function buildContextTokens(options: BlogImageQualityOptions): string[] {
  const raw = [options.destination, options.primaryKeyword]
    .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    .flatMap((value) => value.split(/[\/,\s|·]+/g));

  const tokens = raw
    .map(normalizeToken)
    .filter((token) => token.length >= 2 && !STOP_WORDS.has(token));

  return [...new Set(tokens)].slice(0, 8);
}

function isValidImageUrl(url: string): boolean {
  if (MALFORMED_PEXELS_RE.test(url)) return false;
  return /^https?:\/\//i.test(url) || url.startsWith('/');
}

export function extractMarkdownImages(markdown: string): MarkdownImage[] {
  const images: MarkdownImage[] = [];
  let match: RegExpExecArray | null;

  while ((match = MARKDOWN_IMAGE_RE.exec(markdown)) !== null) {
    const after = markdown.slice(match.index + match[0].length, match.index + match[0].length + 260);
    const captionMatch = after.match(FIGCAPTION_RE);
    images.push({
      alt: stripHtml(match[1] ?? ''),
      url: (match[2] ?? '').trim(),
      caption: stripHtml(captionMatch?.[1] ?? ''),
    });
  }

  return images;
}

export function inspectBlogImageQuality(
  markdown: string,
  options: BlogImageQualityOptions = {},
): BlogImageQualityReport {
  const images = extractMarkdownImages(markdown);
  const minImages = Math.max(1, options.minImages ?? (options.blogType === 'product' ? 2 : 3));
  const issues: string[] = [];

  const missingAlt = images.filter((image) => image.alt.length < 3).length;
  const genericAlt = images.filter((image) => GENERIC_ALT_RE.test(image.alt.trim())).length;
  const malformedUrls = images.filter((image) => !isValidImageUrl(image.url)).map((image) => image.url);

  const seen = new Set<string>();
  const duplicateUrls = [...new Set(images
    .map((image) => image.url)
    .filter((url) => {
      if (!url) return false;
      if (seen.has(url)) return true;
      seen.add(url);
      return false;
    }))];

  const contextTokens = buildContextTokens(options);
  const contextMatchedImages = contextTokens.length === 0
    ? images.length
    : images.filter((image) => {
        const text = normalizeToken(`${image.alt} ${image.caption}`);
        return contextTokens.some((token) => text.includes(token));
      }).length;

  if (images.length < minImages) issues.push('image_count_below_minimum');
  if (missingAlt > 0) issues.push('missing_alt');
  if (genericAlt > 0) issues.push('generic_alt');
  if (malformedUrls.length > 0) issues.push('malformed_image_url');
  if (duplicateUrls.length > 0) issues.push('duplicate_image_url');
  if (contextTokens.length > 0 && contextMatchedImages === 0) issues.push('no_contextual_alt_or_caption');

  return {
    passed: issues.length === 0,
    reason: issues.length > 0
      ? `이미지 품질 게이트 실패: ${issues.join(', ')}`
      : undefined,
    evidence: {
      imageCount: images.length,
      minImages,
      missingAlt,
      genericAlt,
      malformedUrls,
      duplicateUrls,
      contextTokens,
      contextMatchedImages,
      issues,
    },
  };
}
