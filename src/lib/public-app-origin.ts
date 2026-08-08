export const CANONICAL_PUBLIC_APP_ORIGIN = 'https://www.yeosonam.com';

const ALLOWED_PRODUCTION_HOSTS = new Set(['www.yeosonam.com']);

export function resolvePublicAppOrigin(raw = process.env.PUBLIC_APP_ORIGIN): string {
  const value = String(raw || CANONICAL_PUBLIC_APP_ORIGIN).trim();
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error('[public-origin] PUBLIC_APP_ORIGIN must be an absolute URL');
  }

  if (url.username || url.password || url.search || url.hash || url.pathname !== '/') {
    throw new Error('[public-origin] PUBLIC_APP_ORIGIN must contain only scheme and host');
  }

  const isLocalDevelopment = process.env.NODE_ENV !== 'production'
    && (url.hostname === 'localhost' || url.hostname === '127.0.0.1');
  if (!isLocalDevelopment && (url.protocol !== 'https:' || !ALLOWED_PRODUCTION_HOSTS.has(url.hostname))) {
    throw new Error('[public-origin] PUBLIC_APP_ORIGIN must be https://www.yeosonam.com');
  }

  return url.origin;
}

export function buildPublicUrl(pathname: string, origin = resolvePublicAppOrigin()): string {
  if (!pathname.startsWith('/')) {
    throw new Error('[public-origin] public path must start with /');
  }
  return new URL(pathname, `${origin}/`).toString();
}
