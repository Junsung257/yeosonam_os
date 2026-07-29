type RecordLike = Record<string, unknown>;

export type OfferInventoryStatus = 'available' | 'reconfirm_required' | 'sold_out' | 'unknown';

export interface CanonicalRevenueOffer {
  offerId: string;
  slug: string;
  title: string;
  destination: string;
  departureAirport: string;
  departureDate: string | null;
  returnDate: string | null;
  duration: string;
  currentPrice: number | null;
  priceCheckedAt: string | null;
  inventoryStatus: OfferInventoryStatus;
  inventoryCheckedAt: string | null;
  airline: string | null;
  hotel: string | null;
  inclusions: string[];
  exclusions: string[];
  optionalTours: unknown[];
  tips: string | null;
  cancellationSummary: string | null;
  supplierProvenance: {
    supplierCode: string | null;
    sourceHash: string | null;
  };
  publicationState: string;
  contactCta: '상담 요청하기';
  expectedContributionMargin: number | null;
  readyForPublication: boolean;
  blockers: string[];
}

function record(value: unknown): RecordLike {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as RecordLike : {};
}

function string(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function number(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.map(string).filter((item): item is string => Boolean(item)) : [];
}

function products(value: unknown): RecordLike {
  if (Array.isArray(value)) return record(value[0]);
  return record(value);
}

function cancellationSummary(value: unknown): string | null {
  const direct = string(value);
  if (direct) return direct;
  const row = record(value);
  return string(row.summary ?? row.customer_summary ?? row.text);
}

function fresh(checkedAt: string | null, now: Date, maxAgeHours: number): boolean {
  if (!checkedAt) return false;
  const timestamp = new Date(checkedAt).getTime();
  if (!Number.isFinite(timestamp)) return false;
  const ageMs = now.getTime() - timestamp;
  return ageMs >= 0 && ageMs <= maxAgeHours * 60 * 60 * 1_000;
}

export function buildCanonicalRevenueOffer(
  pkg: RecordLike,
  options: { now?: Date; maxEvidenceAgeHours?: number } = {},
): CanonicalRevenueOffer {
  const now = options.now ?? new Date();
  const maxEvidenceAgeHours = options.maxEvidenceAgeHours ?? 24;
  const product = products(pkg.products);
  const priceDates = Array.isArray(pkg.price_dates) ? pkg.price_dates.map(record) : [];
  const futurePrices = priceDates
    .filter(row => {
      const date = string(row.date);
      return Boolean(date && /^\d{4}-\d{2}-\d{2}$/.test(date) && date >= now.toISOString().slice(0, 10));
    })
    .sort((a, b) => String(a.date).localeCompare(String(b.date)));
  const selectedPrice = futurePrices[0] ?? {};
  const departureDate = string(selectedPrice.date ?? pkg.departure_date);
  const returnDate = string(selectedPrice.return_date ?? pkg.return_date);
  const currentPrice = number(
    selectedPrice.adult_selling_price
      ?? selectedPrice.selling_price
      ?? selectedPrice.price
      ?? pkg.price,
  );
  const inventoryRaw = string(pkg.inventory_status);
  const remainingSeats = Math.max(0, Number(pkg.seats_held ?? 0) - Number(pkg.seats_confirmed ?? 0));
  const inventoryStatus: OfferInventoryStatus =
    inventoryRaw === 'available'
    || inventoryRaw === 'reconfirm_required'
    || inventoryRaw === 'sold_out'
      ? inventoryRaw
      : remainingSeats > 0
        ? 'available'
        : 'unknown';
  const departureAirport = string(pkg.departure_airport ?? product.departure_region) ?? '';
  const publicationState = string(pkg.publication_state) ?? 'draft';
  const priceCheckedAt = string(pkg.price_checked_at);
  const inventoryCheckedAt = string(pkg.inventory_checked_at);
  const sourceHash = string(pkg.raw_text_hash ?? pkg.source_raw_text_hash);
  const supplierCode = string(product.supplier_code ?? pkg.supplier_code ?? pkg.land_operator);
  const expectedContributionMargin = number(pkg.expected_contribution_margin);
  const blockers: string[] = [];

  if (!['부산', '김해', 'PUS', 'BUSAN', 'GIMHAE'].includes(departureAirport.toUpperCase())) blockers.push('departure_airport_not_busan_or_gimhae');
  if (!departureDate) blockers.push('future_departure_date_missing');
  if (!returnDate) blockers.push('return_date_missing');
  if (!currentPrice || selectedPrice.confirmed !== true) blockers.push('confirmed_price_missing');
  if (!fresh(priceCheckedAt, now, maxEvidenceAgeHours)) blockers.push('price_evidence_stale_or_missing');
  if (!['available', 'reconfirm_required'].includes(inventoryStatus)) blockers.push('inventory_unavailable_or_unknown');
  if (!fresh(inventoryCheckedAt, now, maxEvidenceAgeHours)) blockers.push('inventory_evidence_stale_or_missing');
  if (!sourceHash || !supplierCode) blockers.push('supplier_provenance_missing');
  if (strings(pkg.inclusions).length === 0) blockers.push('inclusions_missing');
  if (strings(pkg.excludes).length === 0) blockers.push('exclusions_missing');
  if (!cancellationSummary(pkg.cancellation_policy)) blockers.push('cancellation_summary_missing');
  if (!expectedContributionMargin) blockers.push('contribution_margin_missing');
  if (!['approved', 'published'].includes(publicationState)) blockers.push('publication_not_approved');

  return {
    offerId: string(pkg.id) ?? '',
    slug: string(pkg.short_code) ?? string(pkg.id) ?? '',
    title: string(pkg.display_title ?? pkg.title) ?? '',
    destination: string(pkg.destination) ?? '',
    departureAirport,
    departureDate,
    returnDate,
    duration: string(pkg.trip_style) ?? (number(pkg.duration) ? `${number(pkg.duration)}일` : '기간 미정'),
    currentPrice,
    priceCheckedAt,
    inventoryStatus,
    inventoryCheckedAt,
    airline: string(pkg.airline),
    hotel: string(pkg.hotel ?? pkg.hotel_name),
    inclusions: strings(pkg.inclusions),
    exclusions: strings(pkg.excludes),
    optionalTours: Array.isArray(pkg.optional_tours) ? pkg.optional_tours : [],
    tips: string(pkg.guide_tip),
    cancellationSummary: cancellationSummary(pkg.cancellation_policy),
    supplierProvenance: { supplierCode, sourceHash },
    publicationState,
    contactCta: '상담 요청하기',
    expectedContributionMargin,
    readyForPublication: blockers.length === 0,
    blockers,
  };
}
