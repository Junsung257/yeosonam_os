import { unstable_cache } from 'next/cache';
import { BLOG_DETAIL_CACHE_TAG, createBlogDatabaseUnavailableError } from './blog-cache';
import { shouldSkipPublicDbReadsForResourceSaver } from './cron-resource-saver';
import { isSupabaseAdminConfigured, isSupabaseConfigured, supabaseAdmin } from './supabase';
import bundledDetailSnapshot from '@/data/blog-public-detail-snapshot-v3.json';

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

interface BlogPublicDetailSnapshotBundleV3 {
  generated_at: string | null;
  posts: BlogPublicDetailSnapshotV3[];
}

function hasUsableBundledBody(snapshot: BlogPublicDetailSnapshotV3): boolean {
  const body = snapshot.legacy_markdown
    || (typeof snapshot.content_document?.markdown === 'string'
      ? snapshot.content_document.markdown
      : '');
  return body.replace(/\s+/g, '').length >= 200;
}

export function selectBundledBlogPublicDetailSnapshotV3(
  bundle: BlogPublicDetailSnapshotBundleV3,
  slug: string,
  now = new Date(),
): BlogPublicDetailSnapshotV3 | null {
  const generatedAt = bundle.generated_at ? Date.parse(bundle.generated_at) : Number.NaN;
  if (!Number.isFinite(generatedAt)) return null;
  if (generatedAt > now.getTime() + 5 * 60_000) return null;
  const configuredMaximumAge = Number(process.env.BLOG_DETAIL_BUNDLE_MAX_AGE_HOURS || 72);
  const configuredHours = Number.isFinite(configuredMaximumAge)
    ? Math.max(1, configuredMaximumAge)
    : 72;
  const contentBrief = snapshotRiskBrief(bundle.posts.find((post) => post.slug === slug));
  const riskMaximumHours = contentBrief === 'HIGH' ? 24 : contentBrief === 'MEDIUM' ? 48 : 72;
  const maximumAgeHours = Math.min(configuredHours, riskMaximumHours);
  if (now.getTime() - generatedAt > maximumAgeHours * 60 * 60_000) return null;
  const snapshot = bundle.posts.find((post) => post.slug === slug);
  return snapshot && hasUsableBundledBody(snapshot) ? snapshot : null;
}

function snapshotRiskBrief(snapshot: BlogPublicDetailSnapshotV3 | undefined): string | null {
  const brief = snapshot?.generation_meta?.content_brief;
  if (!brief || typeof brief !== 'object' || Array.isArray(brief)) return null;
  const risk = (brief as Record<string, unknown>).risk_level;
  return risk === 'HIGH' || risk === 'MEDIUM' || risk === 'LOW' ? risk : null;
}

const BUNDLED_DETAIL_SNAPSHOT = bundledDetailSnapshot as unknown as BlogPublicDetailSnapshotBundleV3;

function loadBundled(slug: string): BlogPublicDetailSnapshotV3 | null {
  return selectBundledBlogPublicDetailSnapshotV3(BUNDLED_DETAIL_SNAPSHOT, slug);
}

async function loadUncached(slug: string): Promise<BlogPublicDetailSnapshotV3 | null> {
  if (!isSupabaseConfigured || !isSupabaseAdminConfigured || shouldSkipPublicDbReadsForResourceSaver()) {
    return loadBundled(slug) ?? Promise.reject(createBlogDatabaseUnavailableError());
  }
  const { data, error } = await supabaseAdmin
    .from('blog_public_snapshots')
    .select('creative_id, slug, title, description, content_document, legacy_markdown, generation_meta, quality_gate, product_id, tracking_id, content_type, target_audience, landing_enabled, landing_headline, landing_subtitle, hero_image, author, review, destination, angle_type, published_at, content_modified_at, fact_checked_at')
    .eq('slug', slug)
    .eq('is_current', true)
    .maybeSingle();
  if (error) return loadBundled(slug) ?? Promise.reject(createBlogDatabaseUnavailableError());
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
