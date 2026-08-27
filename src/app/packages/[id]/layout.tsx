import type { Metadata } from 'next';
import { getSupabase, getSupabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';
import { isSafeImageSrc } from '@/lib/image-url';
import { withPublicQueryFallback } from '@/lib/public-query-timeout';
import { getPublicCatalogDetail } from '@/lib/public-catalog';

const BASE_URL = (
  process.env.NEXT_PUBLIC_BASE_URL ||
  process.env.NEXT_PUBLIC_SITE_URL ||
  'https://www.yeosonam.com'
).replace(/\/+$/, '');
const PACKAGE_METADATA_QUERY_TIMEOUT_MS = Math.max(
  1000,
  Number(process.env.PACKAGE_DETAIL_QUERY_TIMEOUT_MS || process.env.PUBLIC_PAGE_QUERY_TIMEOUT_MS || '3500') || 3500,
);

// 2026-05-18 諛뺤젣 (ERR-layout-page-source-drift):
//   湲곗〈 fetch('/api/packages?id=...') ??page.tsx ??supabaseAdmin 吏곸젒 荑쇰━ ?
//   蹂꾨룄 ?곗씠???뚯뒪 (BASE_URL HTTP ?뺣났 + ISR 300s 罹먯떆). 罹먯떆 留뚮즺 ??대컢 ?닿툔?섎㈃
// Metadata and page content now share the exact publication-pointer snapshot reader.
type LayoutPublicPackage = {
  title?: unknown;
  destination?: unknown;
  duration?: unknown;
  price?: unknown;
  product_type?: unknown;
  product_highlights?: unknown;
  itinerary_data?: unknown;
  hero_image?: unknown;
};

async function getPackage(id: string): Promise<LayoutPublicPackage | null> {
  if (!isSupabaseConfigured) return null;
  const client = getSupabaseAdmin() ?? getSupabase();
  if (!client) return null;
  const current = await getPublicCatalogDetail(client, id);
  if (!current) return null;
  return {
    ...(current.package as LayoutPublicPackage),
    title: current.item.title,
    destination: current.item.destination,
    duration: current.item.duration,
    price: current.item.price,
    product_type: current.item.productKind,
    hero_image: current.item.heroImage,
  };
}

async function safeGetPackage(id: string) {
  try {
    return await withPublicQueryFallback(getPackage(id), null, PACKAGE_METADATA_QUERY_TIMEOUT_MS);
  } catch (error) {
    console.error('[packages/layout] generateMetadata failed', { id, error });
    return null;
  }
}

function getPackageUrl(id: string) {
  return `${BASE_URL}/packages/${encodeURIComponent(id)}`;
}

function getRouteParam(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value ?? '').trim();
}

function resolveOgImage(candidate: unknown) {
  if (isSafeImageSrc(candidate)) {
    const imageUrl = candidate.trim();
    return imageUrl.startsWith('//') ? `https:${imageUrl}` : imageUrl;
  }
  if (typeof candidate === 'string' && candidate.trim().startsWith('/')) return `${BASE_URL}${candidate.trim()}`;
  return `${BASE_URL}/og-image.png`;
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
  productType?: unknown;
  price?: unknown;
  id: string;
}): string {
  const parts = [decodeCustomerHtmlEntities(input.title)];
  if (typeof input.productType === 'string' && input.productType.trim()) {
    parts.push(input.productType.trim());
  }
  const price = Number(input.price);
  if (Number.isFinite(price)) parts.push(`${price.toLocaleString('ko-KR')}원~`);
  parts.push(`상품번호 ${input.id.slice(0, 8)}`);
  return parts.filter(Boolean).join(' | ');
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id?: string | string[] }>;
}): Promise<Metadata> {
  const { id: rawId } = await params;
  const id = getRouteParam(rawId);
  const canonical = getPackageUrl(id);
  const pkg = id ? await safeGetPackage(id) : null;
  if (!pkg) {
    return {
      title: '상품을 찾을 수 없습니다',
      alternates: { canonical },
      robots: { index: false, follow: true },
    };
  }

  const rawTitle = decodeCustomerHtmlEntities((pkg.title ?? '여행 상품') as string);
  const title = rawTitle
    .replace(/투어폰|랜드부산|더투어|투어비|현지투어/g, '')
    .trim();
  const seoTitle = buildPackageSeoTitle({
    title,
    productType: (pkg as { product_type?: unknown }).product_type,
    price: (pkg as { price?: unknown }).price,
    id,
  });

  const parts: string[] = [];
  if (pkg.destination) parts.push(decodeCustomerHtmlEntities(String(pkg.destination)));
  if (pkg.duration) parts.push(`${pkg.duration}일`);
  if (pkg.price) parts.push(`${Number(pkg.price).toLocaleString('ko-KR')}원~`);
  if (Array.isArray(pkg.product_highlights) && pkg.product_highlights.length > 0) {
    parts.push(decodeCustomerHtmlEntities(pkg.product_highlights.filter((item): item is string => typeof item === 'string').slice(0, 3).join(', ')));
  }
  const description = parts.length > 0
    ? parts.join(' | ')
    : '여소남에서 여행 상품을 확인하세요.';

  // OG ?대?吏: itinerary_data ???명뀛/愿愿묒? ?ъ쭊 ??釉뚮옖??湲곕낯 ?대?吏 ?대갚.
  // 2026-05-18 諛뺤젣 (PR #102 ?⑦꽩): thumbnail_urls, hero_image_url ? travel_packages ??誘몄〈??而щ읆.
  //   湲곗〈 肄붾뱶??undefined 濡?silently fallback ?덉?留?dead-code ?꾩깮 ?뺣━.
  const firstItineraryPhoto = (() => {
    try {
      const root = pkg.itinerary_data as { days?: Array<Record<string, unknown>> } | null;
      const days = Array.isArray(pkg.itinerary_data)
        ? (pkg.itinerary_data as Array<Record<string, unknown>>)
        : (root?.days ?? []);
      for (const day of days) {
        const items = Array.isArray(day?.schedule) ? day.schedule : (Array.isArray(day?.items) ? day.items : []);
        for (const it of items as Array<{ photo?: string; image?: string; hotel?: { image?: string } }>) {
          const photo = it?.photo || it?.image || it?.hotel?.image;
          if (isSafeImageSrc(photo)) return photo.trim();
        }
      }
    } catch { /* ignore */ }
    return null;
  })();

  const heroCandidate = isSafeImageSrc(pkg.hero_image)
    ? pkg.hero_image.trim()
    : firstItineraryPhoto;

  const ogImage = resolveOgImage(heroCandidate);

  return {
    title: { absolute: `${seoTitle} | 여소남` },
    description,
    openGraph: {
      title: seoTitle,
      description,
      url: canonical,
      siteName: '여소남',
      type: 'website',
      images: [{ url: ogImage, width: 1200, height: 630, alt: rawTitle }],
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
      images: [ogImage],
    },
    alternates: { canonical },
  };
}

export default function PackageLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
