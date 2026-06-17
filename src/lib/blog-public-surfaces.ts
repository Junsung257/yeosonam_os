export const BLOG_PUBLIC_ANGLE_SLUGS = [
  'value',
  'luxury',
  'filial',
  'emotional',
  'activity',
  'food',
  'urgency',
] as const;

export type BlogPublicSurfaceKind = 'page' | 'sitemap' | 'api' | 'health';

export interface BlogPublicSurfaceSpec {
  id: string;
  label: string;
  kind: BlogPublicSurfaceKind;
  path: string;
  url: string;
  critical: boolean;
  timeoutMs: number;
  warnAfterMs: number;
}

interface BuildPublicBlogSurfaceOptions {
  baseUrl?: string | null;
  slug?: string | null;
  destination?: string | null;
  includeDiagnostics?: boolean;
}

export function getPublicSiteOrigin(): string {
  return (process.env.NEXT_PUBLIC_BASE_URL || process.env.NEXT_PUBLIC_SITE_URL || 'https://www.yeosonam.com')
    .replace(/\/+$/, '');
}

function normalizeBaseUrl(baseUrl?: string | null): string {
  const fallback = getPublicSiteOrigin();
  const raw = (baseUrl || fallback).trim() || fallback;
  return raw.replace(/\/+$/, '');
}

function encodePathSegment(value: string): string {
  return encodeURIComponent(value.trim());
}

function addSurface(
  surfaces: BlogPublicSurfaceSpec[],
  baseUrl: string,
  input: Omit<BlogPublicSurfaceSpec, 'url'>,
) {
  surfaces.push({
    ...input,
    url: `${baseUrl}${input.path}`,
  });
}

export function buildPublicBlogSurfaceSpecs(options: BuildPublicBlogSurfaceOptions = {}): BlogPublicSurfaceSpec[] {
  const baseUrl = normalizeBaseUrl(options.baseUrl);
  const surfaces: BlogPublicSurfaceSpec[] = [];

  addSurface(surfaces, baseUrl, {
    id: 'blog-list',
    label: 'Blog list',
    kind: 'page',
    path: '/blog',
    critical: true,
    timeoutMs: 12000,
    warnAfterMs: 10000,
  });

  for (const angle of BLOG_PUBLIC_ANGLE_SLUGS) {
    addSurface(surfaces, baseUrl, {
      id: `blog-angle-${angle}`,
      label: `Blog angle: ${angle}`,
      kind: 'page',
      path: `/blog/angle/${angle}`,
      critical: true,
      timeoutMs: 12000,
      warnAfterMs: 10000,
    });
  }

  const destination = options.destination?.trim();
  if (destination) {
    addSurface(surfaces, baseUrl, {
      id: 'blog-destination',
      label: `Blog destination: ${destination}`,
      kind: 'page',
      path: `/blog/destination/${encodePathSegment(destination)}`,
      critical: true,
      timeoutMs: 12000,
      warnAfterMs: 10000,
    });
  }

  const slug = options.slug?.trim();
  if (slug) {
    addSurface(surfaces, baseUrl, {
      id: 'blog-detail',
      label: `Blog detail: ${slug}`,
      kind: 'page',
      path: `/blog/${encodePathSegment(slug)}`,
      critical: true,
      timeoutMs: 12000,
      warnAfterMs: 10000,
    });
  }

  addSurface(surfaces, baseUrl, {
    id: 'sitemap',
    label: 'Sitemap',
    kind: 'sitemap',
    path: '/sitemap.xml',
    critical: true,
    timeoutMs: 5000,
    warnAfterMs: 3000,
  });

  if (options.includeDiagnostics ?? true) {
    addSurface(surfaces, baseUrl, {
      id: 'api-blog',
      label: 'Blog API',
      kind: 'api',
      path: '/api/blog?limit=3',
      critical: true,
      timeoutMs: 12000,
      warnAfterMs: 10000,
    });
    addSurface(surfaces, baseUrl, {
      id: 'api-health',
      label: 'Health API',
      kind: 'health',
      path: '/api/v1/health',
      critical: true,
      timeoutMs: 5000,
      warnAfterMs: 3000,
    });
  }

  return surfaces;
}
