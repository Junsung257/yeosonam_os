const FALLBACK_BLOG_CANONICAL_ORIGIN = 'https://www.yeosonam.com';

function isPublicOrigin(value: string | null | undefined): value is string {
  if (!value) return false;
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'https:' && !['localhost', '127.0.0.1', '0.0.0.0'].includes(parsed.hostname);
  } catch {
    return false;
  }
}

export function resolveBlogCanonicalOrigin(baseUrl?: string | null): string {
  const candidates = [
    process.env.BLOG_CANONICAL_ORIGIN,
    baseUrl,
    process.env.NEXT_PUBLIC_BASE_URL,
    process.env.NEXT_PUBLIC_SITE_URL,
    FALLBACK_BLOG_CANONICAL_ORIGIN,
  ];

  for (const candidate of candidates) {
    const cleaned = candidate?.replace(/\/+$/, '');
    if (!isPublicOrigin(cleaned)) continue;
    const parsed = new URL(cleaned);
    if (parsed.hostname === 'yeosonam.com') {
      return FALLBACK_BLOG_CANONICAL_ORIGIN;
    }
    return parsed.origin;
  }

  return FALLBACK_BLOG_CANONICAL_ORIGIN;
}

export function blogIndexingUrlForSlug(slug: string, baseUrl?: string | null): string {
  return `${resolveBlogCanonicalOrigin(baseUrl)}/blog/${slug.replace(/^\/+|\/+$/g, '')}`;
}

export function canonicalizeBlogIndexingJobUrl(input: {
  url?: string | null;
  slug: string;
  baseUrl?: string | null;
}): string {
  const canonicalOrigin = resolveBlogCanonicalOrigin(input.baseUrl);
  const cleanSlug = input.slug.trim().replace(/^\/+|\/+$/g, '');

  if (input.url) {
    try {
      const parsed = new URL(input.url, canonicalOrigin);
      if (parsed.pathname.startsWith('/blog/')) {
        const pathSlug = decodeURIComponent(parsed.pathname.replace(/^\/blog\/+|\/+$/g, ''));
        if (pathSlug && cleanSlug && pathSlug !== cleanSlug) {
          return blogIndexingUrlForSlug(cleanSlug, canonicalOrigin);
        }
        parsed.protocol = 'https:';
        parsed.host = new URL(canonicalOrigin).host;
        return parsed.toString();
      }
    } catch {
      // Fall back to the durable slug path below.
    }
  }

  return blogIndexingUrlForSlug(cleanSlug, canonicalOrigin);
}
