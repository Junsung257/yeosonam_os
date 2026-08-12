import { unstable_cache } from 'next/cache';

import {
  BLOG_ANGLE_CACHE_TAG,
  BLOG_DESTINATION_CACHE_TAG,
  BLOG_LIST_CACHE_TAG,
  createBlogDatabaseUnavailableError,
} from '@/lib/blog-cache';
import { shouldSkipPublicDbReadsForResourceSaver } from '@/lib/cron-resource-saver';
import { PUBLIC_BLOG_READ_SOURCE } from '@/lib/blog-public-eligibility';
import { isBlogSlugRedirectSource } from '@/lib/blog-slug-redirects';
import { isSupabaseAdminConfigured, isSupabaseConfigured, supabaseAdmin } from '@/lib/supabase';
import bundledCatalogSnapshot from '@/data/blog-public-catalog-snapshot-v3.json';
import {
  runBlogPublicQueryWithTimeout,
  type AbortableBlogPublicQuery,
} from '@/lib/blog-public-query-timeout';

export const PUBLIC_BLOG_CATALOG_SELECT =
  'id, slug, seo_title, seo_description, og_image_url, angle_type, category, published_at, updated_at, content_modified_at, product_id, destination, content_type, featured, featured_order, view_count';

export interface PublicBlogCatalogPost {
  id: string;
  slug: string;
  seo_title: string | null;
  seo_description: string | null;
  og_image_url: string | null;
  angle_type: string;
  category: string | null;
  published_at: string;
  updated_at: string | null;
  content_modified_at?: string | null;
  product_id: string | null;
  destination: string | null;
  content_type: string | null;
  featured: boolean | null;
  featured_order: number | null;
  view_count: number | null;
}

export interface PublicBlogCatalogPage {
  posts: PublicBlogCatalogPost[];
  total: number;
  destinations: Array<{ destination: string; post_count: number }>;
  angleCounts: Record<string, number>;
  servedFrom: 'live_view' | 'durable_snapshot' | 'bundled_snapshot';
}

const BUNDLED_CATALOG_POSTS = bundledCatalogSnapshot.posts as PublicBlogCatalogPost[];

function loadBundledCatalogPage(input: {
  page: number; pageSize: number; destination?: string; angle?: string;
}): PublicBlogCatalogPage {
  const filtered = BUNDLED_CATALOG_POSTS
    .filter((post) => !input.destination || post.destination === input.destination)
    .filter((post) => !input.angle || post.angle_type === input.angle)
    .filter((post) => !isBlogSlugRedirectSource(post.slug));
  const from = (input.page - 1) * input.pageSize;
  const destinationCounts = new Map<string, number>();
  const angleCounts = new Map<string, number>();
  for (const post of BUNDLED_CATALOG_POSTS) {
    if (post.destination) destinationCounts.set(post.destination, (destinationCounts.get(post.destination) || 0) + 1);
    if (post.angle_type) angleCounts.set(post.angle_type, (angleCounts.get(post.angle_type) || 0) + 1);
  }
  return {
    posts: filtered.slice(from, from + input.pageSize),
    total: filtered.length,
    destinations: [...destinationCounts.entries()]
      .map(([destination, post_count]) => ({ destination, post_count }))
      .sort((left, right) => right.post_count - left.post_count),
    angleCounts: Object.fromEntries(angleCounts),
    servedFrom: 'bundled_snapshot',
  };
}

async function runCatalogQuery<T>(
  label: string,
  query: AbortableBlogPublicQuery<T>,
  timeoutMs = 6000,
): Promise<T> {
  try {
    return await runBlogPublicQueryWithTimeout(label, query, timeoutMs);
  } catch (error) {
    console.info(
      '[blog/catalog][degraded] public catalog query unavailable',
      error instanceof Error ? error.message : error,
    );
    throw createBlogDatabaseUnavailableError();
  }
}

async function loadPublicBlogCatalogUncached(): Promise<PublicBlogCatalogPost[]> {
  if (!isSupabaseConfigured || !isSupabaseAdminConfigured) {
    return BUNDLED_CATALOG_POSTS;
  }
  if (shouldSkipPublicDbReadsForResourceSaver()) {
    return BUNDLED_CATALOG_POSTS;
  }

  const result = await runCatalogQuery(
    'catalog-all',
    supabaseAdmin
      .from(PUBLIC_BLOG_READ_SOURCE)
      .select(PUBLIC_BLOG_CATALOG_SELECT)
      .eq('status', 'published')
      .eq('channel', 'naver_blog')
      .not('slug', 'is', null)
      .order('published_at', { ascending: false, nullsFirst: false })
      .limit(500),
  ).catch(() => null);

  if (!result || result.error) {
    console.info('[blog/catalog][degraded] serving bundled snapshot', result?.error);
    return BUNDLED_CATALOG_POSTS;
  }

  return ((result.data ?? []) as unknown as PublicBlogCatalogPost[])
    .filter((post) => Boolean(post.slug?.trim()))
    .filter((post) => !isBlogSlugRedirectSource(post.slug));
}

function normalizePage(value: number, fallback: number, maximum: number): number {
  return Math.min(maximum, Math.max(1, Number.isFinite(value) ? Math.floor(value) : fallback));
}

async function loadFacetSnapshot(): Promise<Pick<PublicBlogCatalogPage, 'destinations' | 'angleCounts'>> {
  const { data, error } = await runCatalogQuery(
    'catalog-facets',
    supabaseAdmin
      .from('blog_public_catalog_facets')
      .select('facet_type, facet_key, post_count')
      .order('post_count', { ascending: false })
      .limit(1000),
    2500,
  ).catch(() => ({ data: null, error: createBlogDatabaseUnavailableError() }));
  if (error) return { destinations: [], angleCounts: {} };
  const rows = (data || []) as Array<{ facet_type: string; facet_key: string; post_count: number }>;
  return {
    destinations: rows.filter((row) => row.facet_type === 'destination')
      .map((row) => ({ destination: row.facet_key, post_count: Number(row.post_count || 0) })),
    angleCounts: Object.fromEntries(rows.filter((row) => row.facet_type === 'angle')
      .map((row) => [row.facet_key, Number(row.post_count || 0)])),
  };
}

async function loadDurableCatalogPage(input: {
  page: number; pageSize: number; destination?: string; angle?: string;
}): Promise<PublicBlogCatalogPage | null> {
  const from = (input.page - 1) * input.pageSize;
  let query = supabaseAdmin.from('blog_public_snapshots')
    .select('creative_id, slug, title, description, hero_image, angle_type, destination, published_at, content_modified_at', { count: 'exact' })
    .eq('is_current', true)
    .order('published_at', { ascending: false })
    .range(from, from + input.pageSize - 1);
  if (input.destination) query = query.eq('destination', input.destination);
  if (input.angle) query = query.eq('angle_type', input.angle);
  const result = await runCatalogQuery('catalog-durable-snapshot', query);
  if (result.error || !result.data?.length) return null;
  const facets = await loadFacetSnapshot();
  return {
    posts: (result.data as Array<Record<string, unknown>>).map((row) => ({
      id: String(row.creative_id), slug: String(row.slug),
      seo_title: typeof row.title === 'string' ? row.title : null,
      seo_description: typeof row.description === 'string' ? row.description : null,
      og_image_url: typeof (row.hero_image as Record<string, unknown> | null)?.url === 'string'
        ? String((row.hero_image as Record<string, unknown>).url) : null,
      angle_type: typeof row.angle_type === 'string' ? row.angle_type : 'value', category: null,
      published_at: String(row.published_at),
      updated_at: typeof row.content_modified_at === 'string' ? row.content_modified_at : null,
      content_modified_at: typeof row.content_modified_at === 'string' ? row.content_modified_at : null,
      product_id: null, destination: typeof row.destination === 'string' ? row.destination : null,
      content_type: 'guide', featured: false, featured_order: null, view_count: null,
    })),
    total: Number(result.count || 0), ...facets, servedFrom: 'durable_snapshot',
  };
}

export async function loadPublicBlogCatalogPage(input: {
  page?: number; pageSize?: number; destination?: string; angle?: string;
} = {}): Promise<PublicBlogCatalogPage> {
  const page = normalizePage(input.page || 1, 1, 10000);
  const pageSize = normalizePage(input.pageSize || 12, 12, 50);
  const from = (page - 1) * pageSize;
  const bundled = () => loadBundledCatalogPage({ page, pageSize, destination: input.destination, angle: input.angle });
  if (!isSupabaseConfigured || !isSupabaseAdminConfigured || shouldSkipPublicDbReadsForResourceSaver()) {
    return bundled();
  }
  let query = supabaseAdmin.from(PUBLIC_BLOG_READ_SOURCE)
    .select(PUBLIC_BLOG_CATALOG_SELECT, { count: 'exact' })
    .order('published_at', { ascending: false, nullsFirst: false })
    .range(from, from + pageSize - 1);
  if (input.destination) query = query.eq('destination', input.destination);
  if (input.angle) query = query.eq('angle_type', input.angle);
  try {
    const result = await runCatalogQuery('catalog-page', query);
    if (result.error) throw createBlogDatabaseUnavailableError();
    const posts = ((result.data || []) as unknown as PublicBlogCatalogPost[])
      .filter((post) => Boolean(post.slug?.trim()))
      .filter((post) => !isBlogSlugRedirectSource(post.slug));
    const facets = await loadFacetSnapshot();
    return { posts, total: Number(result.count || 0), ...facets, servedFrom: 'live_view' };
  } catch {
    const snapshot = await loadDurableCatalogPage({ page, pageSize, destination: input.destination, angle: input.angle });
    if (snapshot) return snapshot;
    return bundled();
  }
}

const getCachedPublicBlogCatalog = unstable_cache(
  loadPublicBlogCatalogUncached,
  ['blog-public-catalog-v2'],
  {
    revalidate: 300,
    tags: [BLOG_LIST_CACHE_TAG, BLOG_DESTINATION_CACHE_TAG, BLOG_ANGLE_CACHE_TAG],
  },
);

export async function loadPublicBlogCatalog(): Promise<PublicBlogCatalogPost[]> {
  if (process.env.NODE_ENV === 'test' || process.env.VITEST) {
    return loadPublicBlogCatalogUncached();
  }
  return getCachedPublicBlogCatalog();
}
