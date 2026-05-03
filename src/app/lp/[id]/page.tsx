import { Suspense } from 'react';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { loadLpPackageForPage } from '@/lib/load-lp-package';
import { LandingClient } from './LandingClient';

/** 세그먼트 ISR — unstable_cache(300s)와 함께 동작 */
export const revalidate = 300;

export async function generateMetadata({
  params,
}: {
  params: { id: string };
}): Promise<Metadata> {
  const data = await loadLpPackageForPage(params.id);
  if (!data) {
    return { title: '상품 | 여소남', robots: { index: false, follow: true } };
  }
  const plainTitle = data.customMessage.default.headline.replace(/\s*\n\s*/g, ' ').trim();
  const title =
    plainTitle.length > 55 ? `${plainTitle.slice(0, 52)}… | 여소남` : `${plainTitle} | 여소남`;
  const desc =
    (data.customMessage.default.subline || `${data.destination} 패키지`).slice(0, 160) || title;
  const hero = data.heroImageA?.trim();
  const ogImages =
    hero && /^https?:\/\//i.test(hero)
      ? [{ url: hero, alt: data.destination }]
      : undefined;
  return {
    title,
    description: desc,
    openGraph: {
      title,
      description: desc,
      type: 'website',
      ...(ogImages ? { images: ogImages } : {}),
    },
    twitter: {
      card: ogImages ? 'summary_large_image' : 'summary',
      title,
      description: desc,
      ...(ogImages ? { images: [ogImages[0].url] } : {}),
    },
  };
}

export default async function LpPage({ params }: { params: { id: string } }) {
  const data = await loadLpPackageForPage(params.id);
  if (!data) notFound();

  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center text-[var(--text-muted)] bg-[var(--bg-section)]">
          불러오는 중…
        </div>
      }
    >
      <LandingClient initialData={data} />
    </Suspense>
  );
}
