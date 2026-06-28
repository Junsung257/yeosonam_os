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

function decodeCustomerHtmlEntities(value: string | null | undefined): string {
  let text = String(value ?? '');
  for (let pass = 0; pass < 3; pass += 1) {
    const before = text;
    text = text
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#039;|&apos;/g, "'")
      .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => {
        const code = Number.parseInt(hex, 16);
        return code >= 0xd800 && code <= 0xdfff ? String.fromCharCode(code) : String.fromCodePoint(code);
      })
      .replace(/&#(\d+);/g, (_, decimal: string) => {
        const code = Number.parseInt(decimal, 10);
        return code >= 0xd800 && code <= 0xdfff ? String.fromCharCode(code) : String.fromCodePoint(code);
      });
    if (text === before) break;
  }
  return text.trim();
}

function buildPackageSeoTitle(input: {
  title: string;
  productType?: string | null;
  price?: number | null;
  id: string;
}): string {
  const parts = [decodeCustomerHtmlEntities(input.title)];
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
    title: '?곹뭹 ?곸꽭',
    alternates: { canonical },
    robots: { index: false, follow: true },
    openGraph: {
      title: '?곹뭹 ?곸꽭',
      url: canonical,
    },
  };
}

// 2026-05-19 諛뺤젣 (PR #152 ?꾩냽 ??ISR ?쒖꽦???꾧껐):
//   PR #152 (force-dynamic ??revalidate=60) 癒몄? ??production ?ㅼ륫 寃곌낵 ?ъ쟾??MISS ??＜.
//   ?먯씤: Next.js 15 dynamic route ([id]) ??`revalidate` 留뚯쑝濡쒕뒗 ISR 誘명솢?깊솕.
//     `generateStaticParams` + `dynamicParams = true` 議고빀???꾩닔.
//   利앷굅 ???숈씪 production 痢≪젙:
//     - /things-to-do/[region] (generateStaticParams ??: X-Vercel-Cache: PRERENDER, X-Nextjs-Prerender: 1
//     - /destinations/[city]  (generateStaticParams ??: MISS, no-store
//     - /packages/[id]        (generateStaticParams ??: MISS, no-store (PR #152 ?꾩뿉??
//   ?닿껐: ?쒖꽦 ?곹뭹 top 50媛쒕? 鍮뚮뱶 ??prerender + ?섎㉧吏??first-request ISR (dynamicParams=true).
//   invalidation ?명봽?쇰뒗 ?숈씪: /api/packages/[id]/approve 쨌 /api/packages (bulk PATCH/POST)
//     쨌 /api/admin/attractions/[id]/{feedback,aliases} 쨌 section-extractors 쨌 itinerary-llm-extractor
//     紐⑤몢 revalidatePath('/packages/{id}') ?먮뒗 revalidatePackagePaths() ?몄텧.
// Customer package pages must render from the latest saved package row.
// Static package prerendering made audit results diverge from the real mobile page.
export const dynamic = 'force-dynamic';
export const revalidate = 0;

/**
 * 鍮뚮뱶 ??prerender ??? 理쒓렐 ?쒖꽦 ?곹뭹 50媛? ?멸린 ?ロ뙣?ㅻ? 0ms ?묐떟?쇰줈 利됱떆 泥섎━.
 * ?섎㉧吏 ?곹뭹(?꾩뭅?대툕쨌?뱀씤?湲???? 泥??붿껌 ??ISR 罹먯떆 ?앹꽦 + 60珥??ъ궗??
 * - 鍮뚮뱶 ?섍꼍??supabase 媛???쒖뿉留??ㅽ뻾 (CI sandbox ??媛?⑹꽦 蹂댁옣 ???섎㈃ 鍮?諛곗뿴).
 * - 50媛??좎젙 湲곗?: status in (active, approved) + updated_at desc ??理쒓렐 ?댁쁺 ?곹뭹 ?곗꽑.
 */
const ENABLE_UNMATCHED_QUEUE_ON_VIEW = process.env.ENABLE_UNMATCHED_QUEUE_ON_VIEW === '1';

function getPackageReadClient(): SupabaseClient | null {
  return (getSupabaseAdmin() ?? getSupabase()) as SupabaseClient | null;
}

// 2026-05-16 諛뺤젣 (?쒖쫰?ㅼ뭅 ?ш퀬 寃곗젙?): 議댁옱?섏? ?딅뒗 而щ읆 `min_people`, `thumbnail_urls`
//   媛 DETAIL_FIELDS ???ы븿?섏뼱 PostgREST select 媛 ?쇰? fields(destination/itinerary_data)
//   瑜?silent ?꾨씫. pkg.destination=undefined ??matchAttractions destination 留ㅼ묶 fail ??//   matchedNames=0 + idsFromItinerary=0 ??relevantAttractions 鍮?諛곗뿴 ??紐⑤뱺 attraction 移대뱶
//   誘명몴異? min_participants 媛 ?뺤떇 而щ읆?닿퀬 min_people ? 誘몄〈?? thumbnail_urls ??誘몄〈??
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
 * 怨좉컼 ?곸꽭 ?몄텧 寃뚯씠????SSOT ??`src/lib/visibility-status.ts`.
 * 2026-05-16 諛뺤젣: ?댄쐶 遺덉씪移??? 'available' ?꾨씫)濡??ъ씪?고듃 誘몃끂異??ш퀬 李⑤떒.
 */

// SEO: dynamic metadata
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
    return { title: '?怨밸? ?怨멸쉭', alternates: { canonical }, robots: { index: false, follow: true } };
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

  // 鍮꾧났媛??곹뭹(REVIEW_NEEDED/draft/blocked ?? ??硫뷀??곗씠?곕뒗 SEO ?몄텧 湲덉?
  if (!data) notFound();
  const status = (data as { status?: string }).status;
  const auditStatus = (data as { audit_status?: string }).audit_status;
  const allowInternalProof = await isInternalRenderProofRequest();
  if (!allowInternalProof && (auditStatus === 'blocked' || !isCustomerVisibleStatus(status))) {
    notFound();
  }
  const title = decodeCustomerHtmlEntities(String(data.title || data.destination || '?ъ냼???⑦궎吏 ?ы뻾'));
  const seoTitle = buildPackageSeoTitle({
    title,
    productType: data.product_type,
    price: data.price,
    id,
  });
  const destination = decodeCustomerHtmlEntities(String(data.destination || '패키지'));
  const description = decodeCustomerHtmlEntities(data.product_summary || `${destination} ${title} - 여소남 패키지 여행`);

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

  // ACL: 怨좉컼 ?몄텧 ?섏씠吏?먯꽌???대??꾨뱶(net_price/selling_price/margin_rate) SELECT 湲덉?.
  // ?대뱶誘?UI??/api/packages GET?쇰줈 蹂꾨룄 議고쉶?섎ŉ 嫄곌린?쒕뒗 ?먭? ?뺣낫媛 ?좎??쒕떎.
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

  // 議댁옱?섏? ?딅뒗 ?⑦궎吏 ??404
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

  // 媛먯궗 李⑤떒 ?곹뭹? 怨좉컼 ?곸꽭??404 泥섎━ (媛먯궗 寃뚯씠???댁쨷 媛??
  if ('audit_status' in pkg && pkg.audit_status === 'blocked') {
    if (!allowInternalProof) notFound();
  }

  // status 寃뚯씠????REVIEW_NEEDED/draft/expired/archived ?깆? 怨좉컼 ?몄텧 李⑤떒
  const pkgStatus = 'status' in pkg ? pkg.status : undefined;
  if (!allowInternalProof && !isCustomerVisibleStatus(pkgStatus)) {
    notFound();
  }

  // ?? 2-?④퀎 Fetch ?꾨왂 (Next.js 2MB 罹먯떆 ?쒓퀎 + ?깅뒫 理쒖쟻?? ?????????????????
  // Step A: 留ㅼ묶 ?꾩슜 寃쎈웾 fetch (name, country, region, aliases留? ???섎갚 KB
  // Step B: 留ㅼ묶??N媛쒖뿉 ?쒗빐 ?ъ쭊/?ㅻ챸 ?곸꽭 fetch ???섏떗 KB
  //
  // 湲곗〈: select('*') + limit(3000) + photos ?ы븿 ??2MB 珥덇낵 ??fetch cache ?ㅽ뙣 + 30s timeout
  // 2026-05-15 諛뺤젣: category + mrt_gid 異붽? ??attraction-matcher 媛 accommodation/mrt_product
  //   移댄뀒怨좊━瑜?留ㅼ묶 ?꾨낫?먯꽌 ?쒖쇅?섎뒗??SELECT ???꾨씫???덉뼱 ?명뀛/?ъ뼱媛 ?섎せ 留ㅼ묶?섎뜕 ?ш퀬.
  //   mrt_gid ???숈씪 fuzzy ?먯닔????MRT canonical ?곗꽑 ?좏깮??
  let matchQuery = sb.from('attractions')
    .select('name, country, region, aliases, category, mrt_gid');

  if (pkg && pkg.destination) {
    const destTokens = pkg.destination.split(/[\/,·&]/).map((t: string) => t.trim()).filter(Boolean);
    const regionClauses = destTokens.map((t: string) => 'region.ilike.%' + t + '%').join(',');
    // 2026-05-15 諛뺤젣: ISO ?뺢퇋?????쒓? country ?щ씪吏?(VN/JP/CN/TH ??. 留ㅽ븨 SSOT ?ъ슜.
    const destIsoCountries = destinationToIsoSet(pkg.destination);
    const isoCountryClauses = [...destIsoCountries].map(c => 'country.eq.' + c).join(',');
    // ?쒓? country fallback ?????곗씠??trigger ?곸슜 ?댁쟾) ?명솚
    const koreanCountryList = '중국,베트남,일본,필리핀,태국,말레이시아,싱가포르,대만,몽골,라오스,인도네시아,마카오';
    const koreanCountryClauses = koreanCountryList.split(',').map(c => 'country.eq.' + c).join(',');
    const clauses = [regionClauses, isoCountryClauses, koreanCountryClauses].filter(Boolean).join(',');
    matchQuery = matchQuery.or(clauses);
  }

  // C6 諛뺤젣 (2026-05-15): JP=793 + TW=160 + ?몄젒 region 留ㅼ묶??1200 ?쒓퀎??洹쇱젒 ??2000 ?쇰줈 ?뺤옣.
  //   light SELECT (id ?쒖쇅 9而щ읆) ?대씪 payload 遺???묒쓬. Step B ??relevantAttractions 媛 吏꾩쭨 ?섏씠濡쒕뱶.
  const matchResult = skipNonCriticalDbReads
    ? { data: [] }
    : await runOptionalSupabaseQuery(
        matchQuery.limit(600),
        { data: [] },
        { label: 'package.attractions.match-light', timeoutMs: 1200 },
      );
  const lightAttractions = (matchResult.data ?? []) as unknown as AttractionData[];

  // 留ㅼ묶??愿愿묒? ?대쫫 紐⑸줉留?異붿텧 (?쒕쾭?ъ씠??1??
  const matchedNames = new Set<string>();
  if (pkg?.itinerary_data && lightAttractions.length) {
    const index = buildAttractionIndex(lightAttractions, pkg.destination);
    const daysData = normalizeDays<{ day: number; schedule?: { activity: string; type?: string }[] }>(pkg.itinerary_data);
    for (const day of daysData) {
      for (const item of (day.schedule || [])) {
        if (item.type === 'flight' || item.type === 'hotel' || item.type === 'shopping') continue;
        const single = matchAttractionIndexed(item.activity, index);
        if (single) matchedNames.add(single.name);
        if (!single && /[,>→·]/.test(item.activity)) {
          const parts = item.activity.replace(/^[-–—>→·,\s]+/, '').split(/[,>→·]\s*/).map(s => s.trim()).filter(s => s.length >= 2);
          for (const part of parts) {
            const m = matchAttractionIndexed(part, index);
            if (m) matchedNames.add(m.name);
          }
        }
      }
    }
  }

  // Step B: 留ㅼ묶??愿愿묒?留?photos/short_desc ???곸꽭 媛?몄삤湲?(?쇰컲?곸쑝濡?10媛?誘몃쭔)
  // 2026-05-16 諛뺤젣 (?쒖쫰?ㅼ뭅 ?ш퀬): name 湲곕컲 留ㅼ묶留??섏〈?섎㈃ destination/region ?뺢퇋???ㅽ뙣 ??  //   ?ъ쭊/?ㅻ챸 ?꾨? ?꾨씫 ??移대뱶 誘명몴異? itinerary_data.days[].schedule[].attraction_ids ??  //   ?대? 諛뺥엺 ID 瑜?SSOT 濡??⑹퀜 detail fetch (留ㅼ묶 ?고쉶 fallback).
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
    // 2026-05-16 諛뺤젣: .or() ?⑹꽦?쇰줈 id + name ?숈떆 留ㅼ묶 ???쒓? name ??PostgREST OR ??    //   ?뚯떛 ?ㅽ뙣 (怨듬갚/?곗샂??escape 鍮꾪몴以) ??0嫄?諛섑솚?섏뼱 紐⑤뱺 attraction 移대뱶 誘명몴異?
    //   ??踰?fetch + ?⑹쭛?⑹쑝濡??⑥닚??
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
  // 湲곗〈 fallback ?명솚 ??留ㅼ묶 0嫄????꾩껜 ???寃쎈웾 紐⑸줉 ?꾨떖 (payload 怨쇰떎 諛⑹?)
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

  // 愿??釉붾줈洹?湲 議고쉶 (1) ?????곹뭹???띾낫?섎뒗 湲 (product_id 吏곸젒 留ㅼ묶)
  let relatedBlogPosts: { slug: string; seo_title: string | null; og_image_url: string | null; angle_type: string }[] = [];
  // 愿??釉붾줈洹?湲 議고쉶 (2) ??媛숈? destination???뺣낫??湲 (?ы뻾 以鍮꾨Ъ/?좎뵪/媛?대뱶 ??
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

    // 以묐났 slug ?쒓굅 + ?뺣낫??湲留?+ ?곸쐞 4媛?    // ERR-LB-DAD-editor-section@2026-04-20:
    //   "?ъ냼???먮뵒?곗쓽 媛?대뱶" ?뱀뀡? destination??媛숈? ?ㅻⅨ ?곹뭹??肄섑뀗痢좊? ?몄텧?섎뒗??
    //   angle_type='value' (媛?깅퉬/媛寃⑺삎) 湲? ?ㅻⅨ ?곹뭹??媛寃?73留뚯썝 ?????곕━ ?곹뭹(110留?
    //   ?섏씠吏?먯꽌 愿묎퀬?섎뒗 瑗댁씠 ?섏뼱 遺?곸젅. ?뺣낫??媛?대뱶/?좎뵪/以鍮꾨Ъ) 湲留??몄텧.
    const FORBIDDEN_ANGLES = ['value', 'price', 'sale', 'deal', 'discount', 'promotion', 'comparison'];
    const PRICE_PATTERN = /\d+\s*만원|\d{1,3}(,\d{3})+\s*원|\d+\s*만\s*~|특가|최저가/;
    const seenSlugs = new Set(relatedBlogPosts.map(p => p.slug));
    destinationBlogPosts = ((destinationScoped.data ?? []) as typeof destinationBlogPosts)
      .filter(p => !seenSlugs.has(p.slug))
      .filter(p => !FORBIDDEN_ANGLES.includes(p.angle_type))
      .filter(p => !PRICE_PATTERN.test(p.seo_title || ''))
      .filter(p => !PRICE_PATTERN.test(p.seo_description || ''))
      .slice(0, 4);
  }

  // 誘몃ℓ移?愿愿묒? ?섏쭛 (?쒕쾭?ъ씠??1?뚮쭔) ??寃쎈웾 紐⑸줉?쇰줈 留ㅼ묶 ?쒕룄
  const unmatchedItems: { activity: string; package_id: string; package_title: string; day_number: number; country?: string }[] = [];
  if (pkg?.itinerary_data && lightAttractions.length) {
    const skipPattern = /^(호텔|리조트)?\s*(조식|중식|석식|식사|체크|휴식|이동|출발|도착|공항|탑승|기내|자유시간|미팅|가이드)/;
    const daysData = normalizeDays<{ day: number; schedule?: { activity: string; type?: string }[] }>(pkg.itinerary_data);
    for (const day of daysData) {
      (day.schedule || []).forEach((item) => {
        if (skipPattern.test(item.activity)) return;
        if (item.type === 'flight' || item.type === 'hotel' || item.type === 'shopping') return;
        if (/공항|출발|도착|이동|휴식|탑승|기내|체크인|체크아웃|식사|미팅|조식|중식|석식/.test(item.activity)) return;
        const attr = matchAttractions(item.activity, lightAttractions, pkg.destination)[0] || null;
        if (!attr) unmatchedItems.push({ activity: item.activity, package_id: id, package_title: pkg.title, day_number: day.day, country: pkg.destination });
      });
    }
  }

  // ?쒕쾭?먯꽌 留ㅼ묶??愿愿묒?(photos/short_desc ?ы븿)留??꾨떖
  const attractionsForClient = (attrResult.data ?? []) as React.ComponentProps<typeof DetailClient>['initialAttractions'];

  // Destination climate lookup
  let climateData: Awaited<ReturnType<typeof resolveDestinationClimate>> = null;
  let representativeMonth = new Date().getMonth() + 1;
  let departureDistribution: Record<number, number> = {};
  if (pkg?.destination && !skipNonCriticalDbReads) {
    climateData = await resolveDestinationClimate(pkg.destination);

    // 異쒕컻???됯퇏???곗텧 ??price_dates ?곗꽑, ?놁쑝硫?price_tiers.departure_dates
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

  // ?? package_scores 議곗씤 (紐⑤컮??異붿쿇 移대뱶?? ???????????????????????
  // ?쒖꽦 ?뺤콉 1嫄대쭔. group_size>=2 ???뚮쭔 ?섎? ?덉쓬 (?⑥씪 洹몃９? 鍮꾧탳 遺덇?)
  // ?? package_scores 異쒕컻?쇰퀎 row N媛?fetch (v3 ?듭뀡 A) ??????????????
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

  // ?? pairwise rivals: 媛숈? ??洹몃９???ㅻⅨ ?⑦궎吏 1~2媛???????????????
  // 異붿쿇 移대뱶?먯꽌 "?ㅻⅨ ?듭뀡怨?鍮꾧탳" UI濡??ъ슜
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
      .map(r => (pkg?.destination ?? '') + '|' + r.departure_date);
    const uniqueGroupKeys = Array.from(new Set(groupKeys)).slice(0, 20);
    if (uniqueGroupKeys.length > 0) {
      const { data } = await runOptionalSupabaseQuery(
        sb
          .from('package_scores')
          .select('departure_date, rank_in_group, list_price, effective_price, hotel_avg_grade, shopping_count, free_option_count, is_direct_flight, breakdown, package_id, group_key, travel_packages!inner(title)')
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
        rivalsByDate[row.departure_date].push({ ...row, title: decodeCustomerHtmlEntities(t ?? '') });
      }
      for (const date of Object.keys(rivalsByDate)) {
        rivalsByDate[date].sort((a, b) => a.rank_in_group - b.rank_in_group);
        rivalsByDate[date] = rivalsByDate[date].slice(0, 2);
      }
    }
  }

  // ?? ?ы쉶??利앷굅 移댁슫??(Cialdini Principle 4) ???????????????????????
  // destination ?⑥쐞 30???멸린??+ ?ㅻ뒛 議고쉶??+ ?ㅼ쓬 異쒕컻???덉빟 ?꾪솴
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

    // 2026-05-18 諛뺤젣 (ERR-social-proof-eq-mismatch):
    //   湲곗〈 raw `.eq('destination', pkg.destination)` ??"?ㅻ궘" ?⑦궎吏媛 "?ㅻ궘/?몄씠?? ?⑦궎吏瑜?紐?遊?
    //   tokenize ??泥??좏겙(硫붿씤 ?꾩떆) ilike 留ㅼ묶?쇰줈 ?뚮났 + raw eq ???⑹쭛?⑹쑝濡?fallback 蹂댁〈.
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
            sb.from('travel_packages').select('id').ilike('destination', '%' + mainDestToken + '%'),
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

    // 媛??媛源뚯슫 誘몃옒 異쒕컻???먯깋 (price_dates ?먮뒗 price_tiers?먯꽌)
    const pd = (pkg as { price_dates?: { date: string }[] }).price_dates ?? [];
    const pt = (pkg as { price_tiers?: { departure_dates?: string[] }[] }).price_tiers ?? [];
    const allDates: string[] = [];
    for (const d of pd) if (d?.date) allDates.push(d.date);
    for (const t of pt) for (const d of (t.departure_dates ?? [])) if (d) allDates.push(d);
    const nextDate = allDates.filter(d => d >= todayStr).sort()[0] ?? null;

    const [bk, sg, tv, nb] = await Promise.all([
      // 30???덉빟 (destination ?⑥쐞)
      runOptionalSupabaseQuery(
        sb.from('bookings').select('id', { count: 'exact', head: true })
          .in('status', ['confirmed', 'waiting_balance', 'fully_paid'])
          .gte('created_at', since30d)
          .in('package_id', destPkgIds),
        { count: 0 },
        { label: 'package.social.bookings', timeoutMs: 1000 },
      ),
      // 30??議고쉶 ?좏샇
      runOptionalSupabaseQuery(
        sb.from('package_score_signals').select('id', { count: 'exact', head: true })
          .gte('created_at', since30d)
          .in('package_id', destPkgIds),
        { count: 0 },
        { label: 'package.social.signals-30d', timeoutMs: 1000 },
      ),
      // ?ㅻ뒛 ???곹뭹 議고쉶??(24h)
      runOptionalSupabaseQuery(
        sb.from('package_score_signals').select('id', { count: 'exact', head: true })
          .gte('created_at', since24h)
          .eq('package_id', id),
        { count: 0 },
        { label: 'package.social.signals-24h', timeoutMs: 1000 },
      ),
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

  // 4-level ?쎄? ?댁냼 (mobile surface) ??異쒕컻??媛???대Ⅸ ?좎쭨 湲곗??쇰줈 ?좎쭨 蹂묎린
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

  // 2026-05-19 諛뺤젣 (P2-A / A3): 媛숈? catalog_id ?ㅻⅨ ?⑦궎吏 fetch ??紐⑤컮???곸꽭 ?섏씠吏 selector ??  //   "?⑥닔??vs 踰좎씠?좎슦 vs ?곕씪?? 媛숈? 遺꾧린 ?좏깮 UI. ?ъ슜?먭? ?꾩옱 ?⑦궎吏?먯꽌 利됱떆 ?ㅻⅨ ?듭뀡?쇰줈 ?대룞 媛??
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
        id: sid,
        title: decodeCustomerHtmlEntities(title),
        display_title: display_title ? decodeCustomerHtmlEntities(display_title) : null,
        destination: destination ? decodeCustomerHtmlEntities(destination) : null,
        product_highlights: product_highlights?.map(item => decodeCustomerHtmlEntities(item)) ?? null,
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
      name: decodeCustomerHtmlEntities(getNonEmptyString(normalizedPkg.title) ?? '여소남 패키지 여행'),
      description:
        decodeCustomerHtmlEntities(getNonEmptyString(normalizedPkg.product_summary)) ||
        decodeCustomerHtmlEntities(getNonEmptyString(normalizedPkg.destination) ?? '패키지') + ' 여행 패키지',
      category: decodeCustomerHtmlEntities(getNonEmptyString(normalizedPkg.destination) ?? '패키지'),
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
        ? { award: highlights.slice(0, 3).map((name) => ({ '@type': 'Award', name: decodeCustomerHtmlEntities(name) })) }
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
        title: decodeCustomerHtmlEntities(normalizedPkg.title),
        display_title: normalizedPkg.display_title ? decodeCustomerHtmlEntities(normalizedPkg.display_title) : normalizedPkg.display_title,
        product_summary: normalizedPkg.product_summary ? decodeCustomerHtmlEntities(normalizedPkg.product_summary) : normalizedPkg.product_summary,
        lp_hero_image_url: lpHeroImageUrl,
      } as React.ComponentProps<typeof DetailClient>['initialPackage'])
    : null;

  return (
    <>
      <UnmatchedActivitiesBeacon items={unmatchedItems} />
      {normalizedPkg && (
        <div className="sr-only">
          <h1>{decodeCustomerHtmlEntities(normalizedPkg.display_title || normalizedPkg.title || '여소남 패키지 여행 상품 상세')}</h1>
          <p>
            {normalizedPkg.destination ? decodeCustomerHtmlEntities(normalizedPkg.destination) + ' 여행 ' : ''}
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
        {/* 怨좉컼 ?꾧린 (approved 由щ럭 ?덉쓣 ?뚮쭔 ?뚮뜑) */}
        <div className="mx-auto max-w-4xl px-4">
          <ReviewsSection packageId={id} limit={5} />
        </div>
        {/* 理쒓렐 蹂??곹뭹 / ?좎궗 ?곹뭹 */}
        <RecentViewsDeferred currentPackageId={id} />
      </div>
    </>
  );
}
