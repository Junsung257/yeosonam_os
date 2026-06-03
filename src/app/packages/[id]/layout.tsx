import type { Metadata } from 'next';
import { getPackageById } from '@/lib/supabase';

const BASE_URL = (
  process.env.NEXT_PUBLIC_BASE_URL ||
  process.env.NEXT_PUBLIC_SITE_URL ||
  'https://www.yeosonam.com'
).replace(/\/+$/, '');

// 2026-05-18 박제 (ERR-layout-page-source-drift):
//   기존 fetch('/api/packages?id=...') 는 page.tsx 의 supabaseAdmin 직접 쿼리 와
//   별도 데이터 소스 (BASE_URL HTTP 왕복 + ISR 300s 캐시). 캐시 만료 타이밍 어긋나면
//   meta 와 본문 drift 가능. getPackageById SSOT 통일.
async function getPackage(id: string) {
  return await getPackageById(id);
}

async function safeGetPackage(id: string) {
  try {
    return await getPackage(id);
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

function resolveOgImage(candidate: string | null) {
  if (candidate && /^https?:\/\//i.test(candidate)) return candidate;
  if (candidate?.startsWith('/')) return `${BASE_URL}${candidate}`;
  return `${BASE_URL}/og-image.png`;
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

  // 제목: 랜드사명 제거, 여소남 브랜딩
  const rawTitle = (pkg.title ?? '여행 상품') as string;
  const title = rawTitle
    .replace(/투어폰|랜드부산|더투어|투어비|현지투어/g, '')
    .trim();

  // 설명: 핵심 정보 조합
  const parts: string[] = [];
  if (pkg.destination) parts.push(pkg.destination);
  if (pkg.duration) parts.push(`${pkg.duration}일`);
  if (pkg.price) parts.push(`₩${Number(pkg.price).toLocaleString('ko-KR')}~`);
  if (pkg.product_highlights?.length) {
    parts.push((pkg.product_highlights as string[]).slice(0, 3).join(', '));
  }
  const description = parts.length > 0
    ? parts.join(' | ')
    : '여소남에서 안심 여행을 예약하세요.';

  // OG 이미지: itinerary_data 의 호텔/관광지 사진 → 브랜드 기본 이미지 폴백.
  // 2026-05-18 박제 (PR #102 패턴): thumbnail_urls, hero_image_url 은 travel_packages 에 미존재 컬럼.
  //   기존 코드는 undefined 로 silently fallback 했지만 dead-code 위생 정리.
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
          if (typeof photo === 'string' && photo.startsWith('http')) return photo;
        }
      }
    } catch { /* ignore */ }
    return null;
  })();

  const heroCandidate: string | null = firstItineraryPhoto;

  const ogImage = resolveOgImage(heroCandidate);

  return {
    title,
    description,
    openGraph: {
      title,
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
