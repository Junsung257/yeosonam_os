import Image from 'next/image';
import Link from 'next/link';

import GlobalNav from '@/components/customer/GlobalNav';
import PackageCard from '@/components/customer/PackageCard';
import { loadPublicBlogCatalogPage } from '@/lib/blog-public-catalog';
import { selectCurrentCustomerGuides } from '@/lib/customer-guide-selection';
import { isSafeImageSrc } from '@/lib/image-url';
import { serializeJsonLdForScript } from '@/lib/json-ld';
import { listPublicCatalog, type PublicCatalogItem } from '@/lib/public-catalog';
import { isSupabaseConfigured, supabaseAdmin } from '@/lib/supabase';

export const revalidate = 300;

const BASE_URL = (process.env.NEXT_PUBLIC_BASE_URL || process.env.NEXT_PUBLIC_SITE_URL || 'https://www.yeosonam.com')
  .replace(/\/+$/, '');

const BUSINESS_AREAS = [
  { icon: '✈️', title: '패키지', description: '출발일과 최근 확인 가격을 비교', href: '/packages' },
  { icon: '🚢', title: '크루즈', description: '항차·객실·현재 요금을 확인', href: '/cruise' },
  { icon: '⛳', title: '해외골프', description: '인원과 지역에 맞춘 견적', href: '/packages?category=golf' },
  { icon: '👥', title: '단독·단체', description: '우리 일행만을 위한 일정', href: '/private-tour' },
] as const;

function lowestPrice(item: PublicCatalogItem): number | undefined {
  const prices = item.availableDates
    .map((entry) => entry.price)
    .filter((price): price is number => typeof price === 'number' && price > 0);
  if (prices.length > 0) return Math.min(...prices);
  return item.price && item.price > 0 ? item.price : undefined;
}

function cardPackage(item: PublicCatalogItem) {
  return {
    id: item.id,
    title: item.title,
    destination: item.destination,
    duration: item.duration,
    nights: item.nights,
    price: item.price,
    product_type: item.productKind,
    departure_airport: item.departureAirport,
    product_highlights: item.badges,
    hero_image_url: item.heroImage,
    price_dates: item.availableDates.map((entry) => ({
      date: entry.date,
      price: entry.price ?? item.price ?? 0,
      confirmed: entry.confirmed ?? false,
    })),
  };
}

export default async function HomePage() {
  const [catalog, guideCatalog] = await Promise.all([
    isSupabaseConfigured
      ? listPublicCatalog(supabaseAdmin, { limit: 6 }).catch((error) => {
        console.error('[home] public catalog unavailable', error);
        return [];
      })
      : Promise.resolve([]),
    loadPublicBlogCatalogPage({ page: 1, pageSize: 24 }),
  ]);
  const guides = selectCurrentCustomerGuides(guideCatalog.posts, 4);
  const heroImage = catalog.find((item) => item.heroImage && isSafeImageSrc(item.heroImage))?.heroImage ?? null;

  return (
    <div className="min-h-screen bg-white">
      <script
        type="application/ld+json"
        suppressHydrationWarning
        dangerouslySetInnerHTML={{
          __html: serializeJsonLdForScript({
            '@context': 'https://schema.org',
            '@type': 'TravelAgency',
            name: '여소남',
            alternateName: '가치 있는 여행을 소개하는 남자',
            url: BASE_URL,
            logo: `${BASE_URL}/logo.png`,
            description: '부산 출발 패키지·크루즈·골프 상품의 실제 예약 조건을 확인하는 여행사',
            areaServed: 'KR',
          }),
        }}
      />
      <GlobalNav />

      <main>
        <section className="relative isolate overflow-hidden bg-slate-950 text-white">
          {heroImage && (
            <Image
              src={heroImage}
              alt="여소남 여행상품"
              fill
              priority
              sizes="100vw"
              className="-z-20 object-cover opacity-55"
            />
          )}
          <div className="absolute inset-0 -z-10 bg-gradient-to-r from-slate-950 via-slate-950/80 to-slate-950/30" />
          <div className="mx-auto max-w-[1200px] px-5 py-20 md:px-8 md:py-28">
            <p className="mb-4 text-sm font-bold text-blue-200">여소남 · 부산 출발 여행</p>
            <h1 className="max-w-3xl text-4xl font-black leading-[1.15] tracking-tight md:text-6xl">
              부산에서 떠나는<br />패키지·크루즈·골프
            </h1>
            <p className="mt-5 max-w-2xl text-base leading-7 text-white/80 md:text-lg">
              출발일·가격·포함 조건을 비교하고, 예약 전 실시간 가능 여부를 다시 확인합니다.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link href="/packages" className="inline-flex min-h-12 items-center rounded-full bg-white px-6 text-sm font-bold text-brand">
                여행상품 찾기
              </Link>
              <a
                href="https://pf.kakao.com/_xcFxkBG/chat"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex min-h-12 items-center rounded-full bg-[#FEE500] px-6 text-sm font-bold text-[#3C1E1E]"
              >
                카카오로 문의
              </a>
            </div>
          </div>
        </section>

        <section className="mx-auto max-w-[1200px] px-4 py-10 md:px-6 md:py-14" aria-labelledby="business-area-title">
          <h2 id="business-area-title" className="sr-only">여소남 여행상품 종류</h2>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {BUSINESS_AREAS.map((area) => (
              <Link
                key={area.title}
                href={area.href}
                className="rounded-[18px] border border-admin-border bg-white p-5 shadow-card transition hover:-translate-y-0.5 hover:shadow-card-hover"
              >
                <span className="text-3xl" aria-hidden>{area.icon}</span>
                <h3 className="mt-4 text-lg font-black text-text-primary">{area.title}</h3>
                <p className="mt-1 text-sm leading-6 text-text-secondary">{area.description}</p>
              </Link>
            ))}
          </div>
        </section>

        <section className="bg-[#F8FAFC] py-12 md:py-16" aria-labelledby="available-products-title">
          <div className="mx-auto max-w-[1200px] px-4 md:px-6">
            <div className="mb-7 flex items-end justify-between gap-4">
              <div>
                <p className="text-sm font-bold text-brand">공개 검증 완료</p>
                <h2 id="available-products-title" className="mt-1 text-2xl font-black tracking-tight text-text-primary md:text-3xl">
                  지금 확인할 수 있는 여행
                </h2>
                <p className="mt-2 text-sm leading-6 text-text-secondary">미래 출발일과 승인된 고객용 정보가 있는 상품만 표시합니다.</p>
              </div>
              <Link href="/packages" className="shrink-0 text-sm font-bold text-brand">전체 보기 →</Link>
            </div>
            {catalog.length > 0 ? (
              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                {catalog.map((item) => (
                  <div key={item.id} className="relative">
                    {item.bookingMode !== 'inquiry' && (
                      <span className="absolute right-3 top-3 z-10 rounded-full bg-white/95 px-2.5 py-1 text-[11px] font-bold text-brand shadow-sm">
                        {item.bookingMode === 'consultation_only' ? '상담 전용' : '현재 요금 확인'}
                      </span>
                    )}
                    <PackageCard pkg={cardPackage(item)} precomputedMinPrice={lowestPrice(item)} />
                    <p className="px-1 pt-2 text-[11px] text-text-secondary">
                      최근 확인 {new Intl.DateTimeFormat('ko-KR', { dateStyle: 'medium' }).format(new Date(item.lastVerifiedAt))}
                    </p>
                  </div>
                ))}
              </div>
            ) : (
              <div className="rounded-[24px] border border-admin-border bg-white px-6 py-12 text-center">
                <p className="font-bold text-text-primary">현재 공개 검증을 마친 상품을 준비 중입니다.</p>
                <p className="mt-2 text-sm text-text-secondary">원하시는 지역과 일정을 알려주시면 담당자가 확인합니다.</p>
                <Link href="/private-tour" className="mt-5 inline-flex min-h-11 items-center rounded-full bg-brand px-5 text-sm font-bold text-white">
                  실시간 견적 요청
                </Link>
              </div>
            )}
          </div>
        </section>

        <section className="mx-auto max-w-[1200px] px-4 py-12 md:px-6 md:py-16">
          <div className="grid overflow-hidden rounded-[24px] bg-gradient-to-br from-[#0B2559] to-brand text-white md:grid-cols-[1.3fr_0.7fr]">
            <div className="p-7 md:p-10">
              <p className="text-sm font-bold text-blue-200">ROYAL CARIBBEAN CRUISE</p>
              <h2 className="mt-2 text-3xl font-black">로열캐리비안 크루즈</h2>
              <p className="mt-4 max-w-xl text-sm leading-7 text-white/80">
                항차와 객실을 먼저 확인하고, 현재 객실과 요금은 상담 요청 시 실시간으로 다시 조회합니다.
              </p>
              <Link href="/cruise" className="mt-6 inline-flex min-h-11 items-center rounded-full bg-white px-5 text-sm font-bold text-brand">
                크루즈 안내 보기
              </Link>
            </div>
            <div className="flex min-h-44 items-center justify-center bg-white/10 text-7xl" aria-hidden>🚢</div>
          </div>
        </section>

        <section className="bg-[#F8FAFC] py-12 md:py-16" aria-labelledby="guide-title">
          <div className="mx-auto max-w-[1200px] px-4 md:px-6">
            <div className="mb-7 flex items-end justify-between">
              <div>
                <p className="text-sm font-bold text-brand">여행가이드</p>
                <h2 id="guide-title" className="mt-1 text-2xl font-black text-text-primary md:text-3xl">예약 전에 필요한 기준</h2>
              </div>
              <Link href="/blog" className="text-sm font-bold text-brand">전체 가이드 →</Link>
            </div>
            {guides.length > 0 ? (
              <div className="grid gap-3 md:grid-cols-2">
                {guides.map((guide, index) => (
                  <Link key={guide.id} href={`/blog/${guide.slug}`} className="flex min-h-20 items-center gap-4 rounded-[16px] border border-admin-border bg-white px-5 py-4 shadow-sm">
                    <span className="text-sm font-black text-brand">0{index + 1}</span>
                    <span>
                      <span className="block font-bold text-text-primary">{guide.seo_title}</span>
                      <span className="mt-1 block text-xs font-medium text-text-secondary">
                        {new Intl.DateTimeFormat('ko-KR', { dateStyle: 'medium' }).format(new Date(guide.published_at))}
                      </span>
                    </span>
                    <span className="ml-auto text-text-secondary" aria-hidden>→</span>
                  </Link>
                ))}
              </div>
            ) : (
              <div className="rounded-[16px] border border-admin-border bg-white px-5 py-8 text-sm text-text-secondary">
                최신성·품질 검수를 마친 여행가이드를 준비 중입니다.
              </div>
            )}
          </div>
        </section>

        <section className="mx-auto max-w-[1200px] px-4 py-12 md:px-6 md:py-16" aria-labelledby="trust-title">
          <div className="rounded-[24px] border border-admin-border p-6 md:p-8">
            <h2 id="trust-title" className="text-2xl font-black text-text-primary">예약 전에 운영 정보를 확인하세요</h2>
            <p className="mt-2 text-sm leading-6 text-text-secondary">
              상품별 출발 여부와 예약 조건은 상세 화면에 표시하고, 확정 전 담당자가 최신 상태를 다시 안내합니다.
            </p>
            <div className="mt-6 flex flex-wrap gap-2">
              {[
                ['회사소개', '/about'],
                ['이용약관', '/terms'],
                ['개인정보처리방침', '/privacy'],
                ['취소·환불 안내', '/terms'],
                ['고객센터', '/group'],
              ].map(([label, href]) => (
                <Link key={label} href={href} className="inline-flex min-h-11 items-center rounded-full border border-admin-border px-4 text-sm font-semibold text-text-primary">
                  {label}
                </Link>
              ))}
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-admin-border bg-white px-4 py-10 text-center">
        <p className="text-sm font-bold text-text-primary">여소남 · 부산 출발 여행 상담</p>
        <p className="mt-2 text-xs text-text-secondary">www.yeosonam.com · help@yeosonam.com</p>
        <div className="mt-4 flex flex-wrap justify-center gap-x-4 gap-y-2 text-xs text-text-secondary">
          <Link href="/about">회사소개</Link>
          <Link href="/terms">이용약관</Link>
          <Link href="/privacy">개인정보처리방침</Link>
          <Link href="/group">고객센터</Link>
        </div>
      </footer>
    </div>
  );
}
