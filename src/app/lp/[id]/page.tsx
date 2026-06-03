import { Suspense } from 'react';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { loadLpPackageForPage } from '@/lib/load-lp-package';
import { resolveTermsForPackage, formatCancellationDates, type NoticeBlock } from '@/lib/standard-terms';
import { LandingClient } from './LandingClient';
import { LpRouteSkeleton } from './LpRouteSkeleton';

/** 세그먼트 ISR — unstable_cache(300s)와 함께 동작 */
export const revalidate = 300;

export async function generateMetadata(
  props: {
    params: Promise<{ id: string }>;
  }
): Promise<Metadata> {
  const params = await props.params;
  const data = await loadLpPackageForPage(params.id);
  if (!data) {
    return { title: '상품 | 여소남', robots: { index: false, follow: true } };
  }
  const fallbackTitle = data.destination ? `${data.destination} 패키지` : '여소남 패키지 여행';
  const plainTitle =
    (data.customMessage.default.headline || fallbackTitle)
      .replace(/\s*\n\s*/g, ' ')
      .trim() || fallbackTitle;
  const rawTitle =
    plainTitle.length > 55 ? `${plainTitle.slice(0, 52)}… | 여소남` : `${plainTitle} | 여소남`;
  // 루트 layout.tsx의 title.template('%s | 여소남') 재적용 방지
  const title = { absolute: rawTitle };
  const desc =
    (data.customMessage.default.subline || fallbackTitle).slice(0, 160) || rawTitle;
  const hero = data.heroImageA?.trim();
  const ogImages =
    hero && /^https?:\/\//i.test(hero)
      ? [{ url: hero, alt: data.destination }]
      : undefined;
  return {
    title,
    description: desc,
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
  const data = await loadLpPackageForPage(params.id);
  if (!data) notFound();

  // Tier 1 플랫폼 기본약관 서버사이드 pre-fetch (바텀시트 waterfall 방지)
  // LP는 Tier 1(플랫폼 공통)만 로드 — id만 전달하면 platform tier 조회 가능
  let initialNotices: NoticeBlock[] = [];
  try {
    const resolved = await resolveTermsForPackage({ id: data.id }, 'mobile');
    initialNotices = formatCancellationDates(resolved, data.departureFullDate ?? null);
  } catch {
    // 약관 로드 실패는 무시 (바텀시트는 동작)
  }

  return (
    <Suspense fallback={<LpRouteSkeleton />}>
      <LandingClient initialData={data} initialNotices={initialNotices} />
    </Suspense>
  );
}
