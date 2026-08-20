// ─── Product Tools: V6.1 published authority read model ─────────────────────

import { getSupabaseAdmin } from '@/lib/supabase';
import {
  getPublishedDepartureFact,
  getPublishedProductFactById,
  getPublishedProductFacts,
  toJarvisPublishedPackage,
  type PublishedDepartureFact,
  type PublishedProductFact,
} from '@/lib/product-registration-authority/read-model';
import type { UIComponent } from '../ui-types';

type JsonObject = Record<string, unknown>;

function adminClient() {
  return getSupabaseAdmin();
}

function projectionValue(fact: PublishedProductFact, key: string): unknown {
  return fact.cardProjection[key] ?? fact.lpProjection[key];
}

function titleOf(fact: PublishedProductFact): string {
  return String(projectionValue(fact, 'title') ?? '');
}

function destinationOf(fact: PublishedProductFact): string {
  return String(projectionValue(fact, 'destination') ?? '');
}

function packageResult(fact: PublishedProductFact): JsonObject {
  const priced = fact.departureInstances.filter(row => row.adult_selling_price !== null);
  const values = priced.map(row => row.adult_selling_price as number);
  const min = values.length ? Math.min(...values) : null;
  const max = values.length ? Math.max(...values) : null;
  const pkg = toJarvisPublishedPackage(fact);
  return {
    id: fact.packageId,
    title: titleOf(fact),
    destination: destinationOf(fact),
    category: projectionValue(fact, 'category') ?? 'package',
    product_type: projectionValue(fact, 'product_type'),
    duration: projectionValue(fact, 'duration'),
    nights: projectionValue(fact, 'nights'),
    min_price: min,
    max_price: max,
    price_dates: pkg.price_dates,
    departure_instances: fact.departureInstances,
    product_tags: projectionValue(fact, 'product_tags') ?? [],
    product_highlights: projectionValue(fact, 'product_highlights') ?? [],
    product_summary: projectionValue(fact, 'product_summary'),
    land_operator: projectionValue(fact, 'land_operator'),
    source_revision_id: fact.sourceRevisionId,
    snapshot_hash: fact.snapshotHash,
  };
}

function dayName(date: string): string {
  const names = ['일', '월', '화', '수', '목', '금', '토'];
  const parsed = new Date(`${date}T00:00:00Z`);
  return names[parsed.getUTCDay()] ?? '';
}

function dateInRange(date: string, from: string, to: string): boolean {
  return date >= from && date <= to;
}

function dateOffset(date: string, delta: number): string {
  const parsed = new Date(`${date}T00:00:00Z`);
  parsed.setUTCDate(parsed.getUTCDate() + delta);
  return parsed.toISOString().slice(0, 10);
}

function departureSearchMatch(row: PublishedDepartureFact, args: Record<string, unknown>): boolean {
  if (row.pricing_state === 'CONFLICTING' || row.pricing_state === 'MISSING' || row.pricing_state === 'UNRESOLVED') return false;
  if (args.departureDate && row.departure_date !== args.departureDate) return false;
  if (args.month && Number(row.departure_date.slice(5, 7)) !== Number(args.month)) return false;
  if (args.dayOfWeek && dayName(row.departure_date) !== String(args.dayOfWeek).replace('요일', '')) return false;
  return true;
}

// ─── search_packages ────────────────────────────────────────────────────────
export async function handleSearchPackages(args: Record<string, unknown>) {
  const client = adminClient();
  if (!client) return { result: { error: '상품 권위 저장소가 구성되지 않았습니다.' }, uiComponents: [] };
  const facts = await getPublishedProductFacts({
    supabase: client,
    destination: typeof args.destination === 'string' ? args.destination : undefined,
    keyword: typeof args.keyword === 'string' ? args.keyword : undefined,
    limit: 100,
  });
  const filtered = facts.filter(fact => {
    const pkg = packageResult(fact);
    if (args.category && pkg.category !== args.category) return false;
    if (args.maxPrice && (pkg.min_price === null || Number(pkg.min_price) > Number(args.maxPrice))) return false;
    if (args.productTags) {
      const tags = String(args.productTags).split(',').map(tag => tag.trim().toLocaleLowerCase()).filter(Boolean);
      const packageTags = Array.isArray(pkg.product_tags) ? pkg.product_tags.map(String).map(tag => tag.toLocaleLowerCase()) : [];
      if (!tags.every(tag => packageTags.some(candidate => candidate.includes(tag)))) return false;
    }
    return !args.departureDate && !args.month && !args.dayOfWeek
      ? true
      : fact.departureInstances.some(row => departureSearchMatch(row, args));
  });
  const resultPackages = filtered.slice(0, 6).map(packageResult);
  const uiComponents: UIComponent[] = resultPackages.map(pkg => ({
    type: 'package_card' as const,
    packageId: String(pkg.id),
    title: String(pkg.title ?? ''),
    destination: String(pkg.destination ?? ''),
    nights: Number(pkg.nights ?? 0),
    days: Number(pkg.duration ?? 0),
    priceFrom: typeof pkg.min_price === 'number' ? pkg.min_price : 0,
    tags: Array.isArray(pkg.product_tags) ? pkg.product_tags as string[] : [],
    landOperator: typeof pkg.land_operator === 'string' ? pkg.land_operator : undefined,
  }));
  return { result: { packages: resultPackages, matched_level: resultPackages.length ? 'exact' : 'none' }, uiComponents };
}

// ─── get_price_quote ─────────────────────────────────────────────────────────
export async function handleGetPriceQuote(args: Record<string, unknown>) {
  const client = adminClient();
  const packageId = String(args.packageId ?? '');
  const departureDate = String(args.departureDate ?? '');
  const adultCount = Number(args.adultCount ?? 1) || 1;
  const childCount = Number(args.childCount ?? 0) || 0;
  if (!client) return { result: { error: '상품 권위 저장소가 구성되지 않았습니다.' } };
  const fact = await getPublishedProductFactById({ supabase: client, productId: packageId });
  if (!fact) return { result: { error: '상품을 찾을 수 없습니다.' } };
  const departure = getPublishedDepartureFact(fact, departureDate);
  if (!departure) return { result: { error: `${departureDate}에 대한 검증된 출발 가격이 없습니다.` } };
  if (departure.pricing_state === 'CONFLICTING' || departure.adult_selling_price === null) {
    return { result: { error: `${departureDate} 가격은 원문 충돌로 검토 중입니다. 추측 가격을 안내하지 않습니다.`, pricing_state: departure.pricing_state } };
  }
  const adultPrice = departure.adult_selling_price;
  const childPrice = departure.child_selling_price ?? adultPrice;
  const subtotal = adultPrice * adultCount + childPrice * childCount;
  const adjacentDates = [-3, -2, -1, 1, 2, 3].map(delta => {
    const candidate = getPublishedDepartureFact(fact, dateOffset(departureDate, delta));
    if (!candidate || candidate.adult_selling_price === null || !['PRICED', 'REQUEST_ONLY'].includes(candidate.pricing_state)) return null;
    return {
      date: candidate.departure_date,
      price: candidate.adult_selling_price,
      saving: adultPrice - candidate.adult_selling_price,
      label: `${candidate.departure_date}(${dayName(candidate.departure_date)}) 판매가 ${candidate.adult_selling_price.toLocaleString()}원`,
    };
  }).filter((item): item is { date: string; price: number; saving: number; label: string } => Boolean(item && item.saving >= 50000));
  return {
    result: {
      package_id: fact.packageId,
      package_title: titleOf(fact),
      departure_date: departureDate,
      adult_count: adultCount,
      child_count: childCount,
      adult_price: adultPrice,
      child_price: childPrice,
      currency: departure.currency,
      subtotal,
      total: subtotal,
      booking_state: departure.booking_state,
      pricing_state: departure.pricing_state,
      note: departure.booking_state === 'MANUAL_CONFIRMATION_REQUIRED'
        ? '해당 날짜는 특별요금으로 등록되어 예약 가능 여부를 별도 확인해야 합니다.'
        : undefined,
      adjacent_dates: adjacentDates,
    },
    uiComponents: adjacentDates.map(adj => ({ type: 'date_chip' as const, ...adj })),
  };
}

// ─── find_cheapest_dates ─────────────────────────────────────────────────────
export async function handleFindCheapestDates(args: Record<string, unknown>) {
  const client = adminClient();
  if (!client) return { result: { error: '상품 권위 저장소가 구성되지 않았습니다.' }, uiComponents: [] };
  const fact = await getPublishedProductFactById({ supabase: client, productId: String(args.packageId ?? '') });
  if (!fact) return { result: { error: '상품을 찾을 수 없습니다.' }, uiComponents: [] };
  const today = new Date().toISOString().slice(0, 10);
  const from = typeof args.fromDate === 'string' ? args.fromDate : today;
  const to = typeof args.toDate === 'string' ? args.toDate : dateOffset(from, 180);
  const adultCount = Number(args.adultCount ?? 1) || 1;
  const results = fact.departureInstances
    .filter(row => dateInRange(row.departure_date, from, to)
      && row.adult_selling_price !== null
      && ['PRICED', 'REQUEST_ONLY'].includes(row.pricing_state)
      && !['SOLD_OUT', 'SALES_CLOSED', 'CANCELLED'].includes(row.booking_state))
    .map(row => ({
      date: row.departure_date,
      price: row.adult_selling_price! * adultCount,
      booking_state: row.booking_state,
      label: `${row.departure_date}(${dayName(row.departure_date)}) — 1인 ${row.adult_selling_price!.toLocaleString()}원`,
    }))
    .sort((a, b) => a.price - b.price)
    .slice(0, 5);
  return {
    result: { package_title: titleOf(fact), cheapest_dates: results, scan_range: { from, to } },
    uiComponents: results.map(row => ({ type: 'date_chip' as const, date: row.date, price: row.price / adultCount, saving: 0, label: row.label })),
  };
}

// ─── generate_itinerary ──────────────────────────────────────────────────────
export async function handleGenerateItinerary(args: Record<string, unknown>) {
  const client = adminClient();
  if (!client) return { result: { error: '상품 권위 저장소가 구성되지 않았습니다.' }, uiComponents: [] };
  const fact = await getPublishedProductFactById({ supabase: client, productId: String(args.packageId ?? '') });
  if (!fact) return { result: { error: '상품을 찾을 수 없습니다.' }, uiComponents: [] };
  const lp = fact.lpProjection;
  const itinerary = (lp.itinerary ?? lp.days) as JsonObject[] | undefined;
  if (Array.isArray(itinerary) && itinerary.length > 0) {
    const uiDays = itinerary.map((day, index) => ({
      day: Number(day.day ?? index + 1),
      title: String(day.title ?? ''),
      activities: Array.isArray(day.activities) ? day.activities.map(String) : [],
    }));
    return {
      result: { package_title: titleOf(fact), destination: destinationOf(fact), duration: lp.duration, itinerary },
      uiComponents: [{ type: 'itinerary_card' as const, title: titleOf(fact), destination: destinationOf(fact), days: uiDays }],
    };
  }
  return {
    result: {
      package_title: titleOf(fact),
      destination: destinationOf(fact),
      duration: lp.duration,
      product_highlights: lp.product_highlights ?? [],
      product_summary: lp.product_summary,
      note: '검증된 상세 일정 데이터가 아직 공개 snapshot에 없습니다.',
    },
    uiComponents: [],
  };
}
