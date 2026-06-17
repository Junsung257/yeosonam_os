import type { MetadataRoute } from 'next';
import { supabaseAdmin, isSupabaseAdminConfigured, isSupabaseConfigured } from '@/lib/supabase';
import { encodeDestinationPathSegment } from '@/lib/regions';

const BASE_URL = (process.env.NEXT_PUBLIC_BASE_URL || process.env.NEXT_PUBLIC_SITE_URL || 'https://www.yeosonam.com')
  .replace(/\/+$/, '');
const PACKAGE_LIMIT = 5000;
const BLOG_LIMIT = 10000;
const DESTINATION_LIMIT = 1000;
const QUERY_TIMEOUT_MS = Math.max(
  1000,
  Number(process.env.SITEMAP_QUERY_TIMEOUT_MS || process.env.PUBLIC_PAGE_QUERY_TIMEOUT_MS || '2500') || 2500,
);

export const revalidate = 3600;
export const dynamic = 'force-dynamic';

type AbortablePromiseLike<T> = PromiseLike<T> & {
  abortSignal?: (signal: AbortSignal) => PromiseLike<T>;
};

type SitemapEntry = MetadataRoute.Sitemap[number];

type PackageRow = {
  id: string;
  updated_at: string | null;
};

type DestinationRow = {
  destination: string | null;
};

type BlogRow = {
  slug: string;
  destination: string | null;
  angle_type: string | null;
  published_at: string | null;
  updated_at: string | null;
};

function emptyQueryResult<T>(data: T) {
  return { data, error: null, count: null, status: 200, statusText: 'fallback', success: true as const };
}

async function withTimeout<T>(promise: AbortablePromiseLike<T>, timeoutMs: number, fallback: T): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const abortSignal = promise.abortSignal;
  const controller = typeof abortSignal === 'function' ? new AbortController() : null;
  const source = controller && typeof abortSignal === 'function'
    ? abortSignal.call(promise, controller.signal)
    : Promise.resolve(promise);

  try {
    return await Promise.race([
      source,
      new Promise<T>((resolve) => {
        timer = setTimeout(() => {
          controller?.abort();
          resolve(fallback);
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function safeLastModified(iso: string | null | undefined): Date {
  if (!iso) return new Date();
  const d = new Date(iso);
  return Number.isFinite(d.getTime()) ? d : new Date();
}

function isSafeSitemapBlogSlug(slug: string | null | undefined): slug is string {
  if (typeof slug !== 'string') return false;
  const s = slug.trim();
  if (s.length === 0 || s.length > 512) return false;
  if (s.startsWith('/') || s.includes('//') || s.includes('?') || s.includes('#')) return false;
  return /[\p{Letter}\p{Number}]/u.test(s);
}

function staticRoutes(): MetadataRoute.Sitemap {
  const now = new Date();
  return [
    { url: BASE_URL, lastModified: now, changeFrequency: 'daily', priority: 1.0 },
    { url: `${BASE_URL}/private-tour`, lastModified: now, changeFrequency: 'weekly', priority: 0.85 },
    { url: `${BASE_URL}/packages`, lastModified: now, changeFrequency: 'daily', priority: 0.9 },
    { url: `${BASE_URL}/destinations`, lastModified: now, changeFrequency: 'daily', priority: 0.9 },
    { url: `${BASE_URL}/concierge`, lastModified: now, changeFrequency: 'weekly', priority: 0.8 },
    { url: `${BASE_URL}/group-inquiry`, lastModified: now, changeFrequency: 'weekly', priority: 0.8 },
    { url: `${BASE_URL}/blog`, lastModified: now, changeFrequency: 'daily', priority: 0.8 },
    { url: `${BASE_URL}/privacy`, lastModified: now, changeFrequency: 'yearly', priority: 0.2 },
    { url: `${BASE_URL}/terms`, lastModified: now, changeFrequency: 'yearly', priority: 0.2 },
  ];
}

async function collectPackageRoutes(): Promise<SitemapEntry[]> {
  try {
    const result = await withTimeout(
      supabaseAdmin
        .from('travel_packages')
        .select('id, updated_at')
        .in('status', ['active', 'approved'])
        .order('updated_at', { ascending: false })
        .limit(PACKAGE_LIMIT),
      QUERY_TIMEOUT_MS,
      emptyQueryResult<PackageRow[]>([]),
    );

    if (result.error) throw result.error;
    return (result.data || [])
      .filter((pkg) => typeof pkg.id === 'string' && pkg.id.trim().length > 0)
      .map((pkg) => ({
        url: `${BASE_URL}/packages/${encodeURIComponent(pkg.id.trim())}`,
        lastModified: safeLastModified(pkg.updated_at),
        changeFrequency: 'weekly' as const,
        priority: 0.85,
      }));
  } catch (err) {
    console.warn('[sitemap] packages error:', err);
    return [];
  }
}

async function collectDestinationRoutes(): Promise<SitemapEntry[]> {
  try {
    const result = await withTimeout(
      supabaseAdmin
        .from('active_destinations')
        .select('destination')
        .limit(DESTINATION_LIMIT),
      QUERY_TIMEOUT_MS,
      emptyQueryResult<DestinationRow[]>([]),
    );

    if (result.error) throw result.error;
    return (result.data || [])
      .filter((row) => typeof row.destination === 'string' && row.destination.trim().length > 0)
      .map((row) => ({
        url: `${BASE_URL}/destinations/${encodeDestinationPathSegment(row.destination!.trim())}`,
        lastModified: new Date(),
        changeFrequency: 'daily' as const,
        priority: 0.9,
      }));
  } catch (err) {
    console.warn('[sitemap] destinations error:', err);
    return [];
  }
}

async function collectBlogRoutes(): Promise<SitemapEntry[]> {
  try {
    const result = await withTimeout(
      supabaseAdmin
        .from('content_creatives')
        .select('slug, destination, angle_type, published_at, updated_at')
        .eq('status', 'published')
        .eq('channel', 'naver_blog')
        .not('slug', 'is', null)
        .order('published_at', { ascending: false })
        .limit(BLOG_LIMIT),
      QUERY_TIMEOUT_MS,
      emptyQueryResult<BlogRow[]>([]),
    );

    if (result.error) throw result.error;
    const posts = result.data || [];
    const routes: SitemapEntry[] = [];
    const angles = new Set(['value', 'emotional', 'filial', 'luxury', 'urgency', 'activity', 'food']);
    const destinations = new Set<string>();
    const anglesWithPosts = new Set<string>();

    for (const post of posts) {
      const destination = post.destination?.trim();
      if (destination) destinations.add(destination);
      if (post.angle_type && angles.has(post.angle_type)) anglesWithPosts.add(post.angle_type);
    }

    for (const destination of destinations) {
      routes.push({
        url: `${BASE_URL}/blog/destination/${encodeDestinationPathSegment(destination)}`,
        lastModified: new Date(),
        changeFrequency: 'weekly' as const,
        priority: 0.75,
      });
    }

    for (const angle of anglesWithPosts) {
      routes.push({
        url: `${BASE_URL}/blog/angle/${angle}`,
        lastModified: new Date(),
        changeFrequency: 'weekly' as const,
        priority: 0.75,
      });
    }

    for (const post of posts) {
      if (!isSafeSitemapBlogSlug(post.slug)) continue;
      routes.push({
        url: `${BASE_URL}/blog/${encodeURIComponent(post.slug.trim())}`,
        lastModified: safeLastModified(post.updated_at || post.published_at),
        changeFrequency: 'weekly' as const,
        priority: 0.7,
      });
    }

    return routes;
  } catch (err) {
    console.warn('[sitemap] blog error:', err);
    return [];
  }
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const routes = staticRoutes();
  if (!isSupabaseConfigured || !isSupabaseAdminConfigured) return routes;

  const [packageRoutes, destinationRoutes, blogRoutes] = await Promise.all([
    collectPackageRoutes(),
    collectDestinationRoutes(),
    collectBlogRoutes(),
  ]);

  return [...routes, ...packageRoutes, ...destinationRoutes, ...blogRoutes];
}
