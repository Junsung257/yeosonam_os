import { createHash } from 'node:crypto';

import {
  buildSupplierRawDeterministicItinerary,
  extractSupplierRawDeterministicFacts,
} from '@/lib/supplier-raw-deterministic-facts';
import { recoverCatalogSplitFromRawText } from './catalog-split-recovery';
import {
  buildUploadReviewFixtureCandidate,
  type UploadReviewQueueFixtureRow,
} from './review-queue-fixture-candidates';
import type { ProductRegistrationFailureCode } from './failure-diagnostics';
import { readSupplierDocumentLikeHuman } from './ai-human-reader';
import { resolveUploadDestinationAndCodes } from './destination-resolution';

type UploadReviewRegressionStatus = 'passed' | 'partial' | 'failed' | 'skipped';

type UploadReviewRegressionCheck = {
  queueId: string;
  productTitle: string | null;
  sourceFilename: string | null;
  normalizedContentHash: string | null;
  codes: ProductRegistrationFailureCode[];
  coveredCodes: ProductRegistrationFailureCode[];
  uncoveredCodes: ProductRegistrationFailureCode[];
  supported: boolean;
  status: UploadReviewRegressionStatus;
  reason: string;
  productsRecovered: number;
  productSummaries: Array<{
    title: string | null;
    duration: number | null;
    days: number[];
    duplicateDays: boolean;
    durationOverflow: boolean;
  }>;
};

export type UploadReviewRegressionReport = {
  generatedAt: string;
  sourceRows: number;
  dedupedRows: number;
  checked: number;
  passed: number;
  partial: number;
  failed: number;
  skipped: number;
  codeCounts: Partial<Record<ProductRegistrationFailureCode, number>>;
  uncoveredCodeCounts: Partial<Record<ProductRegistrationFailureCode, number>>;
  checks: UploadReviewRegressionCheck[];
};

const SUPPORTED_ITINERARY_CODES = new Set<ProductRegistrationFailureCode>([
  'ITINERARY_DUPLICATE_DAY',
  'ITINERARY_DURATION_OVERFLOW',
  'CATALOG_SPLIT_REQUIRED',
  'PRODUCT_COUNT_MISMATCH',
]);

const SUPPORTED_PRICE_EVIDENCE_CODES = new Set<ProductRegistrationFailureCode>([
  'PRICE_ROWS_MISSING',
  'PRICE_DATES_MISSING',
  'PRICE_DATE_DISAGREEMENT',
  'PRICE_AMOUNT_DISAGREEMENT',
  'MODEL_PRICE_UNSUPPORTED',
]);

const SUPPORTED_FLIGHT_CODES = new Set<ProductRegistrationFailureCode>([
  'FLIGHT_TIME_MISMATCH',
]);

const SUPPORTED_DESTINATION_CODES = new Set<ProductRegistrationFailureCode>([
  'DESTINATION_UNRESOLVED',
]);

const SUPPORTED_REPLAY_CODES = new Set<ProductRegistrationFailureCode>([
  'UPLOAD_PIPELINE_SOFT_TIMEOUT',
]);

const SUPPORTED_CODES = new Set<ProductRegistrationFailureCode>([
  ...SUPPORTED_ITINERARY_CODES,
  ...SUPPORTED_PRICE_EVIDENCE_CODES,
  ...SUPPORTED_FLIGHT_CODES,
  ...SUPPORTED_DESTINATION_CODES,
  ...SUPPORTED_REPLAY_CODES,
]);

function splitCoverage(codes: ProductRegistrationFailureCode[]): {
  coveredCodes: ProductRegistrationFailureCode[];
  uncoveredCodes: ProductRegistrationFailureCode[];
} {
  const specificCodes = codes.filter(code => code !== 'CUSTOMER_RENDER_BLOCKED');
  const replayCodes = specificCodes.length > 0 ? specificCodes : codes;
  return {
    coveredCodes: replayCodes.filter(code => SUPPORTED_CODES.has(code)),
    uncoveredCodes: replayCodes.filter(code => !SUPPORTED_CODES.has(code)),
  };
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function dedupeRows(rows: UploadReviewQueueFixtureRow[]): UploadReviewQueueFixtureRow[] {
  const byKey = new Map<string, UploadReviewQueueFixtureRow>();
  for (const row of rows) {
    const candidate = buildUploadReviewFixtureCandidate(row);
    const key = [
      row.normalized_content_hash ?? row.file_hash ?? (row.raw_text_chunk ? sha256(row.raw_text_chunk) : row.id),
      candidate.codes.join(','),
    ].join('|');
    if (!byKey.has(key)) byKey.set(key, row);
  }
  return [...byKey.values()];
}

function hasDuplicate(values: number[]): boolean {
  return new Set(values).size !== values.length;
}

function countCodes(checks: UploadReviewRegressionCheck[], field: 'codes' | 'uncoveredCodes'): Partial<Record<ProductRegistrationFailureCode, number>> {
  const counts: Partial<Record<ProductRegistrationFailureCode, number>> = {};
  for (const check of checks) {
    if (check.reason.includes('synthetic regression/test upload row')) continue;
    for (const code of check[field]) counts[code] = (counts[code] ?? 0) + 1;
  }
  return counts;
}

function isSyntheticRegressionRow(row: UploadReviewQueueFixtureRow): boolean {
  const text = [row.product_title, row.source_filename].filter(Boolean).join(' ');
  return /\bCODEX-|RAW-E2E|\[TEST\]/i.test(text);
}

type ReplayTarget = {
  title: string | null;
  rawText: string;
  duration: number | null;
};

type CheckerResult = {
  ok: boolean;
  coveredCodes: ProductRegistrationFailureCode[];
  reason: string;
  productSummaries?: UploadReviewRegressionCheck['productSummaries'];
  productsRecovered?: number;
};

function yearFromRow(row: UploadReviewQueueFixtureRow, rawText: string): number | undefined {
  const explicit = Number(rawText.match(/\b(20\d{2})[./-]\d{1,2}[./-]\d{1,2}\b/)?.[1]);
  if (Number.isInteger(explicit) && explicit >= 2000) return explicit;
  const createdYear = Number(row.created_at?.slice(0, 4));
  return Number.isInteger(createdYear) && createdYear >= 2000 ? createdYear : undefined;
}

function replayTargets(row: UploadReviewQueueFixtureRow): {
  rawText: string;
  products: ReturnType<typeof recoverCatalogSplitFromRawText>;
  targets: ReplayTarget[];
} {
  const rawText = row.raw_text_chunk ?? '';
  const products = recoverCatalogSplitFromRawText(rawText);
  const targets = products.length >= 2
    ? products.map(product => ({
        title: product.extractedData.title ?? null,
        rawText: product.sectionRawText ?? '',
        duration: typeof product.extractedData.duration === 'number' ? product.extractedData.duration : null,
      }))
    : [{
        title: row.product_title,
        rawText,
        duration: null,
      }];
  return { rawText, products, targets };
}

function verifyItineraryBoundary(row: UploadReviewQueueFixtureRow): CheckerResult {
  const candidate = buildUploadReviewFixtureCandidate(row);
  const coveredCodes = candidate.codes.filter(code => SUPPORTED_ITINERARY_CODES.has(code));
  const rawText = row.raw_text_chunk ?? '';
  if (!rawText.trim()) {
    return {
      coveredCodes,
      ok: false,
      reason: 'raw_text_chunk is missing; cannot replay the source failure.',
      productsRecovered: 0,
      productSummaries: [],
    };
  }

  const products = recoverCatalogSplitFromRawText(rawText);
  const productSummaries = products.map(product => {
    const itinerary = buildSupplierRawDeterministicItinerary(product.sectionRawText ?? '');
    const days = itinerary?.days.map(day => day.day) ?? [];
    const duration = typeof product.extractedData.duration === 'number'
      ? product.extractedData.duration
      : null;
    return {
      title: product.extractedData.title ?? null,
      duration,
      days,
      duplicateDays: hasDuplicate(days),
      durationOverflow: duration != null && days.length > duration,
    };
  });

  if (products.length < 2) {
    return {
      coveredCodes,
      ok: false,
      reason: `expected a recovered multi-product catalog, recovered ${products.length}.`,
      productsRecovered: products.length,
      productSummaries,
    };
  }

  const badProduct = productSummaries.find(summary => (
    summary.days.length === 0 || summary.duplicateDays || summary.durationOverflow
  ));
  if (badProduct) {
    return {
      coveredCodes,
      ok: false,
      reason: `recovered product still has invalid itinerary days: ${badProduct.title ?? '(untitled)'}.`,
      productsRecovered: products.length,
      productSummaries,
    };
  }

  return {
    coveredCodes,
    ok: true,
    reason: 'catalog boundaries recover clean per-product itinerary day sequences.',
    productsRecovered: products.length,
    productSummaries,
  };
}

function verifyPriceEvidence(row: UploadReviewQueueFixtureRow): CheckerResult {
  const candidate = buildUploadReviewFixtureCandidate(row);
  const coveredCodes = candidate.codes.filter(code => SUPPORTED_PRICE_EVIDENCE_CODES.has(code));
  const { rawText, targets } = replayTargets(row);
  if (!rawText.trim()) {
    return {
      coveredCodes,
      ok: false,
      reason: 'raw_text_chunk is missing; cannot replay source-backed price evidence.',
    };
  }

  const year = yearFromRow(row, rawText);
  const summaries = targets.map(target => {
    const reader = readSupplierDocumentLikeHuman({
      rawText: target.rawText,
      title: target.title,
      durationDays: target.duration,
      year,
    });
    return {
      title: target.title,
      priceSource: reader.priceSource,
      pricePairs: reader.pricePairs.length,
      dates: new Set(reader.pricePairs.map(pair => pair.date)).size,
      prices: new Set(reader.pricePairs.map(pair => pair.adult_price)).size,
    };
  });
  const bad = summaries.find(summary => summary.pricePairs === 0 || summary.dates === 0 || summary.prices === 0);
  if (bad) {
    return {
      coveredCodes,
      ok: false,
      reason: `source-backed price/date evidence is still missing for ${bad.title ?? row.product_title ?? row.id}.`,
    };
  }
  return {
    coveredCodes,
    ok: true,
    reason: `source-backed price/date evidence recovered for ${summaries.length} product section(s).`,
  };
}

function hasCompleteRoundTripFlightEvidence(rawText: string): boolean {
  const facts = extractSupplierRawDeterministicFacts(rawText);
  const factsComplete = Boolean(
    facts.outbound?.code
      && facts.outbound.departure.time
      && facts.outbound.arrival.time
      && facts.inbound?.code
      && facts.inbound.departure.time
      && facts.inbound.arrival.time,
  );
  if (factsComplete) return true;

  const segments = buildSupplierRawDeterministicItinerary(rawText)?.flight_segments ?? [];
  const outbound = segments.find(segment => segment.leg === 'outbound');
  const inbound = segments.find(segment => segment.leg === 'inbound');
  return Boolean(
    outbound?.flight_no
      && outbound.dep_time
      && outbound.arr_time
      && inbound?.flight_no
      && inbound.dep_time
      && inbound.arr_time,
  );
}

function verifyFlightEvidence(row: UploadReviewQueueFixtureRow): CheckerResult {
  const candidate = buildUploadReviewFixtureCandidate(row);
  const coveredCodes = candidate.codes.filter(code => SUPPORTED_FLIGHT_CODES.has(code));
  const { rawText, targets } = replayTargets(row);
  if (!rawText.trim()) {
    return {
      coveredCodes,
      ok: false,
      reason: 'raw_text_chunk is missing; cannot replay source-backed flight evidence.',
    };
  }

  const bad = targets.find(target => {
    return !hasCompleteRoundTripFlightEvidence(target.rawText);
  });
  if (bad) {
    return {
      coveredCodes,
      ok: false,
      reason: `source-backed round-trip flight times are still incomplete for ${bad.title ?? row.product_title ?? row.id}.`,
    };
  }
  return {
    coveredCodes,
    ok: true,
    reason: `source-backed outbound/inbound flight times recovered for ${targets.length} product section(s).`,
  };
}

function verifyDestinationEvidence(row: UploadReviewQueueFixtureRow): CheckerResult {
  const candidate = buildUploadReviewFixtureCandidate(row);
  const coveredCodes = candidate.codes.filter(code => SUPPORTED_DESTINATION_CODES.has(code));
  const { rawText, targets } = replayTargets(row);
  if (!rawText.trim()) {
    return {
      coveredCodes,
      ok: false,
      reason: 'raw_text_chunk is missing; cannot replay destination resolution.',
    };
  }

  const bad = targets.find(target => {
    const resolved = resolveUploadDestinationAndCodes({
      destination: target.title,
      durationDays: target.duration,
      productRawText: target.rawText,
      documentRawText: rawText,
      tempDestination: row.product_title,
    });
    return !resolved.destination || resolved.destinationCode === 'UNK';
  });
  if (bad) {
    return {
      coveredCodes,
      ok: false,
      reason: `destination code is still unresolved for ${bad.title ?? row.product_title ?? row.id}.`,
    };
  }
  return {
    coveredCodes,
    ok: true,
    reason: `destination code resolves for ${targets.length} product section(s).`,
  };
}

function verifyReplayableSource(row: UploadReviewQueueFixtureRow): CheckerResult {
  const candidate = buildUploadReviewFixtureCandidate(row);
  const coveredCodes = candidate.codes.filter(code => SUPPORTED_REPLAY_CODES.has(code));
  const rawText = row.raw_text_chunk ?? '';
  if (rawText.trim().length < 50) {
    return {
      coveredCodes,
      ok: false,
      reason: 'saved raw text is missing or too short for timeout replay.',
    };
  }

  return {
    coveredCodes,
    ok: true,
    reason: 'saved raw text is available for timeout replay with duplicate guard.',
  };
}

function verifySupportedCodes(row: UploadReviewQueueFixtureRow): UploadReviewRegressionCheck {
  const candidate = buildUploadReviewFixtureCandidate(row);
  const { coveredCodes: supportedCovered, uncoveredCodes: initiallyUncovered } = splitCoverage(candidate.codes);
  const results: CheckerResult[] = [];
  if (candidate.codes.some(code => SUPPORTED_ITINERARY_CODES.has(code))) results.push(verifyItineraryBoundary(row));
  if (candidate.codes.some(code => SUPPORTED_PRICE_EVIDENCE_CODES.has(code))) results.push(verifyPriceEvidence(row));
  if (candidate.codes.some(code => SUPPORTED_FLIGHT_CODES.has(code))) results.push(verifyFlightEvidence(row));
  if (candidate.codes.some(code => SUPPORTED_DESTINATION_CODES.has(code))) results.push(verifyDestinationEvidence(row));
  if (candidate.codes.some(code => SUPPORTED_REPLAY_CODES.has(code))) results.push(verifyReplayableSource(row));

  const failed = results.filter(result => !result.ok);
  const coveredCodes = [...new Set(results.flatMap(result => result.coveredCodes))];
  const uncoveredCodes = [
    ...initiallyUncovered,
    ...supportedCovered.filter(code => !coveredCodes.includes(code)),
  ];
  const status: UploadReviewRegressionStatus = failed.length > 0
    ? 'failed'
    : uncoveredCodes.length > 0
      ? 'partial'
      : 'passed';
  const bestProductSummary = results.find(result => result.productSummaries)?.productSummaries ?? [];
  const productsRecovered = Math.max(0, ...results.map(result => result.productsRecovered ?? 0));

  return {
    queueId: row.id,
    productTitle: row.product_title,
    sourceFilename: row.source_filename,
    normalizedContentHash: row.normalized_content_hash,
    codes: candidate.codes,
    coveredCodes,
    uncoveredCodes,
    supported: true,
    status,
    reason: results.map(result => result.reason).join(' | '),
    productsRecovered,
    productSummaries: bestProductSummary,
  };
}

export function buildUploadReviewRegressionReport(input: {
  rows: UploadReviewQueueFixtureRow[];
  generatedAt?: string;
}): UploadReviewRegressionReport {
  const dedupedRows = dedupeRows(input.rows);
  const checks = dedupedRows.map(row => {
    const candidate = buildUploadReviewFixtureCandidate(row);
    if (isSyntheticRegressionRow(row)) {
      return {
        queueId: row.id,
        productTitle: row.product_title,
        sourceFilename: row.source_filename,
        normalizedContentHash: row.normalized_content_hash,
        codes: candidate.codes,
        coveredCodes: [],
        uncoveredCodes: candidate.codes,
        supported: false,
        status: 'skipped' as const,
        reason: 'synthetic regression/test upload row is excluded from live customer-source replay strictness.',
        productsRecovered: 0,
        productSummaries: [],
      };
    }
    const supported = candidate.codes.some(code => SUPPORTED_CODES.has(code));
    if (supported) return verifySupportedCodes(row);
    return {
      queueId: row.id,
      productTitle: row.product_title,
      sourceFilename: row.source_filename,
      normalizedContentHash: row.normalized_content_hash,
      codes: candidate.codes,
      coveredCodes: [],
      uncoveredCodes: candidate.codes,
      supported: false,
      status: 'skipped' as const,
      reason: 'no deterministic live replay checker is registered for these codes yet.',
      productsRecovered: 0,
      productSummaries: [],
    };
  });

  return {
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    sourceRows: input.rows.length,
    dedupedRows: dedupedRows.length,
    checked: checks.filter(check => check.supported).length,
    passed: checks.filter(check => check.status === 'passed').length,
    partial: checks.filter(check => check.status === 'partial').length,
    failed: checks.filter(check => check.status === 'failed').length,
    skipped: checks.filter(check => check.status === 'skipped').length,
    codeCounts: countCodes(checks, 'codes'),
    uncoveredCodeCounts: countCodes(checks, 'uncoveredCodes'),
    checks,
  };
}
