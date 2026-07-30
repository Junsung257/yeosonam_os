#!/usr/bin/env tsx

import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { config as loadEnv } from 'dotenv';

import type { AttractionData } from '@/lib/attraction-matcher';
import { recoverCatalogSplitFromRawText } from '@/lib/product-registration/catalog-split-recovery';
import { auditA4Payload, auditPackagesPayload, runMicroAutoQA } from '@/lib/product-registration/auto-qa';
import { extractUploadDestinationFromFilename } from '@/lib/product-registration/destination-resolution';
import {
  ACTIVE_ATTRACTION_CATALOG_UNAVAILABLE,
  evaluateOfflineCustomerReadiness,
} from '@/lib/product-registration/offline-customer-readiness';
import {
  buildRegistrationRemediationPlan,
  type RegistrationRemediationPlan,
} from '@/lib/product-registration/operator-remediation';
import { registerProductFromRaw } from '@/lib/product-registration/register-product-from-raw';
import type { StandardProductRegistrationObject } from '@/lib/product-registration/types';
import type { ExtractedData } from '@/lib/parser';

loadEnv({ path: '.env.local' });
loadEnv();

type ExtractReportRow = {
  filePath?: string;
  fileName?: string;
  status?: string;
  rawTextHash?: string | null;
  extractedTextPath?: string | null;
};

type ExtractReport = {
  outputDir?: string;
  rows?: ExtractReportRow[];
};

type OfflineProductAudit = {
  sourceFile: string;
  productIndex: number;
  rawTextHash: string;
  title: string | null;
  destination: string | null;
  destinationCode: string | null;
  priceRows: number;
  priceDates: number;
  itineraryDays: number;
  blockerCategory: string | null;
  publishableOffline: boolean;
  customerReadyOffline: boolean;
  customerReviewWarnings: string[];
  remediation: RegistrationRemediationPlan;
  blockers: string[];
  warnings: string[];
};

type OfflineRenderFixture = {
  id: string;
  sourceFile: string;
  productIndex: number;
  rawTextHash: string;
  customerReadyOffline: boolean;
  package: Record<string, unknown>;
  attractions: AttractionData[];
  heroImageUrl: string | null;
};

type OfflineAuditReport = {
  version: 1;
  generatedAt: string;
  sourceReport: string;
  products: OfflineProductAudit[];
  summary: {
    files: number;
    products: number;
    publishableOffline: number;
    customerReadyOffline: number;
    blocked: number;
    blockedByCategory: Record<string, number>;
    attractionCatalogVerified: boolean;
    activeAttractionCount: number;
    customerReviewReasonCounts: Record<string, number>;
    remediationActionCounts: Record<string, number>;
    supplierConfirmationProducts: number;
    unclassifiedRemediationProducts: number;
    operatorRemediationComplete: boolean;
    offlineRenderFixtureFile: string;
    offlineRenderFixtureCount: number;
    mobileLandingVerified: false;
    mobileLandingVerificationReason: string;
  };
};

function readArg(name: string): string | null {
  const prefix = `${name}=`;
  return process.argv.slice(2).find(arg => arg.startsWith(prefix))?.slice(prefix.length) ?? null;
}

function hasArg(name: string): boolean {
  return process.argv.slice(2).includes(name);
}

function hashText(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

async function readJson<T>(path: string): Promise<T> {
  const value = await readFile(path, { encoding: 'utf8' });
  return JSON.parse(String(value)) as T;
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

async function readTextFile(path: string): Promise<string> {
  const value = await readFile(path, { encoding: 'utf8' });
  return String(value);
}

async function loadActiveAttractions(path: string | null): Promise<AttractionData[]> {
  if (!path) return [];
  const fullPath = resolve(path);
  if (!existsSync(fullPath)) throw new Error(`active attractions cache not found: ${fullPath}`);
  const parsed = await readJson<unknown>(fullPath);
  if (Array.isArray(parsed)) return parsed as AttractionData[];
  if (parsed && typeof parsed === 'object' && Array.isArray((parsed as { attractions?: unknown }).attractions)) {
    return (parsed as { attractions: unknown[] }).attractions as AttractionData[];
  }
  throw new Error(`active attractions cache has unsupported shape: ${fullPath}`);
}

function productsFromRawText(rawText: string): Array<{
  rawText: string;
  documentRawText: string;
  extractedData: ExtractedData;
  title: string | null;
}> {
  const recovered = recoverCatalogSplitFromRawText(rawText);
  if (recovered.length > 0) {
    return recovered.map(product => ({
      rawText: product.sectionRawText ?? rawText,
      documentRawText: rawText,
      extractedData: {
        ...product.extractedData,
        rawText: product.sectionRawText ?? rawText,
      },
      title: product.extractedData.title ?? null,
    }));
  }
  return [{
    rawText,
    documentRawText: rawText,
    extractedData: { rawText },
    title: null,
  }];
}

function classifyBlockerCategory(blockers: string[]): string | null {
  if (blockers.length === 0) return null;
  const text = blockers.join('\n');
  const priceMissing = /product_prices missing|price_dates missing|landing\.priceFrom missing|landing\.price_dates missing/i.test(text);
  const itineraryMissing = /itinerary missing|landing\.itinerary\.days missing|a4\.days missing/i.test(text);
  if (priceMissing && itineraryMissing) return 'price_and_itinerary_missing';
  if (/itinerary duplicate day number|duration overflow/i.test(text)) return 'itinerary_duplicate_or_overflow';
  if (/flight time source mismatch|saved segments are incomplete|round-trip flight times/i.test(text)) return 'flight_mismatch';
  if (/destination_unknown|destination code unresolved|destination_code:UNK/i.test(text)) return 'destination_unresolved';
  if (itineraryMissing) return 'itinerary_missing';
  if (priceMissing) return 'price_missing';
  return 'other';
}

function countBlockedByCategory(products: OfflineProductAudit[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const product of products) {
    if (product.publishableOffline) continue;
    const category = product.blockerCategory ?? 'other';
    counts[category] = (counts[category] ?? 0) + 1;
  }
  return counts;
}

function collectReferencedAttractionIds(itineraryData: unknown): Set<string> {
  const ids = new Set<string>();
  if (!itineraryData || typeof itineraryData !== 'object' || Array.isArray(itineraryData)) return ids;
  const days = Array.isArray((itineraryData as { days?: unknown }).days)
    ? (itineraryData as { days: unknown[] }).days
    : [];
  for (const day of days) {
    if (!day || typeof day !== 'object' || Array.isArray(day)) continue;
    const schedule = Array.isArray((day as { schedule?: unknown }).schedule)
      ? (day as { schedule: unknown[] }).schedule
      : [];
    for (const item of schedule) {
      if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
      const attractionIds = Array.isArray((item as { attraction_ids?: unknown }).attraction_ids)
        ? (item as { attraction_ids: unknown[] }).attraction_ids
        : [];
      for (const id of attractionIds) {
        if (typeof id === 'string' && id.trim()) ids.add(id.trim());
      }
    }
  }
  return ids;
}

function parseNights(tripStyle: unknown, duration: unknown): number | null {
  const match = String(tripStyle ?? '').match(/(\d+)\s*박\s*(\d+)\s*일/u);
  if (match) return Number(match[1]);
  const days = Number(duration);
  return Number.isFinite(days) && days > 0 ? Math.max(0, days - 1) : null;
}

function buildOfflineRenderFixture(input: {
  sourceFile: string;
  productIndex: number;
  rawTextHash: string;
  registration: StandardProductRegistrationObject;
  activeAttractions: AttractionData[];
  customerReadyOffline: boolean;
}): OfflineRenderFixture {
  const registration = input.registration;
  const ed = registration.extractedData;
  const extendedEd = ed as ExtractedData & {
    customer_notes?: string | null;
    hero_tagline?: string | null;
  };
  const itineraryData = registration.itinerary.itineraryDataToSave
    ?? registration.itinerary.itineraryInput
    ?? null;
  const referencedIds = collectReferencedAttractionIds(itineraryData);
  const attractions = input.activeAttractions.filter(attraction => (
    typeof attraction.id === 'string' && referencedIds.has(attraction.id)
  ));
  const heroImageUrl = attractions
    .flatMap(attraction => attraction.photos ?? [])
    .map(photo => photo.src_large || photo.src_medium)
    .find(Boolean)
    ?? null;
  const title = registration.identity.title ?? ed.title ?? '상품명 검토 필요';
  const duration = registration.identity.durationDays ?? ed.duration ?? null;
  const id = `offline-${input.rawTextHash.slice(0, 24)}-${input.productIndex}`;

  return {
    id,
    sourceFile: input.sourceFile,
    productIndex: input.productIndex,
    rawTextHash: input.rawTextHash,
    customerReadyOffline: input.customerReadyOffline,
    attractions,
    heroImageUrl,
    package: {
      id,
      title,
      display_title: title,
      destination: registration.identity.destination ?? ed.destination ?? null,
      duration,
      nights: parseNights(ed.trip_style, duration),
      trip_style: ed.trip_style ?? null,
      price: registration.pricing.minPrice ?? ed.price ?? null,
      price_dates: registration.pricing.priceDates,
      price_tiers: registration.pricing.tiers,
      product_prices: registration.pricing.productPrices,
      itinerary_data: itineraryData,
      inclusions: ed.inclusions ?? [],
      excludes: ed.excludes ?? [],
      accommodations: ed.accommodations ?? [],
      optional_tours: ed.optional_tours ?? [],
      surcharges: ed.surcharges ?? [],
      notices_parsed: ed.notices_parsed ?? [],
      customer_notes: extendedEd.customer_notes ?? null,
      product_highlights: ed.product_highlights ?? [],
      product_summary: ed.product_summary ?? null,
      hero_tagline: extendedEd.hero_tagline ?? null,
      product_type: ed.product_type ?? null,
      airline: registration.identity.airline ?? ed.airline ?? null,
      departure_airport: ed.departure_airport ?? null,
      departure_days: ed.departure_days ?? null,
      min_participants: ed.min_participants ?? null,
      ticketing_deadline: ed.ticketing_deadline ?? null,
      guide_tip: ed.guide_tip ?? null,
      single_supplement: ed.single_supplement ?? null,
      lp_hero_image_url: heroImageUrl,
      internal_code: registration.identity.internalCode,
      products: {
        internal_code: registration.identity.internalCode,
        display_name: title,
      },
      status: 'active',
      audit_status: 'warnings',
      updated_at: new Date().toISOString(),
      package_revision: 1,
    },
  };
}

async function auditProduct(input: {
  sourceFile: string;
  productIndex: number;
  rawText: string;
  documentRawText: string;
  sourceFileName: string;
  extractedData: ExtractedData;
  title: string | null;
  activeAttractions: AttractionData[];
  activeAttractionCatalogVerified: boolean;
}): Promise<{ audit: OfflineProductAudit; fixture: OfflineRenderFixture }> {
  const registration = await registerProductFromRaw({
    rawText: input.rawText,
    documentRawText: input.documentRawText,
    extractedData: input.extractedData,
    title: input.title,
    activeAttractions: input.activeAttractions,
    tempDestination: extractUploadDestinationFromFilename(input.sourceFileName),
    enableGeminiFallback: false,
  });
  const autoQA = runMicroAutoQA({
    rawText: input.rawText,
    sectionRawText: input.rawText,
    registration,
  });
  const finalRegistration = autoQA.repairedRegistration;
  const packagesAudit = autoQA.packagesAudit;
  const a4Audit = autoQA.a4Audit;
  const blockers = [
    ...finalRegistration.failures,
    ...packagesAudit.failures.map(failure => `packages:${failure}`),
    ...a4Audit.failures.map(failure => `a4:${failure}`),
    ...autoQA.remainingTriggers.map(trigger => `micro:${trigger}`),
  ];
  const warnings = [
    ...finalRegistration.warnings,
    ...packagesAudit.warnings.map(warning => `packages:${warning}`),
    ...a4Audit.warnings.map(warning => `a4:${warning}`),
    ...(!input.activeAttractionCatalogVerified
      ? [ACTIVE_ATTRACTION_CATALOG_UNAVAILABLE]
      : []),
  ];
  const customerReadiness = evaluateOfflineCustomerReadiness({
    publishable: finalRegistration.publishable,
    blockers,
    warnings,
    activeAttractionCatalogVerified: input.activeAttractionCatalogVerified,
  });
  const itineraryDays = finalRegistration.itinerary.itineraryDataToSave?.days?.length
    ?? finalRegistration.itinerary.itineraryInput?.days?.length
    ?? 0;
  const remediation = buildRegistrationRemediationPlan(
    [...customerReadiness.reviewWarnings, ...blockers],
    { productTitle: finalRegistration.identity.title },
  );

  const audit: OfflineProductAudit = {
    sourceFile: input.sourceFile,
    productIndex: input.productIndex,
    rawTextHash: hashText(input.rawText),
    title: finalRegistration.identity.title,
    destination: finalRegistration.identity.destination,
    destinationCode: finalRegistration.identity.destinationCode,
    priceRows: finalRegistration.pricing.productPrices.length,
    priceDates: finalRegistration.pricing.priceDates.length,
    itineraryDays,
    blockerCategory: classifyBlockerCategory(blockers),
    publishableOffline: finalRegistration.publishable && blockers.length === 0,
    customerReadyOffline: customerReadiness.ready,
    customerReviewWarnings: customerReadiness.reviewWarnings,
    remediation,
    blockers: [...new Set(blockers)].slice(0, 40),
    warnings: [...new Set(warnings)].slice(0, 40),
  };
  return {
    audit,
    fixture: buildOfflineRenderFixture({
      sourceFile: input.sourceFile,
      productIndex: input.productIndex,
      rawTextHash: audit.rawTextHash,
      registration: finalRegistration,
      activeAttractions: input.activeAttractions,
      customerReadyOffline: audit.customerReadyOffline,
    }),
  };
}

function buildLearningEvents(products: OfflineProductAudit[]) {
  return products.map(product => ({
    rawTextHash: product.rawTextHash,
    sourceFile: product.sourceFile,
    productIndex: product.productIndex,
    title: product.title,
    destination: product.destination,
    finalStatus: product.customerReadyOffline ? 'PASS' : product.publishableOffline ? 'REVIEW_NEEDED' : 'BLOCKED',
    blockerSignatures: product.blockers.map(blocker => blocker.slice(0, 160)),
    comparedFields: [
      'title',
      'destination',
      'product_prices',
      'price_dates',
      'itinerary_days',
      'mobile_render_contract',
      'a4_render_contract',
      'attraction_media',
    ],
  }));
}

function buildMacroLearningReport(products: OfflineProductAudit[]) {
  const counts = new Map<string, number>();
  for (const product of products) {
    for (const blocker of product.blockers) {
      const signature = blocker.replace(/\d{4}-\d{2}-\d{2}/g, 'YYYY-MM-DD').replace(/\d[\d,]+/g, 'N');
      counts.set(signature, (counts.get(signature) ?? 0) + 1);
    }
  }
  return {
    generatedAt: new Date().toISOString(),
    candidates: [...counts.entries()]
      .sort((left, right) => right[1] - left[1])
      .map(([signature, count]) => ({
        kind: 'offline_product_registration_pattern',
        signature,
        evidenceCount: count,
        promotionReady: count >= 3,
        recommendedAction: count >= 3 ? 'review_rule_or_fixture_promotion' : 'collect_more_evidence',
      })),
  };
}

function buildOfflineMasterCandidates(products: OfflineProductAudit[]) {
  const candidates = new Map<string, { occurrenceCount: number; examples: string[] }>();
  for (const product of products) {
    for (const warning of product.warnings) {
      if (!warning.startsWith('mobile_media:')) continue;
      const key = warning.replace(/^mobile_media:/, '').slice(0, 120);
      const current = candidates.get(key) ?? { occurrenceCount: 0, examples: [] };
      current.occurrenceCount++;
      if (current.examples.length < 3) current.examples.push(product.sourceFile);
      candidates.set(key, current);
    }
  }
  return {
    generatedAt: new Date().toISOString(),
    candidates: [...candidates.entries()].map(([label, candidate]) => ({
      label,
      action: candidate.occurrenceCount >= 3 ? 'needs_review' : 'collect_more_evidence',
      occurrenceCount: candidate.occurrenceCount,
      examples: candidate.examples,
      photoSearchPlan: {
        searchTerms: [label],
        needsDestinationContext: true,
      },
      descriptionSeed: {
        source: 'offline_mobile_media_warning',
      },
    })),
  };
}

async function main(): Promise<void> {
  const reportPathArg = readArg('--report');
  if (!reportPathArg) throw new Error('Usage: npx tsx scripts/audit-upload-inbox-extracted-sources.ts --report=scratch/.../report.json');
  const reportPath = resolve(reportPathArg);
  const noParser = hasArg('--no-parser');
  if (!noParser) {
    console.warn('[offline-audit] parser is always run from extracted text; --no-parser is accepted for runbook compatibility.');
  }
  const extractReport = await readJson<ExtractReport>(reportPath);
  const outputDir = extractReport.outputDir ?? dirname(reportPath);
  const requestedActiveAttractionsPath = readArg('--active-attractions-json');
  const defaultActiveAttractionsPath = resolve('scratch/attractions/active-attractions-latest.json');
  const activeAttractionsPath = requestedActiveAttractionsPath
    ?? (existsSync(defaultActiveAttractionsPath) ? defaultActiveAttractionsPath : null);
  const activeAttractions = await loadActiveAttractions(activeAttractionsPath);
  const activeAttractionCatalogVerified = activeAttractionsPath !== null;
  if (!activeAttractionCatalogVerified) {
    console.warn(
      '[offline-audit] active attraction catalog unavailable; customer-ready results are intentionally blocked. '
      + 'Provide --active-attractions-json=... before treating this audit as release evidence.',
    );
  }
  const rows = (extractReport.rows ?? []).filter(row => row.extractedTextPath && row.status !== 'extraction_failed');
  const products: OfflineProductAudit[] = [];
  const renderFixtures: OfflineRenderFixture[] = [];

  for (const row of rows) {
    const textPath = resolve(row.extractedTextPath as string);
    const rawText = await readTextFile(textPath);
    const sourceProducts = productsFromRawText(rawText);
    for (let index = 0; index < sourceProducts.length; index++) {
      const sourceProduct = sourceProducts[index];
      const audited = await auditProduct({
        sourceFile: row.fileName ?? row.filePath ?? textPath,
        sourceFileName: row.fileName ?? row.filePath ?? textPath,
        productIndex: index,
        rawText: sourceProduct.rawText,
        documentRawText: sourceProduct.documentRawText,
        extractedData: sourceProduct.extractedData,
        title: sourceProduct.title,
        activeAttractions,
        activeAttractionCatalogVerified,
      });
      products.push(audited.audit);
      renderFixtures.push(audited.fixture);
    }
  }

  const report: OfflineAuditReport = {
    version: 1,
    generatedAt: new Date().toISOString(),
    sourceReport: reportPath,
    products,
    summary: {
      files: rows.length,
      products: products.length,
      publishableOffline: products.filter(product => product.publishableOffline).length,
      customerReadyOffline: products.filter(product => product.customerReadyOffline).length,
      blocked: products.filter(product => !product.publishableOffline).length,
      blockedByCategory: countBlockedByCategory(products),
      attractionCatalogVerified: activeAttractionCatalogVerified,
      activeAttractionCount: activeAttractions.length,
      customerReviewReasonCounts: products
        .flatMap(product => product.customerReviewWarnings)
        .reduce<Record<string, number>>((counts, warning) => {
          counts[warning] = (counts[warning] ?? 0) + 1;
          return counts;
        }, {}),
      remediationActionCounts: products
        .flatMap(product => product.remediation.actions)
        .reduce<Record<string, number>>((counts, action) => {
          counts[action.field] = (counts[action.field] ?? 0) + 1;
          return counts;
        }, {}),
      supplierConfirmationProducts: products.filter(product =>
        product.remediation.actions.some(action => action.kind === 'supplier_confirmation')
      ).length,
      unclassifiedRemediationProducts: products.filter(product =>
        !product.customerReadyOffline
        && (
          product.remediation.ready
          || product.remediation.actions.some(action => action.field === 'unknown')
        )
      ).length,
      operatorRemediationComplete: products.every(product =>
        product.customerReadyOffline
        || (
          !product.remediation.ready
          && product.remediation.actions.every(action => action.field !== 'unknown')
        )
      ),
      offlineRenderFixtureFile: join(outputDir, 'offline-render-fixtures.json'),
      offlineRenderFixtureCount: renderFixtures.filter(fixture => fixture.customerReadyOffline).length,
      mobileLandingVerified: false,
      mobileLandingVerificationReason: 'offline audit cannot verify live mobile pages; run register-upload-inbox with --register --audit-mobile after DB health passes',
    },
  };

  await writeJson(join(outputDir, 'offline-source-audit.json'), report);
  await writeJson(join(outputDir, 'offline-render-fixtures.json'), {
    version: 1,
    generatedAt: report.generatedAt,
    sourceReport: reportPath,
    fixtures: renderFixtures.filter(fixture => fixture.customerReadyOffline),
  });
  await writeJson(join(outputDir, 'learning-events.json'), buildLearningEvents(products));
  await writeJson(join(outputDir, 'offline-master-candidates.json'), buildOfflineMasterCandidates(products));
  await writeJson(join(outputDir, 'macro-learning-report.json'), buildMacroLearningReport(products));
  await writeJson(join(outputDir, 'operator-remediation-report.json'), {
    version: 1,
    generatedAt: report.generatedAt,
    sourceReport: reportPath,
    summary: {
      totalProducts: products.length,
      customerReadyProducts: products.filter(product => product.customerReadyOffline).length,
    },
    products: products
      .filter(product => !product.customerReadyOffline)
      .map(product => ({
        sourceFile: product.sourceFile,
        productIndex: product.productIndex,
        title: product.title,
        customerReadyOffline: product.customerReadyOffline,
        remediation: product.remediation,
      })),
  });

  console.log(`[offline-audit] report: ${join(outputDir, 'offline-source-audit.json')}`);
  console.log(`[offline-audit] products=${report.summary.products} publishableOffline=${report.summary.publishableOffline} customerReadyOffline=${report.summary.customerReadyOffline}`);

  if (
    hasArg('--strict')
    && (report.summary.blocked > 0 || !report.summary.operatorRemediationComplete)
  ) {
    process.exit(1);
  }
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
