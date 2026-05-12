/**
 * Open redirect prevention utility
 * Validates that a redirect URL is same-origin (internal only)
 */

export function isSafeRedirectUrl(url: string | null | undefined): boolean {
  if (!url || typeof url !== 'string') return false;

  // Empty or whitespace-only strings are not safe
  if (!url.trim()) return false;

  // URLs must not contain protocol (http://, https://, etc.)
  // This prevents redirects to external domains
  if (/^[a-z][a-z0-9+.-]*:/i.test(url)) {
    return false;
  }

  // URLs must not contain // at the start (protocol-relative URLs like //evil.com)
  if (url.startsWith('//')) {
    return false;
  }

  // URLs must start with / (internal absolute path) or be relative
  // and must not contain dangerous characters that could indicate external domain
  if (!url.startsWith('/') && !url.startsWith('.')) {
    return false;
  }

  return true;
}

export function getSafeRedirectUrl(url: string | null | undefined, defaultUrl: string = '/admin'): string {
  return isSafeRedirectUrl(url) ? url as string : defaultUrl;
}
