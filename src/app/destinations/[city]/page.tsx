import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';
import { applyMarkdownAccents, applyHtmlAccents } from '@/lib/blog-accent';
import GlobalNav from '@/components/customer/GlobalNav';
import SectionHeader from '@/components/customer/SectionHeader';
import TravelFitnessCard from '@/components/customer/TravelFitnessCard';
import DestinationPackagesSection from '@/components/customer/DestinationPackagesSection';
import { SafeCoverImg } from '@/components/customer/SafeRemoteImage';
import TrackedKakaoLink from '@/components/customer/TrackedKakaoLink';
import { getRegionForCity, getDestinationUrl, getRegionUrl, cityInRegion, encodeDestinationPathSegment, destinationToSlug } from '@/lib/regions';
import { isSafeImageSrc, pickAttractionPhotoUrl } from '@/lib/image-url';
import { shouldSkipPublicDbReadsForResourceSaver } from '@/lib/cron-resource-saver';
import {
  canonicalizePublicDestination,
  getPublicDestinationQueryNames,
  slugMatchesPublicDestination,
} from '@/lib/public-destinations';
import { sanitizePublicBlogBodyHtml } from '@/lib/blog-public-render-normalizer';
import { listCurrentPublicPackageCardSnapshots } from '@/lib/package-publication/snapshot-projection';
import type { FitnessScore, MonthlyNormal } from '@/lib/travel-fitness-score';
import type { SeasonalSignal } from '@/lib/seasonal-signals';
import { isCustomerRenderableAttraction, type AttractionData } from '@/lib/attraction-matcher';
import { serializeJsonLdForScript } from '@/lib/json-ld';
import { PUBLIC_BLOG_READ_SOURCE } from '@/lib/blog-public-eligibility';
import { hasUpcomingPublicDepartureDate } from '@/lib/package-public-eligibility';

export const revalidate = 300;
// The route reads live Supabase-backed publication snapshots and metadata.
// Keep dynamic params on the request path so Next.js does not attempt a
// static/ISR render and surface DYNAMIC_SERVER_USAGE as a 500 for uncached
// destination slugs.
export const dynamic = 'force-dynamic';
export const dynamicParams = true;
const DESTINATION_STATIC_PRERENDER_LIMIT = Math.max(
  0,
  Number(process.env.DESTINATION_STATIC_PRERENDER_LIMIT ?? '0') || 0,
);

async function listDestinationPublicSnapshotRows(limit = 5_000): Promise<Record<string, unknown>[]> {
  try {
    return await listCurrentPublicPackageCardSnapshots(supabaseAdmin, { limit });
  } catch (error) {
    console.warn('[destination] pointer-only package catalog unavailable; hiding package-derived destination data', error);
    return [];
  }
}

/**
 * 2026-05-19 박제 (PR #153 패턴 적용): Next.js 15 dynamic route 의 ISR 활성화를 위해
 * generateStaticParams 가 필수. 빈 배열이라도 반환해야 runtime ISR cache 동작.
 * 활성 상품이 있는 destination 만 빌드 시 prerender (sitemap 노출 도시 우선).
 */
export async function generateStaticParams(): Promise<Array<{ city: string }>> {
  if (DESTINATION_STATIC_PRERENDER_LIMIT <= 0) return [];
  if (!isSupabaseConfigured) return [];
  if (shouldSkipPublicDbReadsForResourceSaver()) return [];
  try {
    const publicRows = await listDestinationPublicSnapshotRows(DESTINATION_STATIC_PRERENDER_LIMIT);
    const unique: string[] = [
      ...new Set(
        (publicRows as Array<{ destination: string | null }>)
          .map((r) => r.destination ?? '')
          .filter((d): d is string => d.length > 0),
      ),
    ];
    return unique.slice(0, DESTINATION_STATIC_PRERENDER_LIMIT).map((city) => ({ city: destinationToSlug(city) }));
  } catch {
    return [];
  }
}

const BASE_URL = (
  process.env.NEXT_PUBLIC_BASE_URL ||
  process.env.NEXT_PUBLIC_SITE_URL ||
  'https://www.yeosonam.com'
).replace(/\/+$/, '');
const SOCIAL_IMAGE_URL = `${BASE_URL}/og-image.png`;

function safeDecodePathSegment(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function getRouteParam(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value ?? '').trim();
}

function clampRating(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return Math.min(5, Math.max(1, value));
}

function getPositiveNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
}

function normalizeJsonLdText(value: unknown): string | null {
  const text = getTrimmedString(value);
  return text ? text.replace(/\s+/g, ' ').slice(0, 500) : null;
}

function buildPackageJsonLdDescription(pkg: PillarData['packages'][number]): string {
  const summary = normalizeJsonLdText(pkg.product_summary);
  if (summary) return summary;

  const facts = [
    `${pkg.destination} package`,
    pkg.duration ? `${pkg.duration} day itinerary` : null,
    pkg.nights ? `${pkg.nights} night stay` : null,
    pkg.departure_airport ? `departure from ${pkg.departure_airport}` : null,
    pkg.airline,
  ].filter((fact): fact is string => Boolean(fact));

  return normalizeJsonLdText(`${pkg.title} - ${facts.join(', ')}`) || pkg.title;
}

async function getDestinationSocialImage(city: string): Promise<string> {
  if (!isSupabaseConfigured) return SOCIAL_IMAGE_URL;
  if (shouldSkipPublicDbReadsForResourceSaver()) return SOCIAL_IMAGE_URL;

  try {
    const queryNames = getPublicDestinationQueryNames(city);
    const { data, error } = await supabaseAdmin
      .from('destination_metadata')
      .select('hero_image_url, photo_approved')
      .in('destination', queryNames)
      .eq('photo_approved', true)
      .limit(1);
    if (error) return SOCIAL_IMAGE_URL;

    const row = (data as Pick<DestinationMeta, 'hero_image_url' | 'photo_approved'>[] | null)?.[0] ?? null;
    const candidate = row?.photo_approved ? row.hero_image_url?.trim() : null;
    return candidate && isSafeImageSrc(candidate) ? candidate : SOCIAL_IMAGE_URL;
  } catch {
    return SOCIAL_IMAGE_URL;
  }
}

async function destinationExistsForRoute(city: string): Promise<boolean | null> {
  try {
    const queryNames = getPublicDestinationQueryNames(city);
    const { data, error } = await supabaseAdmin
      .from('active_destinations')
      .select('destination')
      .in('destination', queryNames)
      .limit(1);
    if (error) return null;

    return Array.isArray(data) && data.length > 0;
  } catch {
    return null;
  }
}

async function resolveDestinationRouteParam(value: string): Promise<string | null> {
  const decoded = safeDecodePathSegment(value).trim();
  if (!decoded) return null;
  const decodedCanonical = canonicalizePublicDestination(decoded) ?? decoded;
  if (!isSupabaseConfigured) return decodedCanonical;
  if (shouldSkipPublicDbReadsForResourceSaver()) return decodedCanonical;

  const exact = await destinationExistsForRoute(decodedCanonical);
  if (exact === true) return decodedCanonical;

  try {
    const { data, error } = await supabaseAdmin
      .from('active_destinations')
      .select('destination')
      .limit(2000);
    if (!error) {
      const match = ((data ?? []) as Array<{ destination: string | null }>)
        .map(row => row.destination?.trim() ?? '')
        .find(destination => destination && slugMatchesPublicDestination(destination, decoded));

      const canonicalMatch = canonicalizePublicDestination(match);
      if (canonicalMatch) return canonicalMatch;
    }
  } catch {
    // Continue to package-backed resolution below.
  }

  try {
    const publicRows = await listDestinationPublicSnapshotRows(2_000);
    const packageMatch = (publicRows as Array<{ destination: string | null }>)
      .map(row => row.destination?.trim() ?? '')
      .find(destination => destination && slugMatchesPublicDestination(destination, decoded));

    return canonicalizePublicDestination(packageMatch) || decodedCanonical;
  } catch {
    return decodedCanonical;
  }
}

interface DestinationMeta {
  tagline: string | null;
  hero_tagline: string | null;
  hero_image_url: string | null;
  photo_approved: boolean;
}

interface ClimateData {
  destination: string;
  primary_city: string;
  country: string | null;
  timezone: string;
  utc_offset_minutes: number;
  monthly_normals: unknown;
  fitness_scores: unknown;
  seasonal_signals: unknown;
}

function buildFallbackClimateData(destination: string): ClimateData {
  const monthlyNormals: MonthlyNormal[] = Array.from({ length: 12 }, (_, index) => {
    const month = index + 1;
    return {
      month,
      temp_max: 28,
      temp_min: 20,
      temp_mean: 24,
      rain_days: month >= 6 && month <= 9 ? 9 : 5,
      rain_mm: month >= 6 && month <= 9 ? 140 : 70,
      humidity: 68,
      sunshine_hours: 6,
    };
  });
  const fitnessScores: FitnessScore[] = monthlyNormals.map((normal) => ({
    month: normal.month,
    score: normal.rain_days >= 9 ? 58 : 66,
    label: '\uc900\ube44 \uad8c\uc7a5',
    key_concern: normal.rain_days >= 9 ? '\uc6b0\uae30 \ub300\ube44' : null,
    metrics: { temp: 80, rain: normal.rain_days >= 9 ? 55 : 70, humidity: 76, crowd: 62 },
  }));
  const seasonalSignals: SeasonalSignal[] = monthlyNormals.map((normal) => ({
    month: normal.month,
    naver_idx: 1,
    naver_ratio: 50,
    wiki_idx: 1,
    wiki_views: 0,
    seasonality_index: 1,
    agreement: 0,
    popularity_score: normal.month === 7 || normal.month === 8 ? 70 : 50,
    label: '\uae30\ubcf8 \uc9c4\ub2e8',
    badge: null,
  }));

  return {
    destination,
    primary_city: destination,
    country: null,
    timezone: 'Asia/Seoul',
    utc_offset_minutes: 540,
    monthly_normals: monthlyNormals,
    fitness_scores: fitnessScores,
    seasonal_signals: seasonalSignals,
  };
}

type GalleryPhoto = { src_medium?: string | null; src_large?: string | null };
type PackagePriceDate = { date?: string };

interface PillarData {
  destination: string;
  packageCount: number;
  avgRating: number | null;
  reviewCount: number;
  minPrice: number | null;
  attractions: Array<{
    id: string;
    name: string;
    short_desc: string | null;
    photos: GalleryPhoto[] | null;
    badge_type: string | null;
  }>;
  packages: Array<{
    id: string;
    title: string;
    destination: string;
    duration: number | null;
    nights: number | null;
    price: number | null;
    airline: string | null;
    departure_airport: string | null;
    product_summary: string | null;
    avg_rating: number | null;
    review_count: number;
    price_dates: PackagePriceDate[] | null;
    products?: { display_name?: string | null; internal_code?: string | null; thumbnail_urls?: string[] | null } | null;
  }>;
  relatedPosts: Array<{
    id: string;
    slug: string;
    seo_title: string | null;
    og_image_url: string | null;
    content_type: string | null;
    angle_type: string;
    published_at: string;
  }>;
  pillarPost: {
    blog_html: string;
    seo_title: string;
    seo_description: string | null;
    updated_at: string | null;
    published_at: string;
  } | null;
  siblingCities: string[];
  metadata: DestinationMeta | null;
  climateData: ClimateData | null;
  departureCities: string[];
}

function extractDepartureCity(airport: string): string {
  return airport.split('(')[0].trim();
}

function getTrimmedString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed || null;
}

function getNullableTrimmedString(value: unknown): string | null {
  return value == null ? null : getTrimmedString(value);
}

function getFiniteNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string' || value.trim() === '') return null;

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function getPhotoList(value: unknown): GalleryPhoto[] | null {
  if (!Array.isArray(value)) return null;
  const photos = value.filter((photo): photo is GalleryPhoto => photo != null && typeof photo === 'object');
  return photos.length > 0 ? photos : null;
}

function getPriceDateList(value: unknown): PackagePriceDate[] | null {
  if (!Array.isArray(value)) return null;

  const priceDates = value
    .filter((item): item is Record<string, unknown> => item != null && typeof item === 'object')
    .map((item) => ({ date: getTrimmedString(item.date) ?? undefined }));

  return priceDates.length > 0 ? priceDates : null;
}

function normalizeProductImageSource(value: unknown): PillarData['packages'][number]['products'] {
  if (!value || typeof value !== 'object') return null;
  const record = Array.isArray(value) ? value[0] : value;
  if (!record || typeof record !== 'object') return null;
  const product = record as Record<string, unknown>;
  const thumbnailUrls = Array.isArray(product.thumbnail_urls)
    ? product.thumbnail_urls.filter((url): url is string => typeof url === 'string' && url.trim().length > 0)
    : null;

  return {
    display_name: getNullableTrimmedString(product.display_name),
    internal_code: getNullableTrimmedString(product.internal_code),
    thumbnail_urls: thumbnailUrls && thumbnailUrls.length > 0 ? thumbnailUrls : null,
  };
}

function normalizeAttractionRow(row: unknown): PillarData['attractions'][number] | null {
  if (!row || typeof row !== 'object') return null;

  const record = row as Record<string, unknown>;
  const id = getTrimmedString(record.id);
  const name = getTrimmedString(record.name);
  if (!id || !name) return null;

  return {
    id,
    name,
    short_desc: getNullableTrimmedString(record.short_desc),
    photos: getPhotoList(record.photos),
    badge_type: getNullableTrimmedString(record.badge_type),
  };
}

function normalizePackageRow(row: unknown): PillarData['packages'][number] | null {
  if (!row || typeof row !== 'object') return null;

  const record = row as Record<string, unknown>;
  const id = getTrimmedString(record.id);
  const title = getTrimmedString(record.title);
  const destination = getTrimmedString(record.destination);
  if (!id || !title || !destination) return null;

  return {
    id,
    title,
    destination,
    duration: getFiniteNumber(record.duration),
    nights: getFiniteNumber(record.nights),
    price: getFiniteNumber(record.price),
    airline: getNullableTrimmedString(record.airline),
    departure_airport: getNullableTrimmedString(record.departure_airport),
    product_summary: getNullableTrimmedString(record.product_summary),
    avg_rating: getFiniteNumber(record.avg_rating),
    review_count: Math.max(0, Math.trunc(getFiniteNumber(record.review_count) ?? 0)),
    price_dates: getPriceDateList(record.price_dates),
    products: normalizeProductImageSource(record.products),
  };
}

async function getPillarData(city: string): Promise<PillarData | null> {
  if (!isSupabaseConfigured) return null;
  if (shouldSkipPublicDbReadsForResourceSaver()) {
    return {
      destination: city,
      packageCount: 0,
      avgRating: null,
      reviewCount: 0,
      minPrice: null,
      attractions: [],
      packages: [],
      relatedPosts: [],
      pillarPost: null,
      siblingCities: [],
      metadata: null,
      climateData: null,
      departureCities: [],
    };
  }

  const region = getRegionForCity(city);
  const queryNames = getPublicDestinationQueryNames(city);

  // destination_metadata는 테이블이 없을 수 있으므로 별도 try/catch
  const metadataQuery = supabaseAdmin
    .from('destination_metadata')
    .select('tagline, hero_tagline, hero_image_url, photo_approved')
    .in('destination', queryNames)
    .order('photo_approved', { ascending: false })
    .limit(1);

  const climateQuery = supabaseAdmin
    .from('destination_climate')
    .select('destination, primary_city, country, timezone, utc_offset_minutes, monthly_normals, fitness_scores, seasonal_signals')
    .in('destination', queryNames)
    .limit(1);

  const [
    { data: attractions },
    packages,
    { data: posts },
    { data: pillarRow },
    metadataResult,
    climateResult,
  ] = await Promise.all([
    supabaseAdmin
      .from('attractions')
      .select('id, name, short_desc, photos, badge_type, category, is_active, customer_publishable')
      .in('region', queryNames)
      .eq('is_active', true)
      .eq('customer_publishable', true)
      .order('mention_count', { ascending: false })
      .limit(8),
    listDestinationPublicSnapshotRows(),
    supabaseAdmin
      .from(PUBLIC_BLOG_READ_SOURCE)
      .select('id, slug, seo_title, og_image_url, content_type, angle_type, published_at')
      .in('destination', queryNames)
      .eq('channel', 'naver_blog')
      .eq('status', 'published')
      .not('slug', 'is', null)
      .order('published_at', { ascending: false })
      .limit(8),
    supabaseAdmin
      .from(PUBLIC_BLOG_READ_SOURCE)
      .select('blog_html, seo_title, seo_description, updated_at, published_at')
      .eq('channel', 'naver_blog')
      .eq('status', 'published')
      .eq('content_type', 'pillar')
      .in('pillar_for', queryNames)
      .limit(1),
    metadataQuery,
    climateQuery,
  ]);

  const alivePackageRows = ((packages as unknown[] | null) ?? [])
    .filter((p): p is Record<string, unknown> => Boolean(p && typeof p === 'object' && !Array.isArray(p)))
    .filter((p) => queryNames.includes(String(p.destination ?? '')))
    .filter((p) => hasUpcomingPublicDepartureDate(p));
  const alivePkgs = alivePackageRows
    .map(normalizePackageRow)
    .filter((p): p is PillarData['packages'][number] => p !== null);

  if (alivePkgs.length === 0) return null;

  const packageCount = alivePkgs.length;
  const reviewCount = alivePkgs.reduce((sum, pkg) => sum + Math.max(0, Math.trunc(pkg.review_count ?? 0)), 0);
  const ratingValues = alivePkgs
    .map((pkg) => pkg.avg_rating)
    .filter((rating): rating is number => typeof rating === 'number' && Number.isFinite(rating) && rating > 0);
  const prices = alivePkgs
    .map((pkg) => pkg.price)
    .filter((price): price is number => typeof price === 'number' && Number.isFinite(price) && price > 0);
  const fallbackMinPrice = prices.length > 0 ? Math.min(...prices) : null;

  let siblingCities: string[] = [];
  if (region) {
    siblingCities = [...new Set((packages as Array<Record<string, unknown>>)
      .map(row => String(row.destination ?? '').trim())
      .filter(Boolean))]
      .filter(destination => destination !== city)
      .filter(destination => cityInRegion(destination, region.slug))
      .slice(0, 8);
  }

  const departureCities = [
    ...new Set(
      (alivePackageRows as Array<{ departure_airport?: string | null }>)
        .map(p => p.departure_airport ? extractDepartureCity(p.departure_airport) : null)
        .filter((c): c is string => !!c && c.length > 0)
    ),
  ];

  // destination_metadata: 테이블 없으면 null로 처리
  const metadata: DestinationMeta | null =
    metadataResult.error ? null : ((metadataResult.data as DestinationMeta[] | null)?.[0] ?? null);

  const climateData: ClimateData | null =
    climateResult.error ? null : ((climateResult.data as unknown as ClimateData[] | null)?.[0] ?? null);

  return {
    destination: city,
    packageCount,
    avgRating: ratingValues.length > 0
      ? ratingValues.reduce((sum, rating) => sum + rating, 0) / ratingValues.length
      : null,
    reviewCount,
    minPrice: fallbackMinPrice,
    attractions: ((attractions as unknown[] | null) ?? [])
      .filter((row): row is AttractionData => isCustomerRenderableAttraction(row as AttractionData))
      .map(normalizeAttractionRow)
      .filter((row): row is PillarData['attractions'][number] => row !== null),
    packages: alivePkgs,
    relatedPosts: (posts || []) as unknown as PillarData['relatedPosts'],
    pillarPost: (pillarRow as unknown as PillarData['pillarPost'][] | null)?.[0] || null,
    siblingCities,
    metadata,
    climateData,
    departureCities,
  };
}

export async function generateMetadata({ params }: { params: Promise<{ city?: string | string[] }> }): Promise<Metadata> {
  const { city: rawCity } = await params;
  const city = getRouteParam(rawCity);
  const decoded = (await resolveDestinationRouteParam(city)) ?? '';
  const encodedCity = encodeDestinationPathSegment(decoded);
  const canonical = encodedCity ? `${BASE_URL}/destinations/${encodedCity}` : `${BASE_URL}/destinations`;
  const fallbackTitle = '여행지 가이드';
  const fallbackSocialTitle = `${fallbackTitle} | 여소남`;
  if (!decoded) {
    return {
      title: fallbackTitle,
      alternates: { canonical },
      robots: { index: false, follow: true },
      openGraph: {
        title: fallbackSocialTitle,
        url: canonical,
        type: 'website',
        images: [{ url: SOCIAL_IMAGE_URL, width: 1200, height: 630 }],
      },
      twitter: {
        card: 'summary_large_image',
        title: fallbackSocialTitle,
        images: [SOCIAL_IMAGE_URL],
      },
    };
  }

  const title = `${decoded} 여행 완벽 가이드 | 관광지·일정·비용`;
  const description = `${decoded} 여행의 모든 것 — 운영팀 검증 관광지, 추천 일정, 예상 비용, 계절별 팁까지. 여소남이 정리한 ${decoded} 완벽 가이드.`;

  // Existence is owned by the page render itself. Calling notFound() from
  // generateMetadata performed a second, independent inventory read and could
  // merge the global noindex metadata into a valid 200 page during a transient
  // snapshot mismatch. A genuinely missing destination reaches notFound() in
  // DestinationPillarPage and keeps the expected 404/noindex behavior there.

  const socialImage = await getDestinationSocialImage(decoded);

  return {
    title,
    description,
    alternates: {
      canonical,
      types: {
        'application/rss+xml': [
          { url: `${BASE_URL}/destinations/${encodedCity}/rss.xml`, title: `${decoded} 여행 매거진 RSS` },
        ],
      },
    },
    openGraph: {
      title: `${decoded} 여행 완벽 가이드 | 여소남`,
      description,
      url: canonical,
      type: 'website',
      images: [{ url: socialImage, width: 1200, height: 630 }],
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
      images: [socialImage],
    },
  };
}

async function renderPillarBody(md: string, imageAltPrefix: string): Promise<string> {
  const accented = applyMarkdownAccents(md);
  const { marked } = await import('marked');
  const html = marked.parse(accented) as string;
  const colored = applyHtmlAccents(html);
  return sanitizePublicBlogBodyHtml(colored, { imageAltPrefix });
}

export default async function DestinationPillarPage({ params }: { params: Promise<{ city?: string | string[] }> }) {
  const { city: rawCity } = await params;
  const city = getRouteParam(rawCity);
  const decoded = (await resolveDestinationRouteParam(city)) ?? '';
  if (!decoded) notFound();
  const encodedCity = encodeDestinationPathSegment(decoded);
  let data: PillarData | null = null;
  try {
    data = await getPillarData(decoded);
  } catch (err) {
    console.error('[destinations] getPillarData 예외:', decoded, err instanceof Error ? err.message : String(err));
  }
  if (!data) notFound();

  // 히어로 이미지: 승인된 메타 URL(안전한 경우만) > 관광지 갤러리 medium/large
  const fromMeta =
    data.metadata?.photo_approved &&
    data.metadata?.hero_image_url &&
    isSafeImageSrc(data.metadata.hero_image_url)
      ? data.metadata.hero_image_url.trim()
      : null;
  const fromAttr =
    (data.attractions ?? [])
      .map(a => pickAttractionPhotoUrl(a.photos))
      .find(Boolean) ?? null;
  const fromPackage =
    (data.packages ?? [])
      .flatMap((p) => p.products?.thumbnail_urls ?? [])
      .find((url) => isSafeImageSrc(url)) ?? null;
  const fromPost =
    (data.relatedPosts ?? [])
      .map((post) => post.og_image_url)
      .find((url): url is string => isSafeImageSrc(url)) ?? null;
  const heroImage = fromMeta || fromAttr || fromPackage || fromPost;

  const pillarHtml = data.pillarPost?.blog_html ? await renderPillarBody(data.pillarPost.blog_html, decoded) : null;
  const region = getRegionForCity(decoded);

  // 히어로 타이틀/설명 (destination_metadata 우선)
  const heroTitle = data.metadata?.tagline || `${decoded} 여행 가이드`;
  const heroDesc =
    data.metadata?.hero_tagline ||
    (pillarHtml && data.pillarPost?.seo_description
      ? data.pillarPost.seo_description
      : `여소남 운영팀이 직접 검증한 ${decoded} 여행의 핵심 정보`);

  // 출발지가 1개면 필터 탭 의미 없음
  const destinationRating = clampRating(data.avgRating);
  const destinationReviewCount = getPositiveNumber(data.reviewCount);

  const showDepartureTabs = data.departureCities.length >= 2;
  const climateCardData = data.climateData ?? buildFallbackClimateData(decoded);

  // 출발월 분포 (climate 카드용)
  const departureDist: Record<number, number> = {};
  data.packages.forEach(p => {
    (p.price_dates || []).forEach(d => {
      if (d.date) {
        const m = new Date(d.date).getMonth() + 1;
        departureDist[m] = (departureDist[m] || 0) + 1;
      }
    });
  });

  return (
    <>
      {/* JSON-LD: TouristDestination + BreadcrumbList */}
      <script
        suppressHydrationWarning
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: serializeJsonLdForScript({
            '@context': 'https://schema.org',
            '@graph': [
              {
                '@type': 'TouristDestination',
                name: decoded,
                description: data.pillarPost?.seo_description || `${decoded} 여행 완벽 가이드`,
                url: `${BASE_URL}/destinations/${encodedCity}`,
                ...(heroImage ? { image: heroImage } : {}),
                ...(destinationRating && destinationReviewCount
                  ? {
                      aggregateRating: {
                        '@type': 'AggregateRating',
                        ratingValue: destinationRating.toFixed(2),
                        reviewCount: destinationReviewCount,
                      },
                    }
                  : {}),
                includesAttraction: data.attractions.slice(0, 8).map(a => ({
                  '@type': 'TouristAttraction',
                  name: a.name,
                })),
              },
              {
                '@type': 'BreadcrumbList',
                itemListElement: [
                  { '@type': 'ListItem', position: 1, name: '홈', item: BASE_URL },
                  { '@type': 'ListItem', position: 2, name: '여행지', item: `${BASE_URL}/destinations` },
                  ...(region
                    ? [{ '@type': 'ListItem', position: 3, name: region.label, item: `${BASE_URL}/destinations/region/${region.slug}` }]
                    : []),
                  {
                    '@type': 'ListItem',
                    position: region ? 4 : 3,
                    name: decoded,
                    item: `${BASE_URL}/destinations/${encodedCity}`,
                  },
                ],
              },
              ...(data.packages.length > 0
                ? [
                    {
                      '@type': 'ItemList',
                      name: `${decoded} 여행 상품`,
                      itemListElement: data.packages.slice(0, 10).map((p, i) => {
                        const packageRating = clampRating(p.avg_rating);
                        const packageReviewCount = getPositiveNumber(p.review_count);
                        const packagePrice = getPositiveNumber(p.price);
                        return {
                          '@type': 'ListItem',
                          position: i + 1,
                          item: {
                            '@type': 'Product',
                            name: p.title,
                            description: buildPackageJsonLdDescription(p),
                            url: `${BASE_URL}/packages/${encodeURIComponent(p.id)}`,
                            ...(packageRating && packageReviewCount
                              ? {
                                  aggregateRating: {
                                    '@type': 'AggregateRating',
                                    ratingValue: packageRating.toFixed(2),
                                    reviewCount: packageReviewCount,
                                  },
                                }
                              : {}),
                            ...(packagePrice ? { offers: { '@type': 'Offer', price: packagePrice, priceCurrency: 'KRW' } } : {}),
                          },
                        };
                      }),
                    },
                  ]
                : []),
            ],
          }),
        }}
      />

      <GlobalNav />

      <main className="min-h-screen bg-white">
        {/* ── Hero ──────────────────────────────────────────────────────── */}
        <section
          className="relative min-h-[420px] md:min-h-[540px] overflow-hidden"
          style={!heroImage ? { background: 'linear-gradient(135deg, #1e3a5f 0%, #3182F6 100%)' } : undefined}
        >
          {/* 배경 이미지 */}
          {heroImage && (
            <div className="absolute inset-0">
              <SafeCoverImg
                src={heroImage}
                alt={`${decoded} 여행 대표 이미지`}
                className="w-full h-full object-cover scale-105 origin-center"
                fetchPriority="high"
                loading="eager"
                fallback={<div className="w-full h-full bg-gradient-to-br from-[#1e3a5f] to-brand" aria-hidden />}
              />
              <div className="absolute inset-0 bg-gradient-to-t from-slate-900/95 via-slate-900/65 to-slate-900/25" />
            </div>
          )}
          {!heroImage && (
            <div className="absolute inset-0 bg-gradient-to-t from-black/40 via-transparent to-transparent" />
          )}

          <div className="relative mx-auto max-w-6xl px-4 py-14 md:py-24 text-white">
            {/* 브레드크럼 */}
            <nav className="text-[13px] md:text-sm text-white/60 mb-5">
              <Link href="/" className="hover:text-white/90 transition">홈</Link>
              <span className="mx-2 text-white/30">/</span>
              <Link href="/destinations" className="hover:text-white/90 transition">여행지</Link>
              {region && (
                <>
                  <span className="mx-2 text-white/30">/</span>
                  <Link href={getRegionUrl(region.slug)} className="hover:text-white/90 transition">{region.label}</Link>
                </>
              )}
              <span className="mx-2 text-white/30">/</span>
              <span className="text-white/90">{decoded}</span>
            </nav>

            {/* 메인 타이틀 */}
            <h1 className="text-[38px] md:text-[68px] font-black tracking-tight leading-[1.05] drop-shadow-lg break-keep">
              {heroTitle}
            </h1>
            <p className="mt-4 text-base md:text-xl text-white/85 max-w-2xl leading-relaxed drop-shadow break-keep">
              {heroDesc}
            </p>

            {/* 메타 뱃지 */}
            <div className="mt-6 md:mt-8 flex flex-wrap gap-2 text-[13px] md:text-sm">
              <span className="px-3.5 py-1.5 bg-white/15 backdrop-blur-sm rounded-full border border-white/20">
                🧳 {data.packageCount}개 상품
              </span>
              {data.attractions.length > 0 && (
                <span className="px-3.5 py-1.5 bg-white/15 backdrop-blur-sm rounded-full border border-white/20">
                  🗺️ {data.attractions.length}곳 관광지
                </span>
              )}
              {data.minPrice && (
                <span className="px-3.5 py-1.5 bg-amber-400/25 backdrop-blur-sm rounded-full border border-amber-300/40 text-amber-100 font-bold">
                  {Math.round(data.minPrice / 10000).toLocaleString()}만원부터
                </span>
              )}
              {data.avgRating && data.reviewCount > 0 && (
                <span className="px-3.5 py-1.5 bg-white/15 backdrop-blur-sm rounded-full border border-white/20">
                  ⭐ {data.avgRating.toFixed(1)} ({data.reviewCount}개 후기)
                </span>
              )}
            </div>

            {/* CTA 버튼 */}
            <div className="mt-8 md:mt-10">
              <div className="flex flex-col sm:flex-row gap-3">
                <a
                  href="#packages"
                  className="inline-flex justify-center items-center px-7 py-3.5 bg-white text-slate-900 font-bold text-base md:text-lg rounded-full hover:bg-slate-100 transition shadow-lg"
                >
                  상품 보기
                </a>
                <TrackedKakaoLink
                  source="destination_city_hero"
                  destination={decoded}
                  className="inline-flex justify-center items-center gap-2 px-7 py-3.5 bg-[#FEE500] text-[#3C1E1E] font-bold text-base md:text-lg rounded-full hover:bg-[#FEE500]/90 transition shadow-lg"
                >
                  💬 카카오톡 상담
                </TrackedKakaoLink>
              </div>

              {/* Trust Bar — 동적 출발지 */}
              <div className="mt-5 flex flex-wrap items-center gap-x-5 gap-y-1.5 text-[13px] text-white/75 font-medium">
                <span className="flex items-center gap-1">✓ 노팁·노옵션</span>
                <span className="flex items-center gap-1">✓ 운영팀 직접 검증</span>
                <span className="flex items-center gap-1">✓ 전 상품 직항</span>
                {data.departureCities.map(c => (
                  <span key={c} className="flex items-center gap-1">✓ {c} 출발</span>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* ── 형제 도시 탭바 (sticky) ────────────────────────────────────── */}
        {region && data.siblingCities.length > 0 && (
          <div className="border-b border-slate-100 bg-white/95 backdrop-blur-sm sticky top-14 md:top-16 z-30">
            <div className="max-w-6xl mx-auto px-4 md:px-6 py-3.5 md:py-4 flex gap-2 overflow-x-auto scrollbar-hide">
              <span
                className="flex-shrink-0 text-sm md:text-base font-bold bg-slate-900 text-white px-4 py-2 rounded-lg"
                aria-current="page"
              >
                {decoded}
              </span>
              {data.siblingCities.map(c => (
                <Link
                  key={c}
                  href={getDestinationUrl(c)}
                  className="flex-shrink-0 text-sm md:text-base font-medium bg-white text-slate-600 border border-slate-200 px-4 py-2 rounded-lg hover:border-slate-900 hover:text-slate-900 transition"
                >
                  {c}
                </Link>
              ))}
              <Link
                href={getRegionUrl(region.slug)}
                className="flex-shrink-0 text-sm md:text-base text-brand font-bold px-4 py-2 hover:underline whitespace-nowrap"
              >
                {region.label} 전체 →
              </Link>
            </div>
          </div>
        )}

        <div className="mx-auto max-w-6xl px-4 md:px-6 py-12 md:py-16 space-y-16 md:space-y-20">
          {/* ── 1. 기후 적합도 (실데이터) ──────────────────────────────────── */}
          <TravelFitnessCard
            destination={climateCardData.destination}
            primaryCity={climateCardData.primary_city}
            country={climateCardData.country}
            monthlyNormals={climateCardData.monthly_normals as MonthlyNormal[]}
            fitnessScores={climateCardData.fitness_scores as FitnessScore[]}
            seasonalSignals={climateCardData.seasonal_signals as SeasonalSignal[]}
            representativeMonth={new Date().getMonth() + 1}
            departureDistribution={Object.keys(departureDist).length > 0 ? departureDist : undefined}
          />

          {/* ── 2. Pillar 본문 ────────────────────────────────────────────── */}
          {pillarHtml && (
            <article className="prose prose-xl prose-blog max-w-none prose-p:text-base md:prose-p:text-lg prose-p:leading-relaxed prose-p:text-slate-700">
              <div dangerouslySetInnerHTML={{ __html: pillarHtml }} />
            </article>
          )}

          {/* ── 3. 관광지 그리드 ──────────────────────────────────────────── */}
          {data.attractions.length > 0 && (
            <section>
              <SectionHeader
                title={`${decoded}에서 꼭 봐야 할 필수 코스`}
                subtitle="운영팀 답사 기준 · 최신 정보"
              />
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 md:gap-5">
                {data.attractions.map(a => {
                  const img = pickAttractionPhotoUrl(a.photos);
                  return (
                    <div
                      key={a.id}
                      className="group bg-white border border-slate-100 rounded-2xl overflow-hidden shadow-sm hover:shadow-md transition-shadow"
                    >
                      {img ? (
                        <div className="aspect-[4/3] bg-slate-100 overflow-hidden relative">
                          <img
                            src={img}
                            alt={`${decoded} ${a.name}`}
                            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                            loading="lazy"
                            width={400}
                            height={300}
                          />
                          <div className="absolute inset-0 bg-gradient-to-t from-black/35 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
                        </div>
                      ) : (
                        <div className="aspect-[4/3] bg-gradient-to-br from-brand/10 to-brand/20 flex flex-col items-center justify-center gap-2">
                          <span className="text-5xl font-bold text-brand/40 drop-shadow-sm select-none">
                            {a.name.charAt(0)}
                          </span>
                          <span className="text-[11px] text-brand/40 font-medium">여행 포인트</span>
                        </div>
                      )}
                      <div className="p-4">
                        <h3 className="text-sm md:text-base font-bold text-slate-900 line-clamp-1 tracking-tight">{a.name}</h3>
                        {a.short_desc && (
                          <p className="text-[12px] md:text-[13px] text-slate-500 mt-1.5 line-clamp-2 leading-relaxed">
                            {a.short_desc}
                          </p>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          )}

          {/* ── 4. 엄선 패키지 (출발지 필터 탭 포함) ─────────────────────── */}
          {data.attractions.length === 0 && (
            <section>
              <SectionHeader
                title={`${decoded}에서 꼭 봐야 할 필수 코스`}
                subtitle="상품 일정과 상담 기록을 기준으로 동선을 확인해드려요"
              />
              <div className="grid gap-4 md:grid-cols-3">
                <div className="overflow-hidden rounded-2xl border border-slate-100 bg-white shadow-sm">
                  <div className="aspect-[16/9] overflow-hidden bg-slate-100">
                    {heroImage ? (
                      <SafeCoverImg
                        src={heroImage}
                        alt={`${decoded} 여행 코스`}
                        className="h-full w-full object-cover"
                        fallback={<div className="h-full w-full bg-gradient-to-br from-brand/20 to-slate-100" aria-hidden />}
                      />
                    ) : (
                      <div className="h-full w-full bg-gradient-to-br from-brand/20 to-slate-100" aria-hidden />
                    )}
                  </div>
                  <div className="p-4">
                    <h3 className="text-base font-bold text-slate-950">대표 코스 상담</h3>
                    <p className="mt-1.5 text-sm leading-relaxed text-slate-500">
                      일정과 동행 형태에 맞춰 핵심 코스를 먼저 골라드립니다.
                    </p>
                  </div>
                </div>
                {['이동 동선 체크', '예산별 일정 추천'].map((title) => (
                  <div key={title} className="rounded-2xl border border-slate-100 bg-slate-50 p-5 shadow-sm">
                    <div className="flex h-10 w-10 items-center justify-center rounded-full bg-white text-sm font-black text-brand shadow-sm">
                      {title.charAt(0)}
                    </div>
                    <h3 className="mt-4 text-base font-bold text-slate-950">{title}</h3>
                    <p className="mt-1.5 text-sm leading-relaxed text-slate-500">
                      출발일, 예산, 숙소 선호도에 맞춰 무리 없는 여행 흐름을 맞춥니다.
                    </p>
                  </div>
                ))}
              </div>
            </section>
          )}

          {data.packages.length > 0 && (
            <DestinationPackagesSection
              destination={decoded}
              packages={data.packages as unknown as Array<{ id: string; title: string; destination: string; duration: number | null; nights: number | null; price: number | null; airline: string | null; departure_airport: string | null; avg_rating: number | null; review_count: number; price_dates: Array<{ date?: string }> | null; [key: string]: unknown }>}
              departureCities={showDepartureTabs ? data.departureCities : []}
            />
          )}

          {/* ── 5. 관련 블로그 ────────────────────────────────────────────── */}
          {data.relatedPosts.length > 0 && (
            <section>
              <SectionHeader
                title={`${decoded} 생생한 매거진 & 꿀팁`}
                subtitle="미리 알아두면 좋은 팁과 후기"
              />
              <div className="grid gap-4 md:gap-5 grid-cols-2 md:grid-cols-4">
                {data.relatedPosts.map(p => (
                  <Link
                    key={p.id}
                    href={`/blog/${encodeURIComponent(p.slug)}`}
                    className="group bg-white border border-slate-100 rounded-2xl overflow-hidden shadow-sm hover:shadow-md transition-shadow"
                  >
                    {p.og_image_url ? (
                      <div className="aspect-[16/9] bg-slate-100 overflow-hidden">
                        <img
                          src={p.og_image_url}
                          alt={p.seo_title || ''}
                          className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                          loading="lazy"
                          width={400}
                          height={225}
                        />
                      </div>
                    ) : (
                      <div className="aspect-[16/9] bg-gradient-to-br from-brand-light to-[#F2F4F6] flex items-center justify-center text-3xl">
                        📖
                      </div>
                    )}
                    <div className="p-4">
                      <h3 className="text-sm md:text-base font-bold text-slate-900 line-clamp-2 leading-snug min-h-[2.8em] group-hover:text-brand tracking-tight transition-colors">
                        {p.seo_title || '블로그 가이드'}
                      </h3>
                    </div>
                  </Link>
                ))}
              </div>
            </section>
          )}

          {/* ── 6. 하단 CTA ───────────────────────────────────────────────── */}
          <section className="bg-[#EBF5FF] border border-brand/15 rounded-3xl p-8 md:p-12 text-center overflow-hidden relative">
            <div className="relative z-10 max-w-2xl mx-auto">
              <h3 className="text-2xl md:text-3xl font-black text-slate-900 mb-4 tracking-tight break-keep">
                어떤 상품이 우리한테 맞을지 모르겠다면
              </h3>
              <p className="text-base md:text-lg text-slate-600 mb-8 leading-relaxed break-keep">
                일정·예산·동행인 알려주시면{' '}
                <br className="md:hidden" />
                운영팀이 딱 맞는 패키지 골라드려요
              </p>

              <div className="flex justify-center gap-8 md:gap-14 mb-8 border-y border-brand/10 py-5 max-w-sm mx-auto">
                <div className="text-center">
                  <div className="text-2xl md:text-3xl font-black text-brand">3분</div>
                  <div className="text-[12px] md:text-[13px] font-bold text-slate-500 mt-0.5">평균 응답</div>
                </div>
                <div className="text-center">
                  <div className="text-2xl md:text-3xl font-black text-brand">무료</div>
                  <div className="text-[12px] md:text-[13px] font-bold text-slate-500 mt-0.5">상담 비용</div>
                </div>
                <div className="text-center">
                  <div className="text-2xl md:text-3xl font-black text-brand">10년+</div>
                  <div className="text-[12px] md:text-[13px] font-bold text-slate-500 mt-0.5">운영 경력</div>
                </div>
              </div>

              <TrackedKakaoLink
                source="destination_city_bottom"
                destination={decoded}
                className="inline-flex justify-center items-center gap-2 w-full md:w-auto md:px-14 py-4 bg-brand text-white font-bold text-base md:text-lg rounded-2xl hover:bg-brand-dark transition shadow-lg shadow-brand/25"
              >
                💬 카카오톡으로 무료 상담받기
              </TrackedKakaoLink>
            </div>
          </section>
        </div>
      </main>
    </>
  );
}
