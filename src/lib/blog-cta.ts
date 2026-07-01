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

export function buildBlogDestinationCtaUrl(opts: BlogCtaOptions & { content?: string }): string {
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

  const lines = [
    '> **여소남 여행 준비**',
    '>',
    `> - [관련 패키지 보기](${buildBlogPackageCtaUrl({ ...opts, content: 'packages_bottom' })})`,
    `> - [목적지 매거진 더 보기](${buildBlogDestinationCtaUrl({ ...opts, content: opts.destination ? 'destination_blog' : 'blog_index' })})`,
    '> - [카카오톡 무료 상담](https://pf.kakao.com/_xfxnFj/chat)',
    `> - [여소남에서 상담 이어가기](${base}/?${utm('site_consult')})`,
  ];

  return lines.join('\n');
}
