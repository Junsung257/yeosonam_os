import type { AngleType } from './content-generator';
import type { PublishedProductFact } from './product-registration-authority/read-model';

type ProductWithOpsFields = {
  id: string;
  title?: string | null;
  destination?: string | null;
  duration?: number | null;
  nights?: number | null;
  price?: number | null;
  departure_airport?: string | null;
  airline?: string | null;
  inclusions?: string[] | null;
  excludes?: string[] | null;
  itinerary?: string[] | null;
  land_operator?: string | null;
  land_operator_id?: string | null;
  supplier_code?: string | null;
  internal_code?: string | null;
  display_title?: string | null;
  price_dates?: unknown;
  price_tiers?: unknown;
  price_list?: unknown;
  confirmed_dates?: unknown;
  itinerary_data?: { days?: unknown[] } | null;
  ticketing_deadline?: string | null;
};

export type ProductBlogBrief = {
  content_type: 'package_intro';
  prompt_version: 'product-template-v4' | 'product-template-v6.1-published-fact-1';
  product_id: string;
  product_title: string;
  destination: string | null;
  angle: AngleType;
  primary_keyword: string;
  seo_keyword: string;
  departure_date: string | null;
  departure_city: string | null;
  duration: string | null;
  duration_days: number | null;
  supplier_code: string | null;
  price_from: number | null;
  inclusions: string[];
  exclusions: string[];
  included: string[];
  excluded: string[];
  itinerary_days: number;
  fit_for: string[];
  not_fit_for: string[];
  risk_notes: string[];
  consult_questions: string[];
  cta: {
    primary: 'kakao_consultation';
    secondary: 'package_detail';
  };
  reader_fit: string[];
  cautions: string[];
  dedup_key: string;
  source_revision_id?: string;
  source_snapshot_hash?: string;
  as_of_date?: string;
  refresh_required_at?: string;
};

function sanitizeSlugPart(value: unknown, fallback = ''): string {
  const text = String(value ?? fallback)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return text || fallback;
}

function cleanKeywordPart(value: unknown): string | null {
  const text = String(value ?? '')
    .replace(/&#8211;|&ndash;|&mdash;|&amp;/gi, ' ')
    .replace(/\[[^\]]*]/g, ' ')
    .replace(/\([^)]*\)/g, ' ')
    .replace(/[\/|,+~]+/g, ' ')
    .replace(/\b(?:PKG|ZE|LJ|7C|TW|KE|OZ|BX|RS|YP|YSN|VJ)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return text.length >= 2 ? text : null;
}

function inferDestinationFromTitle(title: string): string | null {
  const cleaned = cleanKeywordPart(title);
  if (!cleaned) return null;
  const first = cleaned.split(/\s+/).find((part) => /[\uAC00-\uD7A3]{2,}/.test(part));
  return first ?? null;
}

function compactSeoKeyword(parts: Array<string | null | undefined>): string {
  const uniqueParts = [...new Set(parts.map(cleanKeywordPart).filter((part): part is string => Boolean(part)))];
  const keyword = uniqueParts.join(' ').replace(/\s+/g, ' ').trim();
  if (keyword.length <= 42) return keyword;

  const withoutDuration = uniqueParts.filter((part) => !/\d+\s*(?:일|박)/.test(part)).join(' ').trim();
  if (withoutDuration && withoutDuration.length <= 42) return withoutDuration;
  return keyword.slice(0, 42).trim();
}

export function buildProductSeoKeyword(product: ProductWithOpsFields): string {
  const title = product.title || product.display_title || '패키지';
  const destination = cleanKeywordPart(product.destination) ?? inferDestinationFromTitle(title);
  const duration = product.duration ? `${product.duration}일` : null;
  const base = compactSeoKeyword([destination, duration, '패키지']);
  if (base) return base;

  const titleFallback = cleanKeywordPart(title);
  return compactSeoKeyword([titleFallback, '패키지']) || '여행 패키지';
}

function asDateString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const match = value.match(/\b(20\d{2})[-./](\d{1,2})[-./](\d{1,2})\b/);
  if (!match) return null;
  const [, yyyy, mm, dd] = match;
  return `${yyyy}-${mm.padStart(2, '0')}-${dd.padStart(2, '0')}`;
}

function collectDateStrings(value: unknown, dates = new Set<string>()): Set<string> {
  const direct = asDateString(value);
  if (direct) dates.add(direct);

  if (Array.isArray(value)) {
    for (const item of value) collectDateStrings(item, dates);
    return dates;
  }

  if (value && typeof value === 'object') {
    for (const item of Object.values(value as Record<string, unknown>)) collectDateStrings(item, dates);
  }

  return dates;
}

function numberFrom(value: unknown): number | null {
  const parsed = typeof value === 'number' ? value : Number(String(value ?? '').replace(/,/g, ''));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function collectPrices(value: unknown, prices = new Set<number>()): Set<number> {
  const direct = numberFrom(value);
  if (direct) prices.add(direct);

  if (Array.isArray(value)) {
    for (const item of value) collectPrices(item, prices);
    return prices;
  }

  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    for (const key of ['price', 'adult_price', 'adult_selling_price', 'selling_price', 'net_price']) {
      const price = numberFrom(record[key]);
      if (price) prices.add(price);
    }
    for (const item of Object.values(record)) collectPrices(item, prices);
  }

  return prices;
}

export function resolveProductDepartureDate(product: ProductWithOpsFields): string | null {
  const dates = new Set<string>();
  collectDateStrings(product.price_dates, dates);
  collectDateStrings(product.confirmed_dates, dates);
  collectDateStrings(product.price_tiers, dates);
  return [...dates].sort()[0] ?? null;
}

export function resolveProductPriceFrom(product: ProductWithOpsFields): number | null {
  const direct = numberFrom(product.price);
  if (direct) return direct;
  const prices = new Set<number>();
  collectPrices(product.price_dates, prices);
  collectPrices(product.price_tiers, prices);
  collectPrices(product.price_list, prices);
  return [...prices].sort((a, b) => a - b)[0] ?? null;
}

export function resolveProductSupplierCode(product: ProductWithOpsFields): string | null {
  const raw = product.supplier_code || product.land_operator || product.land_operator_id || product.internal_code || null;
  return typeof raw === 'string' && raw.trim() ? raw.trim() : null;
}

export function buildProductDedupKey(product: ProductWithOpsFields): string {
  return [
    product.id,
    resolveProductDepartureDate(product) ?? 'open-date',
    product.duration ? `${product.duration}d` : 'duration-open',
    resolveProductSupplierCode(product) ?? 'supplier-open',
  ].map((part) => String(part).trim()).join('|');
}

export function buildProductSlugSuffix(product: ProductWithOpsFields): string {
  const idPart = sanitizeSlugPart(product.id).slice(-8);
  const datePart = (resolveProductDepartureDate(product) ?? '').replace(/-/g, '');
  const durationPart = product.duration ? `${product.duration}d` : '';
  const supplierPart = sanitizeSlugPart(resolveProductSupplierCode(product), '').slice(0, 12);
  return [idPart, datePart, durationPart, supplierPart].filter(Boolean).join('-');
}

function listFrom(value: string[] | null | undefined, limit = 12): string[] {
  return Array.isArray(value)
    ? value.map((item) => String(item ?? '').replace(/\s+/g, ' ').trim()).filter(Boolean).slice(0, limit)
    : [];
}

export function buildProductBlogBrief(product: ProductWithOpsFields, angle: AngleType): ProductBlogBrief {
  const destination = cleanKeywordPart(product.destination) ?? inferDestinationFromTitle(product.title || product.display_title || '');
  const title = product.title || product.display_title || '여행 패키지';
  const departureDate = resolveProductDepartureDate(product);
  const supplierCode = resolveProductSupplierCode(product);
  const seoKeyword = buildProductSeoKeyword(product);
  const nights = product.nights ?? (product.duration ? Math.max(product.duration - 1, 0) : null);
  const duration = product.duration ? `${nights ? `${nights}박` : ''}${product.duration}일` : null;
  const departureCity = cleanKeywordPart(product.departure_airport);
  const included = listFrom(product.inclusions);
  const excluded = listFrom(product.excludes);
  const destinationLabel = destination || '해당 여행지';
  const departureLabel = departureCity || '출발지';

  const fitFor = [
    `${destinationLabel} 패키지를 가격, 일정, 포함 항목 기준으로 먼저 비교하고 싶은 분`,
    departureCity
      ? `${departureLabel} 출발 상품을 찾는 분`
      : '출발지와 항공 조건을 상담으로 확인하고 싶은 분',
    '자유여행보다 항공, 숙소, 이동을 한 번에 정리하는 방식을 선호하는 분',
  ];
  const notFitFor = [
    '호텔명, 객실, 항공 시간까지 모두 확정된 뒤에만 결정하고 싶은 분',
    '자유시간을 길게 두고 현지 일정을 직접 조합하고 싶은 분',
  ];
  const riskNotes = [
    '가격은 출발일, 좌석, 유류할증료, 객실 조건에 따라 달라질 수 있습니다.',
    '포함/불포함, 선택관광, 취소 규정은 예약 시점의 최종 조건으로 다시 확인하면 안전합니다.',
    departureDate
      ? `가장 이른 출발일은 ${departureDate} 기준으로 확인했습니다.`
      : '출발 가능일은 상담 시점 기준으로 다시 확인해요.',
  ];
  const consultQuestions = [
    '이 출발일에 현재 가능한 좌석과 객실이 있나요?',
    '표시 가격 외에 현지 추가비나 선택관광 비용이 있나요?',
    '항공 시간, 호텔 조건, 조인 행사 여부는 어떻게 확인하나요?',
    '취소와 변경 규정은 출발일 기준으로 어떻게 적용되나요?',
  ];

  return {
    content_type: 'package_intro',
    prompt_version: 'product-template-v4',
    product_id: product.id,
    product_title: title,
    destination,
    angle,
    primary_keyword: seoKeyword,
    seo_keyword: seoKeyword,
    departure_date: departureDate,
    departure_city: departureCity,
    duration,
    duration_days: product.duration ?? null,
    supplier_code: supplierCode,
    price_from: resolveProductPriceFrom(product),
    inclusions: included,
    exclusions: excluded,
    included,
    excluded,
    itinerary_days: Array.isArray(product.itinerary_data?.days)
      ? product.itinerary_data.days.length
      : Array.isArray(product.itinerary) ? product.itinerary.length : 0,
    fit_for: fitFor,
    not_fit_for: notFitFor,
    risk_notes: riskNotes,
    consult_questions: consultQuestions,
    cta: {
      primary: 'kakao_consultation',
      secondary: 'package_detail',
    },
    reader_fit: fitFor,
    cautions: riskNotes,
    dedup_key: buildProductDedupKey(product),
  };
}

/**
 * Builds the blog brief from the V6.1 published fact view. This adapter is the
 * only supported path for automated product articles: it receives the exact
 * publication pointer/snapshot and typed departures, so legacy `price`,
 * `net_price`, supplier raw, and draft fields cannot enter the brief.
 */
export function buildProductBlogBriefFromPublishedFact(fact: PublishedProductFact, angle: AngleType): ProductBlogBrief {
  const card = fact.cardProjection;
  const lp = fact.lpProjection;
  const departures = fact.departureInstances
    .filter(row => row.adult_selling_price !== null && ['PRICED', 'REQUEST_ONLY'].includes(row.pricing_state))
    .sort((a, b) => a.departure_date.localeCompare(b.departure_date));
  const inclusions = Array.isArray(lp.inclusions) ? lp.inclusions.map(String) : [];
  const exclusions = Array.isArray(lp.excludes ?? lp.exclusions) ? (lp.excludes ?? lp.exclusions) as unknown[] : [];
  const safeProduct: ProductWithOpsFields = {
    id: fact.packageId,
    title: typeof card.title === 'string' ? card.title : typeof lp.title === 'string' ? lp.title : null,
    destination: typeof card.destination === 'string' ? card.destination : typeof lp.destination === 'string' ? lp.destination : null,
    duration: typeof lp.duration === 'number' ? lp.duration : null,
    nights: typeof lp.nights === 'number' ? lp.nights : null,
    inclusions,
    excludes: exclusions.map(String),
    price_dates: departures.map(row => ({
      date: row.departure_date,
      price: row.adult_selling_price,
      currency: row.currency,
      pricing_state: row.pricing_state,
      booking_state: row.booking_state,
    })),
    itinerary_data: Array.isArray(lp.itinerary) ? { days: lp.itinerary } : null,
  };
  const brief = buildProductBlogBrief(safeProduct, angle);
  return {
    ...brief,
    prompt_version: 'product-template-v6.1-published-fact-1',
    source_revision_id: fact.sourceRevisionId,
    source_snapshot_hash: fact.snapshotHash,
    as_of_date: fact.asOfDate,
    refresh_required_at: fact.refreshRequiredAt,
  };
}
