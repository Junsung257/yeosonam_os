import { unstable_cache } from 'next/cache';

import {
  BLOG_ANGLE_CACHE_TAG,
  BLOG_DESTINATION_CACHE_TAG,
  BLOG_LIST_CACHE_TAG,
  createBlogDatabaseUnavailableError,
} from '@/lib/blog-cache';
import { shouldSkipPublicDbReadsForResourceSaver } from '@/lib/cron-resource-saver';
import {
  getBlogPublicSurfacePolicyBlockReason,
  PUBLIC_BLOG_READ_SOURCE,
} from '@/lib/blog-public-eligibility';
import {
  isBlogSlugRedirectSource,
  isBlogSlugRedirectTombstone,
} from '@/lib/blog-slug-redirects';
import { isSupabaseAdminConfigured, isSupabaseConfigured, supabaseAdmin } from '@/lib/supabase';
import bundledCatalogSnapshot from '@/data/blog-public-catalog-snapshot-v3.json';
import {
  runBlogPublicQueryWithTimeout,
  type AbortableBlogPublicQuery,
} from '@/lib/blog-public-query-timeout';
import { classifyBlogFreshnessRisk } from '@/lib/blog-freshness-risk';
import { isHighRiskInformationalTopic } from '@/lib/blog-publication-review-policy';
import { loadImmutableRemoteJsonSnapshotV3 } from '@/lib/blog-public-remote-snapshot-v3';

export const PUBLIC_BLOG_CATALOG_SELECT =
  'id, slug, seo_title, seo_description, og_image_url, angle_type, category, published_at, updated_at, content_modified_at, product_id, destination, content_type, featured, featured_order, view_count, review_status, topic_source, noindex:generation_meta->noindex, redirect_to:generation_meta->>redirect_to';
export const PUBLIC_BLOG_CATALOG_LEGACY_SELECT =
  'id, slug, seo_title, seo_description, og_image_url, angle_type, category, published_at, updated_at, product_id, destination, content_type, featured, featured_order, view_count, review_status, topic_source, noindex:generation_meta->noindex, redirect_to:generation_meta->>redirect_to';

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
  review_status?: string | null;
  topic_source?: string | null;
  noindex?: unknown;
  redirect_to?: string | null;
  generation_meta?: Record<string, unknown> | null;
  generated_at?: string | null;
}

export interface PublicBlogCatalogPage {
  posts: PublicBlogCatalogPost[];
  total: number;
  destinations: Array<{ destination: string; post_count: number }>;
  angleCounts: Record<string, number>;
  servedFrom: 'live_view' | 'durable_snapshot' | 'remote_lkg' | 'bundled_snapshot';
}

interface PublicBlogCatalogBundleV3 {
  generated_at: string | null;
  posts: PublicBlogCatalogPost[];
}

const BUNDLED_CATALOG_SNAPSHOT = bundledCatalogSnapshot as unknown as PublicBlogCatalogBundleV3;
const BUNDLED_CATALOG_POSTS = BUNDLED_CATALOG_SNAPSHOT.posts;

function readCatalogRiskLevel(post: PublicBlogCatalogPost): 'LOW' | 'MEDIUM' | 'HIGH' {
  const brief = post.generation_meta?.content_brief ?? post.generation_meta?.content_brief_v3;
  if (brief && typeof brief === 'object' && !Array.isArray(brief)) {
    const value = (brief as Record<string, unknown>).risk_level
      ?? (brief as Record<string, unknown>).riskLevel;
    if (value === 'LOW' || value === 'MEDIUM' || value === 'HIGH') return value;
  }
  if (isHighRiskInformationalTopic({
    productId: post.product_id,
    title: post.seo_title,
    category: post.category,
    contentType: post.content_type,
    topic: post.topic_source,
  })) return 'HIGH';
  return classifyBlogFreshnessRisk([
    post.seo_title,
    post.category,
    post.content_type,
    post.topic_source,
  ].filter(Boolean).join(' ')).level.toUpperCase() as 'LOW' | 'MEDIUM' | 'HIGH';
}

export function isBlogPublicCatalogFallbackFreshV3(
  post: PublicBlogCatalogPost,
  bundleGeneratedAt: string | null,
  now = new Date(),
): boolean {
  const risk = readCatalogRiskLevel(post);
  if (risk === 'HIGH') return false;
  const generatedAt = Date.parse(post.generated_at || bundleGeneratedAt || '');
  if (!Number.isFinite(generatedAt) || generatedAt > now.getTime() + 5 * 60_000) return false;
  const maximumHours = risk === 'MEDIUM' ? 48 : 720;
  return now.getTime() - generatedAt <= maximumHours * 60 * 60_000;
}

function isCatalogPostPolicySafe(post: PublicBlogCatalogPost): boolean {
  if (isBlogSlugRedirectTombstone(post.slug)) return false;
  const bundledMeta = (post as PublicBlogCatalogPost & {
    generation_meta?: Record<string, unknown> | null;
  }).generation_meta;
  return getBlogPublicSurfacePolicyBlockReason({
    productId: post.product_id,
    reviewStatus: post.review_status,
    title: post.seo_title,
    category: post.category,
    contentType: post.content_type,
    topic: post.topic_source,
    generationMeta: {
      noindex: post.noindex ?? bundledMeta?.noindex,
      redirect_to: post.redirect_to ?? bundledMeta?.redirect_to,
    },
  }) === null;
}

function loadCatalogBundlePage(bundle: PublicBlogCatalogBundleV3, input: {
  page: number; pageSize: number; destination?: string; angle?: string;
}, servedFrom: 'remote_lkg' | 'bundled_snapshot'): PublicBlogCatalogPage {
  const eligiblePosts = bundle.posts
    .filter(isCatalogPostPolicySafe)
    .filter((post) => isBlogPublicCatalogFallbackFreshV3(post, bundle.generated_at));
  const filtered = eligiblePosts
    .filter((post) => !input.destination || post.destination === input.destination)
    .filter((post) => !input.angle || post.angle_type === input.angle)
    .filter((post) => !isBlogSlugRedirectSource(post.slug));
  const from = (input.page - 1) * input.pageSize;
  const destinationCounts = new Map<string, number>();
  const angleCounts = new Map<string, number>();
  for (const post of eligiblePosts) {
    if (!isCatalogPostPolicySafe(post) || isBlogSlugRedirectSource(post.slug)) continue;
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
    servedFrom,
  };
}

function loadBundledCatalogPage(input: {
  page: number; pageSize: number; destination?: string; angle?: string;
}): PublicBlogCatalogPage {
  return loadCatalogBundlePage(BUNDLED_CATALOG_SNAPSHOT, input, 'bundled_snapshot');
}

/**
 * Every catalog fallback tier is isolated. A transient database failure in
 * the durable snapshot must not prevent the remote or bundled last-known-good
 * snapshot from serving the request.
 */
export async function resolveBlogPublicCatalogFallbackV3<T>(input: {
  durable: () => Promise<T | null>;
  remote: () => Promise<T | null>;
  bundled: () => T;
}): Promise<T> {
  const durable = await input.durable().catch(() => null);
  if (durable) return durable;
  const remote = await input.remote().catch(() => null);
  return remote ?? input.bundled();
}

async function loadRemoteCatalogPage(input: {
  page: number; pageSize: number; destination?: string; angle?: string;
}): Promise<PublicBlogCatalogPage | null> {
  const result = await loadImmutableRemoteJsonSnapshotV3<PublicBlogCatalogBundleV3>({
    url: process.env.BLOG_PUBLIC_CATALOG_LKG_URL,
    sha256: process.env.BLOG_PUBLIC_CATALOG_LKG_SHA256,
  });
  if (result.state !== 'found' || !Array.isArray(result.value.posts)) return null;
  const page = loadCatalogBundlePage(result.value, input, 'remote_lkg');
  return page.posts.length > 0 || page.total > 0 ? page : null;
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

function isCatalogViewSchemaCompatibilityError(error: unknown): boolean {
  const message = error && typeof error === 'object' && 'message' in error
    ? String((error as { message?: unknown }).message ?? '')
    : String(error ?? '');
  return /content_modified_at.*does not exist/i.test(message);
}

async function loadPublicBlogCatalogUncached(): Promise<PublicBlogCatalogPost[]> {
  if (!isSupabaseConfigured || !isSupabaseAdminConfigured) {
    const remote = await loadRemoteCatalogPage({ page: 1, pageSize: 500 });
    return remote?.posts ?? loadBundledCatalogPage({ page: 1, pageSize: 500 }).posts;
  }
  if (shouldSkipPublicDbReadsForResourceSaver()) {
    const remote = await loadRemoteCatalogPage({ page: 1, pageSize: 500 });
    return remote?.posts ?? loadBundledCatalogPage({ page: 1, pageSize: 500 }).posts;
  }

  const buildQuery = (select: string) => supabaseAdmin
    .from(PUBLIC_BLOG_READ_SOURCE)
    .select(select)
    .eq('status', 'published')
    .eq('channel', 'naver_blog')
    .not('slug', 'is', null)
    .order('published_at', { ascending: false, nullsFirst: false })
    .limit(500);
  let result = await runCatalogQuery(
    'catalog-all',
    buildQuery(PUBLIC_BLOG_CATALOG_SELECT),
  ).catch(() => null);
  if (result?.error && isCatalogViewSchemaCompatibilityError(result.error)) {
    result = await runCatalogQuery(
      'catalog-all-legacy-view',
      buildQuery(PUBLIC_BLOG_CATALOG_LEGACY_SELECT),
    ).catch(() => null);
  }

  if (!result || result.error) {
    console.info('[blog/catalog][degraded] serving snapshot hierarchy', result?.error);
    return (await resolveBlogPublicCatalogFallbackV3({
      durable: () => loadDurableCatalogPage({ page: 1, pageSize: 500 }),
      remote: () => loadRemoteCatalogPage({ page: 1, pageSize: 500 }),
      bundled: () => loadBundledCatalogPage({ page: 1, pageSize: 500 }),
    })).posts;
  }

  return ((result.data ?? []) as unknown as PublicBlogCatalogPost[])
    .filter(isCatalogPostPolicySafe)
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
    .select('creative_id, slug, title, description, hero_image, angle_type, destination, published_at, content_modified_at, review_status, product_id, content_type, generation_meta, generated_at', { count: 'exact' })
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
      product_id: typeof row.product_id === 'string' ? row.product_id : null,
      destination: typeof row.destination === 'string' ? row.destination : null,
      content_type: typeof row.content_type === 'string' ? row.content_type : null,
      review_status: typeof row.review_status === 'string' ? row.review_status : null,
      generation_meta: row.generation_meta && typeof row.generation_meta === 'object'
        ? row.generation_meta as Record<string, unknown> : null,
      generated_at: typeof row.generated_at === 'string' ? row.generated_at : null,
      noindex: (row.generation_meta as Record<string, unknown> | null)?.noindex,
      redirect_to: typeof (row.generation_meta as Record<string, unknown> | null)?.redirect_to === 'string'
        ? String((row.generation_meta as Record<string, unknown>).redirect_to) : null,
      featured: false, featured_order: null, view_count: null,
    })).filter(isCatalogPostPolicySafe)
      .filter((post) => isBlogPublicCatalogFallbackFreshV3(post, post.generated_at || null)),
    total: Number(result.count || 0), ...facets, servedFrom: 'durable_snapshot',
  };
}

async function loadPublicBlogCatalogPageUncached(input: {
  page?: number; pageSize?: number; destination?: string; angle?: string;
} = {}): Promise<PublicBlogCatalogPage> {
  const page = normalizePage(input.page || 1, 1, 10000);
  const pageSize = normalizePage(input.pageSize || 12, 12, 50);
  const from = (page - 1) * pageSize;
  const bundled = () => loadBundledCatalogPage({ page, pageSize, destination: input.destination, angle: input.angle });
  if (!isSupabaseConfigured || !isSupabaseAdminConfigured || shouldSkipPublicDbReadsForResourceSaver()) {
    return bundled();
  }
  const buildQuery = (select: string) => {
    let query = supabaseAdmin.from(PUBLIC_BLOG_READ_SOURCE)
      .select(select, { count: 'exact' })
      .order('published_at', { ascending: false, nullsFirst: false })
      .range(from, from + pageSize - 1);
    if (input.destination) query = query.eq('destination', input.destination);
    if (input.angle) query = query.eq('angle_type', input.angle);
    return query;
  };
  try {
    let result = await runCatalogQuery('catalog-page', buildQuery(PUBLIC_BLOG_CATALOG_SELECT));
    if (result.error && isCatalogViewSchemaCompatibilityError(result.error)) {
      result = await runCatalogQuery(
        'catalog-page-legacy-view',
        buildQuery(PUBLIC_BLOG_CATALOG_LEGACY_SELECT),
      );
    }
    if (result.error) throw createBlogDatabaseUnavailableError();
    const posts = ((result.data || []) as unknown as PublicBlogCatalogPost[])
      .filter(isCatalogPostPolicySafe)
      .filter((post) => Boolean(post.slug?.trim()))
      .filter((post) => !isBlogSlugRedirectSource(post.slug));
    const facets = await loadFacetSnapshot();
    return { posts, total: Number(result.count || 0), ...facets, servedFrom: 'live_view' };
  } catch {
    return resolveBlogPublicCatalogFallbackV3({
      durable: () => loadDurableCatalogPage({ page, pageSize, destination: input.destination, angle: input.angle }),
      remote: () => loadRemoteCatalogPage({ page, pageSize, destination: input.destination, angle: input.angle }),
      bundled,
    });
  }
}

const getCachedPublicBlogCatalogPage = unstable_cache(
  loadPublicBlogCatalogPageUncached,
  ['blog-public-catalog-page-v4-medication-policy'],
  {
    revalidate: 300,
    tags: [BLOG_LIST_CACHE_TAG, BLOG_DESTINATION_CACHE_TAG, BLOG_ANGLE_CACHE_TAG],
  },
);

export async function loadPublicBlogCatalogPage(input: {
  page?: number; pageSize?: number; destination?: string; angle?: string;
} = {}): Promise<PublicBlogCatalogPage> {
  const normalizedInput = {
    page: normalizePage(input.page || 1, 1, 10000),
    pageSize: normalizePage(input.pageSize || 12, 12, 50),
    ...(input.destination?.trim() ? { destination: input.destination.trim() } : {}),
    ...(input.angle?.trim() ? { angle: input.angle.trim() } : {}),
  };
  if (process.env.NODE_ENV === 'test' || process.env.VITEST) {
    return loadPublicBlogCatalogPageUncached(normalizedInput);
  }
  return getCachedPublicBlogCatalogPage(normalizedInput);
}

const getCachedPublicBlogCatalog = unstable_cache(
  loadPublicBlogCatalogUncached,
  ['blog-public-catalog-v3-medication-policy'],
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
