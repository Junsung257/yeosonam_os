import Image from 'next/image';
import Link from 'next/link';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import GlobalNav from '@/components/customer/GlobalNav';
import { SafeCoverImg } from '@/components/customer/SafeRemoteImage';
import AffiliateTouchpointBeacon from '@/components/affiliate/AffiliateTouchpointBeacon';
import { isSupabaseConfigured, supabaseAdmin } from '@/lib/supabase';
import { looksLikeReferralCode, normalizeAffiliateReferralCode } from '@/lib/affiliate-ref-code';
import { isSafeImageSrc } from '@/lib/image-url';
import { isCustomerPubliclyOpenable } from '@/lib/package-public-eligibility';
import { CUSTOMER_VISIBLE_STATUSES } from '@/lib/visibility-status';
import { fetchAndMergeCurrentPublicPackageCardSnapshots } from '@/lib/package-publication/snapshot-projection';
import { isPublicPublicationState } from '@/lib/package-publication/types';
import { buildPublicUrl, resolvePublicAppOrigin } from '@/lib/public-app-origin';

function extractYoutubeEmbedUrl(input?: string | null): string | null {
  if (!input) return null;
  const s = input.trim();
  const m = s.match(/(?:https?:\/\/)?(?:www\.)?(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/shorts\/)([a-zA-Z0-9_-]{11})/);
  if (!m?.[1]) return null;
  return `https://www.youtube.com/embed/${m[1]}?rel=0&modestbranding=1`;
}

/** 랜딩 조회수(affiliate_touchpoints)가 방문마다 기록되도록 캐시 비활성화 */
export const dynamic = 'force-dynamic';

const PKG_CARD_FIELDS =
  'id, title, destination, country, price, display_title, product_summary, product_highlights, status, publication_state, package_revision, audit_status, audit_report, updated_at, optional_tours, itinerary_data';

interface PageProps {
  params: Promise<{ slug?: string | string[] }>;
}

function siteBaseUrl(): string {
  return resolvePublicAppOrigin();
}

function socialImageUrl(): string {
  return buildPublicUrl('/og-image.png', siteBaseUrl());
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

function isWithPublicSnapshotCandidate(row: Record<string, unknown>): boolean {
  const publicationState = typeof row.publication_state === 'string' ? row.publication_state : null;
  return isPublicPublicationState(publicationState) && isCustomerPubliclyOpenable(row);
}

type AffiliatePicksResult<T> = {
  rows: T[];
  unavailable: boolean;
};

async function toPublicAffiliatePicks<T extends Record<string, unknown>>(rows: T[]): Promise<AffiliatePicksResult<T>> {
  if (rows.length === 0) return { rows: [], unavailable: false };
  try {
    return {
      rows: await fetchAndMergeCurrentPublicPackageCardSnapshots(supabaseAdmin, rows),
      unavailable: false,
    };
  } catch (error) {
    console.warn('[with] public snapshot merge failed; hiding affiliate package picks', error);
    return { rows: [], unavailable: true };
  }
}

export async function generateMetadata(props: PageProps): Promise<Metadata> {
  const params = await props.params;
  const rawSlug = getRouteParam(params.slug);
  const slug = normalizeAffiliateReferralCode(safeDecodePathSegment(rawSlug));
  const base = siteBaseUrl();
  const canonical = slug ? `${base}/with/${encodeURIComponent(slug)}` : `${base}/with`;
  const imageUrl = socialImageUrl();
  if (!looksLikeReferralCode(slug)) {
    const title = '제휴 랜딩';
    return {
      title,
      robots: { index: false, follow: false },
      alternates: { canonical },
      openGraph: {
        title,
        url: canonical,
        type: 'website',
        images: [{ url: imageUrl, width: 1200, height: 630 }],
      },
      twitter: {
        card: 'summary_large_image',
        title,
        images: [imageUrl],
      },
    };
  }
  let name = slug;
  if (isSupabaseConfigured) {
    try {
      const { data } = await supabaseAdmin
        .from('affiliates')
        .select('name')
        .eq('referral_code', slug)
        .eq('is_active', true)
        .maybeSingle();
      const affiliateName = typeof data?.name === 'string' ? data.name.trim() : '';
      if (affiliateName) name = affiliateName;
    } catch {
      name = slug;
    }
  }
  const title = `${name} 제휴 여행`;
  const socialTitle = `${name} x Yeosonam`;
  return {
    title,
    description: `${name}님이 추천하는 여소남 패키지 여행입니다. 추천 예약에는 파트너 보상이 포함될 수 있습니다.`,
    robots: { index: false, follow: false },
    alternates: { canonical },
    openGraph: {
      title: socialTitle,
      description: `${name} partner travel landing page.`,
      url: canonical,
      images: [{ url: imageUrl, width: 1200, height: 630 }],
    },
    twitter: {
      card: 'summary_large_image',
      title: socialTitle,
      description: `${name} partner travel landing page.`,
      images: [imageUrl],
    },
  };
}

export default async function AffiliateCoBrandLandingPage(props: PageProps) {
  const params = await props.params;
  const rawSlug = getRouteParam(params.slug);
  const slug = normalizeAffiliateReferralCode(safeDecodePathSegment(rawSlug));
  if (!looksLikeReferralCode(slug)) notFound();

  if (!isSupabaseConfigured) {
    return (
      <div className="min-h-screen bg-gray-50">
        <GlobalNav />
        <main className="mx-auto max-w-3xl px-4 py-16 text-center text-gray-600">
          DB 연결 후 이용할 수 있습니다.
        </main>
      </div>
    );
  }

  let aff: unknown = null;
  let affErr: unknown = null;
  try {
    const result = await supabaseAdmin
      .from('affiliates')
      .select('name, referral_code, logo_url, landing_intro, landing_pick_package_ids, landing_video_url')
      .eq('referral_code', slug)
      .eq('is_active', true)
      .maybeSingle();
    aff = result.data;
    affErr = result.error;
  } catch {
    affErr = true;
  }

  if (affErr || !aff) notFound();

  const row = aff as {
    name: string;
    referral_code: string;
    logo_url?: string | null;
    landing_intro?: string | null;
    landing_pick_package_ids?: string[] | null;
    landing_video_url?: string | null;
  };

  const pickIds = (row.landing_pick_package_ids || []).filter(Boolean);

  let picks: Array<{
    id: string;
    title: string;
    destination?: string | null;
    country?: string | null;
    price?: number | null;
    display_title?: string | null;
    product_summary?: string | null;
    product_highlights?: string[] | null;
  }> = [];
  let picksState: 'ready' | 'empty' | 'data_unavailable' = 'empty';

  if (pickIds.length > 0) {
    try {
      const { data: picked } = await supabaseAdmin
        .from('travel_packages')
        .select(PKG_CARD_FIELDS)
        .in('id', pickIds)
        .in('status', [...CUSTOMER_VISIBLE_STATUSES])
        .in('publication_state', ['approved', 'published']);
      const order = new Map(pickIds.map((id, i) => [id, i]));
      const pickedRows = ((picked || []) as Array<Record<string, unknown>>)
        .filter(isWithPublicSnapshotCandidate)
        .sort(
          (a, b) => {
            const aId = typeof a.id === 'string' ? a.id : '';
            const bId = typeof b.id === 'string' ? b.id : '';
            return (order.get(aId) ?? 99) - (order.get(bId) ?? 99);
          },
        );
      const result = await toPublicAffiliatePicks(pickedRows);
      picks = result.rows as typeof picks;
      picksState = result.unavailable ? 'data_unavailable' : picks.length > 0 ? 'ready' : 'empty';
    } catch {
      picks = [];
      picksState = 'data_unavailable';
    }
  }

  if (picks.length === 0 && picksState !== 'data_unavailable') {
    try {
      const { data: fallback } = await supabaseAdmin
        .from('travel_packages')
        .select(PKG_CARD_FIELDS)
        .in('status', [...CUSTOMER_VISIBLE_STATUSES])
        .in('publication_state', ['approved', 'published'])
        .order('created_at', { ascending: false })
        .limit(100);
      const result = await toPublicAffiliatePicks(
        ((fallback || []) as Array<Record<string, unknown>>)
          .filter(isWithPublicSnapshotCandidate)
          .slice(0, 6),
      );
      picks = result.rows as typeof picks;
      picksState = result.unavailable ? 'data_unavailable' : picks.length > 0 ? 'ready' : 'empty';
    } catch {
      picks = [];
      picksState = 'data_unavailable';
    }
  }

  const refQ = encodeURIComponent(row.referral_code);
  const intro =
    row.landing_intro?.trim() ||
    `안녕하세요, ${row.name}입니다. 여소남에서 살펴볼 수 있는 패키지 여행을 소개합니다.`;
  const youtubeEmbedUrl = extractYoutubeEmbedUrl(row.landing_video_url || row.landing_intro);

  return (
    <div className="min-h-screen bg-gray-50">
      <AffiliateTouchpointBeacon referralCode={row.referral_code} subId="co_brand_landing" />
      <GlobalNav />
      <main>
        <section className="border-b border-gray-200 bg-white">
          <div className="mx-auto max-w-5xl px-4 py-10 sm:py-14">
            <div className="mb-4 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-center text-sm text-emerald-900">
              이 페이지의 링크로 예약하면 <strong>{row.name}</strong>님에게 추천 보상이 지급될 수 있습니다.
              고객 결제 가격과 적용 조건은 각 상품 상세에서 확인해 주세요.
            </div>
            <div className="flex flex-col items-center gap-6 sm:flex-row sm:items-start sm:justify-center">
              <div className="flex shrink-0 items-center gap-4">
                <div className="relative h-16 w-40 shrink-0 sm:h-20 sm:w-48">
                  <Image
                    src="/logo.png"
                    alt="여소남"
                    fill
                    className="object-contain object-left"
                    sizes="(max-width: 640px) 160px, 192px"
                    priority
                  />
                </div>
                <span className="text-3xl font-light text-gray-300" aria-hidden>
                  ×
                </span>
                {row.logo_url && isSafeImageSrc(row.logo_url) ? (
                  <div className="relative h-16 w-16 overflow-hidden rounded-full border-2 border-emerald-600 shadow sm:h-20 sm:w-20">
                    <SafeCoverImg
                      src={row.logo_url}
                      alt=""
                      className="absolute inset-0 h-full w-full object-cover"
                      loading="lazy"
                      fallback={
                        <div className="absolute inset-0 flex items-center justify-center bg-emerald-50 text-xl font-bold text-emerald-800 sm:text-2xl">
                          {row.name.slice(0, 1)}
                        </div>
                      }
                    />
                  </div>
                ) : (
                  <div className="flex h-16 w-16 items-center justify-center rounded-full border-2 border-emerald-600 bg-emerald-50 text-xl font-bold text-emerald-800 sm:h-20 sm:w-20 sm:text-2xl">
                    {row.name.slice(0, 1)}
                  </div>
                )}
              </div>
              <div className="max-w-xl text-center sm:text-left">
                <p className="text-xs font-semibold uppercase tracking-wider text-emerald-700">
                  여소남 제휴 코브랜딩
                </p>
                <h1 className="mt-1 text-2xl font-bold text-gray-900 sm:text-3xl">{row.name}님의 Pick</h1>
                <p className="mt-4 whitespace-pre-wrap text-base leading-relaxed text-gray-700">{intro}</p>
              </div>
            </div>
            {youtubeEmbedUrl ? (
              <div className="mx-auto mt-8 max-w-3xl">
                <div className="overflow-hidden rounded-2xl border border-gray-200 shadow-sm">
                  <div className="aspect-video">
                    <iframe
                      src={youtubeEmbedUrl}
                      title={`${row.name} 제휴 소개 영상`}
                      className="h-full w-full"
                      loading="lazy"
                      referrerPolicy="strict-origin-when-cross-origin"
                      allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                      allowFullScreen
                    />
                  </div>
                </div>
              </div>
            ) : null}
          </div>
        </section>

        <section className="mx-auto max-w-5xl px-4 py-10">
          <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
            <h2 className="text-lg font-bold text-gray-900">추천 패키지</h2>
            <Link
              href={`/packages?ref=${refQ}`}
              className="text-sm font-medium text-emerald-800 underline-offset-2 hover:underline"
            >
              전체 상품 보기 →
            </Link>
          </div>
          {picksState === 'data_unavailable' ? (
            <p role="alert" className="rounded-lg border border-amber-200 bg-amber-50 py-12 text-center text-amber-900">
              상품 정보를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.
            </p>
          ) : picks.length === 0 ? (
            <p className="rounded-lg border border-dashed border-gray-300 bg-white py-12 text-center text-gray-500">
              노출 가능한 상품이 아직 없습니다. 잠시 후 다시 확인해 주세요.
            </p>
          ) : (
            <ul className="grid gap-5 sm:grid-cols-2">
              {picks.map(pkg => {
                const title = pkg.display_title || pkg.title;
                const highlight = pkg.product_highlights?.[0] || pkg.product_summary || '';
                return (
                  <li key={pkg.id}>
                    <Link
                      href={`/packages/${encodeURIComponent(pkg.id)}?ref=${refQ}`}
                      className="block h-full rounded-xl border border-gray-200 bg-white p-5 shadow-sm transition hover:border-emerald-400 hover:shadow-md"
                    >
                      <div className="text-xs font-medium text-emerald-700">
                        {[pkg.destination, pkg.country].filter(Boolean).join(' · ')}
                      </div>
                      <h3 className="mt-1 line-clamp-2 text-lg font-semibold text-gray-900">{title}</h3>
                      {highlight ? (
                        <p className="mt-2 line-clamp-2 text-sm text-gray-600">{highlight}</p>
                      ) : null}
                      {typeof pkg.price === 'number' ? (
                        <div className="mt-4">
                          <p className="text-lg font-bold text-gray-900">
                            {pkg.price.toLocaleString('ko-KR')}
                            <span className="text-sm font-medium text-gray-600">원~</span>
                          </p>
                        </div>
                      ) : null}
                      <span className="mt-3 inline-block text-sm font-medium text-emerald-800">상세 보기</span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <footer className="border-t border-gray-200 bg-white py-8 text-center text-xs text-gray-500">
          예약 및 결제는 여소남 공식 시스템에서 처리됩니다. 문의: 여소남 고객센터
        </footer>
      </main>
    </div>
  );
}
