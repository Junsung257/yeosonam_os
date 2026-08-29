import { NextRequest } from 'next/server';
import { apiResponse } from '@/lib/api-response';
import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';
import {
  normalizeDepartureHub,
  hubMatchesDepartureAirport,
  type DepartureHubId,
} from '@/lib/departure-hub';
import { logError } from '@/lib/sentry-logger';
import { getPersonalizedOverride } from '@/lib/recommendation/personalized';
import { getActivePolicy } from '@/lib/scoring/policy';
import { buildRecommendationDisplay, type PackageScoreDisplayRow } from '@/lib/scoring/recommendation-display';
import { listPublicCatalog, type PublicCatalogItem } from '@/lib/public-catalog';

// 옵션 4a 패턴 — Page 정적 prerender 를 위해 server-side fetch 를 API 로 이관.
// 응답에 Cache-Control 헤더 적용 → Vercel Edge CDN 이 query string 별 cache.
// (Page 는 dynamic 페이지여도 next.config.js headers() 가 덮어쓰여지는 문제 회피 —
//  근거: https://github.com/vercel/next.js/issues/22319, /issues/69920)

export async function GET(request: NextRequest) {
  if (!isSupabaseConfigured) {
    return apiResponse({
      packages: [],
      imageByPkgId: {},
      recommendedIds: [],
      recommendedReasonMap: {},
      scoreByPkgId: {},
      scoreReasonMap: {},
      rankByPkgId: {},
      comparisonGroupSizeMap: {},
      hub: 'all' as DepartureHubId,
      filterForClient: '',
    });
  }

  try {
    const { searchParams } = request.nextUrl;
    const destination = searchParams.get('destination') || '';
    const rawFilter = searchParams.get('filter') || '';
    let hub = normalizeDepartureHub(searchParams.get('hub'));
    if (rawFilter === '인천출발' && !searchParams.get('hub')) hub = 'incheon';
    const filterForClient = rawFilter === '인천출발' ? '' : rawFilter;

    const q = (searchParams.get('q') || '').trim();
    const month = searchParams.get('month') || '';
    const priceMin = searchParams.get('priceMin') || '';
    const priceMax = searchParams.get('priceMax') || '';
    const urgency = searchParams.get('urgency') || '';
    const category = searchParams.get('category') || '';
    const sb = supabaseAdmin;

    const urgencyOn = urgency === '1';
    const fetchLimit = urgencyOn ? 200 : 50;
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() + 14);
    const cutoffStr = cutoff.toISOString().slice(0, 10);
    const safeQuery = q.replace(/[%,]/g, ' ').toLowerCase();
    const minimum = priceMin ? Number(priceMin) : null;
    const maximum = priceMax ? Number(priceMax) : null;
    const catalog = await listPublicCatalog(sb, { limit: 5_000 });
    const visibleCatalog = catalog.filter((item) => {
      const itemMinimum = item.availableDates
        .map(entry => entry.price)
        .filter((price): price is number => typeof price === 'number' && price > 0)
        .sort((left, right) => left - right)[0] ?? item.price;
      const matchesBudget = itemMinimum === null
        ? minimum === null && maximum === null
        : (minimum === null || itemMinimum >= minimum) && (maximum === null || itemMinimum <= maximum);
      const matchesMonth = !month || item.availableDates.some(entry => entry.date.startsWith(month));
      const matchesUrgency = !urgencyOn || item.availableDates.some(entry => entry.date <= cutoffStr);
      return (!destination || String(item.destination ?? '').toLowerCase().includes(destination.toLowerCase()))
        && (hub === 'all' || hubMatchesDepartureAirport(hub, item.departureAirport))
        && (!category || item.productKind === category)
        && (!safeQuery || `${item.destination ?? ''} ${item.title}`.toLowerCase().includes(safeQuery))
        && matchesBudget
        && matchesMonth
        && matchesUrgency;
    }).slice(0, fetchLimit);

    const packages = visibleCatalog.slice(0, 50).map((item: PublicCatalogItem) => ({
      id: item.id,
      slug: item.slug,
      productKind: item.productKind,
      title: item.title,
      departureAirport: item.departureAirport,
      heroImage: item.heroImage,
      priceDisplay: item.priceDisplay,
      availableDates: item.availableDates,
      badges: item.badges,
      bookingMode: item.bookingMode,
      lastVerifiedAt: item.lastVerifiedAt,
      display_title: item.title,
      destination: item.destination,
      country: item.country,
      duration: item.duration,
      nights: item.nights,
      price: item.price,
      price_dates: item.availableDates.map(entry => ({
        date: entry.date,
        price: entry.price ?? 0,
        confirmed: entry.confirmed ?? false,
      })),
      product_type: item.productKind,
      departure_airport: item.departureAirport,
      product_highlights: item.badges,
      hero_image_url: item.heroImage,
      thumbnail_urls: item.heroImage ? [item.heroImage] : [],
      booking_mode: item.bookingMode,
      last_verified_at: item.lastVerifiedAt,
    }));
    const imageByPkgId = Object.fromEntries(visibleCatalog.map(item => [item.id, item.heroImage]));

    // ── 개인화 추천 (x-customer-id 헤더 기반) ──────────────
    const customerId = request.headers.get('x-customer-id') || '';
    const pkgIds = packages.map((p: { id?: string }) => p.id).filter(Boolean) as string[];
    let recommendedIds: string[] = [];
    const recommendedReasonMap: Record<string, string[]> = {};
    let personalizedPayload: { reason: string } | undefined;

    if (customerId && pkgIds.length > 0) {
      // 개인화: customer_unified_profile 기반 weight override
      const policy = await getActivePolicy();
      const personalized = await getPersonalizedOverride(customerId, policy);
      if (personalized) {
        // Find packages matching boosted destinations
        const boostedPkgs = packages.filter((p: any) =>
          personalized.boostedDestinations.some(
            (d) => p.destination?.toLowerCase().includes(d.toLowerCase()),
          ),
        );
        recommendedIds = boostedPkgs.map((p: any) => p.id).slice(0, 5);
        for (const pkg of boostedPkgs.slice(0, 5)) {
          recommendedReasonMap[pkg.id] = [personalized.reason];
        }
        personalizedPayload = { reason: personalized.reason };
      }
      // profile 없으면 fall through → 일반 추천
    }

    const scoreByPkgId: Record<string, ReturnType<typeof buildRecommendationDisplay>> = {};
    const scoreReasonMap: Record<string, string[]> = {};
    const rankByPkgId: Record<string, number> = {};
    const comparisonGroupSizeMap: Record<string, number> = {};

    // 그룹 점수 전체 전달: 리뷰가 없는 상품도 비교판정 UI를 띄울 수 있게 한다.
    if (pkgIds.length > 0) {
      const { data: scores } = await sb
        .from('package_scores')
        .select('package_id, group_key, departure_date, list_price, effective_price, topsis_score, rank_in_group, group_size, breakdown, shopping_count, hotel_avg_grade, free_option_count, is_direct_flight, duration_days')
        .in('package_id', pkgIds)
        .order('group_size', { ascending: false })
        .order('rank_in_group', { ascending: true });
      const bestRows = new Map<string, PackageScoreDisplayRow>();
      for (const raw of (scores ?? []) as PackageScoreDisplayRow[]) {
        if (!raw.package_id || bestRows.has(raw.package_id)) continue;
        bestRows.set(raw.package_id, raw);
      }
      for (const [packageId, row] of bestRows.entries()) {
        const display = buildRecommendationDisplay(row);
        scoreByPkgId[packageId] = display;
        if (display) {
          scoreReasonMap[packageId] = display.reasons;
          if (display.rankInGroup != null) rankByPkgId[packageId] = display.rankInGroup;
          comparisonGroupSizeMap[packageId] = display.groupSize;
          if (display.hasComparison && display.rankInGroup === 1 && !recommendedIds.includes(packageId)) {
            recommendedIds.push(packageId);
          }
          if (!recommendedReasonMap[packageId]) recommendedReasonMap[packageId] = display.reasons;
        }
      }
    }

    return apiResponse(
      {
        packages,
        imageByPkgId,
        recommendedIds,
        recommendedReasonMap,
        scoreByPkgId,
        scoreReasonMap,
        rankByPkgId,
        comparisonGroupSizeMap,
        hub,
        filterForClient,
        personalized: personalizedPayload,
      },
      {
        // Vercel Edge CDN: query string 별 cache key 누적 HIT.
        // API route 응답 헤더는 dynamic page 와 달리 그대로 적용됨.
        headers: { 'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=300' },
      },
    );
  } catch (error) {
    logError('[api/packages/search] GET failed', error);
    return apiResponse(
      { error: error instanceof Error ? error.message : '검색 실패' },
      { status: 500 },
    );
  }
}
