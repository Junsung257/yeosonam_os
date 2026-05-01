import type React from 'react';
import { notFound } from 'next/navigation';
import { supabaseAdmin } from '@/lib/supabase';
import DetailClient from './DetailClient';
import ReviewsSection from '@/components/reviews/ReviewsSection';
import type { Metadata } from 'next';
import { matchAttractions, normalizeDays, buildAttractionIndex, matchAttractionIndexed } from '@/lib/attraction-matcher';
import type { AttractionData } from '@/lib/attraction-matcher';
import { resolveTermsForPackage, formatCancellationDates, type NoticeBlock } from '@/lib/standard-terms';
import { pickRepresentativeMonths } from '@/lib/travel-fitness-score';

export const revalidate = 3600; // 1시간 ISR (상품 데이터 변경 빈도 낮음) // refreshed 2026-04-22

// SEO: 동적 메타데이터
export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const sb = supabaseAdmin;
  const { data } = await sb
    .from('travel_packages')
    .select('title, destination, price, product_summary')
    .eq('id', id)
    .single();

  if (!data) return { title: '상품 상세 | 여소남' };

  return {
    title: `${data.title} | 여소남`,
    description: data.product_summary || `${data.destination} ${data.title} - 여소남 패키지 여행`,
    openGraph: {
      title: data.title,
      description: data.product_summary || `${data.destination} 여행`,
    },
  };
}

export default async function PackageDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const sb = supabaseAdmin;

  // ACL: 고객 노출 페이지에서는 내부필드(net_price/selling_price/margin_rate) SELECT 금지.
  // 어드민 UI는 /api/packages GET으로 별도 조회하며 거기서는 원가 정보가 유지된다.
  const pkgResult = await sb.from('travel_packages')
    .select('*, products(internal_code, display_name, departure_region)')
    .eq('id', id)
    .single();

  const pkg = pkgResult.data;

  // 감사 차단 상품은 고객 상세도 404 처리 (감사 게이트 이중 가드)
  if (pkg && (pkg as { audit_status?: string }).audit_status === 'blocked') {
    notFound();
  }

  // ── 2-단계 Fetch 전략 (Next.js 2MB 캐시 한계 + 성능 최적화) ─────────────────
  // Step A: 매칭 전용 경량 fetch (name, country, region, aliases만) — 수백 KB
  // Step B: 매칭된 N개에 한해 사진/설명 상세 fetch — 수십 KB
  //
  // 기존: select('*') + limit(3000) + photos 포함 → 2MB 초과 → fetch cache 실패 + 30s timeout
  let matchQuery = sb.from('attractions')
    .select('name, country, region, aliases');

  if (pkg && pkg.destination) {
    const destTokens = pkg.destination.split(/[\/,·&]/).map((t: string) => t.trim()).filter(Boolean);
    const regionClauses = destTokens.map((t: string) => `region.ilike.%${t}%`).join(',');
    const countryList = '중국,베트남,일본,필리핀,태국,말레이시아,싱가포르,대만,몽골,라오스,인도네시아,홍콩,마카오';
    const countryClauses = countryList.split(',').map(c => `country.eq.${c}`).join(',');
    const destCountryClause = `country.ilike.%${pkg.destination}%`;
    matchQuery = matchQuery.or(`${regionClauses},${destCountryClause},${countryClauses}`);
  }

  const matchResult = await matchQuery.limit(3000);
  const lightAttractions = (matchResult.data ?? []) as unknown as AttractionData[];

  // 매칭된 관광지 이름 목록만 추출 (서버사이드 1회)
  const matchedNames = new Set<string>();
  if (pkg?.itinerary_data && lightAttractions.length) {
    const index = buildAttractionIndex(lightAttractions, pkg.destination);
    const daysData = normalizeDays<{ day: number; schedule?: { activity: string; type?: string }[] }>(pkg.itinerary_data);
    for (const day of daysData) {
      for (const item of (day.schedule || [])) {
        if (item.type === 'flight' || item.type === 'hotel' || item.type === 'shopping') continue;
        const single = matchAttractionIndexed(item.activity, index);
        if (single) matchedNames.add(single.name);
        if (!single && /[,，]/.test(item.activity)) {
          const parts = item.activity.replace(/^▶/, '').split(/[,，]\s*/).map(s => s.trim()).filter(s => s.length >= 2);
          for (const part of parts) {
            const m = matchAttractionIndexed(part, index);
            if (m) matchedNames.add(m.name);
          }
        }
      }
    }
  }

  // Step B: 매칭된 관광지만 photos/short_desc 등 상세 가져오기 (일반적으로 10개 미만)
  let relevantAttractions: AttractionData[] = [];
  if (matchedNames.size > 0) {
    const { data: detail } = await sb.from('attractions')
      .select('id, name, short_desc, long_desc, photos, country, region, badge_type, emoji, aliases, category')
      .in('name', Array.from(matchedNames));
    relevantAttractions = (detail ?? []) as unknown as AttractionData[];
  }
  // 기존 fallback 호환 — 매칭 0건 시 전체 대신 경량 목록 전달 (payload 과다 방지)
  const attrResult = { data: relevantAttractions.length > 0 ? relevantAttractions : lightAttractions };

  const normalizedPkg = pkg ? {
    ...pkg,
    products: Array.isArray(pkg.products) ? pkg.products[0] ?? null : pkg.products,
  } : null;

  // 관련 블로그 글 조회 (1) — 이 상품을 홍보하는 글 (product_id 직접 매칭)
  let relatedBlogPosts: { slug: string; seo_title: string | null; og_image_url: string | null; angle_type: string }[] = [];
  // 관련 블로그 글 조회 (2) — 같은 destination의 정보성 글 (여행 준비물/날씨/가이드 등)
  let destinationBlogPosts: { slug: string; seo_title: string | null; og_image_url: string | null; angle_type: string; seo_description: string | null }[] = [];
  if (pkg?.destination) {
    const [productScoped, destinationScoped] = await Promise.all([
      sb.from('content_creatives')
        .select('slug, seo_title, og_image_url, angle_type')
        .eq('status', 'published')
        .eq('channel', 'naver_blog')
        .not('slug', 'is', null)
        .eq('product_id', id)
        .order('published_at', { ascending: false })
        .limit(3),
      sb.from('content_creatives')
        .select('slug, seo_title, og_image_url, angle_type, seo_description, travel_packages!inner(destination)')
        .eq('status', 'published')
        .eq('channel', 'naver_blog')
        .not('slug', 'is', null)
        .eq('travel_packages.destination', pkg.destination)
        .neq('product_id', id)
        .order('published_at', { ascending: false })
        .limit(8),
    ]);

    relatedBlogPosts = (productScoped.data ?? []) as typeof relatedBlogPosts;

    // 중복 slug 제거 + 정보성 글만 + 상위 4개
    // ERR-LB-DAD-editor-section@2026-04-20:
    //   "여소남 에디터의 가이드" 섹션은 destination이 같은 다른 상품의 콘텐츠를 노출하는데,
    //   angle_type='value' (가성비/가격형) 글은 다른 상품의 가격(73만원 등)을 우리 상품(110만)
    //   페이지에서 광고하는 꼴이 되어 부적절. 정보성(가이드/날씨/준비물) 글만 노출.
    const FORBIDDEN_ANGLES = ['value', 'price', 'sale', 'deal', 'discount', 'promotion', 'comparison'];
    const PRICE_PATTERN = /\d+만원|\d+,\d{3},?\d*\s*원|\₩\s*\d|\d+만\s*~|특가|최저가/;
    const seenSlugs = new Set(relatedBlogPosts.map(p => p.slug));
    destinationBlogPosts = ((destinationScoped.data ?? []) as typeof destinationBlogPosts)
      .filter(p => !seenSlugs.has(p.slug))
      .filter(p => !FORBIDDEN_ANGLES.includes(p.angle_type))
      .filter(p => !PRICE_PATTERN.test(p.seo_title || ''))
      .filter(p => !PRICE_PATTERN.test(p.seo_description || ''))
      .slice(0, 4);
  }

  // 미매칭 관광지 수집 (서버사이드 1회만) — 경량 목록으로 매칭 시도
  if (pkg?.itinerary_data && lightAttractions.length) {
    const skipPattern = /^(호텔|리조트)?\s*(조식|투숙|체크|휴식|이동|출발|도착|귀환|수속|공항|탑승|기내|자유시간|석식|중식|면세점|쇼핑센터|가이드|미팅)/;
    const daysData = normalizeDays<{ day: number; schedule?: { activity: string; type?: string }[] }>(pkg.itinerary_data);
    const unmatchedItems: { activity: string; package_id: string; package_title: string; day_number: number; country?: string }[] = [];
    for (const day of daysData) {
      (day.schedule || []).forEach((item) => {
        if (skipPattern.test(item.activity)) return;
        if (item.type === 'flight' || item.type === 'hotel' || item.type === 'shopping') return;
        if (/공항|출발|도착|이동|수속|탑승|귀환|체크인|체크아웃|투숙|휴식|미팅|조식|중식|석식/.test(item.activity)) return;
        const attr = matchAttractions(item.activity, lightAttractions, pkg.destination)[0] || null;
        if (!attr) unmatchedItems.push({ activity: item.activity, package_id: id, package_title: pkg.title, day_number: day.day, country: pkg.destination });
      });
    }
    if (unmatchedItems.length > 0) {
      // ERR-unmatched-queue-middleware-401@2026-04-21:
      //   기존: fetch('https://yeosonam.com/api/unmatched') 로 self-call → middleware PUBLIC_PATHS 미등록
      //         → 401 리다이렉트 → .catch(() => {}) 로 침묵 실패 → 2026-04-10 ~ 04-21 사이 등록된
      //         16개 상품 전부 unmatched 자동 큐잉 누락.
      //   해결: supabaseAdmin 으로 직접 upsert (middleware 독립).
      const sbAdmin = supabaseAdmin;
      const upsertPayload = unmatchedItems.map(it => ({
        activity: it.activity,
        package_id: it.package_id,
        package_title: it.package_title,
        day_number: it.day_number,
        country: it.country || null,
        region: null,
        occurrence_count: 1,
        status: 'pending',
      }));
      sbAdmin
        .from('unmatched_activities')
        .upsert(upsertPayload, { onConflict: 'activity' })
        .then(({ error }: { error: { message: string } | null }) => {
          if (error) console.error('[unmatched upsert 실패]', error.message);
        });
    }
  }

  // 서버에서 매칭된 관광지(photos/short_desc 포함)만 전달
  const attractionsForClient = (attrResult.data ?? []) as React.ComponentProps<typeof DetailClient>['initialAttractions'];

  // ── destination_climate 조인 (여행 적합도 + 시차 카드용) ────────────────
  // pkg.destination 텍스트로 매칭 (build_climate.js 의 시드와 1:1)
  let climateData: {
    destination: string; primary_city: string; country: string | null;
    lat: number; lon: number; timezone: string; utc_offset_minutes: number;
    monthly_normals: unknown; fitness_scores: unknown; seasonal_signals: unknown;
  } | null = null;
  let representativeMonth = new Date().getMonth() + 1;
  let departureDistribution: Record<number, number> = {};
  if (pkg?.destination) {
    const { data: cli } = await sb.from('destination_climate')
      .select('destination, primary_city, country, lat, lon, timezone, utc_offset_minutes, monthly_normals, fitness_scores, seasonal_signals')
      .eq('destination', pkg.destination)
      .maybeSingle();
    if (cli) climateData = cli as unknown as typeof climateData;

    // 출발일 평균월 산출 — price_dates 우선, 없으면 price_tiers.departure_dates
    const dates: string[] = [];
    const pd = (pkg as { price_dates?: { date: string }[] }).price_dates ?? [];
    for (const d of pd) if (d?.date) dates.push(d.date);
    const pt = (pkg as { price_tiers?: { departure_dates?: string[] }[] }).price_tiers ?? [];
    for (const t of pt) for (const d of (t.departure_dates ?? [])) if (d) dates.push(d);
    if (dates.length > 0) {
      const r = pickRepresentativeMonths(dates);
      representativeMonth = r.primary;
      departureDistribution = r.distribution;
    }
  }

  // ── package_scores 조인 (모바일 추천 카드용) ───────────────────────
  // 활성 정책 1건만. group_size>=2 일 때만 의미 있음 (단일 그룹은 비교 불가)
  // ── package_scores 출발일별 row N개 fetch (v3 옵션 A) ──────────────
  type ScoreRow = {
    departure_date: string | null;
    rank_in_group: number;
    group_size: number;
    effective_price: number;
    list_price: number | null;
    shopping_count: number | null;
    hotel_avg_grade: number | null;
    meal_count: number | null;
    free_option_count: number | null;
    is_direct_flight: boolean | null;
    breakdown: {
      list_price?: number;
      why?: string[];
      deductions?: {
        hotel_premium?: number;
        flight_premium?: number;
        shopping_avoidance?: number;
        free_options?: number;
        cold_start_boost?: number;
      };
    } | null;
  };
  let scoreRows: ScoreRow[] = [];
  {
    const { data: sc } = await sb
      .from('package_scores')
      .select('departure_date, rank_in_group, group_size, effective_price, list_price, shopping_count, hotel_avg_grade, meal_count, free_option_count, is_direct_flight, breakdown')
      .eq('package_id', id)
      .order('departure_date', { ascending: true });
    if (sc) scoreRows = sc as ScoreRow[];
  }

  // ── pairwise rivals: 같은 날 그룹의 다른 패키지 1~2개 ──────────────
  // 추천 카드에서 "다른 옵션과 비교" UI로 사용
  type Rival = {
    package_id: string; title: string; departure_date: string | null;
    list_price: number; effective_price: number; rank_in_group: number;
    hotel_avg_grade: number | null; shopping_count: number | null;
    free_option_count: number | null; is_direct_flight: boolean | null;
    breakdown: ScoreRow['breakdown'];
  };
  const rivalsByDate: Record<string, Rival[]> = {};
  {
    const groupKeys = scoreRows
      .filter(r => r.group_size >= 2 && r.departure_date)
      .map(r => `${pkg?.destination ?? ''}|${r.departure_date}`);
    if (groupKeys.length > 0) {
      const { data } = await sb
        .from('package_scores')
        .select(`departure_date, rank_in_group, list_price, effective_price, hotel_avg_grade, shopping_count, free_option_count, is_direct_flight, breakdown, package_id, group_key, travel_packages!inner(title)`)
        .in('group_key', groupKeys)
        .neq('package_id', id);
      for (const r of data ?? []) {
        const row = r as unknown as { departure_date: string; travel_packages: { title: string } | { title: string }[] } & Rival;
        const t = Array.isArray(row.travel_packages) ? row.travel_packages[0]?.title : row.travel_packages?.title;
        if (!row.departure_date) continue;
        if (!rivalsByDate[row.departure_date]) rivalsByDate[row.departure_date] = [];
        rivalsByDate[row.departure_date].push({ ...row, title: t ?? '' });
      }
      // 각 날짜별 rank 순 정렬, 최대 2개
      for (const date of Object.keys(rivalsByDate)) {
        rivalsByDate[date].sort((a, b) => a.rank_in_group - b.rank_in_group);
        rivalsByDate[date] = rivalsByDate[date].slice(0, 2);
      }
    }
  }

  // ── 사회적 증거 카운트 (Cialdini Principle 4) ───────────────────────
  // destination 단위 30일 인기도 — bookings + signals (관심 트래픽). 임계값 미만은 노출 X (false signal 방지)
  let socialProof: { bookings: number; interest: number } = { bookings: 0, interest: 0 };
  if (pkg?.destination) {
    const since = new Date(Date.now() - 30 * 86400000).toISOString();
    const [bk, sg] = await Promise.all([
      sb.from('bookings').select('id', { count: 'exact', head: true })
        .eq('status', 'confirmed').gte('created_at', since)
        .in('package_id',
          (await sb.from('travel_packages').select('id').eq('destination', pkg.destination)).data?.map((p: { id: string }) => p.id) ?? []
        ),
      sb.from('package_score_signals').select('id', { count: 'exact', head: true })
        .gte('created_at', since)
        .in('package_id',
          (await sb.from('travel_packages').select('id').eq('destination', pkg.destination)).data?.map((p: { id: string }) => p.id) ?? []
        ),
    ]);
    socialProof = { bookings: bk.count ?? 0, interest: sg.count ?? 0 };
  }

  // 4-level 약관 해소 (mobile surface) — 출발일 가장 이른 날짜 기준으로 날짜 병기
  let initialNotices: NoticeBlock[] = [];
  if (normalizedPkg) {
    const rawPriceDates = (normalizedPkg as { price_dates?: { date: string }[] }).price_dates ?? [];
    const earliestDate = rawPriceDates.map(d => d.date).filter(Boolean).sort()[0] ?? null;
    const resolved = await resolveTermsForPackage(
      {
        id: normalizedPkg.id,
        product_type: normalizedPkg.product_type,
        land_operator_id: normalizedPkg.land_operator_id,
        notices_parsed: normalizedPkg.notices_parsed,
      },
      'mobile',
    );
    initialNotices = formatCancellationDates(resolved, earliestDate);
  }

  return (
    <>
      <DetailClient
        initialPackage={normalizedPkg}
        initialAttractions={attractionsForClient}
        packageId={id}
        relatedBlogPosts={relatedBlogPosts}
        destinationBlogPosts={destinationBlogPosts}
        initialNotices={initialNotices}
        climateData={climateData}
        representativeMonth={representativeMonth}
        departureDistribution={departureDistribution}
        scoreRows={scoreRows}
        rivalsByDate={rivalsByDate}
        socialProof={socialProof}
      />
      {/* 고객 후기 (approved 리뷰 있을 때만 렌더) */}
      <div className="mx-auto max-w-4xl px-4">
        <ReviewsSection packageId={id} limit={5} />
      </div>
    </>
  );
}
