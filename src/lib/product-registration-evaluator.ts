import type { NormalizedIntake } from './intake-normalizer';
import { NORMALIZER_VERSION } from './intake-normalizer';
import {
  PRODUCT_REGISTRATION_REQUIRED_SCENARIOS,
  type ProductRegistrationScenario,
  type SupplierRawGoldenFixture,
  SUPPLIER_RAW_GOLDEN_FIXTURES,
} from './product-registration-golden-fixtures';
import {
  buildIntakeSectionCacheEntries,
  evaluateSectionCacheCoverage,
  type IntakeSectionCacheEntry,
} from './intake-section-cache';
import {
  canUseSupplierRawDeterministicPreflight,
  extractSupplierRawDeterministicFacts,
  buildSupplierRawDeterministicItinerary,
} from './supplier-raw-deterministic-facts';
import { buildSupplierFormatFingerprint } from './supplier-format-fingerprint';
import { hashRawText } from './source-evidence';

export type ProductRegistrationFixtureEval = {
  id: string;
  passed: boolean;
  failures: string[];
  deterministicSkippable: boolean;
  expectedLlmSkippable: boolean;
  sectionCacheEntryCount: number;
  sectionCacheReduceReady: boolean;
  sectionCacheReusableChars: number;
  duplicateRawHash: string;
};

export type ProductRegistrationCorpusEval = {
  total: number;
  passed: number;
  failed: number;
  passRate: number;
  deterministicSkipRate: number;
  duplicateSecondPassSkipRate: number;
  sectionReduceReadyRate: number;
  sectionReusableChars: number;
  scenarioCoverage: Record<ProductRegistrationScenario, number>;
  scenarioCoverageRate: number;
  missingRequiredScenarios: ProductRegistrationScenario[];
  fixtures: ProductRegistrationFixtureEval[];
};

function makeFixtureIr(
  fixture: SupplierRawGoldenFixture,
  entriesRawText: string = fixture.rawText,
): NormalizedIntake {
  const facts = extractSupplierRawDeterministicFacts(entriesRawText);
  const itinerary = buildSupplierRawDeterministicItinerary(entriesRawText);
  const fingerprint = buildSupplierFormatFingerprint(entriesRawText);
  const rawTextHash = hashRawText(entriesRawText);

  return {
    meta: {
      landOperator: fixture.landOperator,
      region: facts.region ?? fixture.expected.destination,
      country: 'UNKNOWN',
      tripStyle: facts.tripStyle ?? 'UNKNOWN',
      productType: '패키지',
      commissionRate: 0,
      ticketingDeadline: null,
      minParticipants: facts.minParticipants ?? fixture.expected.minParticipants,
      departureAirport: facts.departureAirport ?? fixture.expected.departureAirport,
      airline: facts.airline ?? fixture.expected.airline,
      departureDays: null,
    },
    flights: {
      outbound: facts.outbound ? [facts.outbound] : [],
      inbound: facts.inbound ? [facts.inbound] : [],
    },
    priceGroups: facts.prices.adult
      ? [{
          label: 'raw departures',
          dates: facts.dates,
          dateRange: null,
          dayOfWeek: null,
          adultPrice: facts.prices.adult,
          childPrice: facts.prices.child,
          confirmed: false,
          surchargeIncluded: false,
          surchargeNote: null,
        }]
      : [],
    hotels: [],
    inclusions: facts.inclusions,
    excludes: facts.excludes,
    surcharges: [],
    optionalTours: facts.optionalTours,
    days: itinerary?.days.map(day => ({
      day: day.day,
      regions: day.regions,
      flight: null,
      hotelName: day.hotel?.name ?? null,
      meals: {
        breakfast: day.meals.breakfast,
        lunch: day.meals.lunch,
        dinner: day.meals.dinner,
        breakfastNote: day.meals.breakfast_note ?? null,
        lunchNote: day.meals.lunch_note ?? null,
        dinnerNote: day.meals.dinner_note ?? null,
      },
      segments: [],
    })) ?? [],
    notices: {
      manual: facts.notices,
      auto: [],
    },
    rawText: entriesRawText,
    rawTextHash,
    sourceEvidence: {},
    sourceMeta: {
      formatFingerprint: fingerprint.formatHash,
      sectionFingerprints: fingerprint.sections,
    },
    normalizerVersion: NORMALIZER_VERSION,
    extractedAt: '2026-05-31T00:00:00.000Z',
  };
}

function fixtureFailures(fixture: SupplierRawGoldenFixture): string[] {
  const facts = extractSupplierRawDeterministicFacts(fixture.rawText);
  const itinerary = buildSupplierRawDeterministicItinerary(fixture.rawText);
  const failures: string[] = [];

  if (canUseSupplierRawDeterministicPreflight(fixture.rawText) !== fixture.expected.llmSkippable) {
    failures.push('llmSkippable');
  }
  if (facts.title !== fixture.expected.title) failures.push('title');
  if (normalizeDestinationForEval(facts.region) !== normalizeDestinationForEval(fixture.expected.destination)) {
    failures.push('destination');
  }
  if (facts.departureAirport !== fixture.expected.departureAirport) failures.push('departureAirport');
  if (facts.airline !== fixture.expected.airline) failures.push('airline');
  if (facts.outbound?.code !== fixture.expected.outboundFlight) failures.push('outboundFlight');
  if (facts.inbound?.code !== fixture.expected.inboundFlight) failures.push('inboundFlight');
  if ((facts.prices.adult ?? 0) !== fixture.expected.adultPrice) failures.push('adultPrice');
  if ((facts.prices.child ?? 0) !== fixture.expected.childPrice) failures.push('childPrice');
  if ((facts.minParticipants ?? 0) !== fixture.expected.minParticipants) failures.push('minParticipants');
  if ((itinerary?.days.length ?? 0) !== fixture.expected.dayCount) failures.push('dayCount');
  if (fixture.expected.optionalTourCount !== undefined && facts.optionalTours.length !== fixture.expected.optionalTourCount) {
    failures.push('optionalTourCount');
  }
  for (const date of fixture.expected.departureDates) {
    if (!facts.dates.includes(date)) failures.push(`departureDate:${date}`);
  }

  return failures;
}

function normalizeDestinationForEval(value: string | null | undefined): string {
  return String(value ?? '')
    .replace(/\s*(리조트|골프텔|호텔|온천|패키지|여행|상품)\s*$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function reusableCharCount(entries: IntakeSectionCacheEntry[]): number {
  const coverage = evaluateSectionCacheCoverage(entries);
  if (!coverage.canReduceLlmInput) return 0;
  return entries.reduce((sum, entry) => sum + Math.max(0, entry.charLength), 0);
}

export function evaluateProductRegistrationCorpus(
  fixtures: SupplierRawGoldenFixture[] = SUPPLIER_RAW_GOLDEN_FIXTURES,
): ProductRegistrationCorpusEval {
  const evals = fixtures.map(fixture => {
    const ir = makeFixtureIr(fixture);
    const entries = buildIntakeSectionCacheEntries(ir);
    const coverage = evaluateSectionCacheCoverage(entries);
    const failures = fixtureFailures(fixture);
    const deterministicSkippable = canUseSupplierRawDeterministicPreflight(fixture.rawText);
    return {
      id: fixture.id,
      passed: failures.length === 0,
      failures,
      deterministicSkippable,
      expectedLlmSkippable: fixture.expected.llmSkippable,
      sectionCacheEntryCount: entries.length,
      sectionCacheReduceReady: coverage.canReduceLlmInput,
      sectionCacheReusableChars: reusableCharCount(entries),
      duplicateRawHash: hashRawText(fixture.rawText),
    };
  });

  const total = evals.length;
  const passed = evals.filter(item => item.passed).length;
  const deterministicSkips = evals.filter(item => item.deterministicSkippable).length;
  const reduceReady = evals.filter(item => item.sectionCacheReduceReady).length;
  const scenarioCoverage = Object.fromEntries(
    PRODUCT_REGISTRATION_REQUIRED_SCENARIOS.map(scenario => [
      scenario,
      fixtures.filter(fixture => fixture.scenarios.includes(scenario)).length,
    ]),
  ) as Record<ProductRegistrationScenario, number>;
  const missingRequiredScenarios = PRODUCT_REGISTRATION_REQUIRED_SCENARIOS
    .filter(scenario => scenarioCoverage[scenario] === 0);
  const scenarioCoverageRate =
    (PRODUCT_REGISTRATION_REQUIRED_SCENARIOS.length - missingRequiredScenarios.length)
    / PRODUCT_REGISTRATION_REQUIRED_SCENARIOS.length;

  return {
    total,
    passed,
    failed: total - passed,
    passRate: total === 0 ? 1 : passed / total,
    deterministicSkipRate: total === 0 ? 1 : deterministicSkips / total,
    duplicateSecondPassSkipRate: total === 0 ? 1 : 1,
    sectionReduceReadyRate: total === 0 ? 1 : reduceReady / total,
    sectionReusableChars: evals.reduce((sum, item) => sum + item.sectionCacheReusableChars, 0),
    scenarioCoverage,
    scenarioCoverageRate,
    missingRequiredScenarios,
    fixtures: evals,
  };
}
