import { NextRequest } from 'next/server';

import { apiResponse } from '@/lib/api-response';
import { hubMatchesDepartureAirport, normalizeDepartureHub } from '@/lib/departure-hub';
import { logError } from '@/lib/sentry-logger';
import { listPublicCatalog, type PublicCatalogItem } from '@/lib/public-catalog';
import { isSupabaseConfigured, supabaseAdmin } from '@/lib/supabase';

function includesQuery(item: PublicCatalogItem, query: string): boolean {
  if (!query) return true;
  return [item.title, item.destination, item.country, item.departureAirport]
    .filter((value): value is string => Boolean(value))
    .join(' ')
    .toLocaleLowerCase('ko-KR')
    .includes(query);
}

function inMonth(item: PublicCatalogItem, month: string): boolean {
  return !month || item.availableDates.some((entry) => entry.date.startsWith(month));
}

function inPriceRange(item: PublicCatalogItem, minimum: number | null, maximum: number | null): boolean {
  const candidate = item.price ?? item.availableDates
    .map((entry) => entry.price)
    .filter((price): price is number => typeof price === 'number' && price > 0)
    .sort((left, right) => left - right)[0] ?? null;
  if (candidate === null) return minimum === null && maximum === null;
  return (minimum === null || candidate >= minimum) && (maximum === null || candidate <= maximum);
}

function numberParam(value: string | null): number | null {
  if (!value) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

export async function GET(request: NextRequest) {
  if (!isSupabaseConfigured) {
    return apiResponse({ packages: [], total: 0 });
  }

  try {
    const { searchParams } = request.nextUrl;
    const query = (searchParams.get('q') ?? '').trim().toLocaleLowerCase('ko-KR');
    const destination = (searchParams.get('destination') ?? '').trim().toLocaleLowerCase('ko-KR');
    const month = (searchParams.get('month') ?? '').trim();
    const productKind = (searchParams.get('category') ?? '').trim();
    const hub = normalizeDepartureHub(searchParams.get('hub'));
    const minimum = numberParam(searchParams.get('priceMin'));
    const maximum = numberParam(searchParams.get('priceMax'));
    const limit = Math.max(1, Math.min(100, numberParam(searchParams.get('limit')) ?? 50));

    const catalog = await listPublicCatalog(supabaseAdmin, {
      limit: 5_000,
      ...(productKind ? { productKind } : {}),
    });
    const packages = catalog
      .filter((item) => !destination || item.destination?.toLocaleLowerCase('ko-KR').includes(destination))
      .filter((item) => hub === 'all' || hubMatchesDepartureAirport(hub, item.departureAirport))
      .filter((item) => includesQuery(item, query))
      .filter((item) => inMonth(item, month))
      .filter((item) => inPriceRange(item, minimum, maximum));
    const publicPackages = packages.slice(0, limit).map((item) => ({
      id: item.id,
      slug: item.slug,
      productKind: item.productKind,
      title: item.title,
      destination: item.destination,
      departureAirport: item.departureAirport,
      duration: item.duration,
      heroImage: item.heroImage,
      priceDisplay: item.priceDisplay,
      availableDates: item.availableDates,
      badges: item.badges,
      bookingMode: item.bookingMode,
      lastVerifiedAt: item.lastVerifiedAt,
    }));

    return apiResponse(
      { packages: publicPackages, total: packages.length },
      { headers: { 'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=300' } },
    );
  } catch (error) {
    logError('[api/packages/search] public catalog lookup failed', error);
    return apiResponse(
      { error: '상품 목록을 불러오지 못했습니다.', code: 'PUBLIC_CATALOG_UNAVAILABLE' },
      { status: 503 },
    );
  }
}
