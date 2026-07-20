import { resolveBlogCanonicalOrigin } from '@/lib/blog-canonical-url';

type BlogCtaOptions = {
  destination: string | null | undefined;
  slug: string;
  baseUrl?: string;
  utmSource?: string;
  utmMedium?: string;
};

function normalizeBaseUrl(baseUrl?: string): string {
  return resolveBlogCanonicalOrigin(baseUrl);
}

export function normalizeBlogCtaDestination(destination: string | null | undefined): string | null {
  const dest = destination?.trim().replace(/\s+/g, ' ');
  if (!dest) return null;
  if (dest.length > 80) return null;
  if (/[\uFFFD?#=&]/.test(dest)) return null;
  return dest;
}

function buildUtmSearchParams(opts: BlogCtaOptions, content: string): URLSearchParams {
  const params = new URLSearchParams();
  params.set('utm_source', opts.utmSource || 'blog');
  params.set('utm_medium', opts.utmMedium || 'organic');
  params.set('utm_campaign', opts.slug || 'blog');
  params.set('utm_content', content);
  return params;
}

export function buildBlogPackageCtaUrl(opts: BlogCtaOptions & { content?: string }): string {
  const params = buildUtmSearchParams(opts, opts.content || 'packages_bottom');
  const dest = normalizeBlogCtaDestination(opts.destination);
  if (dest) params.set('destination', dest);
  return `${normalizeBaseUrl(opts.baseUrl)}/packages?${params.toString()}`;
}

function buildBlogDestinationCtaUrl(opts: BlogCtaOptions & { content?: string }): string {
  const params = buildUtmSearchParams(opts, opts.content || 'destination_blog');
  const dest = normalizeBlogCtaDestination(opts.destination);
  if (!dest) return `${normalizeBaseUrl(opts.baseUrl)}/blog?${params.toString()}`;
  return `${normalizeBaseUrl(opts.baseUrl)}/blog/destination/${encodeURIComponent(dest)}?${params.toString()}`;
}

function sanitizePackageUrl(rawUrl: string, opts: BlogCtaOptions): string {
  const base = normalizeBaseUrl(opts.baseUrl);

  try {
    const parsed = new URL(rawUrl.startsWith('/') ? `${base}${rawUrl}` : rawUrl);
    if (!/(^|\.)yeosonam\.com$/i.test(parsed.hostname)) return rawUrl;
    if (parsed.pathname !== '/packages') return rawUrl;

    const expectedDest = normalizeBlogCtaDestination(opts.destination);
    const foundDest = normalizeBlogCtaDestination(parsed.searchParams.get('destination'));
    if (foundDest && expectedDest && foundDest === expectedDest) return rawUrl;

    parsed.searchParams.delete('destination');
    if (expectedDest) parsed.searchParams.set('destination', expectedDest);

    const pathWithQuery = `${parsed.pathname}?${parsed.searchParams.toString()}`;
    return rawUrl.startsWith('/') ? pathWithQuery : `${parsed.origin}${pathWithQuery}`;
  } catch {
    return buildBlogPackageCtaUrl(opts);
  }
}

export function sanitizeBlogCtaLinks(markdown: string, opts: BlogCtaOptions): string {
  return markdown.replace(
    /\]\((https?:\/\/(?:www\.)?yeosonam\.com\/packages\?[^)\s]+|\/packages\?[^)\s]+)\)/g,
    (match, url: string) => match.replace(url, sanitizePackageUrl(url.replace(/&amp;/g, '&'), opts)),
  );
}

function deterministicVariantIndex(seed: string, size: number): number {
  if (size <= 1) return 0;
  let hash = 0;
  for (const char of seed) {
    hash = ((hash * 33) + char.charCodeAt(0)) >>> 0;
  }
  return hash % size;
}

function pickVariant(seed: string, values: string[]): string {
  return values[deterministicVariantIndex(seed, values.length)] ?? values[0] ?? '';
}

/**
 * Standard blog CTA block.
 *
 * The SEO scorer counts CTA links only among internal links, so this block must
 * include at least two valid internal CTA links in addition to the Kakao link.
 */
export function buildStandardBlogCtaMarkdown(opts: BlogCtaOptions): string {
  const base = normalizeBaseUrl(opts.baseUrl);
  const slug = opts.slug || 'blog';
  const src = opts.utmSource || 'blog';
  const med = opts.utmMedium || 'organic';
  const utm = (content: string) =>
    `utm_source=${encodeURIComponent(src)}&utm_medium=${encodeURIComponent(med)}&utm_campaign=${encodeURIComponent(slug)}&utm_content=${encodeURIComponent(content)}`;
  const dest = normalizeBlogCtaDestination(opts.destination);
  const seed = `${slug}|${dest || ''}`;
  const heading = pickVariant(seed, [
    '여행 조건을 내 일정에 맞춰 보기',
    '출발 전 조건만 다시 확인하기',
    '상품과 일정 조건 함께 보기',
    '내 예산·일정 기준으로 비교하기',
  ]);
  const packageLabel = dest
    ? pickVariant(`${seed}|packages`, [
      `${dest} 상품 조건 보기`,
      `${dest} 패키지 가격 확인`,
      `${dest} 출발 상품 비교`,
      `${dest} 여행상품 살펴보기`,
    ])
    : pickVariant(`${seed}|packages`, [
      '판매 중인 여행상품 보기',
      '목적지별 상품 비교',
      '출발 가능한 상품 확인',
      '패키지 조건 살펴보기',
    ]);
  const destinationLabel = dest
    ? pickVariant(`${seed}|destination`, [
      `${dest} 가이드 더 보기`,
      `${dest} 준비 글 이어보기`,
      `${dest} 여행 정보 더 보기`,
      `${dest} 매거진 살펴보기`,
    ])
    : pickVariant(`${seed}|destination`, [
      '목적지 매거진 더 보기',
      '다른 여행 가이드 보기',
      '여행 준비 글 이어보기',
      '전체 매거진 살펴보기',
    ]);
  const consultLabel = pickVariant(`${seed}|consult`, [
    '내 일정 기준으로 상담하기',
    '출발일·인원으로 가능 여부 확인',
    '조건 맞는 상품 상담하기',
    '카톡으로 일정 확인하기',
  ]);
  const siteLabel = pickVariant(`${seed}|site`, [
    '여소남에서 상담 이어가기',
    '여소남 여행 준비 바로가기',
    '내 조건으로 다시 비교하기',
    '여행 준비 계속하기',
  ]);

  const lines = [
    `> **${heading}**`,
    '>',
    `> - [${packageLabel}](${buildBlogPackageCtaUrl({ ...opts, content: 'packages_bottom' })})`,
    `> - [${destinationLabel}](${buildBlogDestinationCtaUrl({ ...opts, content: opts.destination ? 'destination_blog' : 'blog_index' })})`,
    `> - [${consultLabel}](https://pf.kakao.com/_xfxnFj/chat)`,
    `> - [${siteLabel}](${base}/?${utm('site_consult')})`,
  ];

  return lines.join('\n');
}
