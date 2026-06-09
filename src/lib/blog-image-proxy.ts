const PROXYABLE_BLOG_IMAGE_HOSTS = new Set([
  'images.pexels.com',
]);

export const BLOG_IMAGE_PROXY_PATH = '/api/blog/image';

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
    return url.protocol === 'https:' && PROXYABLE_BLOG_IMAGE_HOSTS.has(url.hostname.toLowerCase());
  } catch {
    return false;
  }
}

export function toBlogImageProxySrc(value: string, baseUrl = ''): string {
  const path = `${BLOG_IMAGE_PROXY_PATH}?src=${encodeURIComponent(value.trim())}`;
  if (!baseUrl) return path;
  return `${baseUrl.replace(/\/$/, '')}${path}`;
}

export function toBlogImageDisplaySrc(value: unknown, baseUrl = ''): string | null {
  const raw = trimUrl(value);
  if (!raw) return null;
  return isProxyableBlogImageUrl(raw) ? toBlogImageProxySrc(raw, baseUrl) : raw;
}

export function proxyBlogImageUrlsInHtml(html: string): string {
  return html.replace(
    /(<img\b[^>]*\bsrc=["'])(https:\/\/images\.pexels\.com\/[^"']+)(["'][^>]*>)/gi,
    (_match, prefix: string, src: string, suffix: string) => `${prefix}${toBlogImageProxySrc(src)}${suffix}`,
  );
}
