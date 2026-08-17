import { Suspense } from 'react';
import { notFound } from 'next/navigation';
import { headers } from 'next/headers';
import type { Metadata } from 'next';
import { fetchLpPackageUncached, loadLpPackageForPage } from '@/lib/load-lp-package';
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

async function safeLoadLpPackage(id: string, options: {
  proofSnapshotId?: string | null;
  proofToken?: string | null;
} = {}) {
  const normalizedId = id.trim();
  if (!normalizedId) return null;

  try {
    if (options.proofSnapshotId && options.proofToken) {
      return await fetchLpPackageUncached(normalizedId, {
        proofSnapshotId: options.proofSnapshotId,
        proofToken: options.proofToken,
      });
    }
    return await loadLpPackageForPage(normalizedId);
  } catch {
    return null;
  }
}

async function proofLoadOptions(
  searchParams?: Promise<Record<string, string | string[] | undefined>>,
) {
  const resolved = searchParams ? await searchParams : {};
  const snapshotId = getRouteParam(resolved.__proof_snapshot);
  const incomingHeaders = await headers();
  const proofToken = incomingHeaders.get('x-product-registration-v6-proof-token');
  if (snapshotId && proofToken) return { proofSnapshotId: snapshotId, proofToken };
  return {};
}

export async function generateMetadata(
  props: {
    params: Promise<{ id?: string | string[] }>;
    searchParams?: Promise<Record<string, string | string[] | undefined>>;
  }
): Promise<Metadata> {
  const params = await props.params;
  const base = siteBaseUrl();
  const id = getRouteParam(params.id);
  const encodedId = encodeURIComponent(id);
  const canonical = `${base}/lp/${encodedId}`;
  // The browser proof harness is intentionally allowed to render a candidate
  // package before publication. Metadata must use the same access decision as
  // the page body; otherwise Next.js can perform a second public-only lookup,
  // block on a stale snapshot and make an otherwise valid proof time out.
  const data = await safeLoadLpPackage(id, await proofLoadOptions(props.searchParams));
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
  const defaultMessage = data.customMessage?.default;
  const plainTitle =
    (defaultMessage?.headline || fallbackTitle)
      .replace(/\s*\n\s*/g, ' ')
      .trim() || fallbackTitle;
  const rawTitle =
    plainTitle.length > 55 ? `${plainTitle.slice(0, 52)}... | 여소남` : `${plainTitle} | 여소남`;
  const title = { absolute: rawTitle };
  const desc =
    (defaultMessage?.subline || fallbackTitle).slice(0, 160) || rawTitle;
  const hero = data.heroImageA?.trim();
  const socialImage = hero && isSafeImageSrc(hero) ? hero : defaultSocialImage();
  const lineageMeta = data.publicSnapshotHash
    ? {
        'product-registration-v5-snapshot-hash': data.publicSnapshotHash,
        ...(data.publicSnapshotRendererBuildId
          ? { 'product-registration-v5-renderer-build-id': data.publicSnapshotRendererBuildId }
          : {}),
        ...(data.canonicalRevisionId
          ? { 'product-registration-v5-revision-id': data.canonicalRevisionId }
          : {}),
      }
    : undefined;

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
    ...(lineageMeta ? { other: lineageMeta } : {}),
  };
}

export default async function LpPage(props: {
  params: Promise<{ id?: string | string[] }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await props.params;
  const id = getRouteParam(params.id);
  const data = await safeLoadLpPackage(id, await proofLoadOptions(props.searchParams));
  if (!data) notFound();

  let initialNotices: NoticeBlock[] = [];
  try {
    const resolved = data.termsPolicyHash
      ? (data.frozenTermsNotices ?? [])
      : await resolveTermsForPackage({ id: data.id }, 'mobile');
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
