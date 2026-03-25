// ─── Product Tools: 상품 검색, 견적, 최저가, 일정표 ──────────────────────────

import {
  getApprovedPackages,
  getPackageById,
  getPriceTierForDate,
  getSurchargesForDate,
} from '@/lib/supabase';
import type { UIComponent } from '../ui-types';

// ─── search_packages (Self-Healing 내장) ─────────────────────────────────────
export async function handleSearchPackages(args: Record<string, unknown>) {
  const packages = await getApprovedPackages(
    args.destination as string | undefined,
    args.keyword as string | undefined
  );

  type PkgRow = (typeof packages)[0];
  let filtered: PkgRow[] = packages;

  // 기본 필터
  if (args.category) {
    filtered = filtered.filter(p => p.category === args.category);
  }
  if (args.maxPrice) {
    filtered = filtered.filter(p => (p.price ?? Infinity) <= (args.maxPrice as number));
  }
  if (args.keyword) {
    const kw = (args.keyword as string).toLowerCase();
    filtered = filtered.filter(p =>
      p.title?.toLowerCase().includes(kw) ||
      p.destination?.toLowerCase().includes(kw) ||
      p.product_type?.toLowerCase().includes(kw) ||
      p.trip_style?.toLowerCase().includes(kw) ||
      p.product_summary?.toLowerCase().includes(kw) ||
      (p.product_tags || []).some((t: string) => t.toLowerCase().includes(kw))
    );
  }
  if (args.productTags) {
    const tags = (args.productTags as string).split(',').map(t => t.trim().toLowerCase());
    filtered = filtered.filter(p => {
      const pkgTags = (p.product_tags || []).map((t: string) => t.toLowerCase());
      const summary = (p.product_summary || '').toLowerCase();
      const inferredTags: string[] = [];
      if (!p.guide_tip) inferredTags.push('노팁');
      if ((p.min_participants || 99) <= 8) inferredTags.push('소규모');
      if (p.product_type?.includes('에어텔')) inferredTags.push('에어텔');
      const allTags = [...pkgTags, ...inferredTags, summary];
      return tags.every(tag => allTags.some(t => t.includes(tag)));
    });
  }

  // 출발일 필터
  if (args.departureDate) {
    const depDate = args.departureDate as string;
    const date = new Date(depDate);
    const dayNames = ['일', '월', '화', '수', '목', '금', '토'];
    const dayOfWeek = dayNames[date.getDay()];
    filtered = filtered.filter(p => {
      const excluded = (p.excluded_dates || []) as string[];
      if (excluded.includes(depDate)) return false;
      const tiers = (p.price_tiers || []) as {
        departure_dates?: string[];
        date_range?: { start: string; end: string };
        departure_day_of_week?: string;
        status?: string;
      }[];
      if (tiers.length === 0) return true;
      return tiers.some(tier => {
        if (tier.status === 'soldout') return false;
        if (tier.departure_dates?.includes(depDate)) return true;
        if (tier.date_range) {
          const s = new Date(tier.date_range.start);
          const e = new Date(tier.date_range.end);
          if (date >= s && date <= e) {
            return !tier.departure_day_of_week || tier.departure_day_of_week === dayOfWeek;
          }
        }
        return false;
      });
    });
  }

  // 월 필터
  if (args.month) {
    const targetMonth = String(args.month as number).padStart(2, '0');
    filtered = filtered.filter(p => {
      const tiers = (p.price_tiers || []) as { date_range?: { start: string }; departure_dates?: string[]; status?: string }[];
      if (tiers.length === 0) return true;
      return tiers.some(t => {
        if (t.status === 'soldout') return false;
        if (t.date_range?.start?.slice(5, 7) === targetMonth) return true;
        if ((t.departure_dates || []).some((d: string) => d.slice(5, 7) === targetMonth)) return true;
        return false;
      });
    });
  }

  // 요일 필터
  if (args.dayOfWeek) {
    const dow = (args.dayOfWeek as string).replace('요일', '');
    filtered = filtered.filter(p => {
      const tiers = (p.price_tiers || []) as { departure_day_of_week?: string; status?: string }[];
      if (tiers.length === 0) return true;
      return tiers.some(t => t.status !== 'soldout' && (!t.departure_day_of_week || t.departure_day_of_week === dow));
    });
  }

  // ── Self-Healing: 단계적 조건 완화 ─────────────────────────────────────────
  let matchedLevel: 'exact' | 'month_only' | 'destination_only' = 'exact';

  if (filtered.length === 0 && args.dayOfWeek) {
    matchedLevel = 'month_only';
    filtered = packages;
    if (args.category) filtered = filtered.filter(p => p.category === args.category);
    if (args.maxPrice) filtered = filtered.filter(p => (p.price ?? Infinity) <= (args.maxPrice as number));
    if (args.destination) {
      const dest = (args.destination as string).toLowerCase();
      filtered = filtered.filter(p =>
        p.destination?.toLowerCase().includes(dest) || p.title?.toLowerCase().includes(dest)
      );
    }
    if (args.month) {
      const targetMonth = String(args.month as number).padStart(2, '0');
      filtered = filtered.filter(p => {
        const tiers = (p.price_tiers || []) as { date_range?: { start: string }; departure_dates?: string[]; status?: string }[];
        if (tiers.length === 0) return true;
        return tiers.some(t => t.status !== 'soldout' && (
          t.date_range?.start?.slice(5, 7) === targetMonth ||
          (t.departure_dates || []).some((d: string) => d.slice(5, 7) === targetMonth)
        ));
      });
    }
  }

  if (filtered.length === 0 && (args.month || args.dayOfWeek)) {
    matchedLevel = 'destination_only';
    filtered = packages;
    if (args.category) filtered = filtered.filter(p => p.category === args.category);
    if (args.destination) {
      const dest = (args.destination as string).toLowerCase();
      filtered = filtered.filter(p =>
        p.destination?.toLowerCase().includes(dest) || p.title?.toLowerCase().includes(dest)
      );
    }
    if (args.keyword) {
      const kw = (args.keyword as string).toLowerCase();
      filtered = filtered.filter(p =>
        p.title?.toLowerCase().includes(kw) || p.destination?.toLowerCase().includes(kw)
      );
    }
  }

  const resultPackages = filtered.slice(0, 6).map(p => {
    const tiers = (p.price_tiers || []) as { adult_price?: number; status?: string }[];
    const prices = tiers.map(t => t.adult_price).filter(Boolean) as number[];
    const minPrice = prices.length > 0 ? Math.min(...prices) : p.price;
    const maxPrice = prices.length > 0 ? Math.max(...prices) : p.price;
    return {
      id: p.id,
      title: p.title,
      destination: p.destination,
      category: p.category || 'package',
      product_type: p.product_type,
      trip_style: p.trip_style,
      departure_days: p.departure_days,
      duration: p.duration,
      min_price: minPrice,
      max_price: maxPrice,
      price_tiers_count: tiers.length,
      ticketing_deadline: p.ticketing_deadline,
      guide_tip: p.guide_tip,
      min_participants: p.min_participants,
      land_operator: p.land_operator,
      product_tags: p.product_tags || [],
      product_highlights: p.product_highlights || [],
      product_summary: p.product_summary,
    };
  });

  const uiComponents: UIComponent[] = resultPackages.map(p => ({
    type: 'package_card' as const,
    packageId: p.id,
    title: p.title || '',
    destination: p.destination || '',
    nights: 0,
    days: 0,
    priceFrom: p.min_price || 0,
    tags: p.product_tags,
    landOperator: p.land_operator || undefined,
  }));

  return {
    result: { packages: resultPackages, matched_level: matchedLevel },
    uiComponents,
  };
}

// ─── get_price_quote (±3일 Adjacent Date Scan 내장) ──────────────────────────
export async function handleGetPriceQuote(args: Record<string, unknown>) {
  const packageId = args.packageId as string;
  const departureDate = args.departureDate as string;
  const adultCount = (args.adultCount as number) || 1;
  const childCount = (args.childCount as number) || 0;

  const pkg = await getPackageById(packageId);
  if (!pkg) return { result: { error: '상품을 찾을 수 없습니다.' } };

  const excludedDates = (pkg.excluded_dates || []) as string[];
  if (excludedDates.includes(departureDate)) {
    return { result: { error: `${departureDate}는 항공 미운항일입니다. 다른 날짜를 선택해 주세요.`, excluded: true } };
  }

  const priceTiers = (pkg.price_tiers || []) as Parameters<typeof getPriceTierForDate>[0];
  const tier = getPriceTierForDate(priceTiers, departureDate);

  if (!tier) {
    return {
      result: {
        error: `${departureDate}에 맞는 가격 정보를 찾을 수 없습니다.`,
        available_tiers_count: priceTiers.length,
        package_title: pkg.title,
        fallback_price: pkg.price,
      }
    };
  }

  const surcharges = (pkg.surcharges || []) as Parameters<typeof getSurchargesForDate>[0];
  const surchargeTotal = getSurchargesForDate(surcharges, departureDate);

  const adultPrice = tier.adult_price || 0;
  const childPrice = tier.child_price || adultPrice;
  const subtotal = adultPrice * adultCount + childPrice * childCount;
  const total = subtotal + surchargeTotal;
  const baseTotal1Person = adultPrice + surchargeTotal;

  // ── ±3일 인접 날짜 스캔 ──────────────────────────────────────────────────
  const adjacentDates: {
    date: string;
    price: number;
    saving: number;
    label: string;
  }[] = [];

  const baseDate = new Date(departureDate);
  for (let delta = -3; delta <= 3; delta++) {
    if (delta === 0) continue;
    const d = new Date(baseDate);
    d.setDate(d.getDate() + delta);
    const dateStr = d.toISOString().split('T')[0];

    if (excludedDates.includes(dateStr)) continue;

    const adjTier = getPriceTierForDate(priceTiers, dateStr);
    if (!adjTier || adjTier.status === 'soldout') continue;

    const adjAdultPrice = adjTier.adult_price || 0;
    const adjSurcharge = getSurchargesForDate(surcharges, dateStr);
    const adjTotal1Person = adjAdultPrice + adjSurcharge;
    const saving = baseTotal1Person - adjTotal1Person;

    if (saving >= 50000) {
      const dayNames = ['일', '월', '화', '수', '목', '금', '토'];
      const dayName = dayNames[d.getDay()];
      const direction = delta < 0 ? `${Math.abs(delta)}일 앞당기면` : `${delta}일 미루면`;
      adjacentDates.push({
        date: dateStr,
        price: adjTotal1Person,
        saving,
        label: `${direction} ${saving.toLocaleString()}원 절약 → ${dateStr}(${dayName}) 판매가 ${adjTotal1Person.toLocaleString()}원`,
      });
    }
  }

  // saving 큰 순서 정렬
  adjacentDates.sort((a, b) => b.saving - a.saving);

  // Generative UI용 DateChip 생성
  const uiComponents = adjacentDates.map(adj => ({
    type: 'date_chip' as const,
    date: adj.date,
    price: adj.price,
    saving: adj.saving,
    label: adj.label,
  }));

  return {
    result: {
      package_id: pkg.id,
      package_title: pkg.title,
      departure_date: departureDate,
      adult_count: adultCount,
      child_count: childCount,
      adult_price: adultPrice,
      child_price: childPrice,
      subtotal,
      surcharge: surchargeTotal,
      total,
      period_label: tier.period_label,
      status: tier.status,
      ticketing_deadline: pkg.ticketing_deadline,
      guide_tip: pkg.guide_tip,
      single_supplement: pkg.single_supplement,
      small_group_surcharge: adultCount + childCount <= 7 ? pkg.small_group_surcharge : null,
      note: tier.note,
      adjacent_dates: adjacentDates,
    },
    uiComponents,
  };
}

// ─── find_cheapest_dates ──────────────────────────────────────────────────────
export async function handleFindCheapestDates(args: Record<string, unknown>) {
  const packageId = args.packageId as string;
  const adultCount = (args.adultCount as number) || 1;

  const pkg = await getPackageById(packageId);
  if (!pkg) return { result: { error: '상품을 찾을 수 없습니다.' } };

  const today = new Date();
  const fromDate = args.fromDate ? new Date(args.fromDate as string) : today;
  const toDate = args.toDate
    ? new Date(args.toDate as string)
    : new Date(today.getFullYear(), today.getMonth() + 6, today.getDate());

  const priceTiers = (pkg.price_tiers || []) as Parameters<typeof getPriceTierForDate>[0];
  const surcharges = (pkg.surcharges || []) as Parameters<typeof getSurchargesForDate>[0];
  const excludedDates = (pkg.excluded_dates || []) as string[];

  // 날짜 범위 내 모든 날짜 스캔 (최대 180일)
  const results: { date: string; price: number; label: string }[] = [];
  const maxDays = Math.min(
    Math.floor((toDate.getTime() - fromDate.getTime()) / (1000 * 60 * 60 * 24)),
    180
  );

  for (let i = 0; i <= maxDays; i++) {
    const d = new Date(fromDate);
    d.setDate(d.getDate() + i);
    const dateStr = d.toISOString().split('T')[0];

    if (excludedDates.includes(dateStr)) continue;

    const tier = getPriceTierForDate(priceTiers, dateStr);
    if (!tier || tier.status === 'soldout') continue;

    const adjAdultPrice = (tier.adult_price || 0);
    const adjSurcharge = getSurchargesForDate(surcharges, dateStr);
    const total1Person = adjAdultPrice + adjSurcharge;

    const dayNames = ['일', '월', '화', '수', '목', '금', '토'];
    const dayName = dayNames[d.getDay()];

    results.push({
      date: dateStr,
      price: total1Person * adultCount,
      label: `${dateStr}(${dayName}) — 1인 ${total1Person.toLocaleString()}원`,
    });
  }

  // 가격 오름차순 정렬, TOP 5 반환
  results.sort((a, b) => a.price - b.price);
  const top5 = results.slice(0, 5);

  const uiComponents = top5.map(r => ({
    type: 'date_chip' as const,
    date: r.date,
    price: r.price / adultCount,
    saving: top5.length > 1 ? (results[results.length - 1].price / adultCount) - (r.price / adultCount) : 0,
    label: r.label,
  }));

  return {
    result: {
      package_title: pkg.title,
      cheapest_dates: top5,
      scan_range: { from: fromDate.toISOString().split('T')[0], to: toDate.toISOString().split('T')[0] },
    },
    uiComponents,
  };
}

// ─── generate_itinerary ───────────────────────────────────────────────────────
export async function handleGenerateItinerary(args: Record<string, unknown>) {
  const packageId = args.packageId as string;

  const pkg = await getPackageById(packageId);
  if (!pkg) return { result: { error: '상품을 찾을 수 없습니다.' } };

  // 기존 일정 데이터가 있으면 반환
  const itinerary = (pkg as Record<string, unknown>).itinerary as {
    day: number; title: string; activities: string[];
  }[] | undefined;

  if (itinerary && itinerary.length > 0) {
    const uiComponent = {
      type: 'itinerary_card' as const,
      title: pkg.title || '',
      destination: pkg.destination || '',
      days: itinerary,
    };
    return {
      result: {
        package_title: pkg.title,
        destination: pkg.destination,
        duration: pkg.duration,
        itinerary,
      },
      uiComponents: [uiComponent],
    };
  }

  // 일정 데이터 없으면 기본 정보만 반환
  return {
    result: {
      package_title: pkg.title,
      destination: pkg.destination,
      duration: pkg.duration,
      product_highlights: pkg.product_highlights || [],
      product_summary: pkg.product_summary,
      note: '상세 일정표 데이터가 아직 등록되지 않았습니다.',
    },
    uiComponents: [],
  };
}
