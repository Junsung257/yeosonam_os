import type { Metadata } from 'next';
import { notFound, permanentRedirect, redirect } from 'next/navigation';
import React, { Suspense } from 'react';
import Link from 'next/link';
import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';
import BlogTracker from '@/components/BlogTracker';
import TableOfContents from '@/components/blog/TableOfContents';
import TldrBox from '@/components/blog/TldrBox';
import AuthorBox from '@/components/blog/AuthorBox';
import ShareButtons from '@/components/blog/ShareButtons';
import ReadingProgress from '@/components/blog/ReadingProgress';
import BlogCitations from '@/components/blog/BlogCitations';
import InlineRelated, {
  type RelatedProductLite,
  type RelatedPostLite,
} from '@/components/blog/InlineRelated';
import { extractTocAndInjectIds, shouldShowToc } from '@/lib/blog-toc';
import { removeUnreachableBlogAssetImages, renderBlogContentToHtml } from '@/lib/blog-renderer';
import LandingHero from '@/components/blog/LandingHero';
import StickyMobileCta from '@/components/blog/StickyMobileCta';
import DestinationCuration from '@/components/blog/DestinationCuration';
import BlogProductRecommendationTracker from '@/components/blog/BlogProductRecommendationTracker';
import { ScrollReveal } from '@/components/blog/ScrollReveal';
import { BackToTop } from '@/components/blog/BackToTop';
import { resolveDki } from '@/lib/dki-resolver';
import GlobalNav from '@/components/customer/GlobalNav';
import { buildBlogPostPageJsonLd } from '@/lib/blog-jsonld';
import { safeDecodeSlug } from '@/lib/decode-slug';
import { assignVariant } from '@/lib/ab-test-engine';
import AbTestTracker from '@/components/blog/AbTestTracker';
import { logError } from '@/lib/sentry-logger';
import { toBlogImageDisplaySrc } from '@/lib/blog-image-proxy';
import { classifyBlogIntent } from '@/lib/blog-content-intent';
import { recommendBestPackages } from '@/lib/scoring/recommend';
import { resolveBlogSlugRedirect } from '@/lib/blog-slug-redirects';

export const dynamic = 'force-dynamic';

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

/**
 * A/B 테스트용 headline variant 생성 (Power word + 연도 조정)
 * variant 0 = 원본, variant 1 = power word 추가, variant 2 = 연도 앞당김
 */
function buildHeadlineVariants(original: string): string[] {
  const powerWords = ['완벽', '최고', '강력 추천', '필수'];
  const pw = powerWords[Math.floor(Math.random() * powerWords.length)];
  const yearVariant = original.replace(/\b20\d{2}\b/g, (m) => String(Number(m) + 1));
  // 이미 power word가 포함된 variant가 있는지 확인
  const hasPowerWord = powerWords.some(w => original.includes(w));
  return [
    original,
    hasPowerWord ? original : `${pw} ${original}`.trim(),
    yearVariant !== original ? yearVariant : original,
  ];
}

export const revalidate = 0;
// 자동 발행 글은 계속 늘어나므로 정적 slug 목록을 빌드/개발 서버에 고정하지 않는다.
// 각 상세 페이지는 첫 요청 시 on-demand ISR로 생성하고, 미존재 slug는 noindex 404로 방어한다.

const BASE_URL = process.env.NEXT_PUBLIC_BASE_URL || 'https://www.yeosonam.com';

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
  product_id: string | null;
  tracking_id: string | null;
  destination: string | null;
  landing_enabled: boolean | null;
  landing_headline: string | null;
  landing_subtitle: string | null;
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
    hero_image_url?: string | null;
  } | null;
}

interface RelatedPost {
  id: string;
  slug: string;
  seo_title: string | null;
  og_image_url: string | null;
  angle_type: string;
  published_at: string;
  travel_packages: {
    destination: string;
    price: number | null;
    duration: string | number | null;
    nights: number | null;
  } | null;
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

function buildSeoTitleWithSuffix(title: string, suffix: string): string {
  if (!suffix) return title;
  const maxBaseLength = Math.max(20, 60 - suffix.length);
  const base = title.length > maxBaseLength
    ? title.slice(0, maxBaseLength).replace(/\s+\S*$/, '').trim() || title.slice(0, maxBaseLength).trim()
    : title;
  return `${base}${suffix}`;
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

async function getDuplicateTitleSuffix(post: BlogPost): Promise<string> {
  if (!isSupabaseConfigured || !post.seo_title) return '';
  try {
    const { data } = await supabaseAdmin
      .from('content_creatives')
      .select('slug, published_at, created_at')
      .eq('channel', 'naver_blog')
      .eq('status', 'published')
      .eq('seo_title', post.seo_title)
      .not('slug', 'is', null)
      .order('published_at', { ascending: true });

    const duplicates = ((data || []) as Array<{ slug: string | null; published_at: string | null; created_at: string | null }>)
      .filter((row) => row.slug)
      .sort((a, b) => {
        const ad = a.published_at || a.created_at || '';
        const bd = b.published_at || b.created_at || '';
        return ad.localeCompare(bd) || String(a.slug).localeCompare(String(b.slug));
      });
    if (duplicates.length <= 1) return '';
    const index = duplicates.findIndex((row) => row.slug === post.slug);
    if (index <= 0) return '';
    return ` (${index + 1}편)`;
  } catch {
    return '';
  }
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

function estimateReadingMinutes(html: string): number {
  const text = html.replace(/<[^>]+>/g, '').trim();
  // 한국어 기준 분당 500자. 최소 3분.
  return Math.max(3, Math.round(text.length / 500));
}

function sanitizeServerBlogHtml(html: string): string {
  return html
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<\/?(del|s|strike)\b[^>]*>/gi, '')
    .replace(/<(script|style|iframe|object|embed|svg|math|base|link|meta|form|input|button|textarea|select)\b[\s\S]*?<\/\1>/gi, '')
    .replace(/<(script|style|iframe|object|embed|svg|math|base|link|meta|form|input|button|textarea|select)\b[^>]*\/?>/gi, '')
    .replace(/\s(?:on[a-z]+|srcdoc)\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/\sstyle\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/\s(href|src)\s*=\s*(["']?)\s*(javascript:|data:text\/html|vbscript:)[\s\S]*?\2/gi, '')
    .replace(/\s(class|id)\s*=\s*(["'])([^"']{300,})\2/gi, '');
}

// ── 데이터 페칭 ──────────────────────────────────────────────
const BLOG_OPTIONAL_QUERY_TIMEOUT_MS = 1800;

async function withOptionalBlogTimeout<T>(
  label: string,
  promise: PromiseLike<T>,
  fallback: T,
  timeoutMs = BLOG_OPTIONAL_QUERY_TIMEOUT_MS,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const timeout = new Promise<T>((resolve) => {
    timer = setTimeout(() => {
      console.warn(`[blog/detail] optional ${label} timed out after ${timeoutMs}ms`);
      resolve(fallback);
    }, timeoutMs);
  });

  try {
    return await Promise.race([
      Promise.resolve(promise).catch((error) => {
        logError(`[blog/detail] optional ${label} failed`, error);
        return fallback;
      }),
      timeout,
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function getPost(slug: string): Promise<BlogPost | null> {
  if (!isSupabaseConfigured) return null;

  const dbSlug = safeDecodeSlug(slug);

  const { data, error } = await supabaseAdmin
    .from('content_creatives')
    .select(
      // travel_packages.hero_image_url 컬럼은 DB에 존재하지 않는다 (photos 는 별도 테이블).
      // select에 포함하면 supabase가 통째로 에러 반환 → data=null → notFound() 404.
      // 이것이 "발행했는데 글이 안 뜬다"의 진짜 원인이었음. (API 라우트는 select 안 함 → 200)
      'id, slug, seo_title, seo_description, og_image_url, blog_html, angle_type, channel, published_at, created_at, updated_at, product_id, tracking_id, destination, landing_enabled, landing_headline, landing_subtitle, travel_packages(id, title, destination, price, duration, nights, category, airline, departure_airport, product_highlights, inclusions, status)',
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
    return null;
  }
  if (!data || data.length === 0) return null;
  return data[0] as unknown as BlogPost;
}

async function getPostMetadata(slug: string): Promise<BlogPost | null> {
  if (!isSupabaseConfigured) return null;

  const dbSlug = safeDecodeSlug(slug);

  const { data, error } = await supabaseAdmin
    .from('content_creatives')
    .select(
      'id, slug, seo_title, seo_description, og_image_url, angle_type, published_at, updated_at, destination, travel_packages(title, destination)',
    )
    .eq('slug', dbSlug)
    .eq('status', 'published')
    .eq('channel', 'naver_blog')
    .not('slug', 'is', null)
    .limit(1);

  if (error) {
    logError('[blog/getPostMetadata] supabase error', error, {
      slug: dbSlug,
      rawParam: slug,
      code: error && typeof error === 'object' && 'code' in error ? (error as { code: string }).code : null,
      hint: error && typeof error === 'object' && 'hint' in error ? (error as { hint: string }).hint : null,
    });
    return null;
  }
  if (!data || data.length === 0) return null;
  return { ...(data[0] as unknown as BlogPost), blog_html: null };
}

async function getRelatedProducts(
  currentProductId: string | null | undefined,
  destination: string | undefined,
  intent: string = 'blog',
): Promise<RelatedProductLite[]> {
  if (!isSupabaseConfigured || !destination) return [];
  try {
    const scored = await recommendBestPackages({
      destination,
      limit: currentProductId ? 5 : 4,
    });
    const ranked = scored.ranked
      .filter((item) => item.package_id !== currentProductId)
      .slice(0, 4);
    if (ranked.length > 0) {
      const ids = ranked.map((item) => item.package_id);
      const { data: detailRows } = await supabaseAdmin
        .from('travel_packages')
        .select('id, title, destination, price, duration, nights, airline, departure_airport')
        .in('id', ids);
      const detailById = new Map(
        ((detailRows || []) as unknown as RelatedProductLite[]).map((row) => [row.id, row]),
      );
      return ranked.map((item) => {
        const detail = detailById.get(item.package_id);
        return {
          id: item.package_id,
          title: detail?.title || item.title,
          destination: detail?.destination || item.destination,
          price: detail?.price ?? item.effective_price ?? item.list_price,
          duration: detail?.duration ?? item.duration_days,
          nights: detail?.nights ?? Math.max(0, item.duration_days - 1),
          airline: detail?.airline ?? null,
          departure_airport: detail?.departure_airport ?? null,
          recommended_rank: item.rank,
          policy_id: null,
          recommendation_intent: intent,
        };
      });
    }
  } catch (err) {
    logError('[blog/getRelatedProducts] scored recommendation failed', err, {
      destination,
      currentProductId,
      intent,
    });
  }

  let query = supabaseAdmin
    .from('travel_packages')
    .select('id, title, destination, price, duration, nights, airline, departure_airport')
    .eq('destination', destination)
    .in('status', ['active', 'approved'])
    .order('price', { ascending: true })
    .limit(4);
  if (currentProductId) query = query.neq('id', currentProductId);
  const { data } = await query;
  return ((data as unknown as RelatedProductLite[]) || []).map((item, index) => ({
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

async function getRelatedPosts(
  currentSlug: string,
  destination: string | undefined,
  angleType: string | undefined,
): Promise<RelatedPost[]> {
  if (!isSupabaseConfigured) return [];

  const { data } = await supabaseAdmin
    .from('content_creatives')
    .select(
      'id, slug, seo_title, og_image_url, angle_type, published_at, travel_packages(destination, price, duration, nights)',
    )
    .eq('status', 'published')
    .eq('channel', 'naver_blog')
    .not('slug', 'is', null)
    .neq('slug', currentSlug)
    .order('published_at', { ascending: false })
    .limit(50);

  if (!data) return [];
  const posts = data as unknown as RelatedPost[];

  // 우선순위: 같은 destination + 같은 angle → 같은 destination → 같은 angle → 최신
  const sameDestSameAngle = posts.filter(
    (p) => p.travel_packages?.destination === destination && p.angle_type === angleType,
  );
  const sameDest = posts.filter(
    (p) => p.travel_packages?.destination === destination && p.angle_type !== angleType,
  );
  const sameAngle = posts.filter(
    (p) => p.angle_type === angleType && p.travel_packages?.destination !== destination,
  );
  const rest = posts.filter(
    (p) => p.travel_packages?.destination !== destination && p.angle_type !== angleType,
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
  const today = new Date().toISOString().split('T')[0];

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
  }

  const { data } = await supabaseAdmin
    .from('travel_packages')
    .select('id, title, destination, duration, nights, price, category, airline, departure_airport, price_dates')
    .eq('destination', destination)
    .in('status', ['approved', 'active'])
    .order('price', { ascending: true })
    .limit(12);

  if (!data || data.length === 0) return [];

  // 미래 출발일 있는 상품만 필터
  const alive = (data as unknown as CurationPackage[]).filter((p) => {
    const pd = (p.price_dates || []) as Array<{ date?: string }>;
    if (pd.length === 0) return true; // 날짜 데이터 없으면 살아있다고 간주
    return pd.some((d) => d.date && d.date >= today);
  });

  if (alive.length <= 3) return alive;

  // 가격 3분위에서 1개씩 (가성비 / 중가 / 프리미엄)
  const sorted = [...alive].sort((a, b) => (a.price || 0) - (b.price || 0));
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

  const base = supabaseAdmin
    .from('content_creatives')
    .select('slug, seo_title, og_image_url, destination')
    .eq('status', 'published')
    .eq('channel', 'naver_blog')
    .not('slug', 'is', null)
    .neq('slug', slug);

  const [prevRes, nextRes] = await Promise.all([
    base.lt('published_at', publishedAt).order('published_at', { ascending: false }).limit(1),
    base.gt('published_at', publishedAt).order('published_at', { ascending: true }).limit(1),
  ]);

  return {
    prev: (prevRes.data?.[0] as NavPost) ?? null,
    next: (nextRes.data?.[0] as NavPost) ?? null,
  };
}

// ── 동적 메타데이터 ──────────────────────────────────────────
export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
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
  const post = await getPostMetadata(slug);
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
  const duplicateTitleSuffix = await withOptionalBlogTimeout(
    'duplicate-title-suffix',
    getDuplicateTitleSuffix(post),
    '',
    900,
  );
  const metadataTitle = buildSeoTitleWithSuffix(cleanedTitle, duplicateTitleSuffix);

  const description = buildSeoDescription(post);
  const dbOgImage = toBlogImageDisplaySrc(post.og_image_url, BASE_URL);

  const angleLabel = ANGLE_LABELS[post.angle_type] || post.angle_type;
  const dest = post.travel_packages?.destination || post.destination || null;
  const tagSet = [dest, angleLabel, '여행', '패키지여행', '단체여행'].filter(Boolean) as string[];

  // A/B 테스트: generateMetadata는 서버 정적이므로 원본 seo_title 유지
  // (실제 변형은 페이지 컴포넌트에서 처리)
  return {
    // absolute를 쓰면 layout의 template이 적용되지 않음
    title: { absolute: `${metadataTitle} | 여소남` },
    description,
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
      modifiedTime: post.updated_at || post.published_at,
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

// ── 페이지 컴포넌트 ──────────────────────────────────────────
export default async function BlogDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { slug: rawSlug } = await params;
  const slug = safeDecodeSlug(rawSlug);
  const redirectedSlug = resolveBlogSlugRedirect(slug);
  if (redirectedSlug) {
    permanentRedirect(`/blog/${redirectedSlug}`);
  }
  const qp = await searchParams;
  const utmCampaign = (qp.utm_campaign as string) || null;
  const utmTerm = (qp.utm_term as string) || null;
  const utmSource = (qp.utm_source as string) || null;

  // 렌더링 errors를 notFound로 fallback (E1401/500 방어)
  try {
    return await renderBlogDetail({ rawSlug, slug, utmCampaign, utmTerm, utmSource });
  } catch (err) {
    if (isNextNotFoundError(err) || isNextRedirectError(err)) {
      throw err;
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
  utmCampaign,
  utmTerm,
  utmSource,
}: {
  rawSlug: string;
  slug: string;
  utmCampaign: string | null;
  utmTerm: string | null;
  utmSource: string | null;
}) {
  // 숫자로만 구성된 slug(e.g. "/blog/2026")는 블로그 목록으로 리다이렉트
  if (/^\d+$/.test(slug)) {
    redirect('/blog');
  }

  const post = await getPost(slug);
  if (!post) notFound();

  const pkg = post.travel_packages;
  const rawTitle = post.seo_title || pkg?.title || '여행 가이드';
  const title = rawTitle.replace(/\s*\|\s*여소남(\s*\d{4})?\s*$/g, '').trim();

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

  // ── A/B 테스트: headline 실험 ────────────────────────────
  // visitorId = post.id (고유 식별자, 결정론적 할당용)
  // generateMetadata와의 중복 방지를 위해 페이지 컴포넌트에서만 실행
  let abTestTitle = title;
  let abTestExperimentId: string | null = null;
  let abTestVariantId: string | null = null;
  let abTestVisitorId: string | null = null;
  try {
    abTestVisitorId = `blog_${post.id}`;
    const variants = buildHeadlineVariants(title);
    const experimentName = `headline_${post.slug.slice(0, 40)}`;

    // 실험 찾기 또는 생성 (없으면 무시 — 실험은 어드민에서 생성됨)
    // assignVariant는 experimentId를 받으므로, 실험이 존재해야 함.
    // 여기서는 기존 실험 ID를 조회하거나, 없으면 조용히 넘어감.
    const existingExps = await withOptionalBlogTimeout(
      'headline-experiment',
      supabaseAdmin
        .from('ab_experiments')
        .select('id')
        .eq('creative_id', post.id)
        .eq('variant_type', 'headline')
        .in('status', ['running', 'paused'])
        .limit(1)
        .then((res) => res.data),
      [],
      900,
    );

    if (existingExps && existingExps.length > 0) {
      const expId = (existingExps[0] as { id: string }).id;
      const result = await withOptionalBlogTimeout(
        'headline-variant',
        assignVariant(expId, abTestVisitorId),
        null,
        900,
      );

      if (result) {
        abTestExperimentId = expId;
        abTestVariantId = result.variantId;
        // variantValue가 있으면 그걸로 타이틀 사용, 없으면 variantLabel로 판단
        if (result.variantValue && result.variantValue !== title) {
          // SEO title clean 적용
          abTestTitle = (result.variantValue ?? '')
            .replace(/\s*\|\s*여소남(\s*\d{4})?\s*$/g, '')
            .trim();
        }
      }
    }
  } catch (abErr) {
    console.warn('[A/B] headline 실험 할당 실패 (기본 타이틀 사용):', abErr instanceof Error ? abErr.message : abErr);
  }

  // PPR: dki(랜딩) + relatedProducts(인라인 주입) + relatedPosts(인라인+사이드바)는
  // 핵심 경로에 유지. curationProducts, prevNext는 Suspense로 streaming.
  const [dki, relatedPosts, relatedProducts] = await Promise.all([
    isLanding
      ? resolveDki(
          { utm_campaign: utmCampaign, utm_term: utmTerm, utm_source: utmSource, content_creative_id: post.id },
          {
            seo_title: abTestTitle,
            landing_headline: post.landing_headline,
            landing_subtitle: post.landing_subtitle,
          },
        )
      : Promise.resolve(null),
    withOptionalBlogTimeout('inline-related-posts', getRelatedPosts(slug, effectiveDestination, post.angle_type), []),
    withOptionalBlogTimeout('inline-related-products', getRelatedProducts(pkg?.id, effectiveDestination, blogRecommendationIntent), []),
  ]);
  const durationStr = formatDuration(pkg?.duration, pkg?.nights);
  const tldrItems = extractTldrItems(post);
  const angleLabel = ANGLE_LABELS[post.angle_type] || post.angle_type;
  const pageUrl = `${BASE_URL}/blog/${slug}`;

  // 본문 sanitize + TOC 추출
  let bodyHtml = '';
  let toc: ReturnType<typeof extractTocAndInjectIds>['toc'] = [];
  let showToc = false;
  let readingMinutes = 3;

  if (post.blog_html) {
    // blog_html은 "마크다운 + 일부 안전한 HTML(figcaption/aside)" 혼합 저장값이다.
    // figcaption 태그만 보고 전체를 raw HTML로 취급하면 이미지/표/링크 마크다운이 그대로 노출된다.
    const rendered = await removeUnreachableBlogAssetImages(await renderBlogContentToHtml(post.blog_html));
    const sanitized = sanitizeServerBlogHtml(rendered);
    const result = extractTocAndInjectIds(sanitized);
    bodyHtml = result.html;
    toc = result.toc;
    showToc = shouldShowToc(sanitized, toc);
    readingMinutes = estimateReadingMinutes(sanitized);
  }

  const productDurationDays =
    pkg?.duration != null && !Number.isNaN(Number(pkg.duration)) ? Number(pkg.duration) : null;

  const jsonLd = buildBlogPostPageJsonLd({
    baseUrl: BASE_URL,
    pageUrl,
    title,
    description: post.seo_description || '',
    publishedAt: post.published_at,
    modifiedAt: post.updated_at,
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
        }
      : null,
    durationStr,
    productDurationDays,
  });

  return (
    <>
      <ReadingProgress />
      <BackToTop />

      {/* JSON-LD — BlogPosting · BreadcrumbList · FAQ · HowTo · TouristTrip (blog-jsonld 단일 소스) */}
      <script
        suppressHydrationWarning
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd.blogPosting) }}
      />
      <script
        suppressHydrationWarning
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd.breadcrumbList) }}
      />
      {jsonLd.faqPage && (
        <script
          suppressHydrationWarning
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd.faqPage) }}
        />
      )}
      {jsonLd.howTo && (
        <script
          suppressHydrationWarning
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd.howTo) }}
        />
      )}
      {jsonLd.touristTrip && (
        <script
          suppressHydrationWarning
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd.touristTrip) }}
        />
      )}
      {jsonLd.product && (
        <script
          suppressHydrationWarning
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd.product) }}
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

      {/* A/B 테스트 전환 추적 (스크롤 50% + CTA 클릭) */}
      {abTestExperimentId && abTestVariantId && (
        <AbTestTracker
          experimentId={abTestExperimentId}
          visitorId={abTestVisitorId!}
          variantId={abTestVariantId}
        />
      )}

      <GlobalNav />

      <main className="min-h-screen bg-white">
        {/* breadcrumb (GlobalNav 아래 sticky 2층) */}
        <nav
          className="border-b bg-white/95 backdrop-blur sticky top-14 md:top-16 z-20"
          aria-label="경로 탐색"
        >
          <div className="mx-auto flex max-w-6xl items-center gap-2 px-4 py-3 text-sm text-slate-500">
            <Link href="/" className="hover:text-brand">
              홈
            </Link>
            <span aria-hidden="true">/</span>
            <Link href="/blog" className="hover:text-brand">
              블로그
            </Link>
            {pkg?.destination && (
              <>
                <span aria-hidden="true">/</span>
                <Link
                  href={`/blog/destination/${encodeURIComponent(pkg.destination)}`}
                  className="hover:text-brand"
                >
                  {pkg.destination}
                </Link>
              </>
            )}
            <span aria-hidden="true">/</span>
            <span className="truncate text-slate-900">{abTestTitle}</span>
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
                className="flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-brand to-brand-dark text-xs font-bold text-white"
                aria-hidden="true"
              >
                여
              </span>
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
        {isLanding && dki && (
          <div className="mx-auto mb-2 max-w-4xl px-4">
            <LandingHero
              headline={dki.headline}
              subtitle={dki.subtitle || post.landing_subtitle || (pkg?.product_highlights?.slice(0, 3).join(' · ') ?? undefined)}
              heroImage={toBlogImageDisplaySrc(post.og_image_url || pkg?.hero_image_url)}
              priceKrw={pkg?.price ?? null}
              productUrl={pkg ? `/packages/${pkg.id}` : null}
              trustBadges={['운영팀 검증', '노팁·노옵션', pkg?.airline || '직항']}
              matched={dki.matched}
            />
          </div>
        )}

        {/* 정보성 글 또는 랜딩 비활성 시 기본 히어로 이미지 — Jiwonnote 스타일: 좁은 폭 + 작은 radius */}
        {!isLanding && post.og_image_url && (
          <figure className="mx-auto mb-4 max-w-3xl px-4">
            <div className="relative aspect-[16/9] overflow-hidden rounded-md bg-slate-100">
              <img
                src={toBlogImageDisplaySrc(post.og_image_url) || post.og_image_url}
                alt={[pkg?.destination || post.destination, title].filter(Boolean).join(' — ')}
                className="absolute inset-0 h-full w-full object-cover"
                loading="eager"
                sizes="(max-width: 768px) 100vw, (max-width: 1200px) 768px, 1024px"
                fetchPriority="high"
              />
            </div>
            <figcaption className="sr-only">{title}</figcaption>
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
                    seo_title: rp.seo_title,
                    destination: rp.travel_packages?.destination,
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
              updatedAt={post.updated_at}
              destination={effectiveDestination}
            />

            {/* 공유 버튼 */}
            <ShareButtons url={pageUrl} title={abTestTitle} utmCampaign={slug} />

            {/* 정보성 블로그: destination 기반 큐레이션 상품 3개 (PPR Suspense) */}
            <Suspense fallback={<div className="animate-pulse h-32 bg-gray-100 rounded my-8" />}>
              <CurationSection
                destination={effectiveDestination ?? null}
                isInfoBlog={isInfoBlog}
                contentCreativeId={post.id}
                intent={blogRecommendationIntent}
              />
            </Suspense>

            {/* 참고 · 출처 */}
            <BlogCitations destination={effectiveDestination} airline={pkg?.airline ?? undefined} />
          </article>

          {/* 데스크톱 사이드바 — Jiwonnote 패턴: TOC + 추천 포스팅 */}
          <aside className="hidden w-64 shrink-0 lg:block">
            <div className="sticky top-24 space-y-10">
              {showToc && <TableOfContents items={toc} variant="desktop" />}
              <Suspense fallback={<div className="animate-pulse h-24 bg-gray-100 rounded" />}>
                <SidebarRelatedPosts currentSlug={slug} destination={effectiveDestination} angleType={post.angle_type} />
              </Suspense>
            </div>
          </aside>
        </div>

        {/* 관련 글 섹션 — PPR: 동적 데이터는 Suspense로 분리 */}
        <Suspense fallback={<div className="animate-pulse h-48 bg-gray-100 rounded mx-auto max-w-6xl my-8" />}>
          <RelatedPostsSection currentSlug={slug} destination={effectiveDestination} angleType={post.angle_type} />
        </Suspense>

        {/* 하단 네비 — 이전/다음 글 — PPR: Suspense로 분리 */}
        <Suspense fallback={<div className="animate-pulse h-24 bg-gray-100 rounded mx-auto max-w-6xl my-8" />}>
          <PrevNextSection slug={slug} publishedAt={post.published_at} />
        </Suspense>
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
}: {
  currentSlug: string;
  destination: string | undefined;
  angleType: string | undefined;
}) {
  const relatedPosts = await withOptionalBlogTimeout(
    'related-posts-section',
    getRelatedPosts(currentSlug, destination, angleType),
    [],
  );
  if (relatedPosts.length === 0) return null;

  return (
    <ScrollReveal>
    <section className="border-t border-slate-200 bg-white" aria-label="관련 여행 가이드">
      <div className="mx-auto max-w-6xl px-4 md:px-6 py-12 md:py-16">
        <div className="border-b-[3px] border-slate-900 pb-3 md:pb-4 mb-6 md:mb-8 flex items-end justify-between">
          <h2 className="text-2xl md:text-3xl font-black text-slate-900 tracking-tight">
            함께 보면 좋은 여행 가이드
          </h2>
          <Link
            href="/blog"
            className="text-[13px] md:text-sm text-slate-700 hover:text-slate-900 font-semibold whitespace-nowrap"
          >
            전체 보기 →
          </Link>
        </div>
        <div className="grid gap-4 md:gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {relatedPosts.slice(0, 6).map((rp) => {
            const rpTitle = (rp.seo_title || '여행 가이드')
              .replace(/\s*\|\s*여소남(\s*\d{4})?\s*$/g, '')
              .trim();
            const rpDur = formatDuration(rp.travel_packages?.duration, rp.travel_packages?.nights);
            return (
              <Link
                key={rp.id}
                href={`/blog/${rp.slug}`}
                className="group overflow-hidden rounded-md border border-slate-200 bg-white transition hover:shadow-md"
              >
                {rp.og_image_url ? (
                  <div className="relative aspect-[16/9] overflow-hidden bg-slate-100">
                    <img
                      src={toBlogImageDisplaySrc(rp.og_image_url) || rp.og_image_url}
                      alt={rpTitle}
                      className="absolute inset-0 h-full w-full object-cover transition duration-300 group-hover:scale-105"
                      sizes="(max-width: 640px) 100vw, 33vw"
                      loading="lazy"
                    />
                  </div>
                ) : (
                  <div className="flex aspect-[16/9] items-center justify-center bg-slate-50">
                    <span className="text-3xl" aria-hidden="true">✈️</span>
                  </div>
                )}
                <div className="p-5">
                  <div className="mb-2.5 flex flex-wrap items-center gap-1.5 text-[11px] text-slate-500 font-medium">
                    {rp.travel_packages?.destination && (
                      <span>{rp.travel_packages.destination}</span>
                    )}
                    {rp.travel_packages?.destination && <span>·</span>}
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
}: {
  currentSlug: string;
  destination: string | undefined;
  angleType: string | undefined;
}) {
  const posts = await withOptionalBlogTimeout(
    'sidebar-related-posts',
    getRelatedPosts(currentSlug, destination, angleType),
    [],
  );
  if (posts.length === 0) return null;

  return (
    <div>
      <p className="mb-3 text-[11px] font-bold uppercase tracking-wider text-slate-400">추천 포스팅</p>
      <ul className="space-y-3">
        {posts.slice(0, 4).map((rp) => {
          const rpTitle = (rp.seo_title || '여행 가이드')
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
  const curationProducts = await withOptionalBlogTimeout(
    'curation-products',
    getCurationProductsForInfo(destination),
    [],
  );
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
  const prevNext = await withOptionalBlogTimeout(
    'prev-next-posts',
    getPrevNextPosts(slug, publishedAt),
    { prev: null, next: null },
  );
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
                  <img
                    src={toBlogImageDisplaySrc(prevNext.prev.og_image_url) || prevNext.prev.og_image_url}
                    alt=""
                    className="absolute inset-0 h-full w-full object-cover transition duration-300 group-hover:scale-105"
                    sizes="96px"
                    loading="lazy"
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
                  <img
                    src={toBlogImageDisplaySrc(prevNext.next.og_image_url) || prevNext.next.og_image_url}
                    alt=""
                    className="absolute inset-0 h-full w-full object-cover transition duration-300 group-hover:scale-105"
                    sizes="96px"
                    loading="lazy"
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
