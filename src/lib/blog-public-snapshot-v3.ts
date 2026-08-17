import { createBlogDatabaseUnavailableError } from './blog-cache';
import { shouldSkipPublicDbReadsForResourceSaver } from './cron-resource-saver';
import { isSupabaseAdminConfigured, isSupabaseConfigured, supabaseAdmin } from './supabase';
import bundledDetailSnapshot from '@/data/blog-public-detail-snapshot-v3.json';
import { runBlogPublicQueryWithTimeout } from './blog-public-query-timeout';
import { getBlogPublicSurfacePolicyBlockReason } from './blog-public-eligibility';
import { isHighRiskInformationalTopic } from './blog-publication-review-policy';
import { classifyBlogFreshnessRisk } from './blog-freshness-risk';
import { loadImmutableRemoteJsonSnapshotV3 } from './blog-public-remote-snapshot-v3';

export interface BlogPublicDetailSnapshotV3 {
  creative_id: string;
  slug: string;
  title: string;
  description: string | null;
  content_document: Record<string, unknown> | null;
  legacy_markdown: string | null;
  generation_meta: Record<string, unknown>;
  quality_gate: Record<string, unknown>;
  review_status?: string | null;
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
  generated_at?: string | null;
}

export type BlogPublicDetailSnapshotLoadResultV3 =
  | {
    state: 'found';
    snapshot: BlogPublicDetailSnapshotV3;
    servedFrom: 'durable_snapshot' | 'remote_lkg' | 'bundled_snapshot';
  }
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

function readSnapshotReviewStatus(snapshot: BlogPublicDetailSnapshotV3): string | null {
  if (typeof snapshot.review_status === 'string') return snapshot.review_status;
  const nested = snapshot.review;
  return nested && typeof nested.review_status === 'string' ? nested.review_status : null;
}

export function isBlogPublicDetailSnapshotPolicySafeV3(
  snapshot: BlogPublicDetailSnapshotV3,
): boolean {
  const brief = snapshot.generation_meta.content_brief
    ?? snapshot.generation_meta.content_brief_v3;
  const topic = brief && typeof brief === 'object' && !Array.isArray(brief)
    ? String((brief as Record<string, unknown>).intent_type ?? '')
    : null;
  return getBlogPublicSurfacePolicyBlockReason({
    productId: snapshot.product_id,
    reviewStatus: readSnapshotReviewStatus(snapshot),
    title: snapshot.title,
    category: null,
    contentType: snapshot.content_type,
    topic,
    generationMeta: snapshot.generation_meta,
  }) === null;
}

export function selectBundledBlogPublicDetailSnapshotV3(
  bundle: BlogPublicDetailSnapshotBundleV3,
  slug: string,
  now = new Date(),
): BlogPublicDetailSnapshotV3 | null {
  const candidate = bundle.posts.find((post) => post.slug === slug);
  if (!candidate) return null;
  const generatedAt = Date.parse(candidate.generated_at || bundle.generated_at || '');
  if (!Number.isFinite(generatedAt) || generatedAt > now.getTime() + 5 * 60_000) return null;
  const configuredMaximumAge = Number(process.env.BLOG_DETAIL_BUNDLE_MAX_AGE_HOURS || 720);
  const configuredHours = Number.isFinite(configuredMaximumAge)
    ? Math.max(1, configuredMaximumAge)
    : 720;
  const contentBrief = snapshotRiskBrief(candidate);
  const topic = snapshotIntent(candidate);
  const highRisk = contentBrief === 'HIGH' || Boolean(candidate && isHighRiskInformationalTopic({
    productId: candidate.product_id,
    title: candidate.title,
    contentType: candidate.content_type,
    topic,
  }));
  const inferredRisk = classifyBlogFreshnessRisk([
    candidate.title,
    candidate.content_type,
    topic,
  ].filter(Boolean).join(' ')).level;
  // HIGH-risk facts must be re-read from the authoritative live surface. A
  // previously approved body is not permission to serve stale legal, entry,
  // medical, insurance, customs, or safety information during an outage.
  if (highRisk || inferredRisk === 'high') return null;
  const riskMaximumHours = contentBrief === 'MEDIUM' || inferredRisk === 'medium' ? 48 : 720;
  const maximumAgeHours = Math.min(configuredHours, riskMaximumHours);
  if (now.getTime() - generatedAt > maximumAgeHours * 60 * 60_000) return null;
  return hasUsableBundledBody(candidate)
    && isBlogPublicDetailSnapshotPolicySafeV3(candidate)
    ? candidate
    : null;
}

function snapshotRiskBrief(snapshot: BlogPublicDetailSnapshotV3 | undefined): string | null {
  const brief = snapshot?.generation_meta?.content_brief
    ?? snapshot?.generation_meta?.content_brief_v3;
  if (!brief || typeof brief !== 'object' || Array.isArray(brief)) return null;
  const record = brief as Record<string, unknown>;
  const risk = record.risk_level ?? record.riskLevel;
  return risk === 'HIGH' || risk === 'MEDIUM' || risk === 'LOW' ? risk : null;
}

function snapshotIntent(snapshot: BlogPublicDetailSnapshotV3 | undefined): string | null {
  const brief = snapshot?.generation_meta?.content_brief
    ?? snapshot?.generation_meta?.content_brief_v3;
  if (!brief || typeof brief !== 'object' || Array.isArray(brief)) return null;
  const record = brief as Record<string, unknown>;
  const intent = record.intent_type ?? record.intentType;
  return typeof intent === 'string' ? intent : null;
}

const BUNDLED_DETAIL_SNAPSHOT = bundledDetailSnapshot as unknown as BlogPublicDetailSnapshotBundleV3;

function loadBundled(slug: string): BlogPublicDetailSnapshotV3 | null {
  return selectBundledBlogPublicDetailSnapshotV3(BUNDLED_DETAIL_SNAPSHOT, slug);
}

async function loadRemote(slug: string): Promise<BlogPublicDetailSnapshotV3 | null> {
  const result = await loadImmutableRemoteJsonSnapshotV3<BlogPublicDetailSnapshotBundleV3>({
    url: process.env.BLOG_PUBLIC_DETAIL_LKG_URL,
    sha256: process.env.BLOG_PUBLIC_DETAIL_LKG_SHA256,
  });
  return result.state === 'found'
    ? selectBundledBlogPublicDetailSnapshotV3(result.value, slug)
    : null;
}

async function loadSnapshotFallbacks(
  slug: string,
  durableUnavailable: boolean,
): Promise<BlogPublicDetailSnapshotLoadResultV3> {
  const remote = await loadRemote(slug);
  if (remote) return { state: 'found', snapshot: remote, servedFrom: 'remote_lkg' };
  const bundled = loadBundled(slug);
  if (bundled) return { state: 'found', snapshot: bundled, servedFrom: 'bundled_snapshot' };
  return durableUnavailable
    ? { state: 'unavailable', snapshot: null }
    : { state: 'missing', snapshot: null };
}

async function loadUncached(slug: string): Promise<BlogPublicDetailSnapshotLoadResultV3> {
  if (!isSupabaseConfigured || !isSupabaseAdminConfigured || shouldSkipPublicDbReadsForResourceSaver()) {
    return loadSnapshotFallbacks(slug, true);
  }
  const { data, error } = await runBlogPublicQueryWithTimeout(
    'detail-snapshot',
    supabaseAdmin
      .from('blog_public_snapshots')
      .select('creative_id, slug, title, description, content_document, legacy_markdown, generation_meta, quality_gate, review_status, product_id, tracking_id, content_type, target_audience, landing_enabled, landing_headline, landing_subtitle, hero_image, author, review, destination, angle_type, published_at, content_modified_at, fact_checked_at, generated_at')
      .eq('slug', slug)
      .eq('is_current', true)
      .limit(1),
    6000,
  ).catch(() => ({ data: null, error: createBlogDatabaseUnavailableError() }));
  if (error) {
    return loadSnapshotFallbacks(slug, true);
  }
  const snapshot = ((data?.[0] || null) as unknown) as BlogPublicDetailSnapshotV3 | null;
  if (snapshot) {
    const selected = selectBundledBlogPublicDetailSnapshotV3({
      generated_at: snapshot.generated_at || null,
      posts: [snapshot],
    }, slug);
    if (selected) return { state: 'found', snapshot: selected, servedFrom: 'durable_snapshot' };
  }
  // This loader is called only after the authoritative live query is
  // unavailable. A lagging/empty durable table therefore cannot prove that a
  // known public slug is missing; continue through remote and bundled LKG.
  return loadSnapshotFallbacks(slug, false);
}

export async function loadBlogPublicDetailSnapshotV3(slug: string): Promise<BlogPublicDetailSnapshotLoadResultV3> {
  // The detail page owns the single cache boundary. Keeping another
  // unstable_cache here caused rejected database reads to be reported as
  // cache revalidation failures even when the page rendered its fallback.
  return loadUncached(slug);
}
