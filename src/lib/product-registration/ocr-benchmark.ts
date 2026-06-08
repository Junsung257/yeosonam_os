import { mapTravelPackageToLandingData } from '@/lib/map-travel-package-to-lp';
import type { ExtractedData } from '@/lib/parser';
import {
  SUPPLIER_RAW_GOLDEN_FIXTURES,
  type SupplierRawGoldenFixture,
} from '@/lib/product-registration-golden-fixtures';
import { renderPackage } from '@/lib/render-contract';
import { buildSupplierRawDeterministicItinerary } from '@/lib/supplier-raw-deterministic-facts';
import { resolveUploadDestinationAndCodes } from './destination-resolution';
import type { ItineraryDataLike } from './itinerary-normalization';
import { registerProductFromRaw } from './register-product-from-raw';

export const OCR_BENCHMARK_CANDIDATE_ENGINES = [
  'docling',
  'marker',
  'mineru',
  'paddleocr-pp-structure-v3',
  'layoutparser',
  'azure-document-intelligence',
  'text-upload-baseline',
] as const;

export type OcrBenchmarkCandidate = {
  engine: string;
  caseId: string;
  extractedText: string;
  sourceFile?: string | null;
};

export type OcrBenchmarkInput = {
  candidates: OcrBenchmarkCandidate[];
};

export type OcrBenchmarkCaseResult = {
  engine: string;
  caseId: string;
  sourceFile: string | null;
  ok: boolean;
  failures: string[];
  metrics: {
    productSplitPreserved: boolean;
    tableRecognitionAccuracy: number;
    priceRowsPreserved: boolean;
    priceDatesPreserved: boolean;
    itineraryDayRowsPreserved: boolean;
    flightSeparated: boolean;
    hotelSeparated: boolean;
    mealSeparated: boolean;
    evidenceSpanRecoverable: boolean;
    mobileLandingReady: boolean;
    a4Ready: boolean;
    finalCustomerOutcomeReady: boolean;
  };
  counts: {
    priceRows: number;
    priceDates: number;
    itineraryDays: number;
    evidenceSpans: number;
  };
};

export type OcrBenchmarkReport = {
  generatedAt: string;
  candidateEngines: string[];
  total: number;
  passed: number;
  failed: number;
  summary: {
    tableRecognitionAccuracyAvg: number;
    priceRowsPreserved: number;
    priceDatesPreserved: number;
    itineraryDayRowsPreserved: number;
    flightSeparated: number;
    hotelSeparated: number;
    mealSeparated: number;
    evidenceSpanRecoverable: number;
    finalCustomerOutcomeReady: number;
  };
  results: OcrBenchmarkCaseResult[];
};

function fixtureById(fixtures: SupplierRawGoldenFixture[]): Map<string, SupplierRawGoldenFixture> {
  return new Map(fixtures.map(fixture => [fixture.id, fixture]));
}

function pctCount(results: OcrBenchmarkCaseResult[], key: keyof OcrBenchmarkCaseResult['metrics']): number {
  return results.filter(result => result.metrics[key]).length;
}

function hasFlightSeparation(registration: Awaited<ReturnType<typeof registerProductFromRaw>>, expected: SupplierRawGoldenFixture['expected']): boolean {
  const serialized = JSON.stringify({
    flightInfo: registration.extractedData.flight_info,
    itinerary: registration.itinerary.itineraryDataToSave,
  });
  return serialized.includes(expected.outboundFlight) && serialized.includes(expected.inboundFlight);
}

function hasHotelSeparation(registration: Awaited<ReturnType<typeof registerProductFromRaw>>): boolean {
  const days = registration.itinerary.itineraryDataToSave?.days ?? [];
  return days.some(day => {
    const hotel = (day as { hotel?: { name?: unknown } } | null)?.hotel;
    return typeof hotel?.name === 'string' && hotel.name.trim().length > 0;
  });
}

function hasMealSeparation(registration: Awaited<ReturnType<typeof registerProductFromRaw>>): boolean {
  const days = registration.itinerary.itineraryDataToSave?.days ?? [];
  return days.some(day => {
    const meals = (day as { meals?: Record<string, unknown> } | null)?.meals;
    return Boolean(
      meals?.breakfast || meals?.lunch || meals?.dinner
      || meals?.breakfast_note || meals?.lunch_note || meals?.dinner_note
    );
  });
}

function renderReadiness(registration: Awaited<ReturnType<typeof registerProductFromRaw>>, fixture: SupplierRawGoldenFixture): {
  mobileLandingReady: boolean;
  a4Ready: boolean;
  failures: string[];
} {
  const failures: string[] = [];
  const pkg = {
    id: fixture.id,
    title: registration.identity.title ?? fixture.expected.title,
    destination: registration.identity.destination ?? fixture.expected.destination,
    duration: registration.identity.durationDays ?? fixture.expected.dayCount,
    price: registration.pricing.minPrice ?? fixture.expected.adultPrice,
    price_dates: registration.pricing.priceDates,
    itinerary_data: registration.itinerary.itineraryDataToSave,
    inclusions: registration.extractedData.inclusions ?? [],
    excludes: registration.extractedData.excludes ?? [],
    optional_tours: registration.extractedData.optional_tours ?? [],
  };

  let mobileLandingReady = false;
  let a4Ready = false;
  try {
    const landing = mapTravelPackageToLandingData(pkg, null);
    mobileLandingReady = Boolean(
      landing.priceFrom
      && landing.priceFrom > 0
      && Array.isArray(landing.price_dates)
      && landing.price_dates.length > 0
      && Array.isArray(landing.itinerary.days)
      && landing.itinerary.days.length > 0
    );
    if (!mobileLandingReady) failures.push('mobile_landing_not_ready');
  } catch (error) {
    failures.push(`mobile_landing_error:${error instanceof Error ? error.message : String(error)}`);
  }

  try {
    const view = renderPackage(pkg);
    a4Ready = Array.isArray(view.days) && view.days.length > 0 && registration.pricing.priceDates.length > 0;
    if (!a4Ready) failures.push('a4_not_ready');
  } catch (error) {
    failures.push(`a4_error:${error instanceof Error ? error.message : String(error)}`);
  }

  return { mobileLandingReady, a4Ready, failures };
}

async function evaluateCandidate(
  candidate: OcrBenchmarkCandidate,
  fixture: SupplierRawGoldenFixture,
): Promise<OcrBenchmarkCaseResult> {
  const failures: string[] = [];
  const expected = fixture.expected;
  const itinerary = buildSupplierRawDeterministicItinerary(candidate.extractedText);
  const destination = resolveUploadDestinationAndCodes({
    destination: expected.destination,
    departureAirport: expected.departureAirport,
    durationDays: expected.dayCount,
    productRawText: candidate.extractedText,
    documentRawText: candidate.extractedText,
  });
  const ed: ExtractedData = {
    title: expected.title,
    destination: destination.destination ?? expected.destination,
    duration: expected.dayCount,
    rawText: candidate.extractedText,
    price_tiers: [],
  };
  const registration = await registerProductFromRaw({
    rawText: candidate.extractedText,
    documentRawText: candidate.extractedText,
    extractedData: ed,
    title: expected.title,
    activeAttractions: [],
    destinationResolution: destination,
    destinationCode: destination.destinationCode,
    internalCode: `${destination.departureCode}-OCR-${destination.destinationCode}-${expected.dayCount}D`,
    itineraryData: itinerary as ItineraryDataLike | null,
    enableGeminiFallback: false,
    priceYear: 2027,
  });

  const priceDateSet = new Set(registration.pricing.priceDates.map(priceDate => priceDate.date));
  const expectedDateCount = expected.departureDates.length;
  const priceRowsPreserved = registration.pricing.productPrices.length >= expectedDateCount;
  const priceDatesPreserved = expected.departureDates.every(date => priceDateSet.has(date));
  const priceValuePreserved = registration.pricing.minPrice === expected.adultPrice;
  const tableRecognitionAccuracy = [
    priceRowsPreserved,
    priceDatesPreserved,
    priceValuePreserved,
  ].filter(Boolean).length / 3;
  const itineraryDays = registration.itinerary.itineraryDataToSave?.days ?? [];
  const itineraryDayRowsPreserved = itineraryDays.length === expected.dayCount;
  const flightSeparated = hasFlightSeparation(registration, expected);
  const hotelSeparated = hasHotelSeparation(registration);
  const mealSeparated = hasMealSeparation(registration);
  const evidenceSpanRecoverable = registration.evidence.rawTextHash.length === 64
    && registration.evidence.spans.length > 0
    && registration.evidence.spans.every(span => span.rawTextHash === registration.evidence.rawTextHash);
  const render = renderReadiness(registration, fixture);
  failures.push(...render.failures);

  if (!priceRowsPreserved) failures.push('price_rows_not_preserved');
  if (!priceDatesPreserved) failures.push('price_dates_not_preserved');
  if (!priceValuePreserved) failures.push(`min_price:${registration.pricing.minPrice ?? 'null'}!=${expected.adultPrice}`);
  if (!itineraryDayRowsPreserved) failures.push(`itinerary_days:${itineraryDays.length}!=${expected.dayCount}`);
  if (!flightSeparated) failures.push('flight_not_separated');
  if (!hotelSeparated) failures.push('hotel_not_separated');
  if (!mealSeparated) failures.push('meal_not_separated');
  if (!evidenceSpanRecoverable) failures.push('evidence_span_not_recoverable');
  if (!registration.deliverability.ok) failures.push(`deliverability:${registration.deliverability.blockers.join('|')}`);

  const finalCustomerOutcomeReady = registration.deliverability.ok
    && render.mobileLandingReady
    && render.a4Ready
    && tableRecognitionAccuracy === 1
    && itineraryDayRowsPreserved
    && flightSeparated
    && hotelSeparated
    && mealSeparated
    && evidenceSpanRecoverable;

  return {
    engine: candidate.engine,
    caseId: candidate.caseId,
    sourceFile: candidate.sourceFile ?? null,
    ok: failures.length === 0 && finalCustomerOutcomeReady,
    failures,
    metrics: {
      productSplitPreserved: true,
      tableRecognitionAccuracy,
      priceRowsPreserved,
      priceDatesPreserved,
      itineraryDayRowsPreserved,
      flightSeparated,
      hotelSeparated,
      mealSeparated,
      evidenceSpanRecoverable,
      mobileLandingReady: render.mobileLandingReady,
      a4Ready: render.a4Ready,
      finalCustomerOutcomeReady,
    },
    counts: {
      priceRows: registration.pricing.productPrices.length,
      priceDates: registration.pricing.priceDates.length,
      itineraryDays: itineraryDays.length,
      evidenceSpans: registration.evidence.spans.length,
    },
  };
}

export function buildDefaultOcrBenchmarkInput(): OcrBenchmarkInput {
  return {
    candidates: SUPPLIER_RAW_GOLDEN_FIXTURES.map(fixture => ({
      engine: 'text-upload-baseline',
      caseId: fixture.id,
      extractedText: fixture.rawText,
      sourceFile: `${fixture.id}.txt`,
    })),
  };
}

export async function runProductOcrBenchmark(
  input: OcrBenchmarkInput = buildDefaultOcrBenchmarkInput(),
  fixtures: SupplierRawGoldenFixture[] = SUPPLIER_RAW_GOLDEN_FIXTURES,
): Promise<OcrBenchmarkReport> {
  const fixturesById = fixtureById(fixtures);
  const results: OcrBenchmarkCaseResult[] = [];

  for (const candidate of input.candidates) {
    const fixture = fixturesById.get(candidate.caseId);
    if (!fixture) {
      results.push({
        engine: candidate.engine,
        caseId: candidate.caseId,
        sourceFile: candidate.sourceFile ?? null,
        ok: false,
        failures: [`unknown_case:${candidate.caseId}`],
        metrics: {
          productSplitPreserved: false,
          tableRecognitionAccuracy: 0,
          priceRowsPreserved: false,
          priceDatesPreserved: false,
          itineraryDayRowsPreserved: false,
          flightSeparated: false,
          hotelSeparated: false,
          mealSeparated: false,
          evidenceSpanRecoverable: false,
          mobileLandingReady: false,
          a4Ready: false,
          finalCustomerOutcomeReady: false,
        },
        counts: {
          priceRows: 0,
          priceDates: 0,
          itineraryDays: 0,
          evidenceSpans: 0,
        },
      });
      continue;
    }
    results.push(await evaluateCandidate(candidate, fixture));
  }

  const tableRecognitionAccuracyAvg = results.length === 0
    ? 0
    : results.reduce((sum, result) => sum + result.metrics.tableRecognitionAccuracy, 0) / results.length;

  return {
    generatedAt: new Date().toISOString(),
    candidateEngines: [...OCR_BENCHMARK_CANDIDATE_ENGINES],
    total: results.length,
    passed: results.filter(result => result.ok).length,
    failed: results.filter(result => !result.ok).length,
    summary: {
      tableRecognitionAccuracyAvg,
      priceRowsPreserved: pctCount(results, 'priceRowsPreserved'),
      priceDatesPreserved: pctCount(results, 'priceDatesPreserved'),
      itineraryDayRowsPreserved: pctCount(results, 'itineraryDayRowsPreserved'),
      flightSeparated: pctCount(results, 'flightSeparated'),
      hotelSeparated: pctCount(results, 'hotelSeparated'),
      mealSeparated: pctCount(results, 'mealSeparated'),
      evidenceSpanRecoverable: pctCount(results, 'evidenceSpanRecoverable'),
      finalCustomerOutcomeReady: pctCount(results, 'finalCustomerOutcomeReady'),
    },
    results,
  };
}
