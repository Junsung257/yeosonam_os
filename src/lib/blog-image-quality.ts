const MARKDOWN_IMAGE_RE = /!\[([^\]]*)\]\(([^)\s]+)[^)]*\)/g;
const HTML_IMAGE_RE = /<img\b[^>]*>/gi;
const FIGCAPTION_RE = /<figcaption[^>]*>([\s\S]*?)<\/figcaption>/i;

const GENERIC_ALT_RE = /^(?:image|photo|picture|travel|travel image|여행|이미지|사진|여행 이미지|여행 사진)$/i;
const MALFORMED_PEXELS_RE = /https:\/\/(?:images\/pexels\.com|images-pexels\.com)/i;

const STOP_WORDS = new Set([
  '여소남',
  '여행',
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
  '패키지',
]);

export interface BlogImageQualityOptions {
  destination?: string | null;
  primaryKeyword?: string | null;
  blogType?: 'product' | 'info';
  minImages?: number;
}

interface BlogImage {
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

export interface BlogImageQualityRepairResult {
  markdown: string;
  changed: boolean;
  changes: string[];
}

function stripHtml(value: string): string {
  return value.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

function normalizeToken(value: string): string {
  return value.toLowerCase().replace(/[^\p{Script=Hangul}\p{Letter}\p{Number}]+/gu, '');
}

function readAttr(tag: string, attr: string): string {
  const match = tag.match(new RegExp(`\\b${attr}=(["'])(.*?)\\1`, 'i'));
  return match?.[2]?.trim() ?? '';
}

function isWeakContextToken(token: string): boolean {
  const hasHangul = /\p{Script=Hangul}/u.test(token);
  const hasLatin = /[a-z]/i.test(token);
  const hasDigit = /\d/.test(token);

  if (!token || token.length < 2) return true;
  if (STOP_WORDS.has(token)) return true;
  if (hasHangul && hasDigit && token.length >= 8) return true;
  if (hasHangul && token.includes('여행') && token.length >= 8) return true;
  if (!hasHangul && hasLatin && hasDigit) return true;
  if (!hasHangul && /^(?:top|best|post|guide|travel|complete|weather|itinerary)\d*$/i.test(token)) return true;
  if (hasHangul && token.length >= 14) return true;
  if (!hasHangul && token.length >= 14) return true;
  return false;
}

function buildContextTokens(options: BlogImageQualityOptions): string[] {
  const raw = [options.destination, options.primaryKeyword]
    .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    .flatMap((value) => value.split(/[\/,\s|·]+/g));

  const tokens = raw
    .map(normalizeToken)
    .filter((token) => !isWeakContextToken(token));

  return [...new Set(tokens)].slice(0, 8);
}

function isValidImageUrl(url: string): boolean {
  if (MALFORMED_PEXELS_RE.test(url)) return false;
  return /^https?:\/\//i.test(url) || url.startsWith('/');
}

export function extractMarkdownImages(markdown: string): BlogImage[] {
  const images: BlogImage[] = [];
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

  while ((match = HTML_IMAGE_RE.exec(markdown)) !== null) {
    const tag = match[0] ?? '';
    const after = markdown.slice(match.index + tag.length, match.index + tag.length + 260);
    const captionMatch = after.match(FIGCAPTION_RE);
    images.push({
      alt: stripHtml(readAttr(tag, 'alt')),
      url: readAttr(tag, 'src'),
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
  const minImages = Math.max(0, options.minImages ?? 0);
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

function labelForImageContext(options: BlogImageQualityOptions): string {
  const raw = [
    options.destination,
    options.primaryKeyword,
  ].find((value): value is string => typeof value === 'string' && value.trim().length >= 2);
  const cleaned = String(raw ?? '여행')
    .replace(/[_|()[\]{}"'`~!@#$%^&*+=<>]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned || '여행';
}

function includesAnyContextToken(text: string, tokens: string[]): boolean {
  if (tokens.length === 0) return true;
  const normalized = normalizeToken(text);
  return tokens.some((token) => normalized.includes(token));
}

export function repairBlogImageQuality(
  markdown: string,
  options: BlogImageQualityOptions = {},
): BlogImageQualityRepairResult {
  const report = inspectBlogImageQuality(markdown, options);
  const issues = new Set(report.evidence.issues);
  const shouldRepair =
    issues.has('missing_alt')
    || issues.has('generic_alt')
    || issues.has('no_contextual_alt_or_caption');

  if (!shouldRepair) return { markdown, changed: false, changes: [] };

  const contextTokens = buildContextTokens(options);
  const label = labelForImageContext(options);
  const captionText = options.blogType === 'product'
    ? `${label} 상품 조건을 비교할 때 함께 확인할 이미지입니다.`
    : `${label} 여행 준비와 현지 판단 기준을 함께 확인할 이미지입니다.`;
  const altText = options.blogType === 'product'
    ? `${label} 여행 상품 조건 참고 이미지`
    : `${label} 여행 준비 참고 이미지`;

  const lines = markdown.split('\n');
  let changed = false;
  const next: string[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? '';
    const match = line.match(/^(\s*)!\[([^\]]*)]\(([^)\s]+)([^)]*)\)\s*$/);
    if (!match) {
      next.push(line);
      continue;
    }

    const [, indent = '', rawAlt = '', url = '', suffix = ''] = match;
    const following = lines[index + 1] ?? '';
    const followingCaption = following.match(/^\s*<figcaption[^>]*>([\s\S]*?)<\/figcaption>\s*$/i);
    const combinedContext = `${rawAlt} ${followingCaption?.[1] ?? ''}`;
    const needsAlt = rawAlt.trim().length < 3 || GENERIC_ALT_RE.test(rawAlt.trim());
    const needsContext = !includesAnyContextToken(combinedContext, contextTokens);
    const nextAlt = needsAlt || needsContext ? altText : rawAlt.trim();

    if (nextAlt !== rawAlt.trim()) changed = true;
    next.push(`${indent}![${nextAlt}](${url}${suffix})`);

    if (followingCaption) {
      const existingCaption = stripHtml(followingCaption[1] ?? '');
      if (!includesAnyContextToken(existingCaption, contextTokens)) {
        next.push(`${indent}<figcaption>${captionText}</figcaption>`);
        changed = true;
      } else {
        next.push(following);
      }
      index += 1;
      continue;
    }

    if (needsAlt || needsContext) {
      next.push(`${indent}<figcaption>${captionText}</figcaption>`);
      changed = true;
    }
  }

  if (!changed) return { markdown, changed: false, changes: [] };
  return {
    markdown: next.join('\n').replace(/\n{4,}/g, '\n\n\n'),
    changed: true,
    changes: ['repaired_image_alt_caption_context'],
  };
}
