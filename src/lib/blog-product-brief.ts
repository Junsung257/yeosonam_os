import type { AngleType } from './content-generator';

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
  confirmed_dates?: unknown;
  ticketing_deadline?: string | null;
};

export type ProductBlogBrief = {
  content_type: 'package_intro';
  prompt_version: 'product-template-v2';
  product_id: string;
  product_title: string;
  destination: string | null;
  angle: AngleType;
  primary_keyword: string;
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
};

function sanitizeSlugPart(value: unknown, fallback = ''): string {
  const text = String(value ?? fallback)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return text || fallback;
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
    for (const item of Object.values(value as Record<string, unknown>)) {
      collectDateStrings(item, dates);
    }
  }

  return dates;
}

export function resolveProductDepartureDate(product: ProductWithOpsFields): string | null {
  const dates = new Set<string>();
  collectDateStrings(product.price_dates, dates);
  collectDateStrings(product.confirmed_dates, dates);
  collectDateStrings(product.price_tiers, dates);
  const futureOrAll = [...dates].sort();
  return futureOrAll[0] ?? null;
}

export function resolveProductSupplierCode(product: ProductWithOpsFields): string | null {
  const raw =
    product.supplier_code ||
    product.land_operator ||
    product.land_operator_id ||
    product.internal_code ||
    null;
  return typeof raw === 'string' && raw.trim() ? raw.trim() : null;
}

export function buildProductDedupKey(product: ProductWithOpsFields): string {
  const departureDate = resolveProductDepartureDate(product) ?? 'open-date';
  const duration = product.duration ? `${product.duration}d` : 'duration-open';
  const supplier = resolveProductSupplierCode(product) ?? 'supplier-open';
  return [
    product.id,
    departureDate,
    duration,
    supplier,
  ].map((part) => String(part).trim()).join('|');
}

export function buildProductSlugSuffix(product: ProductWithOpsFields): string {
  const idPart = sanitizeSlugPart(product.id).slice(-8);
  const datePart = (resolveProductDepartureDate(product) ?? '').replace(/-/g, '');
  const durationPart = product.duration ? `${product.duration}d` : '';
  const supplierPart = sanitizeSlugPart(resolveProductSupplierCode(product), '').slice(0, 12);
  return [idPart, datePart, durationPart, supplierPart].filter(Boolean).join('-');
}

export function buildProductBlogBrief(
  product: ProductWithOpsFields,
  angle: AngleType,
): ProductBlogBrief {
  const destination = product.destination ?? null;
  const title = product.title || product.display_title || 'package';
  const price =
    typeof product.price === 'number' && Number.isFinite(product.price)
      ? product.price
      : null;
  const departureDate = resolveProductDepartureDate(product);
  const supplierCode = resolveProductSupplierCode(product);
  const primaryKeyword = [destination, title].filter(Boolean).join(' ').trim() || title;
  const nights = product.nights ?? (product.duration ? product.duration - 1 : null);
  const duration = product.duration
    ? `${nights ? `${nights}박` : ''}${product.duration}일`
    : null;
  const departureCity = product.departure_airport ?? null;
  const included = Array.isArray(product.inclusions) ? product.inclusions.slice(0, 12) : [];
  const excluded = Array.isArray(product.excludes) ? product.excludes.slice(0, 12) : [];
  const fitFor = [
    destination ? `${destination} 패키지를 가격과 동선 기준으로 먼저 비교하려는 고객` : '패키지 가격과 동선을 먼저 비교하려는 고객',
    departureCity ? `${departureCity} 출발 상품을 찾는 고객` : '출발지와 항공 조건을 상담으로 확인할 고객',
    '포함사항과 추가 비용을 나눠 보고 문의하고 싶은 고객',
  ];
  const notFitFor = [
    '호텔명, 객실 타입, 항공 시간이 확정된 뒤에만 결정하려는 고객',
    '자유일정이 많은 개별여행을 원하는 고객',
  ];
  const riskNotes = [
    '가격과 좌석은 발권/예약 시점에 달라질 수 있음',
    '포함/불포함, 선택관광, 취소 규정은 상담 전에 재확인 필요',
    departureDate ? `대표 출발일은 ${departureDate} 기준으로 추출됨` : '대표 출발일은 상담에서 확인 필요',
  ];
  const consultQuestions = [
    '인원과 출발 가능일이 어떻게 되나요?',
    '항공 시간과 호텔 등급을 확정 기준으로 볼 수 있나요?',
    '선택관광, 가이드/기사 경비, 싱글차지가 있나요?',
    '취소/변경 규정은 출발일 기준으로 어떻게 적용되나요?',
  ];

  return {
    content_type: 'package_intro',
    prompt_version: 'product-template-v2',
    product_id: product.id,
    product_title: title,
    destination,
    angle,
    primary_keyword: primaryKeyword,
    departure_date: departureDate,
    departure_city: departureCity,
    duration,
    duration_days: product.duration ?? null,
    supplier_code: supplierCode,
    price_from: price,
    inclusions: included,
    exclusions: excluded,
    included,
    excluded,
    itinerary_days: Array.isArray(product.itinerary) ? product.itinerary.length : 0,
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
