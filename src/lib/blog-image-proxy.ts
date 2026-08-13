const PROXYABLE_BLOG_IMAGE_HOSTS = new Set([
  'images.pexels.com',
  'commons.wikimedia.org',
]);
const YEOSONAM_PUBLIC_ASSET_HOST = 'ixaxnvbmhzjvupissmly.supabase.co';
const YEOSONAM_BLOG_ASSET_PATH_PREFIX = '/storage/v1/object/public/blog-assets/';

export const BLOG_IMAGE_PROXY_PATH = '/api/blog/image';
const DEFAULT_BLOG_IMAGE_PROXY_WIDTH = 960;
export const BLOG_IMAGE_PROXY_WIDTHS = [480, 768, 960, 1280, 1600] as const;

function trimUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function isProxyableBlogImageUrl(value: unknown): value is string {
  const raw = trimUrl(value);
  if (!raw) return false;

  try {
    const url = new URL(raw);
    if (url.protocol !== 'https:') return false;
    const hostname = url.hostname.toLowerCase();
    if (PROXYABLE_BLOG_IMAGE_HOSTS.has(hostname)) return true;
    return hostname === YEOSONAM_PUBLIC_ASSET_HOST
      && url.pathname.startsWith(YEOSONAM_BLOG_ASSET_PATH_PREFIX);
  } catch {
    return false;
  }
}

type BlogImageProxyOptions = {
  width?: number;
  quality?: number;
};

export function normalizeBlogImageProxyWidth(value: number | undefined): number {
  if (!Number.isFinite(value) || Number(value) <= 0) return DEFAULT_BLOG_IMAGE_PROXY_WIDTH;
  const requested = Number(value);
  return BLOG_IMAGE_PROXY_WIDTHS.reduce((closest, candidate) => (
    Math.abs(candidate - requested) < Math.abs(closest - requested) ? candidate : closest
  ), DEFAULT_BLOG_IMAGE_PROXY_WIDTH);
}

function appendPositiveInt(params: URLSearchParams, key: string, value: number | undefined): void {
  if (Number.isFinite(value) && Number(value) > 0) {
    params.set(key, String(Math.round(Number(value))));
  }
}

export function toBlogImageProxySrc(value: string, baseUrl = '', options: BlogImageProxyOptions = {}): string {
  const params = new URLSearchParams();
  appendPositiveInt(params, 'w', normalizeBlogImageProxyWidth(options.width));
  appendPositiveInt(params, 'q', options.quality);
  const optionQuery = params.toString();
  const path = `${BLOG_IMAGE_PROXY_PATH}?src=${encodeURIComponent(value.trim())}${optionQuery ? `&${optionQuery}` : ''}`;
  if (!baseUrl) return path;
  return `${baseUrl.replace(/\/$/, '')}${path}`;
}

export function buildBlogImageSrcSet(value: unknown, baseUrl = '', quality?: number): string | undefined {
  const raw = trimUrl(value);
  if (!raw || !isProxyableBlogImageUrl(raw)) return undefined;
  return BLOG_IMAGE_PROXY_WIDTHS
    .map((width) => `${toBlogImageProxySrc(raw, baseUrl, { width, quality })} ${width}w`)
    .join(', ');
}

export function toBlogImageDisplaySrc(value: unknown, baseUrl = '', options: BlogImageProxyOptions = {}): string | null {
  const raw = trimUrl(value);
  if (!raw) return null;
  return isProxyableBlogImageUrl(raw) ? toBlogImageProxySrc(raw, baseUrl, options) : raw;
}

function escapeHtmlAttribute(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
}

function inferInlineImageDimensions(value: string): { width: number; height: number } {
  try {
    const url = new URL(value);
    const width = Number(url.searchParams.get('w'));
    const height = Number(url.searchParams.get('h'));
    if (Number.isFinite(width) && width > 0 && Number.isFinite(height) && height > 0) {
      return { width: Math.round(width), height: Math.round(height) };
    }
  } catch {
    // A valid URL was already established by isProxyableBlogImageUrl.
  }
  return { width: 1200, height: 675 };
}

function appendMissingImageAttributes(tag: string, attributes: string[]): string {
  const insertion = attributes.filter(Boolean).join(' ');
  if (!insertion) return tag;
  if (/\/\s*>$/.test(tag)) return tag.replace(/\s*\/\s*>$/, ` ${insertion} />`);
  return tag.replace(/\s*>$/, ` ${insertion}>`);
}

export function proxyBlogImageUrlsInHtml(html: string): string {
  return html.replace(/<img\b[^>]*>/gi, (tag) => {
    const sourceMatch = tag.match(/\bsrc\s*=\s*(["'])(https:\/\/[^"']+)\1/i);
    const source = sourceMatch?.[2];
    if (!source || !isProxyableBlogImageUrl(source)) return tag;

    const proxySource = escapeHtmlAttribute(toBlogImageProxySrc(source));
    const responsiveSet = escapeHtmlAttribute(buildBlogImageSrcSet(source) || '');
    const dimensions = inferInlineImageDimensions(source);
    let result = tag.replace(sourceMatch[0], `src="${proxySource}"`);
    const additions: string[] = [];
    if (!/\bsrcset\s*=/i.test(result) && responsiveSet) additions.push(`srcset="${responsiveSet}"`);
    if (!/\bsizes\s*=/i.test(result)) additions.push('sizes="(max-width: 768px) 100vw, 760px"');
    if (!/\bwidth\s*=/i.test(result)) additions.push(`width="${dimensions.width}"`);
    if (!/\bheight\s*=/i.test(result)) additions.push(`height="${dimensions.height}"`);
    if (!/\bloading\s*=/i.test(result)) additions.push('loading="lazy"');
    if (!/\bdecoding\s*=/i.test(result)) additions.push('decoding="async"');
    result = appendMissingImageAttributes(result, additions);
    return result;
  });
}
