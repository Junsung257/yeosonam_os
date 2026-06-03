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
import { redirect } from 'next/navigation';
import type { Metadata } from 'next';
import { isSupabaseConfigured, supabaseAdmin } from '@/lib/supabase';
import { normalizeAffiliateReferralCode } from '@/lib/affiliate-ref-code';

interface Params {
  params: Promise<{ code: string; slug: string }>;
  searchParams?: Promise<{ sub?: string }>;
}

function siteBaseUrl(): string {
  return (process.env.NEXT_PUBLIC_SITE_URL || process.env.NEXT_PUBLIC_BASE_URL || 'https://yeosonam.co.kr')
    .replace(/\/+$/, '');
}

function safeDecodePathSegment(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export async function generateMetadata(props: Params): Promise<Metadata> {
  const params = await props.params;
  const { code: rawCode, slug } = params;
  const code = normalizeAffiliateReferralCode(safeDecodePathSegment(rawCode));
  const baseUrl = siteBaseUrl();
  const encodedCode = encodeURIComponent(rawCode);
  const encodedSlug = encodeURIComponent(slug);
  const ogUrl = `${baseUrl}/api/og/affiliate?code=${encodeURIComponent(code || rawCode)}&pkg=${encodeURIComponent(slug)}`;

  let title = `여소남 추천 여행 — ${code || rawCode}`;
  let description = '여소남 제휴 콘텐츠 · 추천 보상 포함 (광고)';
  if (isSupabaseConfigured) {
    try {
      const { data: pkg } = await supabaseAdmin
        .from('travel_packages')
        .select('title, destination, product_summary')
        .eq('id', slug)
        .maybeSingle();
      if (pkg) {
        const p = pkg as { title?: string; destination?: string; product_summary?: string };
        title = `${p.title || title} · ${code || rawCode} × 여소남`;
        description = (p.product_summary || `${p.destination || ''} 여행 패키지`) + ' · 여소남 제휴 콘텐츠 (광고)';
      }
    } catch { /* */ }
  }

  return {
    title,
    description,
    openGraph: {
      title,
      description,
      images: [{ url: ogUrl, width: 1200, height: 630 }],
      url: `${baseUrl}/r/${encodedCode}/${encodedSlug}`,
      type: 'website',
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
      images: [ogUrl],
    },
    alternates: { canonical: `${baseUrl}/r/${encodedCode}/${encodedSlug}` },
    robots: { index: false, follow: false },  // 단축링크는 검색 인덱싱 차단
  };
}

export default async function AffiliateShortLinkPage(props: Params) {
  const searchParams = await props.searchParams;
  const params = await props.params;
  const { code: rawCode, slug } = params;
  const code = normalizeAffiliateReferralCode(safeDecodePathSegment(rawCode));
  const subRaw =
    typeof searchParams?.sub === 'string'
      ? searchParams.sub.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 40)
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
