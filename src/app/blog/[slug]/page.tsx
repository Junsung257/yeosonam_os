import type { Metadata } from 'next';
import { unstable_cache, unstable_noStore } from 'next/cache';
import { notFound, permanentRedirect, redirect } from 'next/navigation';
import Link from 'next/link';
import { supabaseAdmin, isSupabaseAdminConfigured, isSupabaseConfigured } from '@/lib/supabase';
import BlogTracker from '@/components/BlogTracker';
import TableOfContents from '@/components/blog/TableOfContents';
import TldrBox from '@/components/blog/TldrBox';
import AuthorBox from '@/components/blog/AuthorBox';
import ShareButtons from '@/components/blog/ShareButtons';
import ReadingProgress from '@/components/blog/ReadingProgress';
import BlogCitations from '@/components/blog/BlogCitations';
import { loadBlogPublicCitations } from '@/lib/blog-public-citations';
import InlineRelated, {
  type RelatedProductLite,
  type RelatedPostLite,
} from '@/components/blog/InlineRelated';
import { extractTocAndInjectIds, shouldShowToc } from '@/lib/blog-toc';
import { removeUnreachableBlogAssetImages, renderBlogContentToHtml } from '@/lib/blog-renderer';
import LandingHero from '@/components/blog/LandingHero';
import { buildBlogProductFactLabels } from '@/lib/blog-product-fact-labels';
import StickyMobileCta from '@/components/blog/StickyMobileCta';
import DestinationCuration from '@/components/blog/DestinationCuration';
import BlogProductRecommendationTracker from '@/components/blog/BlogProductRecommendationTracker';
import { ScrollReveal } from '@/components/blog/ScrollReveal';
import { BackToTop } from '@/components/blog/BackToTop';
import GlobalNav from '@/components/customer/GlobalNav';
import { SafeCoverImg } from '@/components/customer/SafeRemoteImage';
import { buildBlogPostPageJsonLd } from '@/lib/blog-jsonld';
import { serializeJsonLdForScript } from '@/lib/json-ld';
import { safeDecodeSlug } from '@/lib/decode-slug';
import { logError } from '@/lib/sentry-logger';
import { toBlogImageDisplaySrc } from '@/lib/blog-image-proxy';
import { isGeneratedBlogImageUrl } from '@/lib/blog-image-gen';
import { classifyBlogIntent } from '@/lib/blog-content-intent';
import { resolveBlogSlugRedirect } from '@/lib/blog-slug-redirects';
import { CUSTOMER_VISIBLE_STATUSES } from '@/lib/visibility-status';
import {
  BLOG_DETAIL_CACHE_TAG,
  createBlogDatabaseUnavailableError,
  isBlogDatabaseUnavailableError,
} from '@/lib/blog-cache';
import { shouldSkipPublicDbReadsForResourceSaver } from '@/lib/cron-resource-saver';
import { resolveBlogCanonicalOrigin } from '@/lib/blog-canonical-url';
import { hasUpcomingPublicDepartureDate, isCustomerPubliclyOpenable } from '@/lib/package-public-eligibility';
import { formatKstDate } from '@/lib/kst-date';
import {
  fetchAndMergeCurrentPublicPackageCardSnapshots,
  listCurrentPublicPackageCardSnapshots,
} from '@/lib/package-publication/snapshot-projection';
import { getCurrentPublicPackage } from '@/lib/package-publication/repository';
import { PLATFORM_PRODUCT_REGISTRATION_TENANT_ID } from '@/lib/product-registration-authority/types';
import { isPublicPublicationState } from '@/lib/package-publication/types';
import {
  rankBlogInformationalRelatedLinks,
  readBlogInformationalLinkCandidate,
  type BlogInformationalLinkContext,
} from '@/lib/blog-informational-related-links';
import { readBlogInformationRepresentativeIdentity } from '@/lib/blog-information-representative';
import { InformationalCtaHub } from '@/components/blog/InformationalCtaHub';
import {
  selectBlogInformationalCtas,
  stripBlogInformationalBodyCtas,
} from '@/lib/blog-informational-cta';
import {
  loadBlogInformationalCtaSettings,
  loadBlogInformationalOfficialSourceUrl,
} from '@/lib/blog-informational-cta-settings';
import type { BlogInformationRiskLevel } from '@/lib/blog-information-planner';
import {
  sanitizePublicBlogBodyHtml,
  stripPublicDuplicateBodyTitleHeading,
} from '@/lib/blog-public-render-normalizer';
import {
  getBlogPublicSurfacePolicyBlockReason,
  PUBLIC_BLOG_READ_SOURCE,
} from '@/lib/blog-public-eligibility';
import {
  calculateBlogReadingTimeFromHtml,
  readPersistedBlogReadingTime,
} from '@/lib/blog-reading-time';
import {
  loadBlogPublicDetailSnapshotV3,
  type BlogPublicDetailSnapshotV3,
} from '@/lib/blog-public-snapshot-v3';
import { verifyBlogPreviewToken } from '@/lib/blog-browser-preview-v4';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

function isNextNotFoundError(err: unknown): boolean {
  return (
    !!err &&
    typeof err === 'object' &&
    'digest' in err &&
    typeof (err as { digest?: unknown }).digest === 'string' &&
    (err as { digest: string }).digest.startsWith('NEXT_HTTP_ERROR_FALLBACK;404')
  );
}

function isNextRedirectError(err: unknown): boolean {
  return (
    !!err &&
    typeof err === 'object' &&
    'digest' in err &&
    typeof (err as { digest?: unknown }).digest === 'string' &&
    (err as { digest: string }).digest.startsWith('NEXT_REDIRECT')
  );
}

function readInformationalRiskLevel(
  generationMeta: Record<string, unknown> | null | undefined,
  intent: string,
): BlogInformationRiskLevel {
  const contentBrief = generationMeta?.content_brief;
  if (contentBrief && typeof contentBrief === 'object' && !Array.isArray(contentBrief)) {
    const risk = (contentBrief as Record<string, unknown>).risk_level;
    if (risk === 'LOW' || risk === 'MEDIUM' || risk === 'HIGH') return risk;
  }
  if (intent === 'entry_requirements' || intent === 'travel_insurance') return 'HIGH';
  if (intent === 'monthly_weather' || intent === 'airport_transport' || intent === 'local_transport' || intent === 'currency_payment') {
    return 'MEDIUM';
  }
  return 'LOW';
}

export const revalidate = 0;
// 자동 발행 글은 계속 늘어나므로 정적 slug 목록을 빌드/개발 서버에 고정하지 않는다.
// 각 상세 페이지는 첫 요청 시 on-demand ISR로 생성하고, 미존재 slug는 noindex 404로 방어한다.

const BASE_URL = resolveBlogCanonicalOrigin();

// ── 타입 ────────────────────────────────────────────────────
interface BlogPost {
  id: string;
  slug: string;
  seo_title: string | null;
  seo_description: string | null;
  og_image_url: string | null;
  blog_html: string | null;
  angle_type: string;
  channel: string;
  published_at: string;
  created_at: string;
  updated_at: string | null;
  content_modified_at?: string | null;
  fact_checked_at?: string | null;
  product_id: string | null;
  tracking_id: string | null;
  destination: string | null;
  landing_enabled: boolean | null;
  landing_headline: string | null;
  landing_subtitle: string | null;
  content_type?: string | null;
  category?: string | null;
  topic_source?: string | null;
  review_status?: string | null;
  pillar_for?: string | null;
  target_audience?: string | null;
  generation_meta?: Record<string, unknown> | null;
  quality_gate?: Record<string, unknown> | null;
  travel_packages: {
    id: string;
    title: string;
    destination: string;
    price: number | null;
    duration: string | number | null;
    nights: number | null;
    category: string | null;
    airline: string | null;
    departure_airport: string | null;
    product_highlights: string[] | null;
    inclusions: string[] | null;
    status?: string | null;
    publication_state?: string | null;
    package_revision?: number | null;
    audit_status?: string | null;
    audit_report?: unknown;
    updated_at?: string | null;
    optional_tours?: unknown;
    itinerary_data?: unknown;
    hero_image_url?: string | null;
  } | null;
}

function isBlogPublicSnapshotCandidate(row: Record<string, unknown>): boolean {
  const publicationState = typeof row.publication_state === 'string' ? row.publication_state : null;
  return isPublicPublicationState(publicationState) && isCustomerPubliclyOpenable(row);
}

async function mergeBlogPublicPackageSnapshots<T extends Record<string, unknown>>(rows: T[]): Promise<T[]> {
  if (rows.length === 0) return [];
  try {
    return await fetchAndMergeCurrentPublicPackageCardSnapshots(supabaseAdmin, rows);
  } catch (error) {
    console.warn('[blog] public snapshot merge failed; hiding package-derived blog data', error);
    return [];
  }
}

interface RelatedPost {
  id: string;
  slug: string;
  seo_title: string | null;
  og_image_url: string | null;
  angle_type: string;
  published_at: string;
  product_id: string | null;
  destination: string | null;
  status?: string | null;
  content_type?: string | null;
  pillar_for?: string | null;
  target_audience?: string | null;
  generation_meta?: Record<string, unknown> | null;
  related_anchor?: string;
  travel_packages: {
    id?: string;
    destination: string;
    price: number | null;
    duration: string | number | null;
    nights: number | null;
  } | null;
}

type AbortableQuery<T> = {
  abortSignal: (signal: AbortSignal) => PromiseLike<T>;
};

type BlogDetailQueryResult<T> = T & { __blogQueryUnavailable?: true };

const BLOG_DETAIL_LEGACY_SELECT =
  'id, slug, seo_title, seo_description, og_image_url, blog_html, angle_type, channel, published_at, created_at, updated_at, product_id, tracking_id, destination, landing_enabled, landing_headline, landing_subtitle, content_type, category, topic_source, review_status, pillar_for, target_audience, generation_meta, quality_gate';
const BLOG_DETAIL_V3_SELECT = `${BLOG_DETAIL_LEGACY_SELECT}, content_modified_at, fact_checked_at`;

async function getDraftPreviewPost(slug: string, token: string | null): Promise<BlogPost | null> {
  const verified = verifyBlogPreviewToken({ token, slug });
  if (!verified || !isSupabaseAdminConfigured) return null;
  unstable_noStore();
  const { data, error } = await supabaseAdmin
    .from('content_creatives')
    .select(BLOG_DETAIL_V3_SELECT)
    .eq('id', verified.creativeId)
    .eq('slug', slug)
    .eq('channel', 'naver_blog')
    .eq('status', 'draft')
    .maybeSingle();
  if (error || !data) return null;
  return {
    ...(data as unknown as Omit<BlogPost, 'travel_packages'>),
    published_at: String(data.published_at || data.created_at || new Date().toISOString()),
    travel_packages: null,
  };
}

function isMissingV3DetailProjection(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const record = error as { code?: unknown; message?: unknown };
  const code = typeof record.code === 'string' ? record.code : '';
  const message = typeof record.message === 'string' ? record.message : '';
  return (code === '42703' || code === 'PGRST204')
    && /content_modified_at|fact_checked_at/i.test(message);
}

function isBlogDetailQueryUnavailable(result: unknown): boolean {
  if (!result || typeof result !== 'object') return false;
  const maybeResult = result as { __blogQueryUnavailable?: true; error?: unknown };
  if (maybeResult.__blogQueryUnavailable) return true;
  const error = maybeResult.error;
  if (!error) return false;
  const message = typeof error === 'object'
    ? JSON.stringify(error)
    : String(error);
  return /abort|timeout|timed out|connection timeout/i.test(message);
}

async function runBlogDetailQuery<T>(
  label: string,
  query: AbortableQuery<T>,
  fallback: unknown,
  timeoutMs = 8000,
): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | null = null;
  const unavailableFallback = () => {
    if (fallback && typeof fallback === 'object') {
      return { ...(fallback as Record<string, unknown>), __blogQueryUnavailable: true } as BlogDetailQueryResult<T>;
    }
    return fallback as T;
  };
  const queryPromise = Promise.resolve(query.abortSignal(controller.signal)).catch((err) => {
    console.warn(`[blog/detail] ${label} query timed out or failed`, err instanceof Error ? err.message : err);
    return unavailableFallback();
  });
  const timeoutPromise = new Promise<T>((resolve) => {
    timer = setTimeout(() => {
      controller.abort();
      console.warn(`[blog/detail] ${label} query timed out after ${timeoutMs}ms`);
      resolve(unavailableFallback());
    }, timeoutMs);
  });
  try {
    return await Promise.race([queryPromise, timeoutPromise]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

const ANGLE_LABELS: Record<string, string> = {
  value: '💰 가성비',
  emotional: '🌸 감성',
  filial: '🎁 효도',
  luxury: '✨ 럭셔리',
  urgency: '⚡ 긴급특가',
  activity: '🏄 액티비티',
  food: '🍜 미식',
};

// ── 유틸 ────────────────────────────────────────────────────
function formatDuration(
  duration: string | number | null | undefined,
  nights: number | null | undefined,
): string {
  if (!duration && !nights) return '';
  const d = typeof duration === 'string' ? parseInt(duration, 10) : duration;
  const dNum = typeof d === 'number' && !Number.isNaN(d) ? d : null;
  if (nights && dNum) return `${nights}박${dNum}일`;
  if (dNum) return `${dNum}일`;
  if (typeof duration === 'string' && duration.trim()) return duration.trim();
  return '';
}

function stripMarkdownBold(s: string): string {
  return s.replace(/\*\*([^*]+)\*\*/g, '$1').replace(/\*/g, '').trim();
}

function buildSeoDescription(post: BlogPost): string {
  const destination = post.travel_packages?.destination || post.destination || '여행';
  const base = (post.seo_description || '').trim()
    || `${destination} 여행 가이드 — 여소남이 추천하는 일정, 비용, 준비물, 예약 전 확인 사항을 정리했습니다.`;
  if (base.length >= 50 && base.length <= 180) return base;
  if (base.length < 50) {
    return `${base} ${destination} 일정, 비용, 준비물, 예약 전 확인 사항을 함께 정리했습니다.`
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 180);
  }
  return `${base.slice(0, 177).replace(/\s+\S*$/, '').trim()}...`;
}

function extractTldrItems(post: BlogPost): string[] {
  const pkg = post.travel_packages;
  const out: string[] = [];
  const dur = formatDuration(pkg?.duration, pkg?.nights);
  if (pkg?.destination && dur) out.push(`${pkg.destination} ${dur} 여행`);
  if (pkg?.price) out.push(`출발가 ${pkg.price.toLocaleString()}원~`);
  if (pkg?.airline) out.push(`${pkg.airline} 이용`);
  if (pkg?.departure_airport) out.push(`${pkg.departure_airport.replace(/\(.*?\)/g, '').trim()} 출발`);

  const highlights = (pkg?.product_highlights || [])
    .map(stripMarkdownBold)
    .filter((s) => s && s.length > 3 && s.length < 80)
    .slice(0, 3);
  out.push(...highlights);

  // 중복 제거
  const seen = new Set<string>();
  return out.filter((item) => {
    const key = item.replace(/\s+/g, '');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function withBlogRenderTimeout<T>(
  label: string,
  promise: Promise<T>,
  fallback: T,
  timeoutMs = 3500,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((resolve) => {
        timer = setTimeout(() => resolve(fallback), timeoutMs);
      }),
    ]);
  } catch (err) {
    console.warn(`[blog/detail] ${label} failed`, err instanceof Error ? err.message : err);
    return fallback;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

// ── 데이터 페칭 ──────────────────────────────────────────────
async function getPost(slug: string): Promise<BlogPost | null> {
  if (!isSupabaseConfigured) return null;
  if (shouldSkipPublicDbReadsForResourceSaver()) throw createBlogDatabaseUnavailableError();

  const dbSlug = safeDecodeSlug(slug);

  const { data, error } = await supabaseAdmin
    .from(PUBLIC_BLOG_READ_SOURCE)
    .select(
      // travel_packages.hero_image_url 컬럼은 DB에 존재하지 않는다 (photos 는 별도 테이블).
      // select에 포함하면 supabase가 통째로 에러 반환 → data=null → notFound() 404.
      // 이것이 "발행했는데 글이 안 뜬다"의 진짜 원인이었음. (API 라우트는 select 안 함 → 200)
      'id, slug, seo_title, seo_description, og_image_url, blog_html, angle_type, channel, published_at, created_at, updated_at, content_modified_at, fact_checked_at, product_id, tracking_id, destination, landing_enabled, landing_headline, landing_subtitle, content_type, category, topic_source, review_status, pillar_for, target_audience, generation_meta, quality_gate',
    )
    .eq('slug', dbSlug)
    .eq('status', 'published')
    .eq('channel', 'naver_blog')
    .not('slug', 'is', null)
    .limit(1);

  // 사일런트 fail 차단: PostgREST가 400 등 비-200을 돌려보내면 data는 null이지만
  // 렌더 중 DB write는 금지하고 Sentry/console 로그로만 추적한다.
  if (error) {
    logError('[blog/getPost] supabase error', error, {
      slug: dbSlug,
      rawParam: slug,
      code: error && typeof error === 'object' && 'code' in error ? (error as { code: string }).code : null,
      hint: error && typeof error === 'object' && 'hint' in error ? (error as { hint: string }).hint : null,
    });
    throw createBlogDatabaseUnavailableError();
  }
  if (!data || data.length === 0) return null;
  const post = data[0] as unknown as BlogPost;
  return isBlogPostSurfacePolicySafe(post) ? post : null;
}

function isBlogPostSurfacePolicySafe(post: BlogPost): boolean {
  return getBlogPublicSurfacePolicyBlockReason({
    productId: post.product_id,
    reviewStatus: post.review_status,
    title: post.seo_title,
    category: post.category,
    contentType: post.content_type,
    topic: post.topic_source,
    generationMeta: post.generation_meta,
  }) === null;
}

function blogPostFromPublicSnapshot(
  snapshot: BlogPublicDetailSnapshotV3,
): BlogPost {
  return {
    id: snapshot.creative_id,
    slug: snapshot.slug,
    seo_title: snapshot.title,
    seo_description: snapshot.description,
    og_image_url: typeof snapshot.hero_image?.url === 'string' ? snapshot.hero_image.url : null,
    blog_html: snapshot.legacy_markdown
      || (typeof snapshot.content_document?.markdown === 'string' ? snapshot.content_document.markdown : null),
    angle_type: snapshot.angle_type || 'value',
    channel: 'naver_blog',
    published_at: snapshot.published_at,
    created_at: snapshot.published_at,
    updated_at: snapshot.content_modified_at,
    content_modified_at: snapshot.content_modified_at,
    fact_checked_at: snapshot.fact_checked_at,
    product_id: snapshot.product_id,
    tracking_id: snapshot.tracking_id,
    destination: snapshot.destination,
    landing_enabled: snapshot.landing_enabled,
    landing_headline: snapshot.landing_headline,
    landing_subtitle: snapshot.landing_subtitle,
    content_type: snapshot.content_type,
    review_status: snapshot.review_status
      ?? (typeof snapshot.review?.review_status === 'string' ? snapshot.review.review_status : null),
    pillar_for: null,
    target_audience: snapshot.target_audience,
    generation_meta: {
      ...snapshot.generation_meta,
      ...(snapshot.author ? {
        author_profile: {
          slug: snapshot.author.slug,
          displayName: snapshot.author.display_name,
          bio: snapshot.author.bio,
        },
      } : {}),
      ...(snapshot.review ? {
        reviewer: {
          displayName: snapshot.review.display_name,
          reviewedAt: snapshot.review.reviewed_at,
          scope: snapshot.review.review_scope,
        },
      } : {}),
    },
    quality_gate: snapshot.quality_gate,
    travel_packages: null,
  };
}

async function loadBlogPublicFallbackOrThrow(dbSlug: string): Promise<BlogPost> {
  const snapshotResult = await loadBlogPublicDetailSnapshotV3(dbSlug);
  if (snapshotResult.state === 'found') {
    return blogPostFromPublicSnapshot(snapshotResult.snapshot);
  }
  throw createBlogDatabaseUnavailableError();
}

async function getPostFastUncached(slug: string): Promise<BlogPost | null> {
  const dbSlug = safeDecodeSlug(slug);
  if (!isSupabaseConfigured || !isSupabaseAdminConfigured) {
    return loadBlogPublicFallbackOrThrow(dbSlug);
  }
  if (shouldSkipPublicDbReadsForResourceSaver()) {
    return loadBlogPublicFallbackOrThrow(dbSlug);
  }
  const postResult = await runBlogDetailQuery(
    'postFast',
    supabaseAdmin
      .from(PUBLIC_BLOG_READ_SOURCE)
      .select(BLOG_DETAIL_V3_SELECT)
      .eq('slug', dbSlug)
      .eq('status', 'published')
      .eq('channel', 'naver_blog')
      .not('slug', 'is', null)
      .limit(1),
    { data: null, error: null },
  );
  let data = postResult.data as Array<Record<string, unknown>> | null;
  let error: unknown = postResult.error;

  if (isBlogDetailQueryUnavailable(postResult)) {
    return loadBlogPublicFallbackOrThrow(dbSlug);
  }

  // Rolling deployment compatibility: the current public eligibility view is
  // still authoritative, while the material/fact-check timestamp columns are
  // added by the V3 migration. During the migration window, retry only this
  // known projection mismatch and derive modifiedAt from updated_at.
  if (isMissingV3DetailProjection(error)) {
    const legacyResult = await runBlogDetailQuery(
      'postFastLegacyProjection',
      supabaseAdmin
        .from(PUBLIC_BLOG_READ_SOURCE)
        .select(BLOG_DETAIL_LEGACY_SELECT)
        .eq('slug', dbSlug)
        .eq('status', 'published')
        .eq('channel', 'naver_blog')
        .not('slug', 'is', null)
        .limit(1),
      { data: null, error: null },
    );
    if (isBlogDetailQueryUnavailable(legacyResult)) {
      return loadBlogPublicFallbackOrThrow(dbSlug);
    }
    data = legacyResult.data as Array<Record<string, unknown>> | null;
    error = legacyResult.error;
  }

  if (error) {
    logError('[blog/getPostFast] supabase error', error, { slug: dbSlug, rawParam: slug });
    // A PostgREST/schema/connection error cannot prove that the slug does not
    // exist. Treating it as a null row produces a false 404 and lets crawlers
    // cache an infrastructure incident as a deletion.
    return loadBlogPublicFallbackOrThrow(dbSlug);
  }
  if (!data || data.length === 0) return null;

  const post = data[0] as unknown as BlogPost;
  if (!isBlogPostSurfacePolicySafe(post)) return null;
  post.content_modified_at ??= post.updated_at;
  post.fact_checked_at ??= null;
  post.travel_packages = null;

  if (post.product_id) {
    const current = await getCurrentPublicPackage(supabaseAdmin, {
      tenantId: PLATFORM_PRODUCT_REGISTRATION_TENANT_ID,
      packageRef: post.product_id,
      channel: 'customer',
      locale: 'ko-KR',
    }).catch(() => null);
    post.travel_packages = (current?.package as BlogPost['travel_packages'] | undefined) ?? null;
  }

  return post;
}

function isNextCacheContextUnavailable(error: unknown): boolean {
  return error instanceof Error && /incrementalCache missing in unstable_cache/i.test(error.message);
}

function hasUsableBlogBody(post: BlogPost | null | undefined): boolean {
  const text = (post?.blog_html || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/[#*_`>\-\[\]\(\)!|:]/g, ' ')
    .replace(/\s+/g, '')
    .trim();
  return text.length >= 200;
}

type BlogPostCacheEnvelope =
  | { state: 'found'; post: BlogPost }
  | { state: 'missing'; post: null }
  | { state: 'unavailable'; post: null };

async function loadBlogPostCacheEnvelope(slug: string): Promise<BlogPostCacheEnvelope> {
  try {
    const post = await getPostFastUncached(slug);
    if (!post) return { state: 'missing', post: null };
    if (!hasUsableBlogBody(post)) return { state: 'unavailable', post: null };
    return { state: 'found', post };
  } catch (error) {
    if (isBlogDatabaseUnavailableError(error)) {
      // Cache a short-lived typed outage result instead of rejecting inside
      // unstable_cache. This prevents transient DB incidents becoming 404s
      // or surfacing as failed cache revalidation in production telemetry.
      return { state: 'unavailable', post: null };
    }
    throw error;
  }
}

const getCachedPostFast = unstable_cache(
  loadBlogPostCacheEnvelope,
  ['blog-detail-v6-outage-envelope'],
  { revalidate: 30, tags: [BLOG_DETAIL_CACHE_TAG] },
);

async function getPostFast(slug: string): Promise<BlogPost | null> {
  if (process.env.NODE_ENV === 'test' || process.env.VITEST) {
    return getPostFastUncached(slug);
  }
  try {
    const cached = await getCachedPostFast(slug);
    if (cached.state === 'unavailable') throw createBlogDatabaseUnavailableError();
    return cached.post;
  } catch (error) {
    if (isNextCacheContextUnavailable(error)) {
      return getPostFastUncached(slug);
    }
    throw error;
  }
}

async function getRelatedProducts(
  currentProductId: string | null | undefined,
  destination: string | undefined,
  intent: string = 'blog',
): Promise<RelatedProductLite[]> {
  if (!isSupabaseConfigured || !destination) return [];
  if (shouldSkipPublicDbReadsForResourceSaver()) return [];
  const today = formatKstDate();
  const scoreResult = await runBlogDetailQuery(
    'relatedProductScores',
    supabaseAdmin
      .from('package_scores')
      .select('package_id, rank_in_group, effective_price, list_price, travel_packages!inner(id, title, destination, price, duration, nights, airline, departure_airport, status, publication_state, package_revision, audit_status, audit_report, updated_at, optional_tours, itinerary_data)')
      .ilike('travel_packages.destination', `%${destination}%`)
      .gte('departure_date', today)
      .order('rank_in_group', { ascending: true })
      .order('effective_price', { ascending: true })
      .limit(currentProductId ? 8 : 6),
    {
      data: [] as Array<{
        package_id: string;
        rank_in_group: number | null;
        effective_price: number | null;
        list_price: number | null;
        travel_packages: RelatedProductLite & { status?: string | null; publication_state?: string | null; package_revision?: number | null; audit_status?: string | null; audit_report?: unknown; updated_at?: string | null; optional_tours?: unknown; itinerary_data?: unknown };
      }>,
      error: null,
    },
    2200,
  );
  if (!isBlogDetailQueryUnavailable(scoreResult) && !scoreResult.error && scoreResult.data) {
    const scoredCandidates: Array<Record<string, unknown> & {
      _blog_score_rank?: number | null;
      _blog_effective_price?: number | null;
      _blog_list_price?: number | null;
      _blog_score_index?: number;
    }> = [];
    for (const [index, row] of (scoreResult.data as Array<{
      package_id: string;
      rank_in_group: number | null;
      effective_price: number | null;
      list_price: number | null;
      travel_packages:
        | (RelatedProductLite & { status?: string | null; publication_state?: string | null; package_revision?: number | null; audit_status?: string | null; audit_report?: unknown; updated_at?: string | null; optional_tours?: unknown; itinerary_data?: unknown })
        | Array<RelatedProductLite & { status?: string | null; publication_state?: string | null; package_revision?: number | null; audit_status?: string | null; audit_report?: unknown; updated_at?: string | null; optional_tours?: unknown; itinerary_data?: unknown }>
        | null;
    }>).entries()) {
      const pkg = Array.isArray(row.travel_packages) ? row.travel_packages[0] : row.travel_packages;
      if (!pkg || !isBlogPublicSnapshotCandidate(pkg as unknown as Record<string, unknown>)) continue;
      if (pkg.id === currentProductId) continue;
      scoredCandidates.push({
        ...(pkg as unknown as Record<string, unknown>),
        _blog_score_rank: row.rank_in_group,
        _blog_effective_price: row.effective_price,
        _blog_list_price: row.list_price,
        _blog_score_index: index,
      });
    }
    const seen = new Set<string>();
    const scored: RelatedProductLite[] = [];
    for (const pkg of await mergeBlogPublicPackageSnapshots(scoredCandidates)) {
      const id = typeof pkg.id === 'string' ? pkg.id : '';
      if (!id || id === currentProductId || seen.has(id)) continue;
      seen.add(id);
      scored.push({
        id,
        title: typeof pkg.title === 'string' ? pkg.title : '',
        destination: typeof pkg.destination === 'string' ? pkg.destination : '',
        price: (typeof pkg._blog_effective_price === 'number' ? pkg._blog_effective_price : null)
          ?? (typeof pkg.price === 'number' ? pkg.price : null)
          ?? (typeof pkg._blog_list_price === 'number' ? pkg._blog_list_price : null),
        duration: typeof pkg.duration === 'number' || typeof pkg.duration === 'string' ? pkg.duration : null,
        nights: typeof pkg.nights === 'number' ? pkg.nights : null,
        airline: typeof pkg.airline === 'string' ? pkg.airline : null,
        departure_airport: typeof pkg.departure_airport === 'string' ? pkg.departure_airport : null,
        recommended_rank: (typeof pkg._blog_score_rank === 'number' ? pkg._blog_score_rank : null)
          ?? (typeof pkg._blog_score_index === 'number' ? pkg._blog_score_index + 1 : scored.length + 1),
        policy_id: null,
        recommendation_intent: `${intent}:package_scores`,
      });
      if (scored.length >= 4) break;
    }
    if (scored.length > 0) return scored;
  }

  const data = await listCurrentPublicPackageCardSnapshots(supabaseAdmin, { limit: 1_000 })
    .then(rows => rows
      .filter(pkg => String(pkg.destination ?? '') === destination && String(pkg.id ?? '') !== currentProductId)
      .sort((a, b) => Number(a.price ?? Number.MAX_SAFE_INTEGER) - Number(b.price ?? Number.MAX_SAFE_INTEGER))
      .slice(0, 4))
    .catch(() => []);
  return (data as unknown as RelatedProductLite[])
    .map((item, index) => ({
      ...item,
      recommended_rank: index + 1,
      recommendation_intent: `${intent}:fallback_price`,
    }));
}

/**
 * sanitize된 본문 HTML을 H2 경계로 2등분한다.
 * H2가 4개 미만이면 주입하지 않는다 (짧은 글엔 방해됨).
 */
function splitHtmlForInlineInjection(html: string): { before: string; after: string } | null {
  if (/<table\b/i.test(html)) return null;

  const parts = html.split(/(?=<h2\b)/i);
  // parts[0]은 첫 H2 이전(도입부), 이후가 각 H2 섹션
  const h2Count = parts.length - 1;
  if (h2Count < 4) return null;
  const midIdx = Math.ceil(parts.length / 2);
  const before = parts.slice(0, midIdx).join('');
  const after = parts.slice(midIdx).join('');
  if (!before.trim() || !after.trim()) return null;
  return { before, after };
}

function relatedPostDestination(post: RelatedPost): string | null {
  return post.travel_packages?.destination || post.destination || null;
}

async function attachRelatedPostPublicSnapshots(posts: RelatedPost[]): Promise<RelatedPost[]> {
  const productIds = Array.from(
    new Set(posts.map((post) => post.product_id).filter((id): id is string => Boolean(id))),
  );
  if (productIds.length === 0) {
    return posts.map((post) => ({ ...post, travel_packages: null }));
  }

  try {
    const publicRows = (await listCurrentPublicPackageCardSnapshots(supabaseAdmin, { limit: 1_000 }))
      .filter(pkg => productIds.includes(String(pkg.id ?? '')));
    const publicById = new Map(
      publicRows.map((pkg) => [String(pkg.id), pkg]),
    );

    return posts.map((post) => {
      const publicPkg = post.product_id ? publicById.get(post.product_id) : null;
      if (!publicPkg) return { ...post, travel_packages: null };
      return {
        ...post,
        travel_packages: {
          id: typeof publicPkg.id === 'string' ? publicPkg.id : undefined,
          destination: typeof publicPkg.destination === 'string' ? publicPkg.destination : '',
          price: typeof publicPkg.price === 'number' ? publicPkg.price : null,
          duration:
            typeof publicPkg.duration === 'number' || typeof publicPkg.duration === 'string'
              ? publicPkg.duration
              : null,
          nights: typeof publicPkg.nights === 'number' ? publicPkg.nights : null,
        },
      };
    });
  } catch (error) {
    console.warn('[blog] related post public snapshot merge failed; hiding package price/duration', error);
    return posts.map((post) => ({ ...post, travel_packages: null }));
  }
}

async function getRelatedPosts(
  currentSlug: string,
  destination: string | undefined,
  angleType: string | undefined,
  sourcePost?: Pick<
    BlogPost,
    'product_id' | 'content_type' | 'pillar_for' | 'target_audience' | 'generation_meta'
  >,
): Promise<RelatedPost[]> {
  if (!isSupabaseConfigured) return [];

  const result = await runBlogDetailQuery(
    'relatedPosts',
    supabaseAdmin
      .from(PUBLIC_BLOG_READ_SOURCE)
      .select(
        'id, slug, seo_title, og_image_url, angle_type, published_at, product_id, destination, status, content_type, pillar_for, target_audience, generation_meta',
      )
      .eq('status', 'published')
      .eq('channel', 'naver_blog')
      .not('slug', 'is', null)
      .neq('slug', currentSlug)
      .order('published_at', { ascending: false })
      .limit(50),
    { data: [] as RelatedPost[], error: null },
    2500,
  );
  if (isBlogDetailQueryUnavailable(result) || result.error || !result.data) return [];
  const { data } = result;
  const posts = await attachRelatedPostPublicSnapshots(data as unknown as RelatedPost[]);

  const informationIdentity = sourcePost?.product_id
    ? null
    : readBlogInformationRepresentativeIdentity(sourcePost?.generation_meta);
  if (informationIdentity) {
    const sourceMeta = sourcePost?.generation_meta || {};
    const source: BlogInformationalLinkContext = {
      slug: currentSlug,
      destination: destination ?? null,
      destinationId: informationIdentity.destinationId,
      intent: informationIdentity.intent,
      audience: informationIdentity.audience,
      locale: informationIdentity.locale,
      contentType: sourcePost?.content_type,
      pillarFor: sourcePost?.pillar_for,
      clusterId: typeof sourceMeta.editorial_cluster_id === 'string'
        ? sourceMeta.editorial_cluster_id
        : null,
    };
    const postBySlug = new Map(posts.map((post) => [post.slug, post]));
    return rankBlogInformationalRelatedLinks(
      source,
      posts.flatMap((post) => {
        const candidate = readBlogInformationalLinkCandidate({
          id: post.id,
          slug: post.slug,
          title: post.seo_title,
          destination: relatedPostDestination(post),
          status: post.status,
          contentType: post.content_type,
          pillarFor: post.pillar_for,
          targetAudience: post.target_audience,
          publishedAt: post.published_at,
          generationMeta: post.generation_meta,
        });
        return candidate ? [candidate] : [];
      }),
      6,
    ).flatMap((entry) => {
      const post = postBySlug.get(entry.candidate.slug);
      return post ? [{ ...post, related_anchor: entry.anchorText }] : [];
    });
  }

  // 우선순위: 같은 destination + 같은 angle → 같은 destination → 같은 angle → 최신
  const sameDestSameAngle = posts.filter(
    (p) => relatedPostDestination(p) === destination && p.angle_type === angleType,
  );
  const sameDest = posts.filter(
    (p) => relatedPostDestination(p) === destination && p.angle_type !== angleType,
  );
  const sameAngle = posts.filter(
    (p) => p.angle_type === angleType && relatedPostDestination(p) !== destination,
  );
  const rest = posts.filter(
    (p) => relatedPostDestination(p) !== destination && p.angle_type !== angleType,
  );

  const merged: RelatedPost[] = [];
  const seen = new Set<string>();
  for (const arr of [sameDestSameAngle, sameDest, sameAngle, rest]) {
    for (const p of arr) {
      if (seen.has(p.id)) continue;
      seen.add(p.id);
      merged.push(p);
      if (merged.length >= 6) return merged;
    }
  }
  return merged;
}

// ── 정보성 블로그 하단 큐레이션 상품 3개 (가격 분산) ─────────
async function getCurationProductsForInfo(destination: string) {
  if (!isSupabaseConfigured) return [];
  const scored = await getRelatedProducts(null, destination, 'info_curation');
  if (scored.length > 0) return scored.slice(0, 3);
  interface CurationPackage {
    id: string;
    title: string | null;
    destination: string | null;
    duration: number | null;
    nights: number | null;
    price: number | null;
    category: string | null;
    airline: string | null;
    departure_airport: string | null;
    price_dates: Array<{ date?: string; price?: number }> | null;
    status?: string | null;
    publication_state?: string | null;
    package_revision?: number | null;
    audit_status?: string | null;
    audit_report?: unknown;
    updated_at?: string | null;
    optional_tours?: unknown;
    itinerary_data?: unknown;
  }

  const data = await listCurrentPublicPackageCardSnapshots(supabaseAdmin, { limit: 1_000 })
    .then(rows => rows
      .filter(pkg => String(pkg.destination ?? '') === destination)
      .sort((a, b) => Number(a.price ?? Number.MAX_SAFE_INTEGER) - Number(b.price ?? Number.MAX_SAFE_INTEGER))
      .slice(0, 12))
    .catch(() => []);
  if (data.length === 0) return [];

  // 미래 출발일 있는 상품만 필터
  const alive = (data as unknown as CurationPackage[]).filter((p) => hasUpcomingPublicDepartureDate(p));

  const publicAlive = alive;

  if (publicAlive.length <= 3) return publicAlive;

  // 가격 3분위에서 1개씩 (가성비 / 중가 / 프리미엄)
  const sorted = [...publicAlive].sort((a, b) => (a.price || 0) - (b.price || 0));
  const n = sorted.length;
  return [
    sorted[0],
    sorted[Math.floor(n / 2)],
    sorted[n - 1],
  ];
}

// ── 이전/다음 글 (published_at 기준) ─────────────────────────
type NavPost = { slug: string; seo_title: string | null; og_image_url: string | null; destination: string | null };

async function getPrevNextPosts(
  slug: string,
  publishedAt: string,
): Promise<{ prev: NavPost | null; next: NavPost | null }> {
  if (!isSupabaseConfigured) return { prev: null, next: null };

  const [prevRes, nextRes] = await Promise.all([
    runBlogDetailQuery(
      'prevPost',
      supabaseAdmin
        .from(PUBLIC_BLOG_READ_SOURCE)
        .select('slug, seo_title, og_image_url, destination')
        .eq('status', 'published')
        .eq('channel', 'naver_blog')
        .not('slug', 'is', null)
        .neq('slug', slug)
        .lt('published_at', publishedAt)
        .order('published_at', { ascending: false })
        .limit(1),
      { data: [] as NavPost[], error: null },
      2000,
    ),
    runBlogDetailQuery(
      'nextPost',
      supabaseAdmin
        .from(PUBLIC_BLOG_READ_SOURCE)
        .select('slug, seo_title, og_image_url, destination')
        .eq('status', 'published')
        .eq('channel', 'naver_blog')
        .not('slug', 'is', null)
        .neq('slug', slug)
        .gt('published_at', publishedAt)
        .order('published_at', { ascending: true })
        .limit(1),
      { data: [] as NavPost[], error: null },
      2000,
    ),
  ]);

  return {
    prev: isBlogDetailQueryUnavailable(prevRes) || prevRes.error ? null : ((prevRes.data?.[0] as NavPost) ?? null),
    next: isBlogDetailQueryUnavailable(nextRes) || nextRes.error ? null : ((nextRes.data?.[0] as NavPost) ?? null),
  };
}

// ── 동적 메타데이터 ──────────────────────────────────────────
export async function generateMetadata({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}): Promise<Metadata> {
  const { slug: rawSlug } = await params;
  const slug = safeDecodeSlug(rawSlug);
  const redirectedSlug = resolveBlogSlugRedirect(slug);
  if (redirectedSlug) {
    permanentRedirect(`/blog/${redirectedSlug}`);
  }
  // 숫자 slug(연도 등)는 noindex
  if (/^\d+$/.test(slug)) {
    return { title: '글을 찾을 수 없습니다', robots: { index: false, follow: false } };
  }
  const resolvedSearchParams = searchParams ? await searchParams : {};
  const previewValue = resolvedSearchParams.preview;
  const previewToken = typeof previewValue === 'string' ? previewValue : null;
  let post: BlogPost | null = await getDraftPreviewPost(slug, previewToken);
  const isPreview = Boolean(post);
  try {
    post ??= await getPostFast(slug);
  } catch (err) {
    if (isBlogDatabaseUnavailableError(err)) {
      return {
        title: { absolute: '블로그 데이터를 불러올 수 없습니다 | 여소남' },
        robots: { index: false, follow: true },
      };
    }
    throw err;
  }
  // 404 캐시가 색인되지 않도록 명시적 noindex.
  if (!post) {
    notFound();
  }

  const rawTitle = post.seo_title || post.travel_packages?.title || '여행 블로그';
  // 레거시 글 방어: seo_title에 ' | 여소남 2026' 접미사가 남아 있으면 루트 layout의
  // template("%s | 여소남")과 중복되므로 제거한다.
  const cleanedTitle = rawTitle
    .replace(/\s*\|\s*여소남(\s*\d{4})?\s*$/g, '')
    .trim();
  // Duplicate titles must be merged or blocked before publication. Never alter
  // facts or append numeric "part" suffixes on the public surface.
  const metadataTitle = cleanedTitle;

  const description = buildSeoDescription(post);
  const dbOgImage = toBlogImageDisplaySrc(post.og_image_url, BASE_URL);

  const angleLabel = ANGLE_LABELS[post.angle_type] || post.angle_type;
  const dest = post.travel_packages?.destination || post.destination || null;
  const tagSet = [dest, angleLabel, '여행', '패키지여행', '단체여행'].filter(Boolean) as string[];

  // Metadata, OG title, and the page H1 use the same stored title.
  return {
    // absolute를 쓰면 layout의 template이 적용되지 않음
    title: { absolute: metadataTitle },
    description,
    robots: isPreview ? { index: false, follow: false, nocache: true } : undefined,
    keywords: tagSet,
    alternates: {
      canonical: `${BASE_URL}/blog/${slug}`,
      types: { 'application/rss+xml': `${BASE_URL}/api/rss` },
    },
    openGraph: {
      type: 'article',
      title: metadataTitle,
      description,
      url: `${BASE_URL}/blog/${slug}`,
      publishedTime: post.published_at,
      modifiedTime: post.content_modified_at || post.published_at,
      authors: [BASE_URL],
      section: angleLabel,
      tags: tagSet,
      locale: 'ko_KR',
      siteName: '여소남',
      ...(dbOgImage ? { images: [{ url: dbOgImage, width: 1200, height: 630, alt: metadataTitle }] } : {}),
    },
    twitter: {
      card: 'summary_large_image',
      title: metadataTitle,
      description,
      ...(dbOgImage ? { images: [dbOgImage] } : {}),
    },
  };
}

function BlogDatabaseUnavailableView({ slug }: { slug: string }) {
  return (
    <>
      <GlobalNav />
      <main className="min-h-screen bg-white">
        <section className="mx-auto flex min-h-[60vh] max-w-3xl flex-col items-center justify-center px-4 py-20 text-center">
          <p className="mb-3 text-[32px]">!</p>
          <h1 className="text-[28px] font-extrabold text-text-primary tracking-[-0.02em]">
            블로그 데이터를 잠시 불러오지 못했습니다.
          </h1>
          <p className="mt-3 text-[15px] leading-7 text-text-secondary">
            이 글이 삭제되었거나 발행되지 않은 상태가 아니라, 현재 DB 응답이 지연되고 있습니다.
          </p>
          <div className="mt-7 flex flex-wrap justify-center gap-3">
            <Link
              href="/blog"
              className="rounded-full bg-text-primary px-5 py-2.5 text-[13px] font-semibold text-white transition hover:bg-black"
            >
              매거진으로 돌아가기
            </Link>
            <a
              href={`/blog/${slug}`}
              className="rounded-full border border-admin-border px-5 py-2.5 text-[13px] font-semibold text-text-body transition hover:bg-bg-section"
            >
              다시 시도
            </a>
          </div>
        </section>
      </main>
    </>
  );
}

// ── 페이지 컴포넌트 ──────────────────────────────────────────
export default async function BlogDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { slug: rawSlug } = await params;
  const slug = safeDecodeSlug(rawSlug);
  const resolvedSearchParams = searchParams ? await searchParams : {};
  const previewValue = resolvedSearchParams.preview;
  const previewToken = typeof previewValue === 'string' ? previewValue : null;
  const redirectedSlug = resolveBlogSlugRedirect(slug);
  if (redirectedSlug) {
    permanentRedirect(`/blog/${redirectedSlug}`);
  }
  // 렌더링 errors를 notFound로 fallback (E1401/500 방어)
  try {
    const previewPost = await getDraftPreviewPost(slug, previewToken);
    return await renderBlogDetail({ rawSlug, slug, previewPost });
  } catch (err) {
    if (isNextNotFoundError(err) || isNextRedirectError(err)) {
      throw err;
    }
    if (isBlogDatabaseUnavailableError(err)) {
      return <BlogDatabaseUnavailableView slug={slug} />;
    }

    logError('[blog/detail] render failed', err, {
      slug,
      rawSlug,
      digest: err && typeof err === 'object' && 'digest' in err ? (err as { digest: string }).digest : null,
    });
    throw err;
  }
}

async function renderBlogDetail({
  rawSlug,
  slug,
  previewPost,
}: {
  rawSlug: string;
  slug: string;
  previewPost?: BlogPost | null;
}) {
  // 숫자로만 구성된 slug(e.g. "/blog/2026")는 블로그 목록으로 리다이렉트
  if (/^\d+$/.test(slug)) {
    redirect('/blog');
  }

  const post = previewPost ?? await getPostFast(slug);
  if (!post) notFound();

  const pkg = post.travel_packages;
  const rawTitle = post.seo_title || pkg?.title || '여행 가이드';
  const title = rawTitle.replace(/\s*\|\s*여소남(\s*\d{4})?\s*$/g, '').trim();
  const generatedHeroImage = isGeneratedBlogImageUrl(post.og_image_url);

  // 블로그 유형 판별
  const isInfoBlog = !post.product_id;
  const isLanding = !!post.landing_enabled && !!post.product_id;
  const intentProfile = classifyBlogIntent({
    title,
    slug: post.slug,
    angleType: post.angle_type,
    productId: post.product_id,
    blogHtml: post.blog_html,
  });
  const blogRecommendationIntent = [
    intentProfile.mode,
    intentProfile.infoSubtype || intentProfile.productSubtype || intentProfile.readerIntent,
  ].filter(Boolean).join(':');
  const effectiveDestination = post.destination || pkg?.destination || undefined;
  const informationalIdentity = isInfoBlog
    ? readBlogInformationRepresentativeIdentity(post.generation_meta)
    : null;
  const informationalRiskLevel = informationalIdentity
    ? readInformationalRiskLevel(post.generation_meta, informationalIdentity.intent)
    : null;

  // Metadata title, H1, and OG title are intentionally identical. Headline
  // experiments are URL-stable records and must never vary facts per visitor.
  const abTestTitle = title;

  // Related content and evidence are independent and start together. Public
  // detail rendering never performs visitor-level DKI lookups or mutations.
  const [relatedPosts, relatedProducts, officialSourceTarget, researchCitations] = await Promise.all([
    withBlogRenderTimeout('relatedPosts', getRelatedPosts(slug, effectiveDestination, post.angle_type, post), []),
    withBlogRenderTimeout('relatedProducts', getRelatedProducts(pkg?.id, effectiveDestination, blogRecommendationIntent), []),
    informationalIdentity && informationalRiskLevel === 'HIGH'
      ? withBlogRenderTimeout('officialSourceCta', loadBlogInformationalOfficialSourceUrl({
          creativeId: post.id,
          generationMeta: post.generation_meta,
        }), null, 1500)
      : Promise.resolve(null),
    informationalIdentity
      ? withBlogRenderTimeout('researchCitations', loadBlogPublicCitations({
          creativeId: post.id,
          contentKey: post.slug,
          limit: 6,
        }), [], 1500)
      : Promise.resolve([]),
  ]);
  const durationStr = formatDuration(pkg?.duration, pkg?.nights);
  const tldrItems = extractTldrItems(post);
  const angleLabel = ANGLE_LABELS[post.angle_type] || post.angle_type;
  const pageUrl = `${BASE_URL}/blog/${slug}`;
  const relatedArticlesHref = relatedPosts[0]?.slug
    ? `/blog/${relatedPosts[0].slug}`
    : effectiveDestination
      ? `/blog/destination/${encodeURIComponent(effectiveDestination)}`
      : '/blog';
  const informationalCtas = informationalIdentity
    ? selectBlogInformationalCtas({
        intent: informationalIdentity.intent,
        destination: effectiveDestination,
        riskLevel: informationalRiskLevel ?? 'LOW',
        locale: informationalIdentity.locale,
        placement: 'bottom',
        settings: loadBlogInformationalCtaSettings({
          destination: effectiveDestination,
          relatedArticlesHref,
          officialSourceUrl: officialSourceTarget?.url,
          officialSourceRegistryHostname: officialSourceTarget?.registryHostname,
          officialSourceAllowSubdomains: officialSourceTarget?.allowSubdomains,
        }),
      })
    : [];

  // 본문 sanitize + TOC 추출
  let bodyHtml = '';
  let toc: ReturnType<typeof extractTocAndInjectIds>['toc'] = [];
  let showToc = false;
  let readingMinutes = 3;

  if (post.blog_html) {
    // blog_html은 "마크다운 + 일부 안전한 HTML(figcaption/aside)" 혼합 저장값이다.
    // figcaption 태그만 보고 전체를 raw HTML로 취급하면 이미지/표/링크 마크다운이 그대로 노출된다.
    const rendered = await removeUnreachableBlogAssetImages(await renderBlogContentToHtml(post.blog_html));
    const normalizedBody = isInfoBlog ? stripBlogInformationalBodyCtas(rendered) : rendered;
    const sanitized = stripPublicDuplicateBodyTitleHeading(
      sanitizePublicBlogBodyHtml(normalizedBody, {
        imageAltPrefix: post.destination?.trim() || post.seo_title?.trim() || '여행 정보',
      }),
      abTestTitle,
    );
    const result = extractTocAndInjectIds(sanitized);
    bodyHtml = result.html;
    toc = result.toc;
    showToc = shouldShowToc(sanitized, toc);
    readingMinutes = readPersistedBlogReadingTime(post.quality_gate)
      ?? calculateBlogReadingTimeFromHtml(sanitized);
  }

  const [curationSection, sidebarRelatedPosts, relatedPostsSection, prevNextSection] = await Promise.all([
    withBlogRenderTimeout('curationSection', CurationSection({
      destination: effectiveDestination ?? null,
      isInfoBlog,
      contentCreativeId: post.id,
      intent: blogRecommendationIntent,
    }), null),
    withBlogRenderTimeout('sidebarRelatedPosts', SidebarRelatedPosts({
      currentSlug: slug,
      destination: effectiveDestination,
      angleType: post.angle_type,
      sourcePost: post,
    }), null),
    withBlogRenderTimeout('relatedPostsSection', RelatedPostsSection({
      currentSlug: slug,
      destination: effectiveDestination,
      angleType: post.angle_type,
      sourcePost: post,
    }), null),
    withBlogRenderTimeout('prevNextSection', PrevNextSection({ slug, publishedAt: post.published_at }), null),
  ]);

  const productDurationDays =
    pkg?.duration != null && !Number.isNaN(Number(pkg.duration)) ? Number(pkg.duration) : null;
  const contentBriefV3 = post.generation_meta?.content_brief_v3;
  const contentBriefV3Record = contentBriefV3 && typeof contentBriefV3 === 'object' && !Array.isArray(contentBriefV3)
    ? contentBriefV3 as Record<string, unknown>
    : {};

  const jsonLd = buildBlogPostPageJsonLd({
    baseUrl: BASE_URL,
    pageUrl,
    title,
    description: post.seo_description || '',
    publishedAt: post.published_at,
    modifiedAt: post.content_modified_at || null,
    ogImageUrl: toBlogImageDisplaySrc(post.og_image_url, BASE_URL),
    blogHtmlMarkdown: post.blog_html || '',
    bodyHtmlForWordCount: bodyHtml,
    readingMinutes,
    angleLabel,
    pkg: pkg
      ? {
          id: pkg.id,
          title: pkg.title,
          destination: pkg.destination,
          price: pkg.price,
          isCurrentlyAvailable: ['active', 'approved'].includes(String(pkg.status || '').toLowerCase()),
        }
      : null,
    durationStr,
    productDurationDays,
    includeFaqSchema: contentBriefV3Record.includeFaq === true,
    includeHowToSchema: contentBriefV3Record.archetype === 'route_walkthrough',
    includeTouristTripSchema: contentBriefV3Record.archetype === 'itinerary_timeline' && Boolean(pkg),
  });

  return (
    <>
      <ReadingProgress />
      <BackToTop />

      {/* JSON-LD — BlogPosting · BreadcrumbList · FAQ · HowTo · TouristTrip (blog-jsonld 단일 소스) */}
      <script
        suppressHydrationWarning
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: serializeJsonLdForScript(jsonLd.blogPosting) }}
      />
      <script
        suppressHydrationWarning
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: serializeJsonLdForScript(jsonLd.breadcrumbList) }}
      />
      {jsonLd.faqPage && (
        <script
          suppressHydrationWarning
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: serializeJsonLdForScript(jsonLd.faqPage) }}
        />
      )}
      {jsonLd.howTo && (
        <script
          suppressHydrationWarning
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: serializeJsonLdForScript(jsonLd.howTo) }}
        />
      )}
      {jsonLd.touristTrip && (
        <script
          suppressHydrationWarning
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: serializeJsonLdForScript(jsonLd.touristTrip) }}
        />
      )}
      {jsonLd.product && (
        <script
          suppressHydrationWarning
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: serializeJsonLdForScript(jsonLd.product) }}
        />
      )}

      <BlogTracker contentCreativeId={post.id} />
      {pkg && (
        <BlogProductRecommendationTracker
          contentCreativeId={post.id}
          intent={blogRecommendationIntent}
          placement="primary_product_cta"
          products={[{ package_id: pkg.id, recommended_rank: 1, policy_id: null }]}
        />
      )}

      <GlobalNav />

      <main className="min-h-screen bg-white">
        {/* breadcrumb (GlobalNav 아래 sticky 2층) */}
        <nav
          className="border-b bg-white/95 backdrop-blur sticky top-14 md:top-16 z-20"
          aria-label="경로 탐색"
        >
          <div className="mx-auto flex min-h-11 max-w-6xl items-center gap-2 px-4 text-sm text-slate-500">
            <Link href="/" className="hidden min-h-11 items-center px-2 hover:text-brand sm:inline-flex">
              홈
            </Link>
            <span aria-hidden="true" className="hidden sm:inline">/</span>
            <Link href="/blog" className="inline-flex min-h-11 items-center px-2 hover:text-brand">
              블로그
            </Link>
            {pkg?.destination && (
              <>
                <span aria-hidden="true">/</span>
                <Link
                  href={`/blog/destination/${encodeURIComponent(pkg.destination)}`}
                  className="inline-flex min-h-11 items-center px-2 hover:text-brand"
                >
                  {pkg.destination}
                </Link>
              </>
            )}
            <span aria-hidden="true" className="hidden sm:inline">/</span>
            <span className="hidden truncate text-slate-900 sm:inline">{abTestTitle}</span>
          </div>
        </nav>

        {pkg?.status &&
          !['active', 'approved'].includes(String(pkg.status).toLowerCase()) && (
            <div className="mx-auto max-w-6xl px-4 pt-4">
              <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950">
                이 글과 연결된 상품은 현재 예약이 어렵거나 판매가 종료된 상태일 수 있어요.{' '}
                <Link
                  href={
                    pkg.destination
                      ? `/packages?destination=${encodeURIComponent(pkg.destination)}`
                      : '/packages'
                  }
                  className="font-semibold text-amber-900 underline underline-offset-2"
                >
                  대체 패키지 보기
                </Link>
              </div>
            </div>
          )}

        {/* 매거진 스타일 헤더 */}
        <header className="mx-auto max-w-3xl px-4 pb-6 pt-10 md:pt-14">
          <div className="mb-5 flex flex-wrap items-center gap-2">
            {pkg?.destination && (
              <Link
                href={`/blog/destination/${encodeURIComponent(pkg.destination)}`}
                className="bg-slate-900 px-3 py-1 text-xs font-bold text-white transition hover:opacity-80"
              >
                {pkg.destination}
              </Link>
            )}
            <Link
              href={`/blog/angle/${post.angle_type}`}
              className="border border-slate-200 bg-white px-3 py-1 text-xs font-medium text-slate-600 transition hover:border-slate-900 hover:text-slate-900"
            >
              {angleLabel}
            </Link>
          </div>

          <h1 className="text-[32px] font-black leading-[1.15] tracking-tight text-slate-900 md:text-[48px] md:leading-[1.1]">
            {abTestTitle}
          </h1>

          {post.seo_description && (
            <p className="mt-5 text-base leading-relaxed text-slate-600 md:text-lg">
              {post.seo_description}
            </p>
          )}

          <div className="mt-6 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-slate-100 pt-4 text-sm text-slate-500">
            <div className="flex items-center gap-2">
              <span
                className="flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-brand to-brand-dark text-xs font-bold text-white before:content-['Y']"
                aria-hidden="true"
              />
              <span className="font-medium text-slate-700">여소남 에디터</span>
            </div>
            <span aria-hidden="true" className="text-slate-300">·</span>
            <time dateTime={post.published_at}>
              {new Date(post.published_at).toLocaleDateString('ko-KR', {
                year: 'numeric',
                month: 'long',
                day: 'numeric',
              })}
            </time>
            <span aria-hidden="true" className="text-slate-300">·</span>
            <span>약 {readingMinutes}분 읽기</span>
          </div>
        </header>

        {/* 상품 블로그 + landing_enabled → 광고 랜딩 Hero (above-fold CTA) */}
        {isLanding && (
          <div className="mx-auto mb-2 max-w-4xl px-4">
            <LandingHero
              subtitle={post.landing_subtitle || (pkg?.product_highlights?.slice(0, 3).join(' · ') ?? undefined)}
              heroImage={post.og_image_url || pkg?.hero_image_url}
              priceKrw={pkg?.price ?? null}
              productUrl={pkg ? `/packages/${pkg.id}` : null}
              trustBadges={buildBlogProductFactLabels({
                airline: pkg?.airline,
                departureAirport: pkg?.departure_airport,
                duration: pkg?.duration,
                nights: pkg?.nights,
              })}
            />
          </div>
        )}

        {/* 정보성 글 또는 랜딩 비활성 시 기본 히어로 이미지 — Jiwonnote 스타일: 좁은 폭 + 작은 radius */}
        {!isLanding && post.og_image_url && (
          <figure className="mx-auto mb-4 max-w-3xl px-4">
            <div className="relative aspect-[16/9] overflow-hidden rounded-md bg-slate-100">
              <SafeCoverImg
                src={post.og_image_url}
                alt={generatedHeroImage ? 'AI 생성 참고 이미지' : ''}
                className="absolute inset-0 h-full w-full object-cover"
                loading="eager"
                sizes="(max-width: 768px) 100vw, (max-width: 1200px) 768px, 1024px"
                fetchPriority="high"
                fallback={<div className="absolute inset-0 bg-slate-100" aria-hidden />}
              />
            </div>
            <figcaption className={generatedHeroImage ? 'mt-2 text-center text-xs text-slate-500' : 'sr-only'}>
              {generatedHeroImage
                ? 'AI 생성 참고 이미지 · 실제 현장 기록이나 최신 운영 상황의 증거로 사용하지 않습니다.'
                : title}
            </figcaption>
          </figure>
        )}

        {/* 본문 + 사이드바 그리드 */}
        <div className="mx-auto max-w-6xl px-4 py-8 md:py-10 lg:flex lg:gap-12">
          <article className="min-w-0 flex-1 lg:max-w-[720px]">
            {/* TL;DR 박스 */}
            <TldrBox items={tldrItems} />

            {/* 모바일 TOC (본문 상단 접이식) */}
            {showToc && <TableOfContents items={toc} variant="mobile" />}

            {/* 본문 HTML — H2 4개 이상일 때 중간에 인라인 관련 콘텐츠 주입 */}
            {bodyHtml ? (
              (() => {
                const split = splitHtmlForInlineInjection(bodyHtml);
                const inlineRelatedLites: RelatedPostLite[] = relatedPosts
                  .slice(0, 2)
                  .map((rp) => ({
                    slug: rp.slug,
                    seo_title: rp.related_anchor || rp.seo_title,
                    destination: relatedPostDestination(rp) ?? undefined,
                  }));
                const canInject =
                  split &&
                  (relatedProducts.length > 0 || inlineRelatedLites.length > 0);
                if (canInject && split) {
                  return (
                    <>
                      <div
                        className="prose prose-lg prose-blue prose-blog max-w-none scroll-smooth"
                        dangerouslySetInnerHTML={{ __html: split.before }}
                      />
                      <InlineRelated
                        destination={effectiveDestination}
                        relatedProducts={relatedProducts}
                        relatedPosts={inlineRelatedLites}
                        contentCreativeId={post.id}
                        intent={blogRecommendationIntent}
                      />
                      <div
                        className="prose prose-lg prose-blue prose-blog max-w-none scroll-smooth"
                        dangerouslySetInnerHTML={{ __html: split.after }}
                      />
                    </>
                  );
                }
                return (
                  <div
                    className="prose prose-lg prose-blue prose-blog max-w-none scroll-smooth"
                    dangerouslySetInnerHTML={{ __html: bodyHtml }}
                  />
                );
              })()
            ) : (
              <p className="py-10 text-center text-slate-400">본문이 준비 중입니다.</p>
            )}

            {informationalIdentity && informationalCtas.length > 0 && (
              <InformationalCtaHub
                articleId={post.id}
                ctas={informationalCtas}
              />
            )}

            {/* 상품 CTA 카드 — Jiwonnote 미니멀 스타일: 슬레이트 보더 + 흰배경 */}
            {pkg && (
              <aside className="not-prose mt-14 border-t-[3px] border-slate-900 pt-6">
                <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
                  이 글의 추천 상품
                </p>
                <h3 className="mt-2 text-xl md:text-2xl font-black leading-tight text-slate-900 tracking-tight">
                  {pkg.title}
                </h3>
                <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-sm text-slate-600">
                  {pkg.destination && (
                    <span className="inline-flex items-center gap-1">
                      <span aria-hidden="true">📍</span>
                      {pkg.destination}
                    </span>
                  )}
                  {durationStr && (
                    <span className="inline-flex items-center gap-1">
                      <span aria-hidden="true">📅</span>
                      {durationStr}
                    </span>
                  )}
                  {pkg.airline && (
                    <span className="inline-flex items-center gap-1">
                      <span aria-hidden="true">✈️</span>
                      {pkg.airline}
                    </span>
                  )}
                  {pkg.price && (
                    <span className="inline-flex items-center gap-1 font-bold text-slate-900 tabular-nums">
                      {pkg.price.toLocaleString()}원~
                    </span>
                  )}
                </div>
                <Link
                  href={`/packages/${pkg.id}`}
                  data-blog-product-id={pkg.id}
                  data-recommendation-source="blog"
                  data-recommendation-rank="1"
                  data-recommendation-placement="primary_product_cta"
                  data-blog-intent={blogRecommendationIntent}
                  className="mt-6 inline-flex items-center gap-1 rounded-md bg-slate-900 px-6 py-3 text-sm font-bold text-white transition hover:opacity-80"
                >
                  상품 상세 보기
                  <span aria-hidden="true">→</span>
                </Link>
              </aside>
            )}

            {/* 저자 박스 */}
            <AuthorBox
              publishedAt={post.published_at}
              contentModifiedAt={post.content_modified_at || null}
              factCheckedAt={post.fact_checked_at || null}
              author={post.generation_meta?.author_profile as { slug: string; displayName: string; bio?: string | null } | null | undefined}
              reviewer={post.generation_meta?.reviewer as { displayName: string; reviewedAt: string; scope: string } | null | undefined}
            />

            {/* 공유 버튼 */}
            <div data-blog-supporting="share">
              <ShareButtons url={pageUrl} title={abTestTitle} utmCampaign={slug} />
            </div>

            {/* 정보성 블로그: destination 기반 큐레이션 상품 3개 (PPR Suspense) */}
            {curationSection}

            {/* 참고 · 출처 */}
            <BlogCitations
              destination={effectiveDestination}
              airline={pkg?.airline ?? undefined}
              citations={researchCitations}
            />
          </article>

          {/* 데스크톱 사이드바 — Jiwonnote 패턴: TOC + 추천 포스팅 */}
          <aside className="hidden w-64 shrink-0 lg:block">
            <div className="sticky top-24 space-y-10">
              {showToc && <TableOfContents items={toc} variant="desktop" />}
              {sidebarRelatedPosts}
            </div>
          </aside>
        </div>

        {/* 관련 글 섹션 — PPR: 동적 데이터는 Suspense로 분리 */}
        {relatedPostsSection}

        {/* 하단 네비 — 이전/다음 글 — PPR: Suspense로 분리 */}
        {prevNextSection}
      </main>

      {/* 상품 블로그 랜딩: 모바일 하단 고정 CTA (+15~25% 전환) */}
      {isLanding && pkg && (
        <StickyMobileCta
          priceKrw={pkg.price ?? null}
          productUrl={`/packages/${pkg.id}`}
          packageId={pkg.id}
          intent={blogRecommendationIntent}
          placement="sticky_mobile_cta"
        />
      )}
    </>
  );
}

// ── PPR Suspense 컴포넌트 ────────────────────────────────────

/** 관련 글 섹션 (함께 보면 좋은 여행 가이드) */
async function RelatedPostsSection({
  currentSlug,
  destination,
  angleType,
  sourcePost,
}: {
  currentSlug: string;
  destination: string | undefined;
  angleType: string | undefined;
  sourcePost?: BlogPost;
}) {
  const relatedPosts = await getRelatedPosts(currentSlug, destination, angleType, sourcePost);
  if (relatedPosts.length === 0) return null;

  return (
    <ScrollReveal>
    <section
      data-related-posts="footer"
      className="border-t border-slate-200 bg-white"
      aria-label="관련 여행 가이드"
    >
      <div className="mx-auto max-w-6xl px-4 md:px-6 py-12 md:py-16">
        <div className="border-b-[3px] border-slate-900 pb-3 md:pb-4 mb-6 md:mb-8 flex items-end justify-between">
          <div className="text-2xl md:text-3xl font-black text-slate-900 tracking-tight">
            함께 보면 좋은 여행 가이드
          </div>
          <Link
            href="/blog"
            className="text-[13px] md:text-sm text-slate-700 hover:text-slate-900 font-semibold whitespace-nowrap"
          >
            전체 보기 →
          </Link>
        </div>
        <div className="grid gap-4 md:gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {relatedPosts.slice(0, 6).map((rp) => {
            const rpTitle = (rp.related_anchor || rp.seo_title || '여행 가이드')
              .replace(/\s*\|\s*여소남(\s*\d{4})?\s*$/g, '')
              .trim();
            const rpDur = formatDuration(rp.travel_packages?.duration, rp.travel_packages?.nights);
            const rpDestination = relatedPostDestination(rp);
            return (
              <Link
                key={rp.id}
                href={`/blog/${rp.slug}`}
                className="group overflow-hidden rounded-md border border-slate-200 bg-white transition hover:shadow-md"
              >
                {rp.og_image_url ? (
                  <div className="relative aspect-[16/9] overflow-hidden bg-slate-100">
                    <SafeCoverImg
                      src={rp.og_image_url}
                      alt=""
                      className="absolute inset-0 h-full w-full object-cover transition duration-300 group-hover:scale-105"
                      sizes="(max-width: 640px) 100vw, 33vw"
                      loading="lazy"
                      fallback={<div className="absolute inset-0 bg-slate-100" aria-hidden />}
                    />
                  </div>
                ) : (
                  <div className="flex aspect-[16/9] items-center justify-center bg-slate-50">
                    <span className="text-3xl" aria-hidden="true">✈️</span>
                  </div>
                )}
                <div className="p-5">
                  <div className="mb-2.5 flex flex-wrap items-center gap-1.5 text-[11px] text-slate-500 font-medium">
                    {rpDestination && (
                      <span>{rpDestination}</span>
                    )}
                    {rpDestination && <span>·</span>}
                    <span>{ANGLE_LABELS[rp.angle_type] || rp.angle_type}</span>
                    {rpDur && <><span>·</span><span>{rpDur}</span></>}
                  </div>
                  <h3 className="line-clamp-2 text-base md:text-[17px] font-bold leading-snug text-slate-900 group-hover:text-slate-700 tracking-tight">
                    {rpTitle}
                  </h3>
                  {rp.travel_packages?.price && (
                    <p className="mt-3 text-base font-black text-slate-900 tabular-nums">
                      {rp.travel_packages.price.toLocaleString()}원~
                    </p>
                  )}
                </div>
              </Link>
            );
          })}
        </div>
      </div>
    </section>
    </ScrollReveal>
  );
}

/** 사이드바 추천 포스팅 */
async function SidebarRelatedPosts({
  currentSlug,
  destination,
  angleType,
  sourcePost,
}: {
  currentSlug: string;
  destination: string | undefined;
  angleType: string | undefined;
  sourcePost?: BlogPost;
}) {
  const posts = await getRelatedPosts(currentSlug, destination, angleType, sourcePost);
  if (posts.length === 0) return null;

  return (
    <div data-related-posts="sidebar">
      <p className="mb-3 text-[11px] font-bold uppercase tracking-wider text-slate-400">추천 포스팅</p>
      <ul className="space-y-3">
        {posts.slice(0, 4).map((rp) => {
          const rpTitle = (rp.related_anchor || rp.seo_title || '여행 가이드')
            .replace(/\s*\|\s*여소남(\s*\d{4})?\s*$/g, '')
            .trim();
          return (
            <li key={rp.id}>
              <Link
                href={`/blog/${rp.slug}`}
                className="block text-[13px] font-semibold text-slate-700 leading-snug hover:text-slate-900 transition line-clamp-3"
              >
                {rpTitle}
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** 정보성 블로그 하단 큐레이션 상품 */
async function CurationSection({
  destination,
  isInfoBlog,
  contentCreativeId,
  intent,
}: {
  destination: string | null;
  isInfoBlog: boolean;
  contentCreativeId?: string | null;
  intent?: string | null;
}) {
  if (!isInfoBlog || !destination) return null;
  const curationProducts = await getCurationProductsForInfo(destination);
  if (curationProducts.length === 0) return null;

  return (
    <DestinationCuration
      destination={destination}
      contentCreativeId={contentCreativeId}
      intent={intent}
      products={curationProducts.map((p: any) => ({
        id: p.id,
        title: p.title,
        destination: p.destination,
        duration: p.duration,
        nights: p.nights,
        price: p.price,
        category: p.category,
        hero_image_url: p.hero_image_url,
        airline: p.airline,
        departure_airport: p.departure_airport,
        recommended_rank: p.recommended_rank,
        policy_id: p.policy_id,
        recommendation_intent: p.recommendation_intent,
      }))}
    />
  );
}

/** 이전/다음 글 네비게이션 */
async function PrevNextSection({
  slug,
  publishedAt,
}: {
  slug: string;
  publishedAt: string;
}) {
  const prevNext = await getPrevNextPosts(slug, publishedAt);
  if (!prevNext.prev && !prevNext.next) return null;

  return (
    <div className="border-t bg-white">
      <div className="mx-auto max-w-6xl px-4 py-8">
        <div className="mb-5 text-sm">
          <Link href="/blog" className="font-medium text-brand hover:text-[#1B64DA]">
            ← 블로그 목록으로
          </Link>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          {prevNext.prev ? (
            <Link
              href={`/blog/${prevNext.prev.slug}`}
              className="group flex overflow-hidden rounded-xl border border-slate-200 bg-white transition hover:border-brand/30 hover:shadow-md"
            >
              {prevNext.prev.og_image_url && (
                <div className="relative w-24 shrink-0 overflow-hidden bg-slate-100">
                  <SafeCoverImg
                    src={prevNext.prev.og_image_url}
                    alt=""
                    className="absolute inset-0 h-full w-full object-cover transition duration-300 group-hover:scale-105"
                    sizes="96px"
                    loading="lazy"
                    fallback={<div className="absolute inset-0 bg-slate-100" aria-hidden />}
                  />
                </div>
              )}
              <div className="flex flex-col justify-center gap-1 p-4 min-w-0">
                <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
                  ← 이전 글
                </span>
                {prevNext.prev.destination && (
                  <span className="text-xs text-slate-500">{prevNext.prev.destination}</span>
                )}
                <span className="line-clamp-2 text-sm font-semibold leading-snug text-slate-800 transition group-hover:text-brand">
                  {(prevNext.prev.seo_title || '여행 가이드')
                    .replace(/\s*\|\s*여소남(\s*\d{4})?\s*$/g, '')
                    .trim()}
                </span>
              </div>
            </Link>
          ) : (
            <div />
          )}
          {prevNext.next ? (
            <Link
              href={`/blog/${prevNext.next.slug}`}
              className="group flex overflow-hidden rounded-xl border border-slate-200 bg-white transition hover:border-brand/30 hover:shadow-md"
            >
              <div className="flex flex-col justify-center gap-1 p-4 min-w-0 text-right flex-1">
                <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
                  다음 글 →
                </span>
                {prevNext.next.destination && (
                  <span className="text-xs text-slate-500">{prevNext.next.destination}</span>
                )}
                <span className="line-clamp-2 text-sm font-semibold leading-snug text-slate-800 transition group-hover:text-brand">
                  {(prevNext.next.seo_title || '여행 가이드')
                    .replace(/\s*\|\s*여소남(\s*\d{4})?\s*$/g, '')
                    .trim()}
                </span>
              </div>
              {prevNext.next.og_image_url && (
                <div className="relative w-24 shrink-0 overflow-hidden bg-slate-100">
                  <SafeCoverImg
                    src={prevNext.next.og_image_url}
                    alt=""
                    className="absolute inset-0 h-full w-full object-cover transition duration-300 group-hover:scale-105"
                    sizes="96px"
                    loading="lazy"
                    fallback={<div className="absolute inset-0 bg-slate-100" aria-hidden />}
                  />
                </div>
              )}
            </Link>
          ) : (
            <div />
          )}
        </div>
      </div>
    </div>
  );
}
