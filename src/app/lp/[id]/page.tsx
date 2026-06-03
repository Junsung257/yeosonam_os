import { Suspense } from 'react';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { loadLpPackageForPage } from '@/lib/load-lp-package';
import { resolveTermsForPackage, formatCancellationDates, type NoticeBlock } from '@/lib/standard-terms';
import { isSafeImageSrc } from '@/lib/image-url';
import { LandingClient } from './LandingClient';
import { LpRouteSkeleton } from './LpRouteSkeleton';

export const revalidate = 300;

function siteBaseUrl(): string {
  return (process.env.NEXT_PUBLIC_BASE_URL || process.env.NEXT_PUBLIC_SITE_URL || 'https://www.yeosonam.com')
    .replace(/\/+$/, '');
}

function defaultSocialImage(): string {
  return `${siteBaseUrl()}/og-image.png`;
}

function getRouteParam(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value ?? '').trim();
}

async function safeLoadLpPackage(id: string) {
  const normalizedId = id.trim();
  if (!normalizedId) return null;

  try {
    return await loadLpPackageForPage(normalizedId);
  } catch {
    return null;
  }
}

export async function generateMetadata(
  props: {
    params: Promise<{ id?: string | string[] }>;
  }
): Promise<Metadata> {
  const params = await props.params;
  const base = siteBaseUrl();
  const id = getRouteParam(params.id);
  const encodedId = encodeURIComponent(id);
  const canonical = `${base}/lp/${encodedId}`;
  const data = await safeLoadLpPackage(id);
  if (!data) {
    return {
      title: '상품',
      robots: { index: false, follow: true },
      alternates: { canonical },
      openGraph: {
        title: '상품 | 여소남',
        url: canonical,
        type: 'website',
        images: [{ url: defaultSocialImage(), width: 1200, height: 630 }],
      },
      twitter: {
        card: 'summary_large_image',
        title: '상품 | 여소남',
        images: [defaultSocialImage()],
      },
    };
  }

  const fallbackTitle = data.destination ? `${data.destination} 패키지` : '여소남 패키지 여행';
  const plainTitle =
    (data.customMessage.default.headline || fallbackTitle)
      .replace(/\s*\n\s*/g, ' ')
      .trim() || fallbackTitle;
  const rawTitle =
    plainTitle.length > 55 ? `${plainTitle.slice(0, 52)}... | 여소남` : `${plainTitle} | 여소남`;
  const title = { absolute: rawTitle };
  const desc =
    (data.customMessage.default.subline || fallbackTitle).slice(0, 160) || rawTitle;
  const hero = data.heroImageA?.trim();
  const socialImage = hero && isSafeImageSrc(hero) ? hero : defaultSocialImage();

  return {
    title,
    description: desc,
    alternates: { canonical },
    openGraph: {
      title: rawTitle,
      description: desc,
      url: canonical,
      type: 'website',
      images: [{ url: socialImage, width: 1200, height: 630, alt: data.destination || fallbackTitle }],
    },
    twitter: {
      card: 'summary_large_image',
      title: rawTitle,
      description: desc,
      images: [socialImage],
    },
  };
}

export default async function LpPage(props: { params: Promise<{ id?: string | string[] }> }) {
  const params = await props.params;
  const id = getRouteParam(params.id);
  const data = await safeLoadLpPackage(id);
  if (!data) notFound();

  let initialNotices: NoticeBlock[] = [];
  try {
    const resolved = await resolveTermsForPackage({ id: data.id }, 'mobile');
    initialNotices = formatCancellationDates(resolved, data.departureFullDate ?? null);
  } catch {
    // Keep the landing page renderable even if standard terms are temporarily unavailable.
  }

  return (
    <Suspense fallback={<LpRouteSkeleton />}>
      <LandingClient initialData={data} initialNotices={initialNotices} />
    </Suspense>
  );
}
