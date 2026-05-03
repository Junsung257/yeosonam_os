import Image from 'next/image';
import Link from 'next/link';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { cookies } from 'next/headers';
import GlobalNav from '@/components/customer/GlobalNav';
import { SafeCoverImg } from '@/components/customer/SafeRemoteImage';
import { isSupabaseConfigured, supabaseAdmin } from '@/lib/supabase';
import { looksLikeReferralCode, normalizeAffiliateReferralCode } from '@/lib/affiliate-ref-code';
import { isSafeImageSrc } from '@/lib/image-url';

/** 랜딩 조회수(affiliate_touchpoints)가 방문마다 기록되도록 캐시 비활성화 */
export const dynamic = 'force-dynamic';

const PKG_CARD_FIELDS =
  'id, title, destination, country, price, display_title, product_summary, product_highlights, status';

interface PageProps {
  params: { slug: string };
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const slug = normalizeAffiliateReferralCode(decodeURIComponent(params.slug));
  const base = process.env.NEXT_PUBLIC_BASE_URL || process.env.NEXT_PUBLIC_SITE_URL || 'https://www.yeosonam.com';
  if (!looksLikeReferralCode(slug)) {
    return { title: '제휴 랜딩', robots: { index: false, follow: false } };
  }
  let name = slug;
  if (isSupabaseConfigured) {
    const { data } = await supabaseAdmin
      .from('affiliates')
      .select('name')
      .eq('referral_code', slug)
      .eq('is_active', true)
      .maybeSingle();
    if (data && (data as { name?: string }).name) name = (data as { name: string }).name;
  }
  return {
    title: `${name} × 여소남`,
    description: `${name}님과 함께하는 여소남 패키지 여행. 제휴 혜택이 적용됩니다.`,
    robots: { index: false, follow: false },
    alternates: { canonical: `${base}/with/${encodeURIComponent(slug)}` },
  };
}

export default async function AffiliateCoBrandLandingPage({ params }: PageProps) {
  const slug = normalizeAffiliateReferralCode(decodeURIComponent(params.slug));
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

  const { data: aff, error: affErr } = await supabaseAdmin
    .from('affiliates')
    .select('name, referral_code, logo_url, landing_intro, landing_pick_package_ids')
    .eq('referral_code', slug)
    .eq('is_active', true)
    .maybeSingle();

  if (affErr || !aff) notFound();

  const row = aff as {
    name: string;
    referral_code: string;
    logo_url?: string | null;
    landing_intro?: string | null;
    landing_pick_package_ids?: string[] | null;
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

  if (pickIds.length > 0) {
    const { data: picked } = await supabaseAdmin
      .from('travel_packages')
      .select(PKG_CARD_FIELDS)
      .in('id', pickIds)
      .in('status', ['active', 'approved'])
      .or('audit_status.is.null,audit_status.neq.blocked');
    const order = new Map(pickIds.map((id, i) => [id, i]));
    picks = (picked || []).sort(
      (a: { id: string }, b: { id: string }) => (order.get(a.id) ?? 99) - (order.get(b.id) ?? 99),
    );
  }

  if (picks.length === 0) {
    const { data: fallback } = await supabaseAdmin
      .from('travel_packages')
      .select(PKG_CARD_FIELDS)
      .in('status', ['active', 'approved'])
      .or('audit_status.is.null,audit_status.neq.blocked')
      .order('created_at', { ascending: false })
      .limit(6);
    picks = fallback || [];
  }

  const refQ = encodeURIComponent(row.referral_code);
  const intro =
    row.landing_intro?.trim() ||
    `안녕하세요, ${row.name}입니다. 여소남과 함께 엄선한 패키지를 소개합니다. 아래 상품은 이 링크로 예약 시 제휴 혜택이 적용됩니다.`;

  try {
    const sid = cookies().get('ys_session_id')?.value || `ssr-${Date.now()}`;
    await supabaseAdmin.from('affiliate_touchpoints').insert({
      session_id: sid,
      referral_code: row.referral_code,
      package_id: null,
      sub_id: 'co_brand_landing',
      is_bot: false,
      is_duplicate: false,
    } as never);
  } catch {
    /* 랜딩 조회수 기록 실패는 페이지 노출에 영향 없음 */
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <GlobalNav />
      <main>
        <section className="border-b border-gray-200 bg-white">
          <div className="mx-auto max-w-5xl px-4 py-10 sm:py-14">
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
          {picks.length === 0 ? (
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
                      href={`/packages/${pkg.id}?ref=${refQ}`}
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
                        <p className="mt-4 text-lg font-bold text-gray-900">
                          {pkg.price.toLocaleString('ko-KR')}
                          <span className="text-sm font-normal text-gray-500">원~</span>
                        </p>
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
