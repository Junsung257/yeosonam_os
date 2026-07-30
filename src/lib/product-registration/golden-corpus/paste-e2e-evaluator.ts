import { recoverCatalogSplitFromRawText } from '../catalog-split-recovery';
import { registerProductFromRaw } from '../register-product-from-raw';
import { GOLDEN_PASTE_E2E_CASES } from './paste-e2e-cases';
import type { ItineraryDataLike } from '@/lib/itinerary-attraction-enricher';

type CheckResult = {
  field: string;
  passed: boolean;
  expected: unknown;
  actual: unknown;
};

export type GoldenPasteCaseEvaluation = {
  id: string;
  kind: string;
  registrationSucceeded: boolean;
  customerOpenCandidate: boolean;
  publishable: boolean;
  splitCount: number;
  checks: CheckResult[];
  fieldPassCount: number;
  fieldCheckCount: number;
  fieldAccuracyRate: number;
  blockers: string[];
  error: string | null;
};

export type GoldenPasteEvaluationReport = {
  generated_at: string;
  corpus_version: 'golden-paste-e2e-v2-raw-only';
  total_cases: number;
  threshold: number;
  metrics: {
    registration_success_rate: number;
    field_accuracy_rate: number;
    customer_open_candidate_rate: number;
    incomplete_source_block_rate: number;
    multiproduct_split_rate: number;
    inbound_next_day_success_rate: number;
    option_price_misclassification_rate: number;
  };
  passed: boolean;
  cases: GoldenPasteCaseEvaluation[];
};

function samePrimitiveArray(left: unknown[], right: unknown[]): boolean {
  return JSON.stringify([...left].sort()) === JSON.stringify([...right].sort());
}

function samePriceCandidates(
  actual: Array<{ amount: number; currency: string }>,
  expected: Array<{ amount: number; currency: string }>,
): boolean {
  const toKey = (candidate: { amount: number; currency: string }) => `${candidate.currency}:${candidate.amount}`;
  return samePrimitiveArray(actual.map(toKey), expected.map(toKey));
}

function rate(numerator: number, denominator: number): number {
  return denominator > 0 ? numerator / denominator : 1;
}

export async function evaluateGoldenPasteE2E(
  threshold = 0.95,
): Promise<GoldenPasteEvaluationReport> {
  const cases: GoldenPasteCaseEvaluation[] = [];

  for (const testCase of GOLDEN_PASTE_E2E_CASES) {
    const recoveredProducts = recoverCatalogSplitFromRawText(testCase.rawText);
    const products = recoveredProducts.length >= 2
      ? recoveredProducts
      : [{
          extractedData: { rawText: testCase.rawText },
          itineraryData: null,
          sectionRawText: testCase.rawText,
        }];
    const firstProduct = products[0];
    const sectionRawText = firstProduct.sectionRawText ?? testCase.rawText;
    const checks: CheckResult[] = [];

    try {
      const result = await registerProductFromRaw({
        rawText: sectionRawText,
        originalRawText: testCase.rawText,
        parserRawText: testCase.rawText,
        documentRawText: testCase.rawText,
        analysisNormalizedText: testCase.rawText,
        extractedData: firstProduct.extractedData,
        itineraryData: (firstProduct.itineraryData ?? null) as ItineraryDataLike | null,
        title: firstProduct.extractedData.title,
        activeAttractions: [],
        sourceType: 'text',
        enableGeminiFallback: false,
        priceYear: 2026,
      });
      const actualDates = result.pricing.priceDates.map(row => row.date);
      const actualCandidates = (result.pricing.excludedPriceCandidates ?? []).map(candidate => ({
        amount: candidate.amount,
        currency: candidate.currency,
      }));
      const expectedSplitCount = testCase.kind === 'multiproduct_mixed_catalog' ? 2 : 1;

      checks.push(
        { field: 'title', passed: result.identity.title === testCase.expected.title, expected: testCase.expected.title, actual: result.identity.title },
        { field: 'destination', passed: result.identity.destination === testCase.expected.destination, expected: testCase.expected.destination, actual: result.identity.destination },
        { field: 'duration_days', passed: result.identity.durationDays === testCase.expected.dayCount, expected: testCase.expected.dayCount, actual: result.identity.durationDays },
        { field: 'adult_price', passed: result.pricing.minPrice === testCase.expected.adultPrice, expected: testCase.expected.adultPrice, actual: result.pricing.minPrice },
        { field: 'departure_dates', passed: samePrimitiveArray(actualDates, testCase.expected.departureDates), expected: testCase.expected.departureDates, actual: actualDates },
        {
          field: 'excluded_non_product_prices',
          passed: samePriceCandidates(actualCandidates, testCase.expected.optionalPriceCandidates),
          expected: testCase.expected.optionalPriceCandidates,
          actual: actualCandidates,
        },
        { field: 'product_split_count', passed: products.length === expectedSplitCount, expected: expectedSplitCount, actual: products.length },
        { field: 'incomplete_source_blocked', passed: !result.deliverability.ok && !result.publishable, expected: true, actual: !result.deliverability.ok && !result.publishable },
      );

      if (testCase.expected.inboundFlight) {
        const flightSegments = (
          result.itinerary.itineraryDataToSave as {
            flight_segments?: Array<{
              leg?: string;
              flight_no?: string;
              dep_time?: string;
              arr_time?: string;
              arr_day_offset?: number;
            }>;
          } | null
        )?.flight_segments ?? [];
        const inbound = flightSegments.find(segment => segment.leg === 'inbound');
        checks.push({
          field: 'inbound_next_day',
          passed: Boolean(
            inbound
            && inbound.flight_no === testCase.expected.inboundFlight.flightNo
            && inbound.dep_time === testCase.expected.inboundFlight.depTime
            && inbound.arr_time === testCase.expected.inboundFlight.arrTime
            && inbound.arr_day_offset === testCase.expected.inboundFlight.arrDayOffset
          ),
          expected: testCase.expected.inboundFlight,
          actual: inbound ?? null,
        });
      }

      const fieldPassCount = checks.filter(check => check.passed).length;
      cases.push({
        id: testCase.id,
        kind: testCase.kind,
        registrationSucceeded: true,
        customerOpenCandidate: result.deliverability.ok,
        publishable: result.publishable,
        splitCount: products.length,
        checks,
        fieldPassCount,
        fieldCheckCount: checks.length,
        fieldAccuracyRate: rate(fieldPassCount, checks.length),
        blockers: result.deliverability.blockers,
        error: null,
      });
    } catch (error) {
      cases.push({
        id: testCase.id,
        kind: testCase.kind,
        registrationSucceeded: false,
        customerOpenCandidate: false,
        publishable: false,
        splitCount: products.length,
        checks,
        fieldPassCount: 0,
        fieldCheckCount: 8,
        fieldAccuracyRate: 0,
        blockers: [],
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const totalChecks = cases.reduce((sum, testCase) => sum + testCase.fieldCheckCount, 0);
  const totalPassedChecks = cases.reduce((sum, testCase) => sum + testCase.fieldPassCount, 0);
  const multiProductCases = cases.filter(testCase => testCase.kind === 'multiproduct_mixed_catalog');
  const inboundCases = cases.filter(testCase => testCase.kind === 'inbound_next_day_arrival');
  const optionChecks = cases.flatMap(testCase => testCase.checks)
    .filter(check => check.field === 'excluded_non_product_prices');
  const optionFailures = optionChecks.filter(check => !check.passed).length;
  const metrics = {
    registration_success_rate: rate(cases.filter(testCase => testCase.registrationSucceeded).length, cases.length),
    field_accuracy_rate: rate(totalPassedChecks, totalChecks),
    customer_open_candidate_rate: rate(cases.filter(testCase => testCase.customerOpenCandidate).length, cases.length),
    incomplete_source_block_rate: rate(
      cases.filter(testCase => testCase.checks.some(check => check.field === 'incomplete_source_blocked' && check.passed)).length,
      cases.length,
    ),
    multiproduct_split_rate: rate(multiProductCases.filter(testCase => testCase.splitCount === 2).length, multiProductCases.length),
    inbound_next_day_success_rate: rate(
      inboundCases.filter(testCase => testCase.checks.some(check => check.field === 'inbound_next_day' && check.passed)).length,
      inboundCases.length,
    ),
    option_price_misclassification_rate: rate(optionFailures, optionChecks.length),
  };

  return {
    generated_at: new Date().toISOString(),
    corpus_version: 'golden-paste-e2e-v2-raw-only',
    total_cases: cases.length,
    threshold,
    metrics,
    passed: metrics.registration_success_rate === 1
      && metrics.field_accuracy_rate >= threshold
      && metrics.incomplete_source_block_rate === 1
      && metrics.option_price_misclassification_rate === 0,
    cases,
  };
}
