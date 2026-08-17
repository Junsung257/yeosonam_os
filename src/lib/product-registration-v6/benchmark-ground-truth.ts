import { createHash } from 'node:crypto';

import type { CanonicalSection } from '@/lib/product-registration-v4/canonical-worker';
import type { ProductSourceDocumentClass } from '@/lib/product-registration-v6/document-classifier';

import type { ProductRegistrationBenchmarkCase } from './benchmark-metrics';
import { PRODUCT_REGISTRATION_BENCHMARK_SCHEMA_VERSION } from './engine-release-manifest';

type JsonObject = Record<string, unknown>;

export type BenchmarkEvidenceAnchor = {
  anchorId?: string | null;
  quoteHash: string;
  quote?: string | null;
  page?: number | null;
  tableId?: string | null;
  row?: number | null;
  column?: number | null;
  startOffset?: number | null;
  endOffset?: number | null;
};

export type BenchmarkSectionBoundary = {
  startAnchor: BenchmarkEvidenceAnchor;
  endAnchor: BenchmarkEvidenceAnchor;
  rawTextHash?: string | null;
};

export type BenchmarkProductIdentityAxes = {
  destination?: string | null;
  durationDays: number | null;
  nights: number | null;
  grade?: string | null;
  hotelMode: 'fixed' | 'alternatives' | 'unconfirmed' | 'none';
  hotels: string[];
  flightCodes: string[];
};

export type BenchmarkPriceScope =
  | { kind: 'specific_departure'; date: string }
  | { kind: 'date_range'; startDate: string; endDate: string }
  | { kind: 'weekday'; weekdays: number[]; startDate?: string | null; endDate?: string | null }
  | { kind: 'always' };

export type BenchmarkPriceComponent = {
  componentType:
    | 'sale_price'
    | 'list_price'
    | 'fuel_surcharge'
    | 'guide_fee'
    | 'local_fee'
    | 'child_price'
    | 'infant_price'
    | 'single_supplement'
    | 'optional_tour';
  amount: number;
  currency: string;
  chargeBasis: 'per_person' | 'per_room' | 'per_booking' | 'per_night';
  inclusion: 'included' | 'excluded' | 'payable_local' | 'optional';
  scope: BenchmarkPriceScope;
  evidence: BenchmarkEvidenceAnchor[];
};

export type BenchmarkItineraryItem = {
  order: number;
  type: 'flight' | 'ferry' | 'ground_transport' | 'attraction' | 'meal' | 'lodging' | 'shopping' | 'optional_tour' | 'free_time' | 'meeting' | 'note';
  text: string;
  time?: string | null;
  evidence?: BenchmarkEvidenceAnchor[];
};

export type BenchmarkItineraryDay = {
  day: number;
  items: BenchmarkItineraryItem[];
  hotel?: string | null;
};

export type BenchmarkCommercialFact = {
  kind: 'inclusion' | 'exclusion' | 'shopping' | 'optional_tour';
  value: string;
  scope: 'document' | 'product_group' | 'product_variant' | 'departure' | 'day_item';
  evidence: BenchmarkEvidenceAnchor[];
};

export type ReviewedBenchmarkAnnotation = {
  schemaVersion?: typeof PRODUCT_REGISTRATION_BENCHMARK_SCHEMA_VERSION;
  referenceDate?: string;
  /** Operator-confirmed upload context for sources that omit a year. */
  sourceDepartureYear?: number | null;
  expectedDocumentClass?: ProductSourceDocumentClass;
  sections: BenchmarkGroundTruthSection[];
};

export type BenchmarkGroundTruthSection = {
  title?: string | null;
  boundary?: BenchmarkSectionBoundary;
  productIdentity?: BenchmarkProductIdentityAxes;
  /** False means the source is not a sellable product input and must be discarded. */
  sourceSalePricePresent: boolean;
  departurePrices: Array<{
    date: string;
    amount: number;
    currency: string;
    listPrice?: number | null;
    fuelSurcharge?: number | null;
  }>;
  priceComponents?: BenchmarkPriceComponent[];
  dayCounts: number[];
  itinerary?: BenchmarkItineraryDay[];
  flights: Array<{
    code: string;
    departureAirport?: string | null;
    arrivalAirport?: string | null;
    departureTime?: string | null;
    arrivalTime?: string | null;
    evidence?: BenchmarkEvidenceAnchor[];
  }>;
  hotels: string[];
  hotelMode?: BenchmarkProductIdentityAxes['hotelMode'];
  inclusions: string[];
  exclusions: string[];
  commercialFacts?: BenchmarkCommercialFact[];
  cancellationPresent: boolean;
  cancellationCoverage?: 'source' | 'approved_standard_fallback' | 'missing';
};

export type BenchmarkAnnotationReview = {
  annotation: ReviewedBenchmarkAnnotation;
  annotationHash: string;
  blindedToEngine: true;
};

export type BenchmarkCaseReviewBundle = {
  first: BenchmarkAnnotationReview;
  second: BenchmarkAnnotationReview;
  adjudicator?: BenchmarkAnnotationReview;
};

export type BenchmarkFieldDiff = {
  field: string;
  criticality: 'hard' | 'degradable';
  missing: string[];
  unexpected: string[];
};

type ExtractedSectionFacts = BenchmarkGroundTruthSection & {
  productIdentity: BenchmarkProductIdentityAxes;
  priceComponents: BenchmarkPriceComponent[];
  itinerary: BenchmarkItineraryDay[];
  commercialFacts: BenchmarkCommercialFact[];
};

function object(value: unknown): JsonObject | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonObject : null;
}

function array(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function normalizedText(value: unknown): string {
  return typeof value === 'string'
    ? value.normalize('NFKC').replace(/\s+/g, ' ').trim()
    : '';
}

function normalizedTerm(value: unknown): string {
  return normalizedText(value).replace(/^[-•·*]+\s*/u, '').replace(/\s+/g, ' ');
}

function normalizedCurrency(value: unknown): string {
  return normalizedText(value).toUpperCase();
}

export function stableBenchmarkJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableBenchmarkJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as JsonObject)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableBenchmarkJson(item)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

export function benchmarkAnnotationHash(annotation: ReviewedBenchmarkAnnotation): string {
  return createHash('sha256').update(stableBenchmarkJson(annotation)).digest('hex');
}

export function assertBenchmarkV2Annotation(
  annotation: ReviewedBenchmarkAnnotation,
): asserts annotation is ReviewedBenchmarkAnnotation & {
  schemaVersion: typeof PRODUCT_REGISTRATION_BENCHMARK_SCHEMA_VERSION;
  referenceDate: string;
} {
  if (annotation.schemaVersion !== PRODUCT_REGISTRATION_BENCHMARK_SCHEMA_VERSION) {
    throw new Error('BENCHMARK_V2_SCHEMA_REQUIRED');
  }
  const annotationHash = benchmarkAnnotationHash(annotation);
  validateReview({ annotation, annotationHash, blindedToEngine: true }, 'submission');
}

function validSha256(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{64}$/iu.test(value);
}

function validateEvidenceAnchors(anchors: BenchmarkEvidenceAnchor[], code: string): void {
  if (anchors.length === 0) throw new Error(`${code}:EVIDENCE_REQUIRED`);
  anchors.forEach((anchor, index) => {
    if (!validSha256(anchor.quoteHash)) throw new Error(`${code}:EVIDENCE_HASH_INVALID:${index}`);
    if (anchor.startOffset != null && anchor.endOffset != null && anchor.endOffset < anchor.startOffset) {
      throw new Error(`${code}:EVIDENCE_RANGE_INVALID:${index}`);
    }
  });
}

function validateV2Section(section: BenchmarkGroundTruthSection, code: string, fullProductFacts = true): void {
  if (!section.boundary) throw new Error(`${code}:BOUNDARY_REQUIRED`);
  validateEvidenceAnchors([section.boundary.startAnchor, section.boundary.endAnchor], `${code}:BOUNDARY`);
  if (!fullProductFacts) {
    if (section.sourceSalePricePresent || section.departurePrices.length > 0
      || (section.priceComponents ?? []).some(component => component.componentType === 'sale_price')) {
      throw new Error(`${code}:NON_PRODUCT_SALE_FACT_FORBIDDEN`);
    }
    return;
  }
  if (!section.productIdentity) throw new Error(`${code}:PRODUCT_IDENTITY_REQUIRED`);
  if (section.sourceSalePricePresent && (
    section.departurePrices.length === 0
    || !(section.priceComponents ?? []).some(component => component.componentType === 'sale_price')
  )) {
    throw new Error(`${code}:SALE_PRICE_FACT_REQUIRED`);
  }
  if (!Number.isInteger(section.productIdentity.durationDays) && section.productIdentity.durationDays != null) {
    throw new Error(`${code}:DURATION_INVALID`);
  }
  if (!Number.isInteger(section.productIdentity.nights) && section.productIdentity.nights != null) {
    throw new Error(`${code}:NIGHTS_INVALID`);
  }
  for (const [index, component] of (section.priceComponents ?? []).entries()) {
    if (!Number.isSafeInteger(component.amount) || component.amount < 0 || !component.currency) {
      throw new Error(`${code}:PRICE_COMPONENT_INVALID:${index}`);
    }
    validateEvidenceAnchors(component.evidence, `${code}:PRICE_COMPONENT:${index}`);
  }
  for (const [dayIndex, day] of (section.itinerary ?? []).entries()) {
    if (day.day !== dayIndex + 1) throw new Error(`${code}:ITINERARY_DAY_SEQUENCE:${dayIndex}`);
    day.items.forEach((item, itemIndex) => {
      if (item.order !== itemIndex + 1) throw new Error(`${code}:ITINERARY_ITEM_SEQUENCE:${dayIndex}:${itemIndex}`);
      validateEvidenceAnchors(item.evidence ?? [], `${code}:ITINERARY_ITEM:${dayIndex}:${itemIndex}`);
    });
  }
  section.flights.forEach((flight, index) => validateEvidenceAnchors(flight.evidence ?? [], `${code}:FLIGHT:${index}`));
  for (const [index, fact] of (section.commercialFacts ?? []).entries()) {
    validateEvidenceAnchors(fact.evidence, `${code}:COMMERCIAL_FACT:${index}`);
  }
  if (!section.cancellationCoverage) throw new Error(`${code}:CANCELLATION_COVERAGE_REQUIRED`);
}

function validateReview(review: BenchmarkAnnotationReview | undefined, slot: string): asserts review is BenchmarkAnnotationReview {
  if (!review || review.blindedToEngine !== true) throw new Error(`BENCHMARK_REVIEW_NOT_BLINDED:${slot}`);
  const sourceDepartureYear = review.annotation.sourceDepartureYear;
  if (sourceDepartureYear != null && (
    !Number.isInteger(sourceDepartureYear)
    || sourceDepartureYear < 2020
    || sourceDepartureYear > 2100
  )) {
    throw new Error(`BENCHMARK_SOURCE_DEPARTURE_YEAR_INVALID:${slot}`);
  }
  if (review.annotation.schemaVersion === PRODUCT_REGISTRATION_BENCHMARK_SCHEMA_VERSION) {
    if (!review.annotation.referenceDate || !/^\d{4}-\d{2}-\d{2}$/u.test(review.annotation.referenceDate)) {
      throw new Error(`BENCHMARK_REFERENCE_DATE_REQUIRED:${slot}`);
    }
    if (!review.annotation.expectedDocumentClass) {
      throw new Error(`BENCHMARK_EXPECTED_DOCUMENT_CLASS_REQUIRED:${slot}`);
    }
  }
  if (sourceDepartureYear != null) {
    const groundTruthYears = new Set(review.annotation.sections.flatMap(section =>
      section.departurePrices.map(price => Number(price.date.slice(0, 4))).filter(Number.isInteger)));
    if ([...groundTruthYears].some(year => year !== sourceDepartureYear)) {
      throw new Error(`BENCHMARK_SOURCE_DEPARTURE_YEAR_CONFLICT:${slot}`);
    }
  }
  review.annotation.sections.forEach((section, sectionIndex) => {
    if (typeof section.sourceSalePricePresent !== 'boolean') {
      throw new Error(`BENCHMARK_SOURCE_SALE_PRICE_REVIEW_REQUIRED:${slot}:${sectionIndex}`);
    }
    if (section.sourceSalePricePresent === false && (
      section.departurePrices.length > 0
      || (section.priceComponents ?? []).some(component => component.componentType === 'sale_price')
    )) {
      throw new Error(`BENCHMARK_SOURCE_SALE_PRICE_CONFLICT:${slot}:${sectionIndex}`);
    }
    if (review.annotation.schemaVersion === PRODUCT_REGISTRATION_BENCHMARK_SCHEMA_VERSION) {
      validateV2Section(
        section,
        `BENCHMARK_V2_SECTION_INVALID:${slot}:${sectionIndex}`,
        review.annotation.expectedDocumentClass === 'travel_product',
      );
    }
  });
  if (review.annotation.schemaVersion === PRODUCT_REGISTRATION_BENCHMARK_SCHEMA_VERSION
    && review.annotation.sections.length === 0) {
    throw new Error(`BENCHMARK_SOURCE_BOUNDARY_REQUIRED:${slot}`);
  }
  const actualHash = benchmarkAnnotationHash(review.annotation);
  if (actualHash !== review.annotationHash) throw new Error(`BENCHMARK_REVIEW_HASH_MISMATCH:${slot}`);
}

export function resolveReviewedBenchmarkAnnotation(bundle: BenchmarkCaseReviewBundle): {
  annotation: ReviewedBenchmarkAnnotation;
  firstReviewHash: string;
  secondReviewHash: string;
  adjudicationHash: string | null;
} {
  validateReview(bundle.first, 'first');
  validateReview(bundle.second, 'second');
  if (bundle.first.annotationHash === bundle.second.annotationHash) {
    return {
      annotation: bundle.first.annotation,
      firstReviewHash: bundle.first.annotationHash,
      secondReviewHash: bundle.second.annotationHash,
      adjudicationHash: null,
    };
  }
  validateReview(bundle.adjudicator, 'adjudicator');
  return {
    annotation: bundle.adjudicator.annotation,
    firstReviewHash: bundle.first.annotationHash,
    secondReviewHash: bundle.second.annotationHash,
    adjudicationHash: bundle.adjudicator.annotationHash,
  };
}

function evidenceFrom(value: unknown): BenchmarkEvidenceAnchor[] {
  const evidence = object(value);
  if (!evidence) return [];
  const quoteHash = normalizedText(evidence.quote_hash ?? evidence.quoteHash);
  if (!validSha256(quoteHash)) return [];
  return [{
    anchorId: normalizedText(evidence.node_id ?? evidence.nodeId) || null,
    quoteHash,
    quote: normalizedText(evidence.quote) || null,
    page: Number.isInteger(evidence.page) ? Number(evidence.page) : null,
    tableId: normalizedText(evidence.table_id ?? evidence.tableId) || null,
    row: Number.isInteger(evidence.row) ? Number(evidence.row) : null,
    column: Number.isInteger(evidence.column) ? Number(evidence.column) : null,
    startOffset: Number.isInteger(evidence.char_start ?? evidence.startOffset) ? Number(evidence.char_start ?? evidence.startOffset) : null,
    endOffset: Number.isInteger(evidence.char_end ?? evidence.endOffset) ? Number(evidence.char_end ?? evidence.endOffset) : null,
  }];
}

function priceScope(price: JsonObject): BenchmarkPriceScope {
  const date = normalizedText(price.date);
  if (/^\d{4}-\d{2}-\d{2}$/u.test(date)) return { kind: 'specific_departure', date };
  const range = object(price.date_range);
  const startDate = normalizedText(range?.start);
  const endDate = normalizedText(range?.end);
  if (/^\d{4}-\d{2}-\d{2}$/u.test(startDate) && /^\d{4}-\d{2}-\d{2}$/u.test(endDate)) {
    return { kind: 'date_range', startDate, endDate };
  }
  if (Number.isInteger(price.weekday)) return { kind: 'weekday', weekdays: [Number(price.weekday)] };
  return { kind: 'always' };
}

function itineraryEventType(value: unknown): BenchmarkItineraryItem['type'] {
  const type = normalizedText(value).toLowerCase();
  if (type === 'transfer') return 'ground_transport';
  if (['flight', 'attraction', 'meal', 'shopping', 'optional_tour', 'free_time', 'meeting', 'lodging'].includes(type)) {
    return type as BenchmarkItineraryItem['type'];
  }
  if (type === 'hotel') return 'lodging';
  if (type === 'option') return 'optional_tour';
  return 'note';
}

function factsFromCanonicalSection(
  rawSection: unknown,
  sourceText: string,
  standardCancellationPolicyApplied: boolean,
): ExtractedSectionFacts {
  const section = object(rawSection) ?? {};
  const ledger = object(object(section.v3)?.ledger);
  const variants = array(ledger?.variants).map(object).filter((value): value is JsonObject => Boolean(value));
  const titles = variants.flatMap(variant => array(variant.title_parts).map(normalizedText).filter(Boolean));
  const priceRows = variants.flatMap(variant => array(variant.price_calendar).map(object).filter((value): value is JsonObject => Boolean(value)));
  const departurePrices = priceRows.flatMap(price => {
    const date = normalizedText(price.date);
    const amount = Number(price.amount);
    const currency = normalizedCurrency(price.currency);
    return /^\d{4}-\d{2}-\d{2}$/u.test(date) && Number.isFinite(amount) && currency
      ? [{ date, amount, currency, listPrice: Number.isFinite(Number(price.list_price)) ? Number(price.list_price) : null, fuelSurcharge: null }]
      : [];
  });
  const priceComponents = priceRows.flatMap(price => {
    const amount = Number(price.amount);
    const currency = normalizedCurrency(price.currency);
    if (!Number.isFinite(amount) || !currency) return [];
    const scope = priceScope(price);
    const evidence = evidenceFrom(price.evidence);
    const components: BenchmarkPriceComponent[] = [{ componentType: 'sale_price', amount, currency, chargeBasis: 'per_person', inclusion: 'included', scope, evidence }];
    const listPrice = Number(price.list_price);
    if (Number.isFinite(listPrice) && listPrice > 0) components.push({ componentType: 'list_price', amount: listPrice, currency, chargeBasis: 'per_person', inclusion: 'included', scope, evidence });
    const childAmount = Number(price.child_amount);
    if (Number.isFinite(childAmount) && childAmount > 0) components.push({ componentType: 'child_price', amount: childAmount, currency, chargeBasis: 'per_person', inclusion: 'included', scope, evidence });
    return components;
  });
  const flights = variants.flatMap(variant => array(variant.flight_segments).flatMap(rawFlight => {
    const flight = object(rawFlight);
    const code = normalizedText(flight?.code).replace(/\s+/g, '').toUpperCase();
    return code ? [{
      code,
      departureAirport: normalizedText(flight?.dep_airport).toUpperCase() || null,
      arrivalAirport: normalizedText(flight?.arr_airport).toUpperCase() || null,
      departureTime: normalizedText(flight?.dep_time) || null,
      arrivalTime: normalizedText(flight?.arr_time) || null,
      evidence: evidenceFrom(flight?.evidence),
    }] : [];
  }));
  const itinerary = variants.flatMap(variant => array(variant.days).flatMap(rawDay => {
    const day = object(rawDay);
    if (!day) return [];
    const dayNumber = Number(day.day);
    const events = array(day.events).map(object).filter((value): value is JsonObject => Boolean(value));
    const items: BenchmarkItineraryItem[] = events.map((event, index) => ({
      order: index + 1,
      type: itineraryEventType(event.type),
      text: normalizedTerm(event.raw_text),
      time: normalizedText(event.time) || null,
      evidence: evidenceFrom(event.evidence),
    }));
    const hotel = object(day.hotel);
    const hotelName = normalizedTerm(hotel?.raw_text ?? hotel?.name) || null;
    return Number.isInteger(dayNumber) && dayNumber > 0 ? [{ day: dayNumber, items, hotel: hotelName }] : [];
  }));
  const hotels = itinerary.flatMap(day => day.hotel ? [day.hotel] : []);
  const terms = (key: 'inclusions' | 'exclusions') => variants.flatMap(variant => array(variant[key])
    .map(item => normalizedTerm(object(item)?.value ?? item))
    .filter(Boolean));
  const inclusions = terms('inclusions');
  const exclusions = terms('exclusions');
  const commercialFacts: BenchmarkCommercialFact[] = [
    ...inclusions.map(value => ({ kind: 'inclusion' as const, value, scope: 'product_variant' as const, evidence: [] })),
    ...exclusions.map(value => ({ kind: 'exclusion' as const, value, scope: 'product_variant' as const, evidence: [] })),
    ...variants.flatMap(variant => array(variant.shopping).map(item => ({ kind: 'shopping' as const, value: normalizedTerm(object(item)?.value ?? item), scope: 'product_variant' as const, evidence: evidenceFrom(object(item)?.evidence) })).filter(item => item.value)),
    ...variants.flatMap(variant => array(variant.options).map(item => ({ kind: 'optional_tour' as const, value: normalizedTerm(object(item)?.raw_name ?? object(item)?.normalized_name), scope: 'product_variant' as const, evidence: evidenceFrom(object(item)?.evidence) })).filter(item => item.value)),
  ];
  const durationDays = variants.length === 1 && Number.isInteger(variants[0]?.duration_days)
    ? Number(variants[0]?.duration_days)
    : itinerary.length > 0 ? Math.max(...itinerary.map(day => day.day)) : null;
  const nights = variants.length === 1 && Number.isInteger(variants[0]?.nights) ? Number(variants[0]?.nights) : null;
  const hotelText = hotels.join(' / ');
  const hotelMode: BenchmarkProductIdentityAxes['hotelMode'] = hotels.length === 0
    ? 'none'
    : /(?:미정|예정|동급)/u.test(hotelText) ? 'unconfirmed'
    : /(?:\s\/\s|\s또는\s|or)/iu.test(hotelText) ? 'alternatives'
    : 'fixed';
  const cancellationPresent = /(?:cancel|cancellation|취소|취소료|해약|여행약관|특별약관|위약금|패널티)/iu.test(sourceText);
  return {
    title: normalizedText(section.titleHint) || titles[0] || null,
    productIdentity: {
      durationDays,
      nights,
      grade: variants.length === 1 ? normalizedText(variants[0]?.grade) || null : null,
      hotelMode,
      hotels,
      flightCodes: flights.map(flight => flight.code),
    },
    sourceSalePricePresent: departurePrices.length > 0 || priceComponents.some(component => component.componentType === 'sale_price'),
    departurePrices,
    priceComponents,
    dayCounts: variants.map(variant => array(variant.days).length).filter(count => count > 0),
    itinerary,
    flights,
    hotels,
    hotelMode,
    inclusions,
    exclusions,
    commercialFacts,
    cancellationPresent,
    cancellationCoverage: cancellationPresent ? 'source' : standardCancellationPolicyApplied ? 'approved_standard_fallback' : 'missing',
  };
}

function orderedKeys(values: string[]): string[] {
  return values.filter(Boolean);
}

function multisetDiff(expected: string[], actual: string[]): { missing: string[]; unexpected: string[]; exact: number; total: number } {
  const remaining = [...actual];
  let exact = 0;
  const missing: string[] = [];
  for (const value of expected) {
    const index = remaining.indexOf(value);
    if (index >= 0) {
      exact += 1;
      remaining.splice(index, 1);
    } else {
      missing.push(value);
    }
  }
  return { missing, unexpected: remaining, exact, total: Math.max(1, expected.length, actual.length) };
}

function priceKey(value: BenchmarkGroundTruthSection['departurePrices'][number]): string {
  return `${value.date}|${value.amount}|${normalizedCurrency(value.currency)}|${value.listPrice ?? ''}|${value.fuelSurcharge ?? ''}`;
}

function scopeKey(scope: BenchmarkPriceScope): string {
  if (scope.kind === 'specific_departure') return `date:${scope.date}`;
  if (scope.kind === 'date_range') return `range:${scope.startDate}:${scope.endDate}`;
  if (scope.kind === 'weekday') return `weekday:${[...scope.weekdays].sort().join(',')}:${scope.startDate ?? ''}:${scope.endDate ?? ''}`;
  return 'always';
}

function componentKey(value: BenchmarkPriceComponent): string {
  return [value.componentType, value.amount, normalizedCurrency(value.currency), value.chargeBasis, value.inclusion, scopeKey(value.scope)].join('|');
}

function flightIdentityKey(value: BenchmarkGroundTruthSection['flights'][number]): string {
  return [value.code, value.departureAirport ?? '', value.arrivalAirport ?? ''].map(normalizedText).join('|').toUpperCase();
}

function flightTimeKey(value: BenchmarkGroundTruthSection['flights'][number]): string {
  return [flightIdentityKey(value), value.departureTime ?? '', value.arrivalTime ?? ''].join('|');
}

function identityKeys(value: BenchmarkProductIdentityAxes): string[] {
  return [
    `destination:${normalizedTerm(value.destination)}`,
    `duration:${value.durationDays ?? ''}`,
    `nights:${value.nights ?? ''}`,
    `grade:${normalizedTerm(value.grade)}`,
    `hotel_mode:${value.hotelMode}`,
    ...value.hotels.map(item => `hotel:${normalizedTerm(item)}`),
    ...value.flightCodes.map(item => `flight:${normalizedText(item).toUpperCase()}`),
  ].filter(valueKey => !valueKey.endsWith(':'));
}

function itineraryKeys(value: BenchmarkItineraryDay[]): string[] {
  return value.flatMap(day => [
    `day:${day.day}:hotel:${normalizedTerm(day.hotel)}`,
    ...day.items.map(item => `day:${day.day}:order:${item.order}:type:${item.type}:time:${normalizedText(item.time)}:text:${normalizedTerm(item.text)}`),
  ]);
}

function commercialFactKey(value: BenchmarkCommercialFact): string {
  return `${value.kind}|${value.scope}|${normalizedTerm(value.value)}`;
}

function compareCollection(input: {
  field: string;
  criticality: BenchmarkFieldDiff['criticality'];
  expected: string[];
  actual: string[];
  ordered?: boolean;
}): { exact: number; total: number; diff: BenchmarkFieldDiff | null } {
  const expected = orderedKeys(input.expected);
  const actual = orderedKeys(input.actual);
  if (expected.length === 0 && actual.length === 0) return { exact: 1, total: 1, diff: null };
  if (input.ordered) {
    const exact = expected.reduce((sum, value, index) => sum + (actual[index] === value ? 1 : 0), 0);
    const isExact = expected.length === actual.length && exact === expected.length;
    return {
      exact,
      total: Math.max(1, expected.length, actual.length),
      diff: isExact ? null : { field: input.field, criticality: input.criticality, missing: expected, unexpected: actual },
    };
  }
  const result = multisetDiff(expected, actual);
  return {
    exact: result.exact,
    total: result.total,
    diff: result.missing.length === 0 && result.unexpected.length === 0
      ? null
      : { field: input.field, criticality: input.criticality, missing: result.missing, unexpected: result.unexpected },
  };
}

function boundaryAnchorMatches(expected: BenchmarkEvidenceAnchor, actual: CanonicalSection['evidence'][number] | undefined): boolean {
  if (!actual) return false;
  const nodeMatches = expected.anchorId ? expected.anchorId === actual.nodeId : true;
  return nodeMatches && expected.quoteHash === actual.quoteHash;
}

export function compareCanonicalSectionSequenceToGroundTruth(input: {
  canonicalSections: CanonicalSection[];
  groundTruthSections: BenchmarkGroundTruthSection[];
}): { exact: boolean; diffs: string[] } {
  const diffs: string[] = [];
  if (input.canonicalSections.length !== input.groundTruthSections.length) {
    diffs.push(`SECTION_COUNT:${input.canonicalSections.length}/${input.groundTruthSections.length}`);
    return { exact: false, diffs };
  }
  input.groundTruthSections.forEach((truth, index) => {
    if (!truth.boundary) {
      diffs.push(`SECTION_BOUNDARY_MISSING:${index}`);
      return;
    }
    const predicted = input.canonicalSections[index];
    if (!predicted) {
      diffs.push(`SECTION_PREDICTION_MISSING:${index}`);
      return;
    }
    if (truth.boundary.rawTextHash && truth.boundary.rawTextHash !== predicted.rawTextHash) diffs.push(`SECTION_TEXT_HASH:${index}`);
    if (!boundaryAnchorMatches(truth.boundary.startAnchor, predicted.evidence[0])) diffs.push(`SECTION_START_ANCHOR:${index}`);
    if (!boundaryAnchorMatches(truth.boundary.endAnchor, predicted.evidence.at(-1))) diffs.push(`SECTION_END_ANCHOR:${index}`);
  });
  return { exact: diffs.length === 0, diffs };
}

export function compareCanonicalSectionToGroundTruth(input: {
  rawSection: unknown;
  sourceText: string;
  groundTruth: BenchmarkGroundTruthSection;
  predictedOutcome: ProductRegistrationBenchmarkCase['predictedOutcome'];
  expectedSourceIncompleteDiscard?: boolean;
  standardCancellationPolicyApplied?: boolean;
}): { criticalFieldCount: number; criticalExactCount: number; criticalFalsePublish: boolean; fieldDiffs: BenchmarkFieldDiff[] } {
  const actual = factsFromCanonicalSection(input.rawSection, input.sourceText, input.standardCancellationPolicyApplied === true);
  const comparisons = [
    compareCollection({ field: 'product_identity', criticality: 'hard', expected: input.groundTruth.productIdentity ? identityKeys(input.groundTruth.productIdentity) : [], actual: input.groundTruth.productIdentity ? identityKeys(actual.productIdentity) : [] }),
    compareCollection({ field: 'departure_prices', criticality: 'hard', expected: input.groundTruth.departurePrices.map(priceKey), actual: actual.departurePrices.map(priceKey) }),
    compareCollection({ field: 'price_components', criticality: 'hard', expected: (input.groundTruth.priceComponents ?? []).map(componentKey), actual: input.groundTruth.priceComponents ? actual.priceComponents.map(componentKey) : [] }),
    compareCollection({ field: 'day_counts', criticality: 'hard', expected: input.groundTruth.dayCounts.map(String), actual: actual.dayCounts.map(String) }),
    compareCollection({ field: 'itinerary_order', criticality: 'hard', expected: itineraryKeys(input.groundTruth.itinerary ?? []), actual: input.groundTruth.itinerary ? itineraryKeys(actual.itinerary) : [], ordered: true }),
    compareCollection({ field: 'flight_identity', criticality: 'hard', expected: input.groundTruth.flights.map(flightIdentityKey), actual: actual.flights.map(flightIdentityKey) }),
    compareCollection({ field: 'flight_times', criticality: 'degradable', expected: input.groundTruth.flights.map(flightTimeKey), actual: actual.flights.map(flightTimeKey) }),
    compareCollection({ field: 'hotels', criticality: 'degradable', expected: input.groundTruth.hotels.map(normalizedTerm), actual: actual.hotels.map(normalizedTerm) }),
    compareCollection({ field: 'hotel_mode', criticality: 'hard', expected: input.groundTruth.hotelMode ? [input.groundTruth.hotelMode] : [], actual: input.groundTruth.hotelMode ? [actual.hotelMode ?? 'none'] : [] }),
    compareCollection({ field: 'inclusions', criticality: 'hard', expected: input.groundTruth.inclusions.map(normalizedTerm), actual: actual.inclusions.map(normalizedTerm) }),
    compareCollection({ field: 'exclusions', criticality: 'hard', expected: input.groundTruth.exclusions.map(normalizedTerm), actual: actual.exclusions.map(normalizedTerm) }),
    compareCollection({ field: 'commercial_scope', criticality: 'hard', expected: (input.groundTruth.commercialFacts ?? []).map(commercialFactKey), actual: input.groundTruth.commercialFacts ? actual.commercialFacts.map(commercialFactKey) : [] }),
    compareCollection({ field: 'cancellation_coverage', criticality: 'hard', expected: [input.groundTruth.cancellationCoverage ?? (input.groundTruth.cancellationPresent ? 'source' : 'missing')], actual: [actual.cancellationCoverage ?? 'missing'] }),
  ];
  const fieldDiffs = comparisons.flatMap(item => item.diff ? [item.diff] : []);
  const criticalFalsePublish = input.predictedOutcome !== 'blocked' && (
    input.expectedSourceIncompleteDiscard === true
    || fieldDiffs.some(diff => diff.criticality === 'hard' || diff.unexpected.length > 0 || input.predictedOutcome === 'verified')
  );
  return {
    criticalFieldCount: comparisons.reduce((sum, item) => sum + item.total, 0),
    criticalExactCount: comparisons.reduce((sum, item) => sum + item.exact, 0),
    criticalFalsePublish,
    fieldDiffs,
  };
}
