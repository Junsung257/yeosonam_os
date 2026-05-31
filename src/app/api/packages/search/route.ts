import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';
import {
  normalizeDepartureHub,
  departureHubSupabaseOr,
  hubMatchesDepartureAirport,
  type DepartureHubId,
} from '@/lib/departure-hub';
import { pickUnusedAttractionPhotoUrl } from '@/lib/image-url';
import { logError } from '@/lib/sentry-logger';
import { getPersonalizedOverride } from '@/lib/recommendation/personalized';
import { getActivePolicy } from '@/lib/scoring/policy';
import { buildRecommendationDisplay, type PackageScoreDisplayRow } from '@/lib/scoring/recommendation-display';

// 옵션 4a 패턴 — Page 정적 prerender 를 위해 server-side fetch 를 API 로 이관.
// 응답에 Cache-Control 헤더 적용 → Vercel Edge CDN 이 query string 별 cache.
// (Page 는 dynamic 페이지여도 next.config.js headers() 가 덮어쓰여지는 문제 회피 —
//  근거: https://github.com/vercel/next.js/issues/22319, /issues/69920)

const PACKAGE_FIELDS = `
  id, title, destination, country, category, product_type, trip_style,
  departure_days, departure_airport, airline, min_participants, ticketing_deadline,
  price, price_tiers, price_list, price_dates, status, created_at,
  product_tags, product_highlights, product_summary,
  internal_code, is_airtel, display_title, hero_tagline, duration, nights,
  avg_rating, review_count,
  seats_held, seats_confirmed,
  catalog_id,
  products(internal_code, display_name)
`;

export async function GET(request: NextRequest) {
  if (!isSupabaseConfigured) {
    return NextResponse.json({
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
    const hubOr = departureHubSupabaseOr(hub);
    const fetchLimit = urgencyOn ? 200 : 50;

    let query = sb
      .from('travel_packages')
      .select(PACKAGE_FIELDS)
      .in('status', ['active', 'approved'])
      .or('audit_status.is.null,audit_status.neq.blocked')
      .order('created_at', { ascending: false })
      .limit(fetchLimit);

    if (destination) {
      query = query.ilike('destination', `%${destination}%`);
    }

    if (urgencyOn) {
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() + 14);
      const cutoffStr = cutoff.toISOString().slice(0, 10);
      query = query.or(`product_type.eq.urgency,ticketing_deadline.lte.${cutoffStr}`);
    }

    if (hubOr && !urgencyOn) {
      query = query.or(hubOr);
    }

    if (category) {
      query = query.eq('category', category);
    }

    if (q) {
      const safe = q.replace(/[%,]/g, ' ');
      query = query.or(`destination.ilike.%${safe}%,title.ilike.%${safe}%,display_title.ilike.%${safe}%`);
    }

    const { data: rawPackages, error: pkgErr } = await query;
    if (pkgErr) throw pkgErr;

    const today = new Date().toISOString().slice(0, 10);
    let aliveRaw = (rawPackages ?? []).filter((p: any) => {
      const pd = (p.price_dates || []) as Array<{ date?: string }>;
      if (pd.length === 0) return true;
      return pd.some(d => d?.date && d.date >= today);
    });

    if (urgencyOn && hub !== 'all') {
      aliveRaw = aliveRaw.filter((p: any) => hubMatchesDepartureAirport(hub, p.departure_airport));
    }

    aliveRaw = aliveRaw.slice(0, 50);

    const packages = aliveRaw.map((pkg: any) => ({
      ...pkg,
      products: Array.isArray(pkg.products) ? pkg.products[0] ?? null : pkg.products,
    }));

    // 관광지 사진 — 지역/국가별 Map으로 O(1) 조회 (기존 O(N²) 루프 제거)
    const attractionLimit = destination || q ? 180 : 240;
    let attractionQuery = sb
      .from('attractions')
      .select('name, photos, country, region, mention_count')
      .not('photos', 'is', null)
      .order('mention_count', { ascending: false })
      .limit(attractionLimit);

    const hintParts = Array.from(
      new Set(
        (aliveRaw ?? [])
          .flatMap((p: any) => String(p?.destination || '').split(/[\/,\s]/))
          .map((s: string) => s.trim())
          .filter((s: string) => s.length >= 2),
      ),
    ).slice(0, 6);
    if (hintParts.length > 0) {
      const ors = hintParts
        .map((part) => `region.ilike.%${part}%,country.ilike.%${part}%`)
        .join(',');
      attractionQuery = attractionQuery.or(ors);
    }

    const { data: attractions } = await attractionQuery;

    // attractions를 region/country별 Map으로 인덱싱 (O(1) 조회)
    const countryIndex = new Map<string, any[]>();
    const regionIndex = new Map<string, any[]>();
    for (const a of (attractions ?? [])) {
      const c = (a.country || '').toLowerCase();
      const r = (a.region || '').toLowerCase();
      if (a.photos?.length > 0) {
        if (c) {
          if (!countryIndex.has(c)) countryIndex.set(c, []);
          countryIndex.get(c)!.push(a);
        }
        if (r && r !== c) {
          if (!regionIndex.has(r)) regionIndex.set(r, []);
          regionIndex.get(r)!.push(a);
        }
      }
    }
    // 각 버킷 mention_count 내림차순 정렬 (1회)
    for (const idx of [countryIndex, regionIndex]) {
      for (const [, list] of idx) {
        list.sort((a: any, b: any) => (b.mention_count || 0) - (a.mention_count || 0));
      }
    }

    const _usedPhotoUrls = new Set<string>();
    const imageByPkgId: Record<string, string | null> = {};
    for (const pkg of packages) {
      let chosen: string | null = null;
      const destParts = (pkg.destination || '').split(/[\/,\s]/).map((s: string) => s.trim()).filter((s: string) => s.length > 0);
      // Map 조회로 O(1): 패키지 destination → country/region 키로 바로 찾기
      for (const part of destParts) {
        const partLc = part.toLowerCase();
        const candidates = countryIndex.get(partLc) ?? regionIndex.get(partLc) ?? [];
        for (const attr of candidates) {
          const url = pickUnusedAttractionPhotoUrl(attr.photos, _usedPhotoUrls);
          if (url) { chosen = url; break; }
        }
        if (chosen) break;
      }
      if (!chosen) {
        const thumb = ((pkg as Record<string, unknown>).thumbnail_urls as string[] | undefined)?.find((u: string) => u?.startsWith('http'));
        if (thumb) chosen = thumb;
      }
      imageByPkgId[pkg.id] = chosen ?? null;
    }

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

    return NextResponse.json(
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
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '검색 실패' },
      { status: 500 },
    );
  }
}
