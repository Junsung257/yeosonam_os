import { readFileSync } from 'fs';
import { join } from 'path';
import { mapTravelPackageToLandingData } from '@/lib/map-travel-package-to-lp';
import type { ExtractedData } from '@/lib/parser';
import { SUPPLIER_RAW_GOLDEN_FIXTURES, type SupplierRawGoldenFixture } from '@/lib/product-registration-golden-fixtures';
import { renderPackage } from '@/lib/render-contract';
import { buildSupplierRawDeterministicItinerary } from '@/lib/supplier-raw-deterministic-facts';
import type { ItineraryDataLike } from '../itinerary-normalization';
import { inferAccommodationsFromRawText } from '../accommodations';
import { recoverCatalogSplitFromRawText } from '../catalog-split-recovery';
import { inferDepartureDaysFromRawText } from '../departure-days';
import { resolveUploadDestinationAndCodes } from '../destination-resolution';
import { registerProductFromRaw } from '../register-product-from-raw';
import { CLARK_MULTIPRODUCT_EXPECTED, CLARK_MULTIPRODUCT_RAW } from './clark-multiproduct-fixture';

export type ExpectedGoldenCase = {
  title: string;
  destination: string;
  destinationCode: string;
  minPrice: number;
  specificDate: string;
  specificDatePrice: number;
  priceRowsMinCount?: number;
  specificDatePriceRowsMinCount?: number;
  specificDateOptionPrices?: number[];
  priceDatesMinCount: number;
  forbiddenPrices: number[];
  itineraryDaysValid: boolean;
  customerDeliverableBlocked: boolean;
};

export type GoldenCorpusCase = {
  id: string;
  fixture: string;
  expected: string;
  accommodations: string[];
  duration: number;
};

export const GOLDEN_CORPUS_CASES: GoldenCorpusCase[] = [
  {
    id: 'cebu-hotel-column-matrix',
    fixture: 'cebu-hotel-column-matrix.txt',
    expected: 'cebu-hotel-column-matrix.json',
    accommodations: ['솔레아[준특급]'],
    duration: 5,
  },
  {
    id: 'phu-quoc-full-upload',
    fixture: 'phu-quoc-full-upload.txt',
    expected: 'phu-quoc-full-upload.json',
    accommodations: ['뉴월드푸꾸옥 - 가든풀빌라 2BED룸'],
    duration: 5,
  },
  {
    id: 'fukuoka-golf-spot-weekday-cash-receipt',
    fixture: 'fukuoka-golf-spot-weekday-cash-receipt.txt',
    expected: 'fukuoka-golf-spot-weekday-cash-receipt.json',
    accommodations: ['더 사세보 파라다이스 가든 호텔 또는 동급'],
    duration: 3,
  },
];

export type GoldenCorpusCaseResult = {
  id: string;
  source: 'file_fixture' | 'supplier_raw_fixture' | 'multiproduct_fixture';
  ok: boolean;
  failures: string[];
  priceRowsCount: number;
  priceDatesCount: number;
  destinationCode: string;
  minPrice: number | null;
  specificDatePrice: number | null;
};

export type GoldenCorpusReport = {
  total: number;
  passed: number;
  failed: number;
  priceRowsZeroCount: number;
  priceDatesZeroCount: number;
  destinationUnkCount: number;
  optionalTourPricePollutionCount: number;
  deliverabilityBlockedCount: number;
  priceStorageMismatchCount: number;
  renderBlockedCount: number;
  minPriceMismatchCount: number;
  specificDateMismatchCount: number;
  priceDatesBelowExpectedCount: number;
  cases: GoldenCorpusCaseResult[];
};

function corpusPath(...parts: string[]): string {
  return join(process.cwd(), 'src/lib/product-registration/golden-corpus', ...parts);
}

function buildSyntheticItinerary(dayCount: number): { days: Array<{ day: number; regions: string[]; schedule: Array<{ activity: string }>; meals: Record<string, string>; hotel: { name: string | null; grade: string | null } }> } {
  return {
    days: Array.from({ length: Math.max(1, dayCount) }, (_, index) => ({
      day: index + 1,
      regions: [],
      schedule: [{ activity: '일정 진행' }],
      meals: {},
      hotel: { name: index + 1 < dayCount ? '동급 호텔' : null, grade: null },
    })),
  };
}

function assertPriceStorageAligned(
  priceRows: Array<{ target_date: string | null; net_price: number }>,
  priceDates: Array<{ date: string; price: number }>,
): string | null {
  const datedRows = priceRows.filter(row => row.target_date);
  const pricesByDate = new Map<string, number[]>();
  const priceDateByDate = new Map(priceDates.map(row => [row.date, row.price]));
  for (const row of datedRows) {
    if (!row.target_date || !Number.isFinite(row.net_price) || row.net_price <= 0) continue;
    const prices = pricesByDate.get(row.target_date) ?? [];
    prices.push(row.net_price);
    pricesByDate.set(row.target_date, prices);
  }
  for (const targetDate of pricesByDate.keys()) {
    if (!priceDateByDate.has(targetDate)) return `priceDatesMissing:${targetDate}`;
  }
  for (const priceDate of priceDates) {
    const prices = pricesByDate.get(priceDate.date);
    if (!prices || Math.min(...prices) !== priceDate.price) {
      return `priceStorageDate:${priceDate.date}`;
    }
  }
  return null;
}

function assertRenderInputsReady(input: {
  id: string;
  title: string;
  destination: string;
  duration: number;
  price: number | null;
  priceDates: Array<{ date: string; price: number; confirmed: boolean }>;
  itineraryData?: unknown;
}): string | null {
  try {
    const pkg = {
      id: input.id,
      title: input.title,
      destination: input.destination,
      duration: input.duration,
      price: input.price ?? 0,
      price_dates: input.priceDates,
      itinerary_data: input.itineraryData ?? buildSyntheticItinerary(input.duration),
      inclusions: ['항공', '숙박'],
      excludes: ['개인경비'],
    };
    const view = renderPackage(pkg);
    const landing = mapTravelPackageToLandingData(pkg, null);
    if (!Array.isArray(view.days) || view.days.length === 0) return 'renderPackage:days:0';
    if (!landing.priceFrom || landing.priceFrom <= 0) return 'landing:priceFrom:0';
    if (!Array.isArray(landing.price_dates) || landing.price_dates.length === 0) return 'landing:price_dates:0';
    if (!Array.isArray(landing.itinerary.days) || landing.itinerary.days.length === 0) return 'landing:itinerary.days:0';
    return null;
  } catch (error) {
    return `render:${error instanceof Error ? error.message : String(error)}`;
  }
}

export function readGoldenText(name: string): string {
  return readFileSync(corpusPath('fixtures', name), 'utf8');
}

export function readGoldenExpected(name: string): ExpectedGoldenCase {
  return JSON.parse(readFileSync(corpusPath('expected', name), 'utf8')) as ExpectedGoldenCase;
}

export async function evaluateGoldenCorpus(
  cases: GoldenCorpusCase[] = GOLDEN_CORPUS_CASES,
  supplierRawFixtures: SupplierRawGoldenFixture[] = SUPPLIER_RAW_GOLDEN_FIXTURES,
): Promise<GoldenCorpusReport> {
  const results: GoldenCorpusCaseResult[] = [];

  for (const testCase of cases) {
    const rawText = readGoldenText(testCase.fixture);
    const expected = readGoldenExpected(testCase.expected);
    const failures: string[] = [];

    const destination = resolveUploadDestinationAndCodes({
      destination: null,
      departureAirport: '부산',
      durationDays: testCase.duration,
      productRawText: rawText,
      documentRawText: rawText,
    });
    if (destination.destination !== expected.destination) {
      failures.push(`destination:${destination.destination ?? 'null'}!=${expected.destination}`);
    }
    if (destination.destinationCode !== expected.destinationCode) {
      failures.push(`destinationCode:${destination.destinationCode}!=${expected.destinationCode}`);
    }

    const ed: ExtractedData = {
      title: expected.title,
      destination: destination.destination ?? expected.destination,
      duration: testCase.duration,
      accommodations: [...testCase.accommodations],
      rawText,
      price_tiers: [],
    };

    const registration = await registerProductFromRaw({
      rawText,
      documentRawText: rawText,
      extractedData: ed,
      title: expected.title,
      activeAttractions: [],
      destinationResolution: destination,
      destinationCode: destination.destinationCode,
      internalCode: `PUS-AA-${destination.destinationCode}-5D`,
      enableGeminiFallback: false,
      priceYear: 2026,
    });
    const recovered = registration.priceRecovery;

    if (!recovered.ok) failures.push(`priceRecovery:${recovered.failures.join('|')}`);
    if (recovered.priceRows.length === 0) failures.push('priceRows:0');
    if (expected.priceRowsMinCount != null && recovered.priceRows.length < expected.priceRowsMinCount) {
      failures.push(`priceRows:${recovered.priceRows.length}<${expected.priceRowsMinCount}`);
    }
    if (recovered.priceDates.length === 0) failures.push('priceDates:0');
    if (recovered.priceDates.length < expected.priceDatesMinCount) {
      failures.push(`priceDates:${recovered.priceDates.length}<${expected.priceDatesMinCount}`);
    }
    if (recovered.minPrice !== expected.minPrice) {
      failures.push(`minPrice:${recovered.minPrice ?? 'null'}!=${expected.minPrice}`);
    }

    const specificDatePrice = recovered.priceDates.find(row => row.date === expected.specificDate)?.price ?? null;
    if (specificDatePrice !== expected.specificDatePrice) {
      failures.push(`specificDatePrice:${specificDatePrice ?? 'null'}!=${expected.specificDatePrice}`);
    }
    const specificDateRows = recovered.priceRows.filter(row => row.target_date === expected.specificDate);
    if (
      expected.specificDatePriceRowsMinCount != null
      && specificDateRows.length < expected.specificDatePriceRowsMinCount
    ) {
      failures.push(`specificDatePriceRows:${specificDateRows.length}<${expected.specificDatePriceRowsMinCount}`);
    }
    for (const optionPrice of expected.specificDateOptionPrices ?? []) {
      if (!specificDateRows.some(row => row.net_price === optionPrice)) {
        failures.push(`missingSpecificDateOptionPrice:${optionPrice}`);
      }
    }

    for (const forbiddenPrice of expected.forbiddenPrices) {
      if (recovered.priceRows.some(row => row.net_price === forbiddenPrice)) {
        failures.push(`forbiddenProductPriceRow:${forbiddenPrice}`);
      }
      if (recovered.priceDates.some(row => row.price === forbiddenPrice)) {
        failures.push(`forbiddenPriceDate:${forbiddenPrice}`);
      }
    }
    const priceStorageMismatch = assertPriceStorageAligned(recovered.priceRows, recovered.priceDates);
    if (priceStorageMismatch) failures.push(priceStorageMismatch);
    const renderFailure = assertRenderInputsReady({
      id: testCase.id,
      title: expected.title,
      destination: destination.destination ?? expected.destination,
      duration: testCase.duration,
      price: recovered.minPrice,
      priceDates: recovered.priceDates,
      itineraryData: registration.itinerary.itineraryDataToSave,
    });
    if (renderFailure) failures.push(renderFailure);

    const deliverability = registration.deliverability;
    if (!deliverability.ok !== expected.customerDeliverableBlocked) {
      failures.push(`deliverability:${deliverability.blockers.join('|') || 'ok'}`);
    }

    results.push({
      id: testCase.id,
      source: 'file_fixture',
      ok: failures.length === 0,
      failures,
      priceRowsCount: recovered.priceRows.length,
      priceDatesCount: recovered.priceDates.length,
      destinationCode: destination.destinationCode,
      minPrice: recovered.minPrice,
      specificDatePrice,
    });
  }

  const clarkProducts = recoverCatalogSplitFromRawText(CLARK_MULTIPRODUCT_RAW);
  const expectedClarkByTitle = new Map(CLARK_MULTIPRODUCT_EXPECTED.map(expected => [expected.title, expected]));
  if (clarkProducts.length !== CLARK_MULTIPRODUCT_EXPECTED.length) {
    results.push({
      id: 'clark-multiproduct-split',
      source: 'multiproduct_fixture',
      ok: false,
      failures: [`split:${clarkProducts.length}!=${CLARK_MULTIPRODUCT_EXPECTED.length}`],
      priceRowsCount: 0,
      priceDatesCount: 0,
      destinationCode: 'UNK',
      minPrice: null,
      specificDatePrice: null,
    });
  }

  for (const product of clarkProducts) {
    const title = product.extractedData.title ?? '';
    const sectionRawText = product.sectionRawText ?? CLARK_MULTIPRODUCT_RAW;
    const expected = expectedClarkByTitle.get(title);
    const failures: string[] = [];

    if (!expected) {
      failures.push(`unexpectedTitle:${title || 'empty'}`);
    }

    const destination = resolveUploadDestinationAndCodes({
      destination: product.extractedData.destination,
      departureAirport: '부산',
      durationDays: product.extractedData.duration,
      productRawText: sectionRawText,
      documentRawText: CLARK_MULTIPRODUCT_RAW,
    });
    if (destination.destinationCode !== 'CRK') {
      failures.push(`destinationCode:${destination.destinationCode}!=CRK`);
    }

    const departureDays = inferDepartureDaysFromRawText(sectionRawText);
    if (expected && departureDays !== expected.departureDays) {
      failures.push(`departureDays:${departureDays ?? 'null'}!=${expected.departureDays}`);
    }

    const accommodations = inferAccommodationsFromRawText(sectionRawText);
    if (expected && !accommodations.includes(expected.hotel)) {
      failures.push(`hotel:${accommodations.join(',') || 'none'}!=${expected.hotel}`);
    }

    const registration = await registerProductFromRaw({
      rawText: sectionRawText,
      documentRawText: CLARK_MULTIPRODUCT_RAW,
      extractedData: {
      ...product.extractedData,
      departure_days: departureDays ?? undefined,
      accommodations,
      },
      title,
      activeAttractions: [],
      destinationResolution: destination,
      destinationCode: destination.destinationCode,
      internalCode: `${destination.departureCode}-ETC-${destination.destinationCode}-${product.extractedData.duration ?? expected?.duration ?? 0}D`,
      enableGeminiFallback: false,
      priceYear: 2026,
    });
    const recovered = registration.priceRecovery;

    if (!recovered.ok) failures.push(`priceRecovery:${recovered.failures.join('|')}`);
    if (recovered.priceRows.length === 0) failures.push('priceRows:0');
    if (recovered.priceDates.length === 0) failures.push('priceDates:0');
    if (expected && recovered.priceDates.length !== expected.count) {
      failures.push(`priceDates:${recovered.priceDates.length}!=${expected.count}`);
    }
    if (expected && recovered.minPrice !== expected.minPrice) {
      failures.push(`minPrice:${recovered.minPrice ?? 'null'}!=${expected.minPrice}`);
    }

    const specificDatePrice = expected
      ? recovered.priceDates.find(row => row.date === expected.sampleDate)?.price ?? null
      : null;
    if (expected && specificDatePrice !== expected.samplePrice) {
      failures.push(`specificDatePrice:${specificDatePrice ?? 'null'}!=${expected.samplePrice}`);
    }
    if (expected && recovered.priceDates.some(row => row.date === expected.forbiddenDate)) {
      failures.push(`forbiddenDepartureDate:${expected.forbiddenDate}`);
    }
    for (const forbiddenPrice of expected?.forbiddenPrices ?? []) {
      if (recovered.priceRows.some(row => row.net_price === forbiddenPrice)) {
        failures.push(`forbiddenProductPriceRow:${forbiddenPrice}`);
      }
      if (recovered.priceDates.some(row => row.price === forbiddenPrice)) {
        failures.push(`forbiddenPriceDate:${forbiddenPrice}`);
      }
    }
    const priceStorageMismatch = assertPriceStorageAligned(recovered.priceRows, recovered.priceDates);
    if (priceStorageMismatch) failures.push(priceStorageMismatch);
    const renderFailure = assertRenderInputsReady({
      id: `clark-multiproduct:${title || 'unknown'}`,
      title,
      destination: destination.destination ?? '클락',
      duration: product.extractedData.duration ?? expected?.duration ?? 1,
      price: recovered.minPrice,
      priceDates: recovered.priceDates,
      itineraryData: registration.itinerary.itineraryDataToSave,
    });
    if (renderFailure) failures.push(renderFailure);

    const deliverability = registration.deliverability;
    if (!deliverability.ok) {
      failures.push(`deliverability:${deliverability.blockers.join('|')}`);
    }

    results.push({
      id: `clark-multiproduct:${title || 'unknown'}`,
      source: 'multiproduct_fixture',
      ok: failures.length === 0,
      failures,
      priceRowsCount: recovered.priceRows.length,
      priceDatesCount: recovered.priceDates.length,
      destinationCode: destination.destinationCode,
      minPrice: recovered.minPrice,
      specificDatePrice,
    });
  }

  for (const fixture of supplierRawFixtures) {
    const rawText = fixture.rawText;
    const expected = fixture.expected;
    const failures: string[] = [];
    const itinerary = buildSupplierRawDeterministicItinerary(rawText);
    const destination = resolveUploadDestinationAndCodes({
      destination: expected.destination,
      departureAirport: expected.departureAirport,
      durationDays: expected.dayCount,
      productRawText: rawText,
      documentRawText: rawText,
    });

    if (destination.destinationCode === 'UNK') {
      failures.push(`destinationCode:UNK:${expected.destination}`);
    }

    const ed: ExtractedData = {
      title: expected.title,
      destination: destination.destination ?? expected.destination,
      duration: expected.dayCount,
      rawText,
      price_tiers: [],
    };

    const registration = await registerProductFromRaw({
      rawText,
      documentRawText: rawText,
      extractedData: ed,
      title: expected.title,
      activeAttractions: [],
      destinationResolution: destination,
      destinationCode: destination.destinationCode,
      internalCode: `${destination.departureCode}-AA-${destination.destinationCode}-${expected.dayCount}D`,
      itineraryData: itinerary as ItineraryDataLike | null,
      enableGeminiFallback: false,
      priceYear: 2027,
    });
    const recovered = registration.priceRecovery;

    if (!recovered.ok) failures.push(`priceRecovery:${recovered.failures.join('|')}`);
    if (recovered.priceRows.length === 0) failures.push('priceRows:0');
    if (recovered.priceDates.length === 0) failures.push('priceDates:0');
    if (recovered.priceDates.length < expected.departureDates.length) {
      failures.push(`priceDates:${recovered.priceDates.length}<${expected.departureDates.length}`);
    }
    if (recovered.minPrice !== expected.adultPrice) {
      failures.push(`minPrice:${recovered.minPrice ?? 'null'}!=${expected.adultPrice}`);
    }

    const dateSet = new Set(recovered.priceDates.map(row => row.date));
    for (const date of expected.departureDates) {
      if (!dateSet.has(date)) failures.push(`missingDepartureDate:${date}`);
    }

    const specificDate = expected.departureDates[0] ?? '';
    const specificDatePrice = recovered.priceDates.find(row => row.date === specificDate)?.price ?? null;
    if (specificDate && specificDatePrice !== expected.adultPrice) {
      failures.push(`specificDatePrice:${specificDatePrice ?? 'null'}!=${expected.adultPrice}`);
    }

    if (expected.optionalTourCount && recovered.priceRows.some(row => typeof row.net_price === 'number' && row.net_price > 0 && row.net_price < 100000)) {
      failures.push('forbiddenProductPriceRow:optional-tour-local-pay');
    }
    const priceStorageMismatch = assertPriceStorageAligned(recovered.priceRows, recovered.priceDates);
    if (priceStorageMismatch) failures.push(priceStorageMismatch);

    if (!itinerary || itinerary.days.length !== expected.dayCount) {
      failures.push(`itineraryDays:${itinerary?.days.length ?? 0}!=${expected.dayCount}`);
    }
    const renderFailure = assertRenderInputsReady({
      id: fixture.id,
      title: expected.title,
      destination: destination.destination ?? expected.destination,
      duration: expected.dayCount,
      price: recovered.minPrice,
      priceDates: recovered.priceDates,
      itineraryData: itinerary as unknown as ItineraryDataLike | null,
    });
    if (renderFailure) failures.push(renderFailure);

    const deliverability = registration.deliverability;
    if (!deliverability.ok) {
      failures.push(`deliverability:${deliverability.blockers.join('|')}`);
    }

    results.push({
      id: fixture.id,
      source: 'supplier_raw_fixture',
      ok: failures.length === 0,
      failures,
      priceRowsCount: recovered.priceRows.length,
      priceDatesCount: recovered.priceDates.length,
      destinationCode: destination.destinationCode,
      minPrice: recovered.minPrice,
      specificDatePrice,
    });
  }

  return {
    total: results.length,
    passed: results.filter(result => result.ok).length,
    failed: results.filter(result => !result.ok).length,
    priceRowsZeroCount: results.filter(result => result.priceRowsCount === 0).length,
    priceDatesZeroCount: results.filter(result => result.priceDatesCount === 0).length,
    destinationUnkCount: results.filter(result => result.destinationCode === 'UNK').length,
    optionalTourPricePollutionCount: results.filter(result =>
      result.failures.some(failure => failure.startsWith('forbiddenProductPriceRow') || failure.startsWith('forbiddenPriceDate')),
    ).length,
    deliverabilityBlockedCount: results.filter(result => result.failures.some(failure => failure.startsWith('deliverability:'))).length,
    priceStorageMismatchCount: results.filter(result => result.failures.some(failure => failure.startsWith('priceStorage'))).length,
    renderBlockedCount: results.filter(result => result.failures.some(failure => failure.startsWith('render') || failure.startsWith('landing:'))).length,
    minPriceMismatchCount: results.filter(result => result.failures.some(failure => failure.startsWith('minPrice:'))).length,
    specificDateMismatchCount: results.filter(result => result.failures.some(failure => failure.startsWith('specificDatePrice:'))).length,
    priceDatesBelowExpectedCount: results.filter(result => result.failures.some(failure => failure.startsWith('priceDates:'))).length,
    cases: results,
  };
}
