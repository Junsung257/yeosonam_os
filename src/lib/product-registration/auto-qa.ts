import { mapTravelPackageToLandingData } from '@/lib/map-travel-package-to-lp';
import { renderPackage } from '@/lib/render-contract';
import type { PriceDate } from '@/lib/price-dates';
import type { ProductPriceRowInput } from '@/lib/upload-validator';
import type { StandardProductRegistrationObject } from './types';
import {
  buildImprovementLedgerEvent,
  type AutoFixRecord,
  type ImprovementFinalStatus,
  type ImprovementLedgerEvent,
  type RenderAuditResult,
} from './improvement-ledger';

export type MicroAutoQATrigger =
  | 'upload_failed'
  | 'not_publishable'
  | 'deliverability_blocked'
  | 'low_confidence'
  | 'price_storage_mismatch'
  | 'customer_selling_price_missing'
  | 'schedule_pollution_removed'
  | 'destination_unknown'
  | 'mobile_render_failed'
  | 'a4_render_failed'
  | 'unknown_format';

export type MicroAutoQAResult = {
  status: ImprovementFinalStatus;
  triggers: MicroAutoQATrigger[];
  attempts: ImprovementLedgerEvent[];
  recommendedFixes: AutoFixRecord[];
  packagesAudit: RenderAuditResult;
  a4Audit: RenderAuditResult;
};

const COMPARED_FIELDS = [
  'title',
  'destination',
  'product_prices',
  'price_dates',
  'itinerary_days',
  'flight_segments',
  'hotels',
  'meals',
  'inclusions',
  'exclusions',
  'optional_tours',
];

const FORBIDDEN_RENDER_TEXT = [
  'supplier_raw_departure_dates',
  'net_price',
  'internal_memo',
  'land_operator',
];

function hasPositiveCustomerSellingPrice(row: ProductPriceRowInput): boolean {
  return typeof row.net_price === 'number'
    && row.net_price > 0
    && typeof row.adult_selling_price === 'number'
    && row.adult_selling_price > 0;
}

function priceDatesAligned(rows: ProductPriceRowInput[], priceDates: PriceDate[]): boolean {
  if (rows.length === 0 || priceDates.length === 0) return false;
  const byDate = new Map<string, number[]>();
  for (const row of rows) {
    if (!row.target_date || !Number.isFinite(row.net_price) || row.net_price <= 0) continue;
    byDate.set(row.target_date, [...(byDate.get(row.target_date) ?? []), row.net_price]);
  }
  return priceDates.every(priceDate => {
    const prices = byDate.get(priceDate.date);
    return Array.isArray(prices) && prices.length > 0 && Math.min(...prices) === priceDate.price;
  });
}

function buildRenderPackageInput(registration: StandardProductRegistrationObject): Record<string, unknown> {
  return {
    title: registration.identity.title ?? registration.extractedData.title ?? 'Untitled package',
    destination: registration.identity.destination ?? registration.extractedData.destination ?? '',
    duration: registration.identity.durationDays ?? registration.extractedData.duration ?? 1,
    price: registration.pricing.minPrice ?? registration.extractedData.price ?? 0,
    price_dates: registration.pricing.priceDates,
    itinerary_data: registration.itinerary.itineraryDataToSave ?? registration.itinerary.itineraryInput ?? null,
    inclusions: registration.extractedData.inclusions ?? [],
    excludes: registration.extractedData.excludes ?? [],
    optional_tours: registration.extractedData.optional_tours ?? [],
    accommodations: registration.extractedData.accommodations ?? [],
  };
}

export function auditPackagesPayload(registration: StandardProductRegistrationObject): RenderAuditResult {
  const failures: string[] = [];
  const warnings: string[] = [];
  try {
    const pkg = buildRenderPackageInput(registration);
    const landing = mapTravelPackageToLandingData(pkg as unknown as Record<string, unknown>, null);
    if (!landing.priceFrom || landing.priceFrom <= 0) failures.push('landing.priceFrom missing');
    if (!Array.isArray(landing.price_dates) || landing.price_dates.length === 0) failures.push('landing.price_dates missing');
    if (!Array.isArray(landing.itinerary.days) || landing.itinerary.days.length === 0) failures.push('landing.itinerary.days missing');
    const payload = JSON.stringify(landing);
    for (const forbidden of FORBIDDEN_RENDER_TEXT) {
      if (payload.includes(forbidden)) failures.push(`landing forbidden text: ${forbidden}`);
    }
    if (registration.pricing.productPrices.length === 0) failures.push('product_prices missing for customer options');
    if (!registration.pricing.productPrices.every(hasPositiveCustomerSellingPrice)) {
      failures.push('product_prices adult_selling_price missing');
    }
  } catch (error) {
    failures.push(`landing render error: ${error instanceof Error ? error.message : String(error)}`);
  }
  return {
    status: failures.length > 0 ? 'fail' : warnings.length > 0 ? 'warn' : 'pass',
    failures,
    warnings,
  };
}

export function auditA4Payload(registration: StandardProductRegistrationObject): RenderAuditResult {
  const failures: string[] = [];
  const warnings: string[] = [];
  try {
    const pkg = buildRenderPackageInput(registration);
    const view = renderPackage(pkg as Parameters<typeof renderPackage>[0]);
    if (!Array.isArray(view.days) || view.days.length === 0) failures.push('a4.days missing');
    if (!Array.isArray(registration.pricing.priceDates) || registration.pricing.priceDates.length === 0) {
      failures.push('a4.price_dates missing');
    }
    const payload = JSON.stringify(view);
    for (const forbidden of FORBIDDEN_RENDER_TEXT) {
      if (payload.includes(forbidden)) failures.push(`a4 forbidden text: ${forbidden}`);
    }
  } catch (error) {
    failures.push(`a4 render error: ${error instanceof Error ? error.message : String(error)}`);
  }
  return {
    status: failures.length > 0 ? 'fail' : warnings.length > 0 ? 'warn' : 'pass',
    failures,
    warnings,
  };
}

function detectTriggers(input: {
  registration: StandardProductRegistrationObject;
  rawText: string;
  uploadFailed?: boolean;
  trustScore?: number | null;
  trustThreshold: number;
  packagesAudit: RenderAuditResult;
  a4Audit: RenderAuditResult;
}): MicroAutoQATrigger[] {
  const triggers = new Set<MicroAutoQATrigger>();
  const registration = input.registration;
  if (input.uploadFailed) triggers.add('upload_failed');
  if (!registration.publishable) triggers.add('not_publishable');
  if (!registration.deliverability.ok) triggers.add('deliverability_blocked');
  if (typeof input.trustScore === 'number' && input.trustScore < input.trustThreshold) triggers.add('low_confidence');
  if (!priceDatesAligned(registration.pricing.productPrices, registration.pricing.priceDates)) triggers.add('price_storage_mismatch');
  if (!registration.pricing.productPrices.every(hasPositiveCustomerSellingPrice)) triggers.add('customer_selling_price_missing');
  if (registration.itinerary.removedPollutedScheduleItems.length > 0) triggers.add('schedule_pollution_removed');
  if (registration.identity.destinationCode === 'UNK' || registration.identity.internalCode?.includes('-UNK-')) triggers.add('destination_unknown');
  if (input.packagesAudit.status === 'fail') triggers.add('mobile_render_failed');
  if (input.a4Audit.status === 'fail') triggers.add('a4_render_failed');
  if (!/\bPKG\s*\d+/i.test(input.rawText) && registration.pricing.source === 'none') triggers.add('unknown_format');
  return [...triggers].sort();
}

function recommendDeterministicFixes(input: {
  registration: StandardProductRegistrationObject;
  triggers: MicroAutoQATrigger[];
}): AutoFixRecord[] {
  const fixes: AutoFixRecord[] = [];
  if (input.triggers.includes('customer_selling_price_missing')) {
    fixes.push({
      field: 'product_prices.adult_selling_price',
      kind: 'deterministic',
      reason: 'fill missing customer selling price from net_price before deliverability',
      confidence: 1,
    });
  }
  if (input.triggers.includes('schedule_pollution_removed')) {
    fixes.push({
      field: 'itinerary_data.days[].schedule',
      kind: 'deterministic',
      reason: 'keep removed table fragments out of customer schedule and verify relocation evidence',
      before: input.registration.itinerary.removedPollutedScheduleItems,
      confidence: 0.9,
    });
  }
  if (input.triggers.includes('price_storage_mismatch')) {
    fixes.push({
      field: 'price_dates',
      kind: 'manual_review_candidate',
      reason: 'rebuild date-level minimum from product_prices only when source evidence confirms rows',
      confidence: 0.7,
    });
  }
  return fixes;
}

function finalStatusFor(input: {
  triggers: MicroAutoQATrigger[];
  fixes: AutoFixRecord[];
  packagesAudit: RenderAuditResult;
  a4Audit: RenderAuditResult;
}): ImprovementFinalStatus {
  if (input.triggers.length === 0) return 'PASS';
  if (input.packagesAudit.status === 'fail' || input.a4Audit.status === 'fail') return 'BLOCKED';
  if (input.fixes.some(fix => fix.kind === 'deterministic') && input.triggers.every(trigger => (
    trigger === 'schedule_pollution_removed'
    || trigger === 'customer_selling_price_missing'
  ))) {
    return 'AUTO_FIXED';
  }
  return 'REVIEW_NEEDED';
}

export function runMicroAutoQA(input: {
  uploadId?: string | null;
  productId?: string | null;
  packageId?: string | null;
  rawText: string;
  sectionRawText?: string | null;
  registration: StandardProductRegistrationObject;
  uploadFailed?: boolean;
  trustScore?: number | null;
  trustThreshold?: number;
  maxAttempts?: number;
  createdAt?: string;
}): MicroAutoQAResult {
  const packagesAudit = auditPackagesPayload(input.registration);
  const a4Audit = auditA4Payload(input.registration);
  const triggers = detectTriggers({
    registration: input.registration,
    rawText: input.rawText,
    uploadFailed: input.uploadFailed,
    trustScore: input.trustScore,
    trustThreshold: input.trustThreshold ?? 85,
    packagesAudit,
    a4Audit,
  });
  const recommendedFixes = recommendDeterministicFixes({ registration: input.registration, triggers });
  const status = finalStatusFor({ triggers, fixes: recommendedFixes, packagesAudit, a4Audit });
  const maxAttempts = Math.max(1, Math.min(3, input.maxAttempts ?? (triggers.length > 0 ? 3 : 1)));
  const blockersBefore = [
    ...input.registration.deliverability.blockers,
    ...packagesAudit.failures,
    ...a4Audit.failures,
    ...triggers.map(trigger => `trigger:${trigger}`),
  ];
  const blockersAfter = status === 'PASS' || status === 'AUTO_FIXED'
    ? []
    : blockersBefore;
  const attempts = Array.from({ length: maxAttempts }, (_, index) => buildImprovementLedgerEvent({
    uploadId: input.uploadId,
    productId: input.productId,
    packageId: input.packageId,
    attemptNo: index,
    rawText: input.rawText,
    sectionRawText: input.sectionRawText,
    registration: input.registration,
    blockersBefore: index === 0 ? blockersBefore : blockersAfter,
    blockersAfter,
    comparedFields: COMPARED_FIELDS,
    autoFixesApplied: index === 0 ? [] : recommendedFixes,
    packagesAudit,
    a4Audit,
    finalStatus: status,
    createdAt: input.createdAt,
  }));

  return {
    status,
    triggers,
    attempts,
    recommendedFixes,
    packagesAudit,
    a4Audit,
  };
}
