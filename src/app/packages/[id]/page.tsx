import type React from 'react';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { headers } from 'next/headers';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getSupabase, getSupabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';
import DetailClient from './DetailClient';
import UnmatchedActivitiesBeacon from '@/components/customer/UnmatchedActivitiesBeacon';
import ReviewsSection from '@/components/reviews/ReviewsSection';
import RecentViewsDeferred from '@/components/customer/RecentViewsDeferred';
import type { Metadata } from 'next';
import { matchAttractions, normalizeDays, buildAttractionIndex, matchAttractionIndexed } from '@/lib/attraction-matcher';
import type { AttractionData } from '@/lib/attraction-matcher';
import { destinationToIsoSet, extractDestinationTokens } from '@/lib/destination-iso';
import { resolveTermsForPackage, formatCancellationDates, type NoticeBlock } from '@/lib/standard-terms';
import { POSTPROCESS_VERSION, postProcessPackageRow } from '@/lib/package-post-process';
import { pickRepresentativeMonths } from '@/lib/travel-fitness-score';
import { isCustomerVisibleStatus } from '@/lib/visibility-status';
import { resolveDestinationClimate } from '@/lib/destination-climate-lookup';
import { sanitizeCustomerPackageForClient } from '@/lib/customer-package-payload';
import { isUuid } from '@/lib/uuid';
import { resolveLpHeroPhotoUrl } from '@/lib/lp-hero-resolver';
import { formatProductTypeLabel } from '@/lib/product-type-label';
import { shouldSkipPublicDbReadsForResourceSaver } from '@/lib/cron-resource-saver';
import { runOptionalSupabaseQuery, runSupabaseQueryWithTimeout } from '@/lib/supabase-query-guard';
import { getSecret } from '@/lib/secret-registry';

const BASE_URL = (
  process.env.NEXT_PUBLIC_BASE_URL ||
  process.env.NEXT_PUBLIC_SITE_URL ||
  'https://www.yeosonam.com'
).replace(/\/+$/, '');

function getPackageUrl(id: string): string {
  return `${BASE_URL}/packages/${encodeURIComponent(id.trim())}`;
}

function getRouteParam(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value ?? '').trim();
}

async function isInternalRenderProofRequest(): Promise<boolean> {
  const secret = getSecret('REVALIDATE_SECRET') || getSecret('ADMIN_API_TOKEN');
  if (!secret) return false;
  return (await headers()).get('x-yeosonam-render-proof') === secret;
}

function getNonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function getFiniteNumber(value: unknown): number | undefined {
  const normalized = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(normalized) ? normalized : undefined;
}

function waitForPackageDetailRetry(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function getStringList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    : [];
}

function buildPackageSeoTitle(input: {
  title: string;
  productType?: string | null;
  price?: number | null;
  id: string;
}): string {
  const parts = [input.title.trim()];
  const productTypeLabel = formatProductTypeLabel(input.productType);
  if (productTypeLabel) parts.push(productTypeLabel);
  if (Number.isFinite(Number(input.price))) {
    parts.push(`${Number(input.price).toLocaleString('ko-KR')}원~`);
  }
  parts.push(`상품번호 ${input.id.slice(0, 8)}`);
  return parts.filter(Boolean).join(' | ');
}

function buildPackageNoindexMetadata(id: string, canonical: string): Metadata {
  return {
    title: '상품 상세',
    alternates: { canonical },
    robots: { index: false, follow: true },
    openGraph: {
      title: '상품 상세',
      url: canonical,
    },
  };
}

// 2026-05-19 박제 (PR #152 후속 — ISR 활성화 완결):
//   PR #152 (force-dynamic → revalidate=60) 머지 후 production 실측 결과 여전히 MISS 폭주.
//   원인: Next.js 15 dynamic route ([id]) 는 `revalidate` 만으로는 ISR 미활성화.
//     `generateStaticParams` + `dynamicParams = true` 조합이 필수.
//   증거 — 동일 production 측정:
//     - /things-to-do/[region] (generateStaticParams ✅): X-Vercel-Cache: PRERENDER, X-Nextjs-Prerender: 1
//     - /destinations/[city]  (generateStaticParams ❌): MISS, no-store
//     - /packages/[id]        (generateStaticParams ❌): MISS, no-store (PR #152 후에도)
//   해결: 활성 상품 top 50개를 빌드 시 prerender + 나머지는 first-request ISR (dynamicParams=true).
//   invalidation 인프라는 동일: /api/packages/[id]/approve · /api/packages (bulk PATCH/POST)
//     · /api/admin/attractions/[id]/{feedback,aliases} · section-extractors · itinerary-llm-extractor
//     모두 revalidatePath('/packages/{id}') 또는 revalidatePackagePaths() 호출.
// Customer package pages must render from the latest saved package row.
// Static package prerendering made audit results diverge from the real mobile page.
export const dynamic = 'force-dynamic';
export const revalidate = 0;

/**
 * 빌드 시 prerender 대상: 최근 활성 상품 50개. 인기 핫패스를 0ms 응답으로 즉시 처리.
 * 나머지 상품(아카이브·승인대기 등)은 첫 요청 시 ISR 캐시 생성 + 60초 재사용.
 * - 빌드 환경에 supabase 가용 시에만 실행 (CI sandbox 등 가용성 보장 안 되면 빈 배열).
 * - 50개 선정 기준: status in (active, approved) + updated_at desc — 최근 운영 상품 우선.
 */
const ENABLE_UNMATCHED_QUEUE_ON_VIEW = process.env.ENABLE_UNMATCHED_QUEUE_ON_VIEW === '1';

function getPackageReadClient(): SupabaseClient | null {
  return (getSupabaseAdmin() ?? getSupabase()) as SupabaseClient | null;
}

// 2026-05-16 박제 (시즈오카 사고 결정타): 존재하지 않는 컬럼 `min_people`, `thumbnail_urls`
//   가 DETAIL_FIELDS 에 포함되어 PostgREST select 가 일부 fields(destination/itinerary_data)
//   를 silent 누락. pkg.destination=undefined → matchAttractions destination 매칭 fail →
//   matchedNames=0 + idsFromItinerary=0 → relevantAttractions 빈 배열 → 모든 attraction 카드
//   미표출. min_participants 가 정식 컬럼이고 min_people 은 미존재. thumbnail_urls 도 미존재.
const DETAIL_FIELDS = `
  id, title, destination, duration, nights, trip_style, price, airline, departure_airport, departure_days,
  min_participants, ticketing_deadline, product_type,
  price_tiers, price_dates, inclusions, excludes, surcharges, optional_tours,
  product_highlights, customer_notes, notices_parsed, itinerary_data,
  display_title, hero_tagline, product_summary, is_airtel,
  land_operator_id, audit_status, status,
  catalog_id,
  products(internal_code, display_name, departure_region)
`;

/**
 * 고객 상세 노출 게이트 — SSOT 는 `src/lib/visibility-status.ts`.
 * 2026-05-16 박제: 어휘 불일치(예: 'available' 누락)로 사일런트 미노출 사고 차단.
 */

// SEO: 동적 메타데이터
export async function generateMetadata({
  params,
}: {
  params: Promise<{ id?: string | string[] }>;
}): Promise<Metadata> {
  const { id: rawId } = await params;
  const id = getRouteParam(rawId);
  const canonical = getPackageUrl(id);
  if (!id || !isUuid(id)) {
    notFound();
  }
  if (!isSupabaseConfigured) {
    return buildPackageNoindexMetadata(id, canonical);
  }
  if (shouldSkipPublicDbReadsForResourceSaver()) {
    return buildPackageNoindexMetadata(id, canonical);
  }
  const sb = getPackageReadClient();
  if (!sb) {
    return { title: '?곹뭹 ?곸꽭', alternates: { canonical }, robots: { index: false, follow: true } };
  }
  let data: {
    title?: string | null;
    destination?: string | null;
    price?: number | null;
    product_type?: string | null;
    product_summary?: string | null;
    status?: string | null;
    audit_status?: string | null;
  } | null = null;
  try {
    let result = await runSupabaseQueryWithTimeout(
      sb
        .from('travel_packages')
        .select('title, destination, price, product_type, product_summary, status, audit_status')
        .eq('id', id)
        .maybeSingle(),
      { label: 'package.metadata.primary', timeoutMs: 1800 },
    ).catch(() => ({ data: null, error: null }));
    if (!result.data) {
      await waitForPackageDetailRetry(300);
      result = await runSupabaseQueryWithTimeout(
        sb
          .from('travel_packages')
          .select('title, destination, price, product_type, product_summary, status, audit_status')
          .eq('id', id)
          .maybeSingle(),
        { label: 'package.metadata.primary.retry1', timeoutMs: 3500 },
      ).catch(() => ({ data: null, error: null }));
    }
    if (!result.data) {
      await waitForPackageDetailRetry(700);
      result = await runSupabaseQueryWithTimeout(
        sb
          .from('travel_packages')
          .select('title, destination, price, product_type, product_summary, status, audit_status')
          .eq('id', id)
          .maybeSingle(),
        { label: 'package.metadata.primary.retry2', timeoutMs: 6000 },
      ).catch(() => ({ data: null, error: null }));
    }
    if (result.error) {
      return buildPackageNoindexMetadata(id, canonical);
    }
    data = result.data;
  } catch {
    return buildPackageNoindexMetadata(id, canonical);
  }

  // 비공개 상품(REVIEW_NEEDED/draft/blocked 등) 의 메타데이터는 SEO 노출 금지
  if (!data) notFound();
  const status = (data as { status?: string }).status;
  const auditStatus = (data as { audit_status?: string }).audit_status;
  const allowInternalProof = await isInternalRenderProofRequest();
  if (!allowInternalProof && (auditStatus === 'blocked' || !isCustomerVisibleStatus(status))) {
    notFound();
  }
  const title = String(data.title || data.destination || '여소남 패키지 여행');
  const seoTitle = buildPackageSeoTitle({
    title,
    productType: data.product_type,
    price: data.price,
    id,
  });
  const destination = String(data.destination || '패키지');
  const description = data.product_summary || `${destination} ${title} - 여소남 패키지 여행`;

  return {
    title: { absolute: `${seoTitle} | 여소남` },
    description,
    openGraph: {
      title: seoTitle,
      description,
      url: canonical,
    },
    alternates: { canonical },
  };
}

export default async function PackageDetailPage({
  params,
}: {
  params: Promise<{ id?: string | string[] }>;
}) {
  const { id: rawId } = await params;
  const id = getRouteParam(rawId);
  if (!id || !isUuid(id)) notFound();
  const sbOrNull = getPackageReadClient();
  if (!sbOrNull) notFound();
  const sb = sbOrNull;
  const skipNonCriticalDbReads = shouldSkipPublicDbReadsForResourceSaver();
  const allowInternalProof = await isInternalRenderProofRequest();

  // ACL: 고객 노출 페이지에서는 내부필드(net_price/selling_price/margin_rate) SELECT 금지.
  // 어드민 UI는 /api/packages GET으로 별도 조회하며 거기서는 원가 정보가 유지된다.
  let pkgResult = await runSupabaseQueryWithTimeout(
    sb.from('travel_packages')
      .select(DETAIL_FIELDS)
      .eq('id', id)
      .maybeSingle(),
    { label: 'package.detail.primary', timeoutMs: 6000 },
  ).catch(() => ({ data: null, error: new Error('package detail query timed out') }));

  if (!pkgResult.data) {
    await waitForPackageDetailRetry(500);
    pkgResult = await runSupabaseQueryWithTimeout(
      sb.from('travel_packages')
        .select(DETAIL_FIELDS)
        .eq('id', id)
        .maybeSingle(),
      { label: 'package.detail.primary.retry1', timeoutMs: 10000 },
    ).catch(() => ({ data: null, error: new Error('package detail retry1 timed out') }));
  }

  if (!pkgResult.data) {
    await waitForPackageDetailRetry(1_000);
    pkgResult = await runSupabaseQueryWithTimeout(
      sb.from('travel_packages')
        .select(DETAIL_FIELDS)
        .eq('id', id)
        .maybeSingle(),
      { label: 'package.detail.primary.retry2', timeoutMs: 15000 },
    ).catch(() => ({ data: null, error: new Error('package detail retry2 timed out') }));
  }

  const pkg = pkgResult.data;

  // 존재하지 않는 패키지 → 404
  if (!pkg && pkgResult.error) {
    console.error('[packages/detail] package detail lookup unavailable', {
      id,
      message: pkgResult.error instanceof Error ? pkgResult.error.message : String(pkgResult.error),
    });
    throw new Error('PACKAGE_DETAIL_LOOKUP_UNAVAILABLE');
  }

  if (!pkg) {
    notFound();
  }

  // 감사 차단 상품은 고객 상세도 404 처리 (감사 게이트 이중 가드)
  if ('audit_status' in pkg && pkg.audit_status === 'blocked') {
    if (!allowInternalProof) notFound();
  }

  // status 게이트 — REVIEW_NEEDED/draft/expired/archived 등은 고객 노출 차단
  const pkgStatus = 'status' in pkg ? pkg.status : undefined;
  if (!allowInternalProof && !isCustomerVisibleStatus(pkgStatus)) {
    notFound();
  }

  // ── 2-단계 Fetch 전략 (Next.js 2MB 캐시 한계 + 성능 최적화) ─────────────────
  // Step A: 매칭 전용 경량 fetch (name, country, region, aliases만) — 수백 KB
  // Step B: 매칭된 N개에 한해 사진/설명 상세 fetch — 수십 KB
  //
  // 기존: select('*') + limit(3000) + photos 포함 → 2MB 초과 → fetch cache 실패 + 30s timeout
  // 2026-05-15 박제: category + mrt_gid 추가 — attraction-matcher 가 accommodation/mrt_product
  //   카테고리를 매칭 후보에서 제외하는데 SELECT 에 누락돼 있어 호텔/투어가 잘못 매칭되던 사고.
  //   mrt_gid 는 동일 fuzzy 점수일 때 MRT canonical 우선 선택용.
  let matchQuery = sb.from('attractions')
    .select('name, country, region, aliases, category, mrt_gid');

  if (pkg && pkg.destination) {
    const destTokens = pkg.destination.split(/[\/,·&]/).map((t: string) => t.trim()).filter(Boolean);
    const regionClauses = destTokens.map((t: string) => `region.ilike.%${t}%`).join(',');
    // 2026-05-15 박제: ISO 정규화 후 한글 country 사라짐 (VN/JP/CN/TH 등). 매핑 SSOT 사용.
    const destIsoCountries = destinationToIsoSet(pkg.destination);
    const isoCountryClauses = [...destIsoCountries].map(c => `country.eq.${c}`).join(',');
    // 한글 country fallback — 옛 데이터(trigger 적용 이전) 호환
    const koreanCountryList = '중국,베트남,일본,필리핀,태국,말레이시아,싱가포르,대만,몽골,라오스,인도네시아,홍콩,마카오';
    const koreanCountryClauses = koreanCountryList.split(',').map(c => `country.eq.${c}`).join(',');
    const clauses = [regionClauses, isoCountryClauses, koreanCountryClauses].filter(Boolean).join(',');
    matchQuery = matchQuery.or(clauses);
  }

  // C6 박제 (2026-05-15): JP=793 + TW=160 + 인접 region 매칭이 1200 한계에 근접 → 2000 으로 확장.
  //   light SELECT (id 제외 9컬럼) 이라 payload 부담 작음. Step B 의 relevantAttractions 가 진짜 페이로드.
  const matchResult = skipNonCriticalDbReads
    ? { data: [] }
    : await runOptionalSupabaseQuery(
        matchQuery.limit(600),
        { data: [] },
        { label: 'package.attractions.match-light', timeoutMs: 1200 },
      );
  const lightAttractions = (matchResult.data ?? []) as unknown as AttractionData[];

  // 매칭된 관광지 이름 목록만 추출 (서버사이드 1회)
  const matchedNames = new Set<string>();
  if (pkg?.itinerary_data && lightAttractions.length) {
    const index = buildAttractionIndex(lightAttractions, pkg.destination);
    const daysData = normalizeDays<{ day: number; schedule?: { activity: string; type?: string }[] }>(pkg.itinerary_data);
    for (const day of daysData) {
      for (const item of (day.schedule || [])) {
        if (item.type === 'flight' || item.type === 'hotel' || item.type === 'shopping') continue;
        const single = matchAttractionIndexed(item.activity, index);
        if (single) matchedNames.add(single.name);
        if (!single && /[,，]/.test(item.activity)) {
          const parts = item.activity.replace(/^▶/, '').split(/[,，]\s*/).map(s => s.trim()).filter(s => s.length >= 2);
          for (const part of parts) {
            const m = matchAttractionIndexed(part, index);
            if (m) matchedNames.add(m.name);
          }
        }
      }
    }
  }

  // Step B: 매칭된 관광지만 photos/short_desc 등 상세 가져오기 (일반적으로 10개 미만)
  // 2026-05-16 박제 (시즈오카 사고): name 기반 매칭만 의존하면 destination/region 정규화 실패 시
  //   사진/설명 전부 누락 → 카드 미표출. itinerary_data.days[].schedule[].attraction_ids 에
  //   이미 박힌 ID 를 SSOT 로 합쳐 detail fetch (매칭 우회 fallback).
  let relevantAttractions: AttractionData[] = [];
  const idsFromItinerary = new Set<string>();
  if (pkg?.itinerary_data) {
    const daysRaw = (pkg.itinerary_data as { days?: Array<{ schedule?: Array<{ attraction_ids?: string[] }> }> } | null)?.days ?? [];
    for (const d of daysRaw) {
      for (const s of (d.schedule ?? [])) {
        for (const aid of (s.attraction_ids ?? [])) {
          if (typeof aid === 'string' && aid.length > 0) idsFromItinerary.add(aid);
        }
      }
    }
  }
  if (idsFromItinerary.size > 0) {
    type DetailRow = { id: string; name: string; short_desc: string | null; long_desc: string | null; photos: unknown; country: string | null; region: string | null; badge_type: string | null; emoji: string | null; aliases: unknown; category: string | null };
    const SELECT = 'id, name, short_desc, long_desc, photos, country, region, badge_type, emoji, aliases, category';
    const merged = new Map<string, DetailRow>();
    // 2026-05-16 박제: .or() 합성으로 id + name 동시 매칭 시 한글 name 의 PostgREST OR 절
    //   파싱 실패 (공백/따옴표 escape 비표준) → 0건 반환되어 모든 attraction 카드 미표출.
    //   두 번 fetch + 합집합으로 단순화.
    if (idsFromItinerary.size > 0 && !skipNonCriticalDbReads) {
      const { data } = await runOptionalSupabaseQuery(
        sb.from('attractions').select(SELECT).in('id', Array.from(idsFromItinerary)),
        { data: [] },
        { label: 'package.attractions.detail-by-id', timeoutMs: 1200 },
      );
      for (const a of ((data ?? []) as DetailRow[])) merged.set(a.id, a);
    }
    if (false && matchedNames.size > 0 && !skipNonCriticalDbReads) {
      const { data } = await runOptionalSupabaseQuery(
        sb.from('attractions').select(SELECT).in('name', Array.from(matchedNames)),
        { data: [] },
        { label: 'package.attractions.detail-by-name', timeoutMs: 1200 },
      );
      for (const a of ((data ?? []) as DetailRow[])) if (!merged.has(a.id)) merged.set(a.id, a);
    }
    relevantAttractions = (Array.from(merged.values()) as unknown) as AttractionData[];
  }
  // 기존 fallback 호환 — 매칭 0건 시 전체 대신 경량 목록 전달 (payload 과다 방지)
  const attrResult = { data: relevantAttractions };

  const parserVersion = String((pkg as { parser_version?: string } | null)?.parser_version ?? '');
  const writeTimeProcessed = parserVersion.includes(POSTPROCESS_VERSION);
  const pkgBase = pkg
    ? {
        ...pkg,
        products: Array.isArray(pkg.products) ? pkg.products[0] ?? null : pkg.products,
      }
    : null;
  let productPriceRows: Array<{ target_date: string | null; adult_selling_price: number | null; note: string | null }> = [];
  const priceProductCode = pkgBase?.products?.internal_code ?? (pkgBase as { internal_code?: string | null } | null)?.internal_code ?? null;
  if (priceProductCode && !skipNonCriticalDbReads) {
    const { data: priceRows } = await runOptionalSupabaseQuery(
      sb
        .from('product_prices')
        .select('target_date, adult_selling_price, note')
        .eq('product_id', priceProductCode)
        .order('target_date', { ascending: true })
        .order('adult_selling_price', { ascending: true, nullsFirst: false })
        .limit(300),
      { data: [] },
      { label: 'package.product-prices', timeoutMs: 1200 },
    );
    productPriceRows = (priceRows ?? []) as typeof productPriceRows;
  }
  const normalizedPkg = pkgBase
    ? (() => {
        const processed = writeTimeProcessed ? pkgBase : postProcessPackageRow(pkgBase);
        return { ...processed, product_prices: productPriceRows };
      })()
    : null;

  // 관련 블로그 글 조회 (1) — 이 상품을 홍보하는 글 (product_id 직접 매칭)
  let relatedBlogPosts: { slug: string; seo_title: string | null; og_image_url: string | null; angle_type: string }[] = [];
  // 관련 블로그 글 조회 (2) — 같은 destination의 정보성 글 (여행 준비물/날씨/가이드 등)
  let destinationBlogPosts: { slug: string; seo_title: string | null; og_image_url: string | null; angle_type: string; seo_description: string | null }[] = [];
  if (pkg?.destination && !skipNonCriticalDbReads) {
    const [productScoped, destinationScoped] = await Promise.all([
      sb.from('content_creatives')
        .select('slug, seo_title, og_image_url, angle_type')
        .eq('status', 'published')
        .eq('channel', 'naver_blog')
        .not('slug', 'is', null)
        .eq('product_id', id)
        .order('published_at', { ascending: false })
        .limit(3),
      sb.from('content_creatives')
        .select('slug, seo_title, og_image_url, angle_type, seo_description, travel_packages!inner(destination)')
        .eq('status', 'published')
        .eq('channel', 'naver_blog')
        .not('slug', 'is', null)
        .eq('travel_packages.destination', pkg.destination)
        .neq('product_id', id)
        .order('published_at', { ascending: false })
        .limit(8),
    ]);

    relatedBlogPosts = (productScoped.data ?? []) as typeof relatedBlogPosts;

    // 중복 slug 제거 + 정보성 글만 + 상위 4개
    // ERR-LB-DAD-editor-section@2026-04-20:
    //   "여소남 에디터의 가이드" 섹션은 destination이 같은 다른 상품의 콘텐츠를 노출하는데,
    //   angle_type='value' (가성비/가격형) 글은 다른 상품의 가격(73만원 등)을 우리 상품(110만)
    //   페이지에서 광고하는 꼴이 되어 부적절. 정보성(가이드/날씨/준비물) 글만 노출.
    const FORBIDDEN_ANGLES = ['value', 'price', 'sale', 'deal', 'discount', 'promotion', 'comparison'];
    const PRICE_PATTERN = /\d+만원|\d+,\d{3},?\d*\s*원|\₩\s*\d|\d+만\s*~|특가|최저가/;
    const seenSlugs = new Set(relatedBlogPosts.map(p => p.slug));
    destinationBlogPosts = ((destinationScoped.data ?? []) as typeof destinationBlogPosts)
      .filter(p => !seenSlugs.has(p.slug))
      .filter(p => !FORBIDDEN_ANGLES.includes(p.angle_type))
      .filter(p => !PRICE_PATTERN.test(p.seo_title || ''))
      .filter(p => !PRICE_PATTERN.test(p.seo_description || ''))
      .slice(0, 4);
  }

  // 미매칭 관광지 수집 (서버사이드 1회만) — 경량 목록으로 매칭 시도
  const unmatchedItems: { activity: string; package_id: string; package_title: string; day_number: number; country?: string }[] = [];
  if (pkg?.itinerary_data && lightAttractions.length) {
    const skipPattern = /^(호텔|리조트)?\s*(조식|투숙|체크|휴식|이동|출발|도착|귀환|수속|공항|탑승|기내|자유시간|석식|중식|면세점|쇼핑센터|가이드|미팅)/;
    const daysData = normalizeDays<{ day: number; schedule?: { activity: string; type?: string }[] }>(pkg.itinerary_data);
    for (const day of daysData) {
      (day.schedule || []).forEach((item) => {
        if (skipPattern.test(item.activity)) return;
        if (item.type === 'flight' || item.type === 'hotel' || item.type === 'shopping') return;
        if (/공항|출발|도착|이동|수속|탑승|귀환|체크인|체크아웃|투숙|휴식|미팅|조식|중식|석식/.test(item.activity)) return;
        const attr = matchAttractions(item.activity, lightAttractions, pkg.destination)[0] || null;
        if (!attr) unmatchedItems.push({ activity: item.activity, package_id: id, package_title: pkg.title, day_number: day.day, country: pkg.destination });
      });
    }
  }

  // 서버에서 매칭된 관광지(photos/short_desc 포함)만 전달
  const attractionsForClient = (attrResult.data ?? []) as React.ComponentProps<typeof DetailClient>['initialAttractions'];

  // ── destination_climate 조인 (여행 적합도 + 시차 카드용) ────────────────
  // 2026-05-16 박제: `eq('destination', …)` 완전일치 매칭으로 "계림/양삭" 같은
  //   alias 미시드 destination 에서 날씨·시차·짐싸기 3종이 통째 사라지던 사고.
  //   정규화 lookup 으로 폴백 (`src/lib/destination-climate-lookup.ts`).
  let climateData: Awaited<ReturnType<typeof resolveDestinationClimate>> = null;
  let representativeMonth = new Date().getMonth() + 1;
  let departureDistribution: Record<number, number> = {};
  if (pkg?.destination && !skipNonCriticalDbReads) {
    climateData = await resolveDestinationClimate(pkg.destination);

    // 출발일 평균월 산출 — price_dates 우선, 없으면 price_tiers.departure_dates
    const dates: string[] = [];
    const pd = (pkg as { price_dates?: { date: string }[] }).price_dates ?? [];
    for (const d of pd) if (d?.date) dates.push(d.date);
    const pt = (pkg as { price_tiers?: { departure_dates?: string[] }[] }).price_tiers ?? [];
    for (const t of pt) for (const d of (t.departure_dates ?? [])) if (d) dates.push(d);
    if (dates.length > 0) {
      const r = pickRepresentativeMonths(dates);
      representativeMonth = r.primary;
      departureDistribution = r.distribution;
    }
  }

  // ── package_scores 조인 (모바일 추천 카드용) ───────────────────────
  // 활성 정책 1건만. group_size>=2 일 때만 의미 있음 (단일 그룹은 비교 불가)
  // ── package_scores 출발일별 row N개 fetch (v3 옵션 A) ──────────────
  type ScoreRow = {
    departure_date: string | null;
    rank_in_group: number;
    group_size: number;
    effective_price: number;
    list_price: number | null;
    shopping_count: number | null;
    hotel_avg_grade: number | null;
    meal_count: number | null;
    free_option_count: number | null;
    is_direct_flight: boolean | null;
    breakdown: {
      list_price?: number;
      why?: string[];
      deductions?: {
        hotel_premium?: number;
        flight_premium?: number;
        shopping_avoidance?: number;
        free_options?: number;
        cold_start_boost?: number;
      };
    } | null;
  };
  let scoreRows: ScoreRow[] = [];
  if (!skipNonCriticalDbReads) {
    const { data: sc } = await runOptionalSupabaseQuery(
      sb
        .from('package_scores')
        .select('departure_date, rank_in_group, group_size, effective_price, list_price, shopping_count, hotel_avg_grade, meal_count, free_option_count, is_direct_flight, breakdown')
        .eq('package_id', id)
        .order('departure_date', { ascending: true })
        .limit(36),
      { data: [] },
      { label: 'package.score-rows', timeoutMs: 1200 },
    );
    if (sc) scoreRows = sc as ScoreRow[];
  }

  // ── pairwise rivals: 같은 날 그룹의 다른 패키지 1~2개 ──────────────
  // 추천 카드에서 "다른 옵션과 비교" UI로 사용
  type Rival = {
    package_id: string; title: string; departure_date: string | null;
    list_price: number; effective_price: number; rank_in_group: number;
    hotel_avg_grade: number | null; shopping_count: number | null;
    free_option_count: number | null; is_direct_flight: boolean | null;
    breakdown: ScoreRow['breakdown'];
  };
  const rivalsByDate: Record<string, Rival[]> = {};
  if (!skipNonCriticalDbReads) {
    const groupKeys = scoreRows
      .filter(r => r.group_size >= 2 && r.departure_date)
      .map(r => `${pkg?.destination ?? ''}|${r.departure_date}`);
    const uniqueGroupKeys = Array.from(new Set(groupKeys)).slice(0, 20);
    if (uniqueGroupKeys.length > 0) {
      const { data } = await runOptionalSupabaseQuery(
        sb
          .from('package_scores')
          .select(`departure_date, rank_in_group, list_price, effective_price, hotel_avg_grade, shopping_count, free_option_count, is_direct_flight, breakdown, package_id, group_key, travel_packages!inner(title)`)
          .in('group_key', uniqueGroupKeys)
          .neq('package_id', id)
          .limit(80),
        { data: [] },
        { label: 'package.score-rivals', timeoutMs: 1200 },
      );
      for (const r of data ?? []) {
        const row = r as unknown as { departure_date: string; travel_packages: { title: string } | { title: string }[] } & Rival;
        const t = Array.isArray(row.travel_packages) ? row.travel_packages[0]?.title : row.travel_packages?.title;
        if (!row.departure_date) continue;
        if (!rivalsByDate[row.departure_date]) rivalsByDate[row.departure_date] = [];
        rivalsByDate[row.departure_date].push({ ...row, title: t ?? '' });
      }
      // 각 날짜별 rank 순 정렬, 최대 2개
      for (const date of Object.keys(rivalsByDate)) {
        rivalsByDate[date].sort((a, b) => a.rank_in_group - b.rank_in_group);
        rivalsByDate[date] = rivalsByDate[date].slice(0, 2);
      }
    }
  }

  // ── 사회적 증거 카운트 (Cialdini Principle 4) ───────────────────────
  // destination 단위 30일 인기도 + 오늘 조회수 + 다음 출발일 예약 현황
  let socialProof: {
    bookings: number;
    interest: number;
    todayViews: number;
    nextDepartureBookings: number;
    nextDepartureDate: string | null;
  } = { bookings: 0, interest: 0, todayViews: 0, nextDepartureBookings: 0, nextDepartureDate: null };

  if (pkg?.destination && !skipNonCriticalDbReads) {
    const since30d = new Date(Date.now() - 30 * 86400000).toISOString();
    const since24h = new Date(Date.now() - 86400000).toISOString();
    const todayStr = new Date().toISOString().slice(0, 10);

    // 2026-05-18 박제 (ERR-social-proof-eq-mismatch):
    //   기존 raw `.eq('destination', pkg.destination)` 는 "다낭" 패키지가 "다낭/호이안" 패키지를 못 봄.
    //   tokenize 후 첫 토큰(메인 도시) ilike 매칭으로 회복 + raw eq 도 합집합으로 fallback 보존.
    const destPkgIdsSet = new Set<string>();
    const destTokens = extractDestinationTokens(pkg.destination);
    const mainDestToken = destTokens[0] ?? null;
    const destLookups = await Promise.all([
      runOptionalSupabaseQuery(
        sb.from('travel_packages').select('id').eq('destination', pkg.destination),
        { data: [] as Array<{ id: string }> },
        { label: 'package.social.same-destination-exact', timeoutMs: 1000 },
      ),
      mainDestToken
        ? runOptionalSupabaseQuery(
            sb.from('travel_packages').select('id').ilike('destination', `%${mainDestToken}%`),
            { data: [] as Array<{ id: string }> },
            { label: 'package.social.same-destination-token', timeoutMs: 1000 },
          )
        : Promise.resolve({ data: [] as Array<{ id: string }> }),
    ]);
    for (const q of destLookups) {
      for (const row of (q.data ?? []) as Array<{ id: string }>) {
        if (row?.id) destPkgIdsSet.add(row.id);
      }
    }
    const destPkgIds = Array.from(destPkgIdsSet);

    // 가장 가까운 미래 출발일 탐색 (price_dates 또는 price_tiers에서)
    const pd = (pkg as { price_dates?: { date: string }[] }).price_dates ?? [];
    const pt = (pkg as { price_tiers?: { departure_dates?: string[] }[] }).price_tiers ?? [];
    const allDates: string[] = [];
    for (const d of pd) if (d?.date) allDates.push(d.date);
    for (const t of pt) for (const d of (t.departure_dates ?? [])) if (d) allDates.push(d);
    const nextDate = allDates.filter(d => d >= todayStr).sort()[0] ?? null;

    const [bk, sg, tv, nb] = await Promise.all([
      // 30일 예약 (destination 단위)
      runOptionalSupabaseQuery(
        sb.from('bookings').select('id', { count: 'exact', head: true })
          .in('status', ['confirmed', 'waiting_balance', 'fully_paid'])
          .gte('created_at', since30d)
          .in('package_id', destPkgIds),
        { count: 0 },
        { label: 'package.social.bookings', timeoutMs: 1000 },
      ),
      // 30일 조회 신호
      runOptionalSupabaseQuery(
        sb.from('package_score_signals').select('id', { count: 'exact', head: true })
          .gte('created_at', since30d)
          .in('package_id', destPkgIds),
        { count: 0 },
        { label: 'package.social.signals-30d', timeoutMs: 1000 },
      ),
      // 오늘 이 상품 조회수 (24h)
      runOptionalSupabaseQuery(
        sb.from('package_score_signals').select('id', { count: 'exact', head: true })
          .gte('created_at', since24h)
          .eq('package_id', id),
        { count: 0 },
        { label: 'package.social.signals-24h', timeoutMs: 1000 },
      ),
      // 다음 출발일 현재 예약자 수
      nextDate
        ? runOptionalSupabaseQuery(
            sb.from('bookings').select('id', { count: 'exact', head: true })
              .eq('package_id', id)
              .eq('departure_date', nextDate)
              .in('status', ['confirmed', 'deposit_paid', 'waiting_balance', 'fully_paid']),
            { count: 0 },
            { label: 'package.social.next-departure-bookings', timeoutMs: 1000 },
          )
        : Promise.resolve({ count: 0 }),
    ]);

    socialProof = {
      bookings: bk.count ?? 0,
      interest: sg.count ?? 0,
      todayViews: tv.count ?? 0,
      nextDepartureBookings: (nb as { count: number | null }).count ?? 0,
      nextDepartureDate: nextDate,
    };
  }

  // 4-level 약관 해소 (mobile surface) — 출발일 가장 이른 날짜 기준으로 날짜 병기
  let initialNotices: NoticeBlock[] = [];
  if (normalizedPkg && !skipNonCriticalDbReads) {
    const rawPriceDates = (normalizedPkg as { price_dates?: { date: string }[] }).price_dates ?? [];
    const earliestDate = rawPriceDates.map(d => d.date).filter(Boolean).sort()[0] ?? null;
    const resolved = await resolveTermsForPackage(
      {
        id: normalizedPkg.id,
        product_type: normalizedPkg.product_type,
        land_operator_id: normalizedPkg.land_operator_id,
        notices_parsed: normalizedPkg.notices_parsed,
      },
      'mobile',
    );
    initialNotices = formatCancellationDates(resolved, earliestDate);
  }

  // 2026-05-19 박제 (P2-A / A3): 같은 catalog_id 다른 패키지 fetch — 모바일 상세 페이지 selector 용
  //   "단수이 vs 베이토우 vs 우라이" 같은 분기 선택 UI. 사용자가 현재 패키지에서 즉시 다른 옵션으로 이동 가능.
  type CatalogSibling = { id: string; title: string; display_title: string | null; destination: string | null; product_highlights: string[] | null };
  let catalogSiblings: CatalogSibling[] = [];
  const currentCatalogId = (pkg as { catalog_id?: string | null }).catalog_id;
  if (currentCatalogId && !skipNonCriticalDbReads) {
    const { data: siblings } = await runOptionalSupabaseQuery(
      sb
        .from('travel_packages')
        .select('id, title, display_title, destination, product_highlights, status, audit_status')
        .eq('catalog_id', currentCatalogId)
        .neq('id', id)
        .order('created_at', { ascending: true }),
      { data: [] },
      { label: 'package.catalog.siblings', timeoutMs: 1200 },
    );
    catalogSiblings = ((siblings ?? []) as Array<{ id: string; title: string; display_title: string | null; destination: string | null; product_highlights: string[] | null; status?: string; audit_status?: string }>)
      .filter(s => s.audit_status !== 'blocked' && isCustomerVisibleStatus(s.status))
      .map(({ id: sid, title, display_title, destination, product_highlights }) => ({
        id: sid, title, display_title, destination, product_highlights,
      }));
  }

  // JSON-LD Product + BreadcrumbList
  const pkgJsonLd = normalizedPkg ? (() => {
    const highlights = getStringList((normalizedPkg as { product_highlights?: unknown }).product_highlights);
    const priceDates = Array.isArray((normalizedPkg as { price_dates?: unknown }).price_dates)
      ? (normalizedPkg as { price_dates: unknown[] }).price_dates
      : [];

    return {
      '@context': 'https://schema.org',
      '@type': 'Product',
      name: getNonEmptyString(normalizedPkg.title) ?? '여소남 패키지 여행',
      description:
        getNonEmptyString(normalizedPkg.product_summary) ??
        `${getNonEmptyString(normalizedPkg.destination) ?? '패키지'} 여행 패키지`,
      category: getNonEmptyString(normalizedPkg.destination) ?? '패키지',
      offers: {
        '@type': 'AggregateOffer',
        priceCurrency: 'KRW',
        lowPrice: getFiniteNumber((normalizedPkg as { price_min?: unknown }).price_min),
        highPrice: getFiniteNumber((normalizedPkg as { price_max?: unknown }).price_max),
        offerCount: priceDates.length > 0 ? priceDates.length : undefined,
        availability: 'https://schema.org/InStock',
        url: getPackageUrl(id),
        seller: { '@type': 'Organization', name: '여소남' },
      },
      ...(highlights.length > 0
        ? { award: highlights.slice(0, 3).map((name) => ({ '@type': 'Award', name })) }
        : {}),
    };
  })() : null;
  let lpHeroImageUrl: string | null = null;
  if (normalizedPkg && !skipNonCriticalDbReads) {
    try {
      lpHeroImageUrl = await resolveLpHeroPhotoUrl(sb, normalizedPkg as { destination?: string | null; itinerary_data?: unknown });
    } catch {
      lpHeroImageUrl = null;
    }
  }
  const clientPackage = normalizedPkg
    ? ({
        ...sanitizeCustomerPackageForClient(normalizedPkg),
        lp_hero_image_url: lpHeroImageUrl,
      } as React.ComponentProps<typeof DetailClient>['initialPackage'])
    : null;

  return (
    <>
      <UnmatchedActivitiesBeacon items={unmatchedItems} />
      {normalizedPkg && (
        <div className="sr-only">
          <h1>{normalizedPkg.display_title || normalizedPkg.title || '여소남 패키지 여행 상품 상세'}</h1>
          <p>
            {normalizedPkg.destination ? `${normalizedPkg.destination} 여행 ` : ''}
            일정, 가격, 포함 사항, 취소 규정, 예약 문의 정보를 확인할 수 있는 여소남 패키지 상품 상세 페이지입니다.
          </p>
          <Link href="/group-inquiry">예약 문의</Link>
          <Link href="/packages">다른 패키지 보기</Link>
        </div>
      )}
      {pkgJsonLd && (
        <script
          type="application/ld+json"
          suppressHydrationWarning
          dangerouslySetInnerHTML={{ __html: JSON.stringify(pkgJsonLd) }}
        />
      )}
      <DetailClient
        initialPackage={clientPackage}
        initialAttractions={attractionsForClient}
        packageId={id}
        relatedBlogPosts={relatedBlogPosts}
        destinationBlogPosts={destinationBlogPosts}
        initialNotices={initialNotices}
        climateData={climateData}
        representativeMonth={representativeMonth}
        departureDistribution={departureDistribution}
        scoreRows={scoreRows}
        rivalsByDate={rivalsByDate}
        socialProof={socialProof}
        catalogSiblings={catalogSiblings}
      />
      <div className="pb-64 md:pb-12">
        {/* 고객 후기 (approved 리뷰 있을 때만 렌더) */}
        <div className="mx-auto max-w-4xl px-4">
          <ReviewsSection packageId={id} limit={5} />
        </div>
        {/* 최근 본 상품 / 유사 상품 */}
        <RecentViewsDeferred currentPackageId={id} />
      </div>
    </>
  );
}
