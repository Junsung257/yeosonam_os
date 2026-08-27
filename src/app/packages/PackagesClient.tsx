'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';

import GlobalNav from '@/components/customer/GlobalNav';
import PackageCard from '@/components/customer/PackageCard';
import type { PublicCatalogItem } from '@/lib/public-catalog';

export class PackagesSearchError extends Error {
  constructor(message: string, public readonly status: number, public readonly code?: string) {
    super(message);
    this.name = 'PackagesSearchError';
  }
}

export type PublicPackageSearchItem = Pick<PublicCatalogItem,
  | 'id'
  | 'slug'
  | 'productKind'
  | 'title'
  | 'destination'
  | 'departureAirport'
  | 'duration'
  | 'heroImage'
  | 'priceDisplay'
  | 'availableDates'
  | 'badges'
  | 'bookingMode'
  | 'lastVerifiedAt'
>;

interface SearchResponse {
  packages: PublicPackageSearchItem[];
  total: number;
}

export async function packagesSearchFetcher(url: string): Promise<SearchResponse> {
  const response = await fetch(url);
  const payload = await response.json().catch(() => null) as Partial<SearchResponse> & {
    error?: string;
    code?: string;
  } | null;
  if (!response.ok) {
    throw new PackagesSearchError(
      payload?.error || '상품 목록을 불러오지 못했습니다.',
      response.status,
      payload?.code,
    );
  }
  if (!payload || !Array.isArray(payload.packages)) {
    throw new PackagesSearchError('상품 목록 응답 형식이 올바르지 않습니다.', response.status);
  }
  return { packages: payload.packages, total: Number(payload.total ?? payload.packages.length) };
}

type SortMode = 'recent' | 'price-low' | 'price-high';

function lowestPrice(item: PublicCatalogItem): number {
  const datePrices = item.availableDates
    .map((entry) => entry.price)
    .filter((price): price is number => typeof price === 'number' && price > 0);
  return datePrices.length > 0 ? Math.min(...datePrices) : item.price ?? Number.MAX_SAFE_INTEGER;
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

export default function PackagesClient({ initialPackages }: { initialPackages: PublicCatalogItem[] }) {
  const searchParams = useSearchParams();
  const initialQuery = searchParams.get('q')?.trim() ?? '';
  const initialDestination = searchParams.get('destination')?.trim() ?? '';
  const [query, setQuery] = useState(initialQuery);
  const [destination, setDestination] = useState(initialDestination);
  const [sortMode, setSortMode] = useState<SortMode>('recent');
  const [visibleCount, setVisibleCount] = useState(12);

  const destinations = useMemo(() => [...new Set(initialPackages
    .map((item) => item.destination)
    .filter((value): value is string => Boolean(value)))].sort(), [initialPackages]);
  const showDestinationFilter = initialPackages.length >= 6 && destinations.length > 1;
  const filtered = useMemo(() => {
    const normalizedQuery = query.toLocaleLowerCase('ko-KR');
    const result = initialPackages.filter((item) => {
      const searchable = `${item.title} ${item.destination ?? ''} ${item.country ?? ''}`.toLocaleLowerCase('ko-KR');
      return (!normalizedQuery || searchable.includes(normalizedQuery))
        && (!destination || item.destination === destination);
    });
    if (sortMode === 'price-low') result.sort((left, right) => lowestPrice(left) - lowestPrice(right));
    if (sortMode === 'price-high') result.sort((left, right) => lowestPrice(right) - lowestPrice(left));
    return result;
  }, [destination, initialPackages, query, sortMode]);
  const visible = filtered.slice(0, visibleCount);

  return (
    <div className="min-h-screen bg-white">
      <GlobalNav />
      <main className="mx-auto max-w-[1200px] px-4 pb-24 pt-8 md:px-6 md:pb-16">
        <div className="mb-7 max-w-3xl">
          <p className="mb-2 text-sm font-bold text-brand">여행상품 찾기</p>
          <h1 className="text-3xl font-black tracking-tight text-text-primary md:text-4xl">현재 예약 조건을 확인할 수 있는 상품</h1>
          <p className="mt-3 text-[15px] leading-7 text-text-secondary">
            공개 검증을 마친 상품만 보여드립니다. 가격과 좌석은 예약 전에 담당자가 한 번 더 확인합니다.
          </p>
        </div>

        <div className="mb-7 grid gap-3 rounded-[20px] border border-admin-border bg-bg-section p-4 md:grid-cols-[1fr_auto_auto]">
          <label className="min-w-0">
            <span className="sr-only">상품 검색</span>
            <input
              value={query}
              onChange={(event) => { setQuery(event.target.value); setVisibleCount(12); }}
              placeholder="여행지나 상품명을 검색하세요"
              className="min-h-12 w-full rounded-xl border border-admin-border bg-white px-4 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/15"
            />
          </label>
          {showDestinationFilter && (
            <label>
              <span className="sr-only">여행지</span>
              <select
                value={destination}
                onChange={(event) => { setDestination(event.target.value); setVisibleCount(12); }}
                className="min-h-12 w-full rounded-xl border border-admin-border bg-white px-4 text-sm md:w-44"
              >
                <option value="">여행지 전체</option>
                {destinations.map((name) => <option key={name} value={name}>{name}</option>)}
              </select>
            </label>
          )}
          <label>
            <span className="sr-only">정렬</span>
            <select
              value={sortMode}
              onChange={(event) => setSortMode(event.target.value as SortMode)}
              className="min-h-12 w-full rounded-xl border border-admin-border bg-white px-4 text-sm md:w-40"
            >
              <option value="recent">최근 확인순</option>
              <option value="price-low">가격 낮은순</option>
              <option value="price-high">가격 높은순</option>
            </select>
          </label>
        </div>

        <div className="mb-4 flex items-end justify-between gap-3">
          <p className="text-sm font-semibold text-text-primary">총 {filtered.length}개</p>
          <p className="text-xs text-text-secondary">상담 전용 상품은 카드에 별도로 표시됩니다.</p>
        </div>

        {visible.length > 0 ? (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {visible.map((item) => (
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
          <div className="rounded-[24px] border border-admin-border bg-bg-section px-6 py-14 text-center">
            <p className="font-bold text-text-primary">조건에 맞는 공개 상품이 없습니다.</p>
            <p className="mt-2 text-sm text-text-secondary">검색 조건을 줄이거나 실시간 견적으로 문의해 주세요.</p>
            <Link href="/private-tour" className="mt-5 inline-flex min-h-11 items-center rounded-full bg-brand px-5 text-sm font-bold text-white">
              실시간 견적 요청
            </Link>
          </div>
        )}

        {visible.length < filtered.length && (
          <div className="mt-8 text-center">
            <button
              type="button"
              onClick={() => setVisibleCount((count) => count + 12)}
              className="min-h-12 rounded-full border border-brand px-7 text-sm font-bold text-brand"
            >
              상품 더 보기
            </button>
          </div>
        )}
      </main>
    </div>
  );
}
