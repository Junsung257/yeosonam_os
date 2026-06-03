import { Suspense } from 'react';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { loadLpPackageForPage } from '@/lib/load-lp-package';
import { resolveTermsForPackage, formatCancellationDates, type NoticeBlock } from '@/lib/standard-terms';
import { LandingClient } from './LandingClient';
import { LpRouteSkeleton } from './LpRouteSkeleton';

export const revalidate = 300;

function siteBaseUrl(): string {
  return (process.env.NEXT_PUBLIC_BASE_URL || process.env.NEXT_PUBLIC_SITE_URL || 'https://www.yeosonam.com')
    .replace(/\/+$/, '');
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
    params: Promise<{ id: string }>;
  }
): Promise<Metadata> {
  const params = await props.params;
  const base = siteBaseUrl();
  const encodedId = encodeURIComponent(params.id.trim());
  const data = await safeLoadLpPackage(params.id);
  if (!data) {
    return {
      title: '상품 | 여소남',
      robots: { index: false, follow: true },
      alternates: { canonical: `${base}/lp/${encodedId}` },
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
  const ogImages =
    hero && /^https?:\/\//i.test(hero)
      ? [{ url: hero, alt: data.destination || fallbackTitle }]
      : undefined;

  return {
    title,
    description: desc,
    alternates: { canonical: `${base}/lp/${encodedId}` },
    openGraph: {
      title: rawTitle,
      description: desc,
      type: 'website',
      ...(ogImages ? { images: ogImages } : {}),
    },
    twitter: {
      card: ogImages ? 'summary_large_image' : 'summary',
      title: rawTitle,
      description: desc,
      ...(ogImages ? { images: [ogImages[0].url] } : {}),
    },
  };
}

export default async function LpPage(props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const data = await safeLoadLpPackage(params.id);
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
