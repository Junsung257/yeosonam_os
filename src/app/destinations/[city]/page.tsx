import type { Metadata } from 'next';
import Image from 'next/image';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import GlobalNav from '@/components/customer/GlobalNav';
import PackageCard from '@/components/customer/PackageCard';
import { isSafeImageSrc } from '@/lib/image-url';
import { listPublicCatalog, type PublicCatalogItem } from '@/lib/public-catalog';
import { isSupabaseConfigured, supabaseAdmin } from '@/lib/supabase';

export const revalidate = 300;

const BASE_URL = (process.env.NEXT_PUBLIC_BASE_URL || process.env.NEXT_PUBLIC_SITE_URL || 'https://www.yeosonam.com')
  .replace(/\/+$/, '');

function cityParam(value: string | string[] | undefined): string {
  const raw = Array.isArray(value) ? value[0] : value ?? '';
  try {
    return decodeURIComponent(raw).trim();
  } catch {
    return raw.trim();
  }
}

function lowestPrice(item: PublicCatalogItem): number | undefined {
  const prices = item.availableDates
    .map((entry) => entry.price)
    .filter((price): price is number => typeof price === 'number' && price > 0);
  return prices.length > 0 ? Math.min(...prices) : item.price ?? undefined;
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

async function loadDestinationProducts(city: string): Promise<PublicCatalogItem[]> {
  if (!isSupabaseConfigured) return [];
  return listPublicCatalog(supabaseAdmin, { destination: city, limit: 100 }).catch((error) => {
    console.error('[destinations/city] public catalog unavailable', { city, error });
    return [];
  });
}

export async function generateMetadata({ params }: { params: Promise<{ city?: string | string[] }> }): Promise<Metadata> {
  const { city: rawCity } = await params;
  const city = cityParam(rawCity);
  if (!city) return { title: '여행지 가이드', robots: { index: false, follow: true } };
  return {
    title: `${city} 여행상품·가이드`,
    description: `${city} 여행상품의 미래 출발일과 최근 확인 조건을 보고, 예약 전 확인할 내용을 살펴보세요.`,
    alternates: { canonical: `${BASE_URL}/destinations/${encodeURIComponent(city)}` },
  };
}

export default async function DestinationPage({ params }: { params: Promise<{ city?: string | string[] }> }) {
  const { city: rawCity } = await params;
  const city = cityParam(rawCity);
  if (!city) notFound();
  const products = await loadDestinationProducts(city);
  const heroImage = products.find((item) => item.heroImage && isSafeImageSrc(item.heroImage))?.heroImage ?? null;

  return (
    <div className="min-h-screen bg-white">
      <GlobalNav />
      <main>
        <section className="relative isolate overflow-hidden bg-slate-950 text-white">
          {heroImage && (
            <Image src={heroImage} alt={`${city} 여행`} fill priority sizes="100vw" className="-z-20 object-cover opacity-50" />
          )}
          <div className="absolute inset-0 -z-10 bg-gradient-to-r from-slate-950 via-slate-950/75 to-slate-950/30" />
          <div className="mx-auto max-w-[1200px] px-5 py-16 md:px-8 md:py-24">
            <p className="text-sm font-bold text-blue-200">여행지 가이드</p>
            <h1 className="mt-2 text-4xl font-black tracking-tight md:text-5xl">{city} 여행</h1>
            <p className="mt-4 max-w-2xl text-sm leading-7 text-white/80 md:text-base">
              공개 검증을 마친 상품과 예약 전에 확인할 기준을 한곳에서 살펴보세요.
            </p>
          </div>
        </section>

        <section className="mx-auto max-w-[1200px] px-4 py-12 md:px-6 md:py-16" aria-labelledby="destination-products">
          <div className="mb-7 flex items-end justify-between gap-4">
            <div>
              <p className="text-sm font-bold text-brand">예약 가능한 상품</p>
              <h2 id="destination-products" className="mt-1 text-2xl font-black text-text-primary md:text-3xl">{city} 출발 일정</h2>
            </div>
            {products.length > 0 && <span className="text-sm font-semibold text-text-secondary">상품 {products.length}개</span>}
          </div>
          {products.length > 0 ? (
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {products.map((item) => (
                <div key={item.id}>
                  <PackageCard pkg={cardPackage(item)} precomputedMinPrice={lowestPrice(item)} />
                  <p className="px-1 pt-2 text-[11px] text-text-secondary">
                    최근 확인 {new Intl.DateTimeFormat('ko-KR', { dateStyle: 'medium' }).format(new Date(item.lastVerifiedAt))}
                  </p>
                </div>
              ))}
            </div>
          ) : (
            <div className="rounded-[24px] border border-admin-border bg-bg-section p-7">
              <p className="font-bold text-text-primary">현재 공개된 {city} 상품은 없습니다.</p>
              <p className="mt-2 text-sm leading-6 text-text-secondary">확정되지 않은 가격은 표시하지 않습니다. 원하시는 일정은 개별로 확인해 드립니다.</p>
              <Link href={`/private-tour?destination=${encodeURIComponent(city)}#private-tour-form`} className="mt-5 inline-flex min-h-11 items-center rounded-full bg-brand px-5 text-sm font-bold text-white">
                {city} 견적 요청
              </Link>
            </div>
          )}
        </section>

        <section className="bg-[#F8FAFC] py-12 md:py-16" aria-labelledby="destination-guides">
          <div className="mx-auto max-w-[1200px] px-4 md:px-6">
            <p className="text-sm font-bold text-brand">여행가이드</p>
            <h2 id="destination-guides" className="mt-1 text-2xl font-black text-text-primary md:text-3xl">{city} 예약 전에 확인할 것</h2>
            <div className="mt-7 grid gap-3 md:grid-cols-3">
              {['여행 시기와 날씨', '포함·불포함 비용', '부모님·아이 동반 동선'].map((topic) => (
                <Link
                  key={topic}
                  href={`/blog?q=${encodeURIComponent(`${city} ${topic}`)}`}
                  className="flex min-h-20 items-center justify-between rounded-[16px] border border-admin-border bg-white px-5 font-bold text-text-primary"
                >
                  {topic}<span className="text-brand" aria-hidden>→</span>
                </Link>
              ))}
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
