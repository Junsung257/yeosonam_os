import { unstable_cache } from 'next/cache';
import { BLOG_DETAIL_CACHE_TAG, createBlogDatabaseUnavailableError } from './blog-cache';
import { isSupabaseAdminConfigured, isSupabaseConfigured, supabaseAdmin } from './supabase';

export interface BlogPublicDetailSnapshotV3 {
  creative_id: string;
  slug: string;
  title: string;
  description: string | null;
  content_document: Record<string, unknown> | null;
  legacy_markdown: string | null;
  generation_meta: Record<string, unknown>;
  quality_gate: Record<string, unknown>;
  product_id: string | null;
  tracking_id: string | null;
  content_type: string | null;
  target_audience: string | null;
  landing_enabled: boolean;
  landing_headline: string | null;
  landing_subtitle: string | null;
  hero_image: Record<string, unknown> | null;
  author: Record<string, unknown> | null;
  review: Record<string, unknown> | null;
  destination: string | null;
  angle_type: string | null;
  published_at: string;
  content_modified_at: string | null;
  fact_checked_at: string | null;
}

async function loadUncached(slug: string): Promise<BlogPublicDetailSnapshotV3 | null> {
  if (!isSupabaseConfigured || !isSupabaseAdminConfigured) throw createBlogDatabaseUnavailableError();
  const { data, error } = await supabaseAdmin
    .from('blog_public_snapshots')
    .select('creative_id, slug, title, description, content_document, legacy_markdown, generation_meta, quality_gate, product_id, tracking_id, content_type, target_audience, landing_enabled, landing_headline, landing_subtitle, hero_image, author, review, destination, angle_type, published_at, content_modified_at, fact_checked_at')
    .eq('slug', slug)
    .eq('is_current', true)
    .maybeSingle();
  if (error) throw createBlogDatabaseUnavailableError();
  return (data || null) as BlogPublicDetailSnapshotV3 | null;
}

const loadCached = unstable_cache(loadUncached, ['blog-public-detail-snapshot-v3'], {
  revalidate: 300,
  tags: [BLOG_DETAIL_CACHE_TAG],
});

export async function loadBlogPublicDetailSnapshotV3(slug: string): Promise<BlogPublicDetailSnapshotV3 | null> {
  if (process.env.NODE_ENV === 'test' || process.env.VITEST) return loadUncached(slug);
  return loadCached(slug);
}
