import { createHash } from 'node:crypto';

import { buildSupplierRawDeterministicItinerary } from '@/lib/supplier-raw-deterministic-facts';
import { recoverCatalogSplitFromRawText } from './catalog-split-recovery';
import {
  buildUploadReviewFixtureCandidate,
  type UploadReviewQueueFixtureRow,
} from './review-queue-fixture-candidates';
import type { ProductRegistrationFailureCode } from './failure-diagnostics';

export type UploadReviewRegressionStatus = 'passed' | 'failed' | 'skipped';

export type UploadReviewRegressionCheck = {
  queueId: string;
  productTitle: string | null;
  sourceFilename: string | null;
  normalizedContentHash: string | null;
  codes: ProductRegistrationFailureCode[];
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
  failed: number;
  skipped: number;
  checks: UploadReviewRegressionCheck[];
};

const SUPPORTED_ITINERARY_CODES = new Set<ProductRegistrationFailureCode>([
  'ITINERARY_DUPLICATE_DAY',
  'ITINERARY_DURATION_OVERFLOW',
  'CATALOG_SPLIT_REQUIRED',
  'PRODUCT_COUNT_MISMATCH',
]);

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

function verifyItineraryBoundary(row: UploadReviewQueueFixtureRow): UploadReviewRegressionCheck {
  const candidate = buildUploadReviewFixtureCandidate(row);
  const rawText = row.raw_text_chunk ?? '';
  if (!rawText.trim()) {
    return {
      queueId: row.id,
      productTitle: row.product_title,
      sourceFilename: row.source_filename,
      normalizedContentHash: row.normalized_content_hash,
      codes: candidate.codes,
      supported: true,
      status: 'failed',
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
      queueId: row.id,
      productTitle: row.product_title,
      sourceFilename: row.source_filename,
      normalizedContentHash: row.normalized_content_hash,
      codes: candidate.codes,
      supported: true,
      status: 'failed',
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
      queueId: row.id,
      productTitle: row.product_title,
      sourceFilename: row.source_filename,
      normalizedContentHash: row.normalized_content_hash,
      codes: candidate.codes,
      supported: true,
      status: 'failed',
      reason: `recovered product still has invalid itinerary days: ${badProduct.title ?? '(untitled)'}.`,
      productsRecovered: products.length,
      productSummaries,
    };
  }

  return {
    queueId: row.id,
    productTitle: row.product_title,
    sourceFilename: row.source_filename,
    normalizedContentHash: row.normalized_content_hash,
    codes: candidate.codes,
    supported: true,
    status: 'passed',
    reason: 'catalog boundaries recover clean per-product itinerary day sequences.',
    productsRecovered: products.length,
    productSummaries,
  };
}

export function buildUploadReviewRegressionReport(input: {
  rows: UploadReviewQueueFixtureRow[];
  generatedAt?: string;
}): UploadReviewRegressionReport {
  const dedupedRows = dedupeRows(input.rows);
  const checks = dedupedRows.map(row => {
    const candidate = buildUploadReviewFixtureCandidate(row);
    const supported = candidate.codes.some(code => SUPPORTED_ITINERARY_CODES.has(code));
    if (supported) return verifyItineraryBoundary(row);
    return {
      queueId: row.id,
      productTitle: row.product_title,
      sourceFilename: row.source_filename,
      normalizedContentHash: row.normalized_content_hash,
      codes: candidate.codes,
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
    failed: checks.filter(check => check.status === 'failed').length,
    skipped: checks.filter(check => check.status === 'skipped').length,
    checks,
  };
}
