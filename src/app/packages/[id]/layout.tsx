import type { Metadata } from 'next';
import { getPackageById } from '@/lib/supabase';
import { isSafeImageSrc } from '@/lib/image-url';
import { isUuid } from '@/lib/uuid';
import { withPublicQueryFallback } from '@/lib/public-query-timeout';

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
//   meta ? 蹂몃Ц drift 媛?? getPackageById SSOT ?듭씪.
async function getPackage(id: string) {
  return await getPackageById(id);
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
  if (Number.isFinite(price)) parts.push(`${price.toLocaleString('ko-KR')}??`);
  parts.push(`?곹뭹踰덊샇 ${input.id.slice(0, 8)}`);
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
  const pkg = id && isUuid(id) ? await safeGetPackage(id) : null;
  if (!pkg) {
    return {
      title: '?곹뭹??李얠쓣 ???놁뒿?덈떎',
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
  if (pkg.product_highlights?.length) {
    parts.push(decodeCustomerHtmlEntities((pkg.product_highlights as string[]).slice(0, 3).join(', ')));
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

  const heroCandidate: string | null = firstItineraryPhoto;

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
