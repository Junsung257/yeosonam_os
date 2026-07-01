import type { MetadataRoute } from 'next';
import { supabaseAdmin, isSupabaseAdminConfigured, isSupabaseConfigured } from '@/lib/supabase';
import { encodeDestinationPathSegment } from '@/lib/regions';
import { shouldSkipPublicDbReadsForResourceSaver } from '@/lib/cron-resource-saver';
import { getFallbackBlogPosts } from '@/lib/blog-public-fallback';

const BASE_URL = (process.env.NEXT_PUBLIC_BASE_URL || process.env.NEXT_PUBLIC_SITE_URL || 'https://www.yeosonam.com')
  .replace(/\/+$/, '');
const PACKAGE_LIMIT = 1000;
const BLOG_LIMIT = 2000;
const DESTINATION_LIMIT = 500;
const QUERY_TIMEOUT_MS = 2500;

type SitemapQueryResponse<T> = {
  data: T[] | null;
  error: { message?: string } | null;
};

type ActiveDestinationSitemapRow = {
  destination: string | null;
  package_count?: number | string | null;
};

export const revalidate = 3600;

function safeLastModified(iso: string | null | undefined): Date {
  if (!iso) return new Date();
  const d = new Date(iso);
  return Number.isFinite(d.getTime()) ? d : new Date();
}

function isSafeSitemapBlogSlug(slug: string | null | undefined): slug is string {
  if (slug == null || typeof slug !== 'string') return false;
  const s = slug.trim();
  if (s.length === 0 || s.length > 512) return false;
  if (s.startsWith('/') || s.includes('/') || s.includes('\\')) return false;
  if (s.includes('//') || s.includes('?') || s.includes('#')) return false;
  return encodeURIComponent(s).length <= 1024;
}

function getSafeSitemapDestination(row: ActiveDestinationSitemapRow): string | null {
  const destination = row.destination?.trim();
  if (!destination || destination.length > 160) return null;
  if (destination.includes('\\') || destination.includes('?') || destination.includes('#')) return null;
  const packageCount = row.package_count == null ? null : Number(row.package_count);
  if (packageCount != null && (!Number.isFinite(packageCount) || packageCount <= 0)) return null;
  return destination;
}

function isAbortLikeError(err: unknown): boolean {
  if (err instanceof Error) {
    return err.name === 'AbortError' || /abort|timeout|timed out/i.test(err.message);
  }
  return false;
}

async function runSitemapQuery<T>(
  label: string,
  queryFactory: (signal: AbortSignal) => PromiseLike<SitemapQueryResponse<T>>,
): Promise<T[]> {
  if (!isSupabaseConfigured || !isSupabaseAdminConfigured) return [];
  if (shouldSkipPublicDbReadsForResourceSaver()) return [];

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), QUERY_TIMEOUT_MS);

  try {
    const result = await queryFactory(controller.signal);
    if (result.error) {
      console.warn(`[sitemap] ${label} query failed:`, result.error.message || result.error);
      return [];
    }
    return Array.isArray(result.data) ? result.data : [];
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    console.warn(`[sitemap] ${label} query ${isAbortLikeError(err) ? 'timed out' : 'failed'}:`, reason);
    return [];
  } finally {
    clearTimeout(timer);
  }
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const routes: MetadataRoute.Sitemap = [
    { url: BASE_URL, lastModified: new Date(), changeFrequency: 'daily', priority: 1.0 },
    { url: `${BASE_URL}/group`, lastModified: new Date(), changeFrequency: 'weekly', priority: 0.9 },
    { url: `${BASE_URL}/private-tour`, lastModified: new Date(), changeFrequency: 'weekly', priority: 0.85 },
    { url: `${BASE_URL}/packages`, lastModified: new Date(), changeFrequency: 'daily', priority: 0.9 },
    { url: `${BASE_URL}/destinations`, lastModified: new Date(), changeFrequency: 'daily', priority: 0.9 },
    { url: `${BASE_URL}/concierge`, lastModified: new Date(), changeFrequency: 'weekly', priority: 0.8 },
    { url: `${BASE_URL}/group-inquiry`, lastModified: new Date(), changeFrequency: 'weekly', priority: 0.8 },
    { url: `${BASE_URL}/blog`, lastModified: new Date(), changeFrequency: 'daily', priority: 0.8 },
    { url: `${BASE_URL}/privacy`, lastModified: new Date(), changeFrequency: 'yearly', priority: 0.2 },
    { url: `${BASE_URL}/terms`, lastModified: new Date(), changeFrequency: 'yearly', priority: 0.2 },
  ];

  const [activeDests, queriedPosts] = await Promise.all([
    runSitemapQuery<ActiveDestinationSitemapRow>('destinations', (signal) =>
      supabaseAdmin
        .from('active_destinations')
        .select('destination, package_count')
        .limit(DESTINATION_LIMIT)
        .abortSignal(signal),
    ),
    runSitemapQuery<{
      slug: string;
      destination: string | null;
      angle_type: string | null;
      published_at: string | null;
      updated_at: string | null;
    }>('blog', (signal) =>
      supabaseAdmin
        .from('content_creatives')
        .select('slug, destination, angle_type, published_at, updated_at')
        .eq('status', 'published')
        .eq('channel', 'naver_blog')
        .not('slug', 'is', null)
        .order('published_at', { ascending: false })
        .limit(BLOG_LIMIT)
        .abortSignal(signal),
    ),
  ]);
  const posts = queriedPosts.length > 0 ? queriedPosts : getFallbackBlogPosts();

  for (const d of activeDests) {
    const destination = getSafeSitemapDestination(d);
    if (destination) {
      routes.push({
        url: `${BASE_URL}/destinations/${encodeDestinationPathSegment(destination)}`,
        lastModified: new Date(),
        changeFrequency: 'daily',
        priority: 0.9,
      });
    }
  }

  const angles = new Set(['value', 'emotional', 'filial', 'luxury', 'urgency', 'activity', 'food']);
  const destinations = new Set<string>();
  const anglesWithPosts = new Set<string>();

  for (const post of posts) {
    const destination = post.destination?.trim();
    if (destination) destinations.add(destination);
    if (post.angle_type && angles.has(post.angle_type)) {
      anglesWithPosts.add(post.angle_type);
    }
  }

  for (const dest of destinations) {
    routes.push({
      url: `${BASE_URL}/blog/destination/${encodeDestinationPathSegment(dest)}`,
      lastModified: new Date(),
      changeFrequency: 'weekly',
      priority: 0.75,
    });
  }

  for (const angle of anglesWithPosts) {
    routes.push({
      url: `${BASE_URL}/blog/angle/${angle}`,
      lastModified: new Date(),
      changeFrequency: 'weekly',
      priority: 0.75,
    });
  }

  for (const post of posts) {
    if (isSafeSitemapBlogSlug(post.slug)) {
      routes.push({
        url: `${BASE_URL}/blog/${encodeURIComponent(post.slug.trim())}`,
        lastModified: safeLastModified(post.updated_at || post.published_at),
        changeFrequency: 'weekly',
        priority: 0.7,
      });
    }
  }

  return routes;
}
