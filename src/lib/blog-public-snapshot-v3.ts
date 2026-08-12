import { createBlogDatabaseUnavailableError } from './blog-cache';
import { shouldSkipPublicDbReadsForResourceSaver } from './cron-resource-saver';
import { isSupabaseAdminConfigured, isSupabaseConfigured, supabaseAdmin } from './supabase';
import bundledDetailSnapshot from '@/data/blog-public-detail-snapshot-v3.json';
import { runBlogPublicQueryWithTimeout } from './blog-public-query-timeout';

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

export type BlogPublicDetailSnapshotLoadResultV3 =
  | { state: 'found'; snapshot: BlogPublicDetailSnapshotV3 }
  | { state: 'missing'; snapshot: null }
  | { state: 'unavailable'; snapshot: null };

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
  const brief = snapshot?.generation_meta?.content_brief
    ?? snapshot?.generation_meta?.content_brief_v3;
  if (!brief || typeof brief !== 'object' || Array.isArray(brief)) return null;
  const record = brief as Record<string, unknown>;
  const risk = record.risk_level ?? record.riskLevel;
  return risk === 'HIGH' || risk === 'MEDIUM' || risk === 'LOW' ? risk : null;
}

const BUNDLED_DETAIL_SNAPSHOT = bundledDetailSnapshot as unknown as BlogPublicDetailSnapshotBundleV3;

function loadBundled(slug: string): BlogPublicDetailSnapshotV3 | null {
  return selectBundledBlogPublicDetailSnapshotV3(BUNDLED_DETAIL_SNAPSHOT, slug);
}

async function loadUncached(slug: string): Promise<BlogPublicDetailSnapshotLoadResultV3> {
  if (!isSupabaseConfigured || !isSupabaseAdminConfigured || shouldSkipPublicDbReadsForResourceSaver()) {
    const bundled = loadBundled(slug);
    return bundled
      ? { state: 'found', snapshot: bundled }
      : { state: 'unavailable', snapshot: null };
  }
  const { data, error } = await runBlogPublicQueryWithTimeout(
    'detail-snapshot',
    supabaseAdmin
      .from('blog_public_snapshots')
      .select('creative_id, slug, title, description, content_document, legacy_markdown, generation_meta, quality_gate, product_id, tracking_id, content_type, target_audience, landing_enabled, landing_headline, landing_subtitle, hero_image, author, review, destination, angle_type, published_at, content_modified_at, fact_checked_at')
      .eq('slug', slug)
      .eq('is_current', true)
      .limit(1),
    6000,
  ).catch(() => ({ data: null, error: createBlogDatabaseUnavailableError() }));
  if (error) {
    const bundled = loadBundled(slug);
    return bundled
      ? { state: 'found', snapshot: bundled }
      : { state: 'unavailable', snapshot: null };
  }
  const snapshot = ((data?.[0] || null) as unknown) as BlogPublicDetailSnapshotV3 | null;
  return snapshot
    ? { state: 'found', snapshot }
    : { state: 'missing', snapshot: null };
}

export async function loadBlogPublicDetailSnapshotV3(slug: string): Promise<BlogPublicDetailSnapshotLoadResultV3> {
  // The detail page owns the single cache boundary. Keeping another
  // unstable_cache here caused rejected database reads to be reported as
  // cache revalidation failures even when the page rendered its fallback.
  return loadUncached(slug);
}
