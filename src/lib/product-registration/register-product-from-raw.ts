import type { AttractionData } from '@/lib/attraction-matcher';
import { createHash } from 'node:crypto';
import { sanitizeForCustomer } from '@/lib/customer-leak-sanitizer';
import { postProcessCatalogFields } from '@/lib/package-post-process';
import { normalizeOptionalTours } from '@/lib/package-acl';
import type { ExtractedData, NoticeItem, OptionalTour } from '@/lib/parser';
import { detectIssues as detectCriticIssues, autoFixIssues as autoFixCriticIssues } from '@/lib/parser/critic';
import { extractBullets } from '@/lib/parser/deterministic/bullets';
import { looksLikeCommaSplitBroken } from '@/lib/parser/deterministic/comma-split-signature';
import { detectFerry } from '@/lib/parser/deterministic/ferry-classifier';
import { repairExtractedDataWithGemini } from '@/lib/parser/extracted-field-repair';
import { generateRecommendationCopy, isWeakCopy } from '@/lib/parser/recommendation-copy';
import { runProductRegistrationV3, type V3PipelineResult } from '@/lib/product-registration-v3';
import {
  buildSupplierRawDeterministicItinerary,
  extractSupplierRawDeterministicFacts,
} from '@/lib/supplier-raw-deterministic-facts';
import { applyDeterministicExtractedDataFixes, validateExtractedProduct, type ProductPriceRowInput } from '@/lib/upload-validator';
import {
  resolveUploadDestinationAndCodes,
  type UploadDestinationResolution,
} from './destination-resolution';
import { evaluateUploadDeliverability } from './deliverability-gate';
import { inferAccommodationsFromRawText } from './accommodations';
import { inferDepartureDaysFromRawText } from './departure-days';
import { normalizeUploadItinerary, type ItineraryDataLike } from './itinerary-normalization';
import { recoverUploadPriceData } from './price-recovery';
import { normalizeUploadTitle } from './title-normalization';
import type { SourceEvidenceSpan, StandardProductRegistrationObject } from './types';

const NOTICE_TYPES = new Set<NoticeItem['type']>(['CRITICAL', 'PAYMENT', 'POLICY', 'INFO']);

function hashRawText(rawText: string): string {
  return createHash('sha256').update(rawText).digest('hex');
}

function addEvidenceSpan(input: {
  spans: SourceEvidenceSpan[];
  field: string;
  rawText: string;
  rawTextHash: string;
  value: unknown;
  productIndex?: number | null;
  sourceKind?: SourceEvidenceSpan['sourceKind'];
  sectionKey?: string | null;
  confidence?: number;
}): void {
  const value = typeof input.value === 'string' ? input.value.trim() : '';
  if (value.length < 2) return;
  const start = input.rawText.indexOf(value);
  if (start < 0) return;
  const lineIndex = input.rawText.slice(0, start).split(/\r?\n/).length - 1;
  input.spans.push({
    field: input.field,
    rawTextHash: input.rawTextHash,
    start,
    end: start + value.length,
    quote: value.slice(0, 240),
    productIndex: input.productIndex ?? null,
    sourceKind: input.sourceKind ?? 'line',
    sectionKey: input.sectionKey ?? null,
    lineIndex,
    rowIndex: null,
    columnIndex: null,
    confidence: input.confidence ?? 0.9,
  });
}

function buildEvidenceSpans(input: {
  rawText: string;
  rawTextHash: string;
  ed: ExtractedData;
  priceRecovery: { minPrice: number | null; source: string };
}): SourceEvidenceSpan[] {
  const spans: SourceEvidenceSpan[] = [];
  addEvidenceSpan({ spans, field: 'title', rawText: input.rawText, rawTextHash: input.rawTextHash, value: input.ed.title, confidence: 0.95 });
  addEvidenceSpan({ spans, field: 'destination', rawText: input.rawText, rawTextHash: input.rawTextHash, value: input.ed.destination, confidence: 0.85 });
  addEvidenceSpan({ spans, field: 'airline', rawText: input.rawText, rawTextHash: input.rawTextHash, value: input.ed.airline, confidence: 0.8 });
  addEvidenceSpan({ spans, field: 'departure_airport', rawText: input.rawText, rawTextHash: input.rawTextHash, value: input.ed.departure_airport, confidence: 0.8 });
  addEvidenceSpan({ spans, field: 'flight_no', rawText: input.rawText, rawTextHash: input.rawTextHash, value: input.ed.flight_info?.flight_no, confidence: 0.9 });

  const minPrice = input.priceRecovery.minPrice;
  if (minPrice != null) {
    const formatted = minPrice.toLocaleString('en-US');
    addEvidenceSpan({ spans, field: 'min_price', rawText: input.rawText, rawTextHash: input.rawTextHash, value: formatted, confidence: 0.8 });
  }

  return spans;
}

function normalizeParserOptionalTours(raw: unknown): OptionalTour[] {
  return normalizeOptionalTours(raw).map(tour => ({
    name: tour.name,
    region: tour.region,
    price: tour.price ?? undefined,
    price_usd: tour.price_usd ?? undefined,
    price_krw: tour.price_krw ?? undefined,
    note: tour.note,
  }));
}

function normalizeParserNoticeItems(raw: unknown): Array<string | NoticeItem> {
  if (!Array.isArray(raw)) return [];

  const notices: Array<string | NoticeItem> = [];
  for (const item of raw) {
    if (typeof item === 'string') {
      notices.push(item);
      continue;
    }
    if (!item || typeof item !== 'object') continue;

    const source = item as Record<string, unknown>;
    const candidateType = typeof source.type === 'string' ? source.type : 'INFO';
    const type = NOTICE_TYPES.has(candidateType as NoticeItem['type'])
      ? candidateType as NoticeItem['type']
      : 'INFO';
    const title = typeof source.title === 'string' && source.title.trim()
      ? source.title.trim()
      : type;
    const text = typeof source.text === 'string' && source.text.trim()
      ? source.text.trim()
      : title;

    notices.push({ type, title, text });
  }

  return notices;
}

export type RegisterProductFromRawInput = {
  rawText: string;
  documentRawText?: string | null;
  extractedData: ExtractedData;
  itineraryData?: ItineraryDataLike | null;
  title?: string | null;
  activeAttractions: AttractionData[];
  supplierCode?: string | null;
  supplierHint?: string | null;
  sourceType?: string | null;
  tempDestination?: string | null;
  destinationResolution?: UploadDestinationResolution | null;
  internalCode?: string | null;
  destinationCode?: string | null;
  extraFailures?: string[];
  enableGeminiFallback?: boolean;
  priceYear?: number;
  confidence?: number | null;
};

function cloneExtractedData(ed: ExtractedData): ExtractedData {
  return {
    ...ed,
    price_tiers: ed.price_tiers ? [...ed.price_tiers] : undefined,
    inclusions: ed.inclusions ? [...ed.inclusions] : undefined,
    excludes: ed.excludes ? [...ed.excludes] : undefined,
    optional_tours: ed.optional_tours ? [...ed.optional_tours] : undefined,
    accommodations: ed.accommodations ? [...ed.accommodations] : undefined,
    notices_parsed: ed.notices_parsed ? [...ed.notices_parsed] : undefined,
    rawText: ed.rawText ?? '',
  };
}

async function runV3Safely(input: RegisterProductFromRawInput, ed: ExtractedData): Promise<{
  result: V3PipelineResult | null;
  warnings: string[];
}> {
  if (input.rawText.trim().length < 50) {
    return { result: null, warnings: ['v3:raw_text_too_short'] };
  }
  try {
    const result = await runProductRegistrationV3(input.rawText, {
      attractions: input.activeAttractions,
      destination: ed.destination ?? input.destinationResolution?.destination ?? input.tempDestination ?? undefined,
      supplierHint: input.supplierHint ?? undefined,
      sourceType: input.sourceType ?? undefined,
    });
    return { result, warnings: [] };
  } catch (error) {
    return { result: null, warnings: [`v3:failed:${error instanceof Error ? error.message : String(error)}`] };
  }
}

function hasValidSequentialDays(input: ItineraryDataLike | null): boolean {
  const days = input?.days ?? [];
  if (days.length === 0) return false;
  const seen = new Set<number>();
  for (const day of days) {
    if (typeof day.day !== 'number' || !Number.isInteger(day.day) || day.day < 1) return false;
    if (seen.has(day.day)) return false;
    seen.add(day.day);
  }
  return Array.from(seen).sort((a, b) => a - b).every((day, index) => day === index + 1);
}

function shouldPreferSupplierItinerary(
  inputItinerary: ItineraryDataLike | null | undefined,
  supplierItinerary: ItineraryDataLike | null | undefined,
): boolean {
  if (!supplierItinerary?.days?.length) return false;
  if (!inputItinerary?.days?.length) return true;

  const hasHotelName = (day: unknown) => {
    const hotel = (day as { hotel?: { name?: unknown } } | null)?.hotel;
    return typeof hotel?.name === 'string' && hotel.name.trim().length > 0;
  };
  const hasMealInfo = (day: unknown) => {
    const meals = (day as { meals?: Record<string, unknown> } | null)?.meals;
    return Boolean(
      meals?.breakfast_note || meals?.lunch_note || meals?.dinner_note
      || meals?.breakfast || meals?.lunch || meals?.dinner
    );
  };

  const supplierDays = supplierItinerary.days ?? [];
  const inputDays = inputItinerary.days ?? [];
  const supplierHasHotels = supplierDays.some(hasHotelName);
  const inputHasHotels = inputDays.some(hasHotelName);
  const supplierHasMeals = supplierDays.some(hasMealInfo);
  const inputHasMeals = inputDays.some(hasMealInfo);
  const pollutedScheduleItems = inputDays.flatMap(day => day.schedule ?? []).filter(item => {
    const activity = String(item.activity ?? '').trim();
    const compact = activity.replace(/\s+/g, '');
    return /^(전용차량|도보|셔틀|차량|버스|전일|부산|김해|나리타|나라타|치바|동경|도쿄)$/.test(compact)
      || /^[A-Z]{2}\d{2,4}$/.test(compact)
      || /^\d{1,2}:\d{2}$/.test(compact)
      || /^HOTEL\s*:/i.test(activity)
      || /^https?:\/\//i.test(activity)
      || /^[조중석]\s*:/.test(activity);
  });

  return pollutedScheduleItems.length >= 2
    || (supplierHasHotels && !inputHasHotels)
    || (supplierHasMeals && !inputHasMeals);
}

function applySupplierRawFacts(ed: ExtractedData, rawText: string): ItineraryDataLike | null {
  if (rawText.trim().length < 50) return null;
  const rawFacts = extractSupplierRawDeterministicFacts(rawText);
  const missingText = (value: unknown) => !value || value === 'UNK' || value === '?';
  const rawFlightCodes = [...rawText.matchAll(/\b([A-Z]{2}\d{2,4})\b/g)].map(match => match[1]);
  const fallbackFlightOut = rawFacts.outbound?.code ?? rawFlightCodes[0] ?? null;
  const fallbackFlightIn = rawFacts.inbound?.code ?? (rawFlightCodes.length > 1 ? rawFlightCodes[rawFlightCodes.length - 1] : null);

  ed.title = normalizeUploadTitle(ed.title, rawFacts.title) ?? ed.title;
  if ((!ed.destination || ed.destination === 'UNK') && rawFacts.region) ed.destination = rawFacts.region;
  if ((!ed.trip_style || ed.trip_style === 'UNK') && rawFacts.tripStyle) ed.trip_style = rawFacts.tripStyle;
  if ((!ed.duration || ed.duration <= 0) && rawFacts.durationDays) ed.duration = rawFacts.durationDays;
  if ((!ed.departure_airport || ed.departure_airport === 'UNK') && rawFacts.departureAirport) ed.departure_airport = rawFacts.departureAirport;
  if (missingText(ed.airline) && rawFacts.airline) ed.airline = rawFacts.airline;
  if ((!ed.min_participants || ed.min_participants <= 0) && rawFacts.minParticipants) ed.min_participants = rawFacts.minParticipants;
  if ((!ed.inclusions?.length) && rawFacts.inclusions.length) ed.inclusions = rawFacts.inclusions;
  if ((!ed.excludes?.length) && rawFacts.excludes.length) ed.excludes = rawFacts.excludes;
  if ((!ed.notices_parsed?.length) && rawFacts.notices.length) ed.notices_parsed = rawFacts.notices;
  if (!ed.departure_days) {
    const departureDays = inferDepartureDaysFromRawText(rawText);
    if (departureDays) ed.departure_days = departureDays;
  }
  if (!ed.accommodations?.length) {
    const accommodations = inferAccommodationsFromRawText(rawText);
    if (accommodations.length > 0) ed.accommodations = accommodations;
  }
  if ((!ed.optional_tours?.length) && rawFacts.optionalTours.length) {
    ed.optional_tours = rawFacts.optionalTours.map(tour => ({
      name: tour.name,
      region: tour.region || undefined,
      price: tour.priceLabel || undefined,
      price_usd: Number(tour.priceLabel.match(/\$(\d+)/)?.[1] ?? 0) || undefined,
      price_krw: undefined,
      note: tour.note,
    }));
  }
  if ((!ed.flight_info?.flight_no) && fallbackFlightOut) {
    ed.flight_info = {
      ...(ed.flight_info ?? {}),
      airline: ed.airline ?? rawFacts.airline,
      flight_no: fallbackFlightOut,
      depart: rawFacts.outbound?.departure.time,
      arrive: rawFacts.outbound?.arrival.time,
      return_depart: rawFacts.inbound?.departure.time,
      return_arrive: rawFacts.inbound?.arrival.time,
    };
  }

  const fallbackItinerary = buildSupplierRawDeterministicItinerary(rawText) as unknown as ItineraryDataLike | null;
  if (!fallbackItinerary && !rawFacts.outbound?.code && !rawFacts.inbound?.code && !ed.airline && !ed.departure_airport) {
    return null;
  }

  const itinerary = (fallbackItinerary ?? {}) as ItineraryDataLike & { meta?: Record<string, string | null | undefined> };
  itinerary.meta = {
    ...(itinerary.meta ?? {}),
    airline: itinerary.meta?.airline ?? ed.airline ?? rawFacts.airline,
    flight_out: itinerary.meta?.flight_out ?? fallbackFlightOut,
    flight_in: itinerary.meta?.flight_in ?? fallbackFlightIn,
    departure_airport: itinerary.meta?.departure_airport ?? ed.departure_airport ?? rawFacts.departureAirport,
  };
  return itinerary;
}

function applyDeterministicProductFieldRecovery(ed: ExtractedData, rawText: string): void {
  const ferry = detectFerry(rawText, ed.title);
  if (ferry.isFerry) {
    if (!ed.product_type || ed.product_type === 'package') {
      ed.product_type = 'cruise';
    }
    if (!ed.airline && ferry.ferryName) {
      ed.airline = ferry.ferryName;
    }
  }

  const bullets = extractBullets(rawText);
  if ((looksLikeCommaSplitBroken(ed.inclusions) || !ed.inclusions?.length) && bullets.inclusions.length > 0) {
    ed.inclusions = bullets.inclusions;
  }
  if ((looksLikeCommaSplitBroken(ed.excludes) || !ed.excludes?.length) && bullets.excludes.length > 0) {
    ed.excludes = bullets.excludes;
  }

  const catalogPost = postProcessCatalogFields({
    title: ed.title,
    product_type: ed.product_type,
    inclusions: ed.inclusions,
    excludes: ed.excludes,
    notices_parsed: ed.notices_parsed,
    raw_text: rawText,
  });
  ed.inclusions = catalogPost.inclusions;
  ed.excludes = catalogPost.excludes;
  ed.notices_parsed = catalogPost.notices_parsed as typeof ed.notices_parsed;
  if (catalogPost.product_type) {
    ed.product_type = catalogPost.product_type;
  }
}

function applyCrossFieldAndSummaryRecovery(ed: ExtractedData, rawText: string): string[] {
  const warnings: string[] = [];
  const criticIssues = detectCriticIssues({
    title: ed.title,
    destination: ed.destination,
    airline: ed.airline,
    product_type: ed.product_type,
    duration: ed.duration,
    nights: (ed as { nights?: number }).nights ?? null,
    price: ed.price ?? null,
    departure_airport: ed.departure_airport,
    rawText,
  });
  if (criticIssues.length > 0) {
    warnings.push(...criticIssues.map(issue => `critic:${issue.severity}:${issue.rule}`));
    const { fixed } = autoFixCriticIssues(ed as unknown as Record<string, unknown>, criticIssues);
    warnings.push(...fixed.map(field => `critic:fixed:${field}`));
  }

  if (isWeakCopy(ed.product_summary, ed.title)) {
    const auto = generateRecommendationCopy({
      title: ed.title,
      destination: ed.destination,
      duration: ed.duration,
      departure: (ed as { departure?: string }).departure ?? null,
      product_type: ed.product_type,
      inclusions: ed.inclusions,
      product_highlights: ed.product_highlights,
      airline: ed.airline,
    });
    if (auto.length > (ed.product_summary?.length ?? 0)) {
      ed.product_summary = auto;
      warnings.push('summary:auto_generated');
    }
  }

  return warnings;
}

function ensureCustomerSellingPrices(rows: ProductPriceRowInput[]): ProductPriceRowInput[] {
  return rows.map(row => {
    if (
      (typeof row.adult_selling_price !== 'number' || row.adult_selling_price <= 0)
      && typeof row.net_price === 'number'
      && Number.isFinite(row.net_price)
      && row.net_price > 0
    ) {
      return { ...row, adult_selling_price: row.net_price };
    }
    return row;
  });
}

async function normalizeExtractedDataForRegistration(input: RegisterProductFromRawInput, ed: ExtractedData): Promise<string[]> {
  const warnings: string[] = [];
  applyDeterministicExtractedDataFixes(ed);

  let validation = validateExtractedProduct(ed);
  if (validation.warnings.length > 0) {
    warnings.push(...validation.warnings.map(warning => `validation:warning:${warning}`));
  }
  if (validation.isValid || input.enableGeminiFallback === false) {
    return warnings;
  }

  warnings.push(...validation.errors.map(error => `validation:error:${error}`));
  const repaired = await repairExtractedDataWithGemini(
    ed,
    validation.errors,
    input.documentRawText ?? input.rawText,
  );
  if (!repaired) {
    warnings.push('validation:repair_unavailable');
    return warnings;
  }

  applyDeterministicExtractedDataFixes(ed);
  validation = validateExtractedProduct(ed);
  if (validation.isValid) {
    warnings.push('validation:repair_applied');
  } else {
    warnings.push(...validation.errors.map(error => `validation:repair_failed:${error}`));
  }
  return warnings;
}

export async function registerProductFromRaw(input: RegisterProductFromRawInput): Promise<StandardProductRegistrationObject> {
  const ed = cloneExtractedData(input.extractedData);
  const rawText = input.rawText || ed.rawText || '';
  const rawTextHash = hashRawText(rawText);
  ed.rawText = rawText;
  const normalizationWarnings = await normalizeExtractedDataForRegistration(input, ed);
  const supplierItinerary = applySupplierRawFacts(ed, rawText);
  applyDeterministicProductFieldRecovery(ed, rawText);
  const fieldRecoveryWarnings = applyCrossFieldAndSummaryRecovery(ed, rawText);

  const destination = input.destinationResolution ?? resolveUploadDestinationAndCodes({
    destination: ed.destination,
    departureAirport: ed.departure_airport,
    durationDays: ed.duration,
    productRawText: rawText,
    documentRawText: input.documentRawText,
    tempDestination: input.tempDestination,
  });
  if (destination.destination && destination.destination !== ed.destination) {
    ed.destination = destination.destination;
  }

  const v3 = await runV3Safely(input, ed);
  const v3RenderInput = v3.result?.render_contract_preview[0] ?? null;
  if ((!ed.optional_tours?.length) && v3RenderInput?.optional_tours?.length) {
    ed.optional_tours = normalizeParserOptionalTours(v3RenderInput.optional_tours);
  }
  if ((!ed.notices_parsed?.length) && v3RenderInput?.notices_parsed?.length) {
    ed.notices_parsed = normalizeParserNoticeItems(v3RenderInput.notices_parsed);
  }

  const sanitization = sanitizeForCustomer(ed);
  Object.assign(ed, sanitization.cleaned);

  const registrationTitle = normalizeUploadTitle(input.title, ed.title) ?? ed.title ?? input.title ?? null;
  if (registrationTitle) ed.title = registrationTitle;

  const priceRecovery = await recoverUploadPriceData(ed, {
    rawText,
    title: registrationTitle ?? ed.title,
    accommodations: ed.accommodations ?? [],
    includeAllHotelColumns: !input.documentRawText || input.documentRawText.trim() === rawText.trim(),
    durationDays: ed.duration,
    departureDays: ed.departure_days,
    year: input.priceYear,
    enableGeminiFallback: input.enableGeminiFallback,
  });
  priceRecovery.priceRows = ensureCustomerSellingPrices(priceRecovery.priceRows);
  ed.price_tiers = priceRecovery.tiers;
  if (priceRecovery.minPrice != null) ed.price = priceRecovery.minPrice;

  const v3ItineraryInput = v3RenderInput?.itinerary_data?.days?.length
    ? { days: v3RenderInput.itinerary_data.days ?? [] } as ItineraryDataLike
    : null;
  const preferSupplierItinerary = shouldPreferSupplierItinerary(input.itineraryData, supplierItinerary);
  const itinerary = await normalizeUploadItinerary({
    itineraryData: preferSupplierItinerary
      ? supplierItinerary
      : input.itineraryData ?? supplierItinerary ?? (hasValidSequentialDays(v3ItineraryInput) ? v3ItineraryInput : null),
    productRawText: rawText,
    destination: ed.destination,
    activeAttractions: input.activeAttractions,
  });
  if (!ed.airline && itinerary.fallbackAirline) ed.airline = itinerary.fallbackAirline;

  const v3GateFailures = v3.result?.gate_result.status === 'blocked'
    ? v3.result.gate_result.checks
      .filter(check => check.status === 'fail')
      .map(check => `v3:gate:${check.id}:${check.message}`)
    : [];
  const deliverability = evaluateUploadDeliverability({
    priceRows: priceRecovery.priceRows,
    priceDates: priceRecovery.priceDates,
    destination: ed.destination,
    destinationCode: input.destinationCode ?? destination.destinationCode,
    internalCode: input.internalCode,
    itineraryDays: itinerary.itineraryDataToSave?.days ?? itinerary.itineraryInput?.days ?? [],
    durationDays: ed.duration,
    rawText,
    priceRecoveryFailures: priceRecovery.failures,
    extraFailures: [
      ...destination.failures.map(reason => `Destination resolution failed: ${reason}`),
      ...(input.extraFailures ?? []),
    ],
  });

  const failures = [
    ...(priceRecovery.ok ? [] : priceRecovery.failures),
    ...(deliverability.ok ? [] : deliverability.blockers),
  ];
  const warnings = [
    ...normalizationWarnings,
    ...fieldRecoveryWarnings,
    ...v3.warnings,
    ...v3GateFailures,
    ...itinerary.warnings,
    ...(v3.result?.gate_result.status === 'needs_review' ? ['v3:needs_review'] : []),
  ];

  return {
    identity: {
      title: registrationTitle,
      destination: ed.destination ?? null,
      destinationCode: input.destinationCode ?? destination.destinationCode,
      internalCode: input.internalCode ?? null,
      departureCode: destination.departureCode,
      supplierCode: input.supplierCode ?? null,
      durationDays: ed.duration ?? destination.durationDays ?? null,
      airline: ed.airline ?? null,
    },
    pricing: {
      ok: priceRecovery.ok,
      source: priceRecovery.source,
      tiers: priceRecovery.tiers,
      productPrices: priceRecovery.priceRows,
      priceDates: priceRecovery.priceDates,
      minPrice: priceRecovery.minPrice,
      selectedPriceBasis: priceRecovery.source,
      optionalPriceCandidatesExcluded: !priceRecovery.failures.some(failure => failure.includes('optional-tour')),
      failures: priceRecovery.failures,
    },
    itinerary,
    destination,
    renderInput: v3RenderInput,
    extractedData: ed,
    sanitization: {
      leakScore: sanitization.leakScore,
      incidents: sanitization.incidents,
    },
    priceRecovery,
    deliverability,
    evidence: {
      rawTextLength: rawText.length,
      rawTextHash,
      priceSource: priceRecovery.source,
      v3DraftStatus: v3.result?.gate_result.status ?? null,
      v3RawTextHash: v3.result?.raw_text_hash ?? null,
      spans: buildEvidenceSpans({
        rawText,
        rawTextHash,
        ed,
        priceRecovery,
      }),
    },
    confidence: input.confidence ?? null,
    failures: [...new Set(failures)],
    warnings: [...new Set(warnings)],
    publishable: priceRecovery.ok && deliverability.ok,
  };
}
