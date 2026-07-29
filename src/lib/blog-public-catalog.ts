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

export const PUBLIC_BLOG_CATALOG_SELECT =
  'id, slug, seo_title, seo_description, og_image_url, angle_type, category, published_at, updated_at, product_id, destination, content_type, featured, featured_order, view_count';

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
  product_id: string | null;
  destination: string | null;
  content_type: string | null;
  featured: boolean | null;
  featured_order: number | null;
  view_count: number | null;
}

type AbortableCatalogQuery<T> = {
  abortSignal: (signal: AbortSignal) => PromiseLike<T>;
};

async function runCatalogQuery<T>(query: AbortableCatalogQuery<T>, timeoutMs = 6000): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await query.abortSignal(controller.signal);
  } catch (error) {
    console.info(
      '[blog/catalog][degraded] public catalog query unavailable',
      error instanceof Error ? error.message : error,
    );
    throw createBlogDatabaseUnavailableError();
  } finally {
    clearTimeout(timer);
  }
}

async function loadPublicBlogCatalogUncached(): Promise<PublicBlogCatalogPost[]> {
  if (!isSupabaseConfigured || !isSupabaseAdminConfigured) {
    throw createBlogDatabaseUnavailableError();
  }
  if (shouldSkipPublicDbReadsForResourceSaver()) {
    throw createBlogDatabaseUnavailableError();
  }

  const result = await runCatalogQuery(
    supabaseAdmin
      .from(PUBLIC_BLOG_READ_SOURCE)
      .select(PUBLIC_BLOG_CATALOG_SELECT)
      .eq('status', 'published')
      .eq('channel', 'naver_blog')
      .not('slug', 'is', null)
      .order('published_at', { ascending: false, nullsFirst: false })
      .limit(2000),
  );

  if (result.error) {
    console.info('[blog/catalog][degraded] public catalog query failed', result.error);
    throw createBlogDatabaseUnavailableError();
  }

  return ((result.data ?? []) as unknown as PublicBlogCatalogPost[])
    .filter((post) => Boolean(post.slug?.trim()))
    .filter((post) => !isBlogSlugRedirectSource(post.slug));
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
