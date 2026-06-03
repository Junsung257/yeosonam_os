/**
 * 어필리에이터 단축링크: /r/{code}/{slug}
 *
 *   slug = packageId 또는 짧은 영문 슬러그 (향후)
 *
 * 흐름:
 *   1. (서버) /api/influencer/track GET 으로 클릭/세션 기록 (멱등 RPC + bot 필터)
 *   2. /packages/{id}?ref={code} 로 redirect
 *
 * OG 메타: 동적 og 이미지 (어필리에이터 + 여소남 + 상품)로 카톡 공유 미리보기 강화.
 */
import { notFound, redirect } from 'next/navigation';
import type { Metadata } from 'next';
import { isSupabaseConfigured, supabaseAdmin } from '@/lib/supabase';
import { normalizeAffiliateReferralCode } from '@/lib/affiliate-ref-code';

interface Params {
  params: Promise<{ code?: string | string[]; slug?: string | string[] }>;
  searchParams?: Promise<{ sub?: string | string[] }>;
}

function siteBaseUrl(): string {
  return (process.env.NEXT_PUBLIC_BASE_URL || process.env.NEXT_PUBLIC_SITE_URL || 'https://www.yeosonam.com')
    .replace(/\/+$/, '');
}

function socialImageUrl(): string {
  return `${siteBaseUrl()}/og-image.png`;
}

function safeDecodePathSegment(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function getRouteParam(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value ?? '').trim();
}

export async function generateMetadata(props: Params): Promise<Metadata> {
  const params = await props.params;
  const rawCode = getRouteParam(params.code);
  const slug = getRouteParam(params.slug);
  const baseUrl = siteBaseUrl();
  if (!rawCode || !slug) {
    const title = '추천 여행';
    const socialTitle = '여소남 추천 여행';
    const imageUrl = socialImageUrl();
    const canonical = rawCode
      ? `${baseUrl}/r/${encodeURIComponent(rawCode)}`
      : `${baseUrl}/r`;

    return {
      title,
      robots: { index: false, follow: false },
      alternates: { canonical },
      openGraph: {
        title: socialTitle,
        url: canonical,
        type: 'website',
        images: [{ url: imageUrl, width: 1200, height: 630 }],
      },
      twitter: {
        card: 'summary_large_image',
        title: socialTitle,
        images: [imageUrl],
      },
    };
  }

  const code = normalizeAffiliateReferralCode(safeDecodePathSegment(rawCode));
  const metadataCode = code || rawCode;
  const decodedSlug = safeDecodePathSegment(slug);
  const encodedCode = encodeURIComponent(metadataCode);
  const encodedSlug = encodeURIComponent(decodedSlug);
  const canonicalUrl = `${baseUrl}/r/${encodedCode}/${encodedSlug}`;
  const ogUrl = `${baseUrl}/api/og/affiliate?code=${encodeURIComponent(metadataCode)}&pkg=${encodedSlug}`;

  let title = `추천 여행 — ${metadataCode}`;
  let socialTitle = `여소남 추천 여행 — ${metadataCode}`;
  let description = '여소남 제휴 콘텐츠 · 추천 보상 포함 (광고)';
  if (isSupabaseConfigured) {
    try {
      const { data: pkg } = await supabaseAdmin
        .from('travel_packages')
        .select('title, destination, product_summary')
        .eq('id', decodedSlug)
        .maybeSingle();
      if (pkg) {
        const p = pkg as { title?: string; destination?: string; product_summary?: string };
        const packageTitle = p.title || title;
        title = `${packageTitle} · ${metadataCode}`;
        socialTitle = `${packageTitle} · ${metadataCode} × 여소남`;
        description = (p.product_summary || `${p.destination || ''} 여행 패키지`) + ' · 여소남 제휴 콘텐츠 (광고)';
      }
    } catch { /* */ }
  }

  return {
    title,
    description,
    openGraph: {
      title: socialTitle,
      description,
      images: [{ url: ogUrl, width: 1200, height: 630 }],
      url: canonicalUrl,
      type: 'website',
    },
    twitter: {
      card: 'summary_large_image',
      title: socialTitle,
      description,
      images: [ogUrl],
    },
    alternates: { canonical: canonicalUrl },
    robots: { index: false, follow: false },  // 단축링크는 검색 인덱싱 차단
  };
}

export default async function AffiliateShortLinkPage(props: Params) {
  const searchParams = await props.searchParams;
  const params = await props.params;
  const rawCode = getRouteParam(params.code);
  const slug = getRouteParam(params.slug);
  if (!rawCode || !slug) notFound();

  const code = normalizeAffiliateReferralCode(safeDecodePathSegment(rawCode));
  const rawSub = getRouteParam(searchParams?.sub);
  const subRaw =
    rawSub
      ? rawSub.toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 40)
      : '';

  // 서버측 클릭 추적 (best-effort) — 실패해도 redirect 진행.
  // /api/influencer/track 은 쿠키도 발급하지만 redirect 시 쿠키 set 어려우므로,
  // 클라이언트가 /packages/{id}?ref={code} 도착 시 다시 ref 처리되어 쿠키 발급됨.
  // /packages/{id}?ref={code} 로 영구 redirect (302 — 검색 인덱싱 안 됨)
  const refParam = code || normalizeAffiliateReferralCode(rawCode);
  const target = `/packages/${encodeURIComponent(slug)}?ref=${encodeURIComponent(refParam)}&utm_source=shortlink${subRaw ? `&sub=${encodeURIComponent(subRaw)}` : ''}`;
  const trackUrl = `/api/influencer/track?ref=${encodeURIComponent(refParam)}&pkg=${encodeURIComponent(slug)}&sub=${encodeURIComponent(subRaw || 'shortlink')}&next=${encodeURIComponent(target)}`;
  redirect(trackUrl);
}
