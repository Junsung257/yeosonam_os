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
  blockers: string[];
  warnings: string[];
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

function customerReadyOffline(registration: StandardProductRegistrationObject, blockers: string[], warnings: string[]): boolean {
  if (blockers.length > 0) return false;
  const customerReviewWarnings = warnings.filter(warning => (
    warning.startsWith('v3:gate:')
    || warning === 'v3:needs_review'
    || warning.startsWith('mobile_media:')
    || warning.includes('unmatched')
  ));
  return registration.publishable && customerReviewWarnings.length === 0;
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

async function auditProduct(input: {
  sourceFile: string;
  productIndex: number;
  rawText: string;
  documentRawText: string;
  sourceFileName: string;
  extractedData: ExtractedData;
  title: string | null;
  activeAttractions: AttractionData[];
}): Promise<OfflineProductAudit> {
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
  ];
  const itineraryDays = finalRegistration.itinerary.itineraryDataToSave?.days?.length
    ?? finalRegistration.itinerary.itineraryInput?.days?.length
    ?? 0;

  return {
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
    customerReadyOffline: customerReadyOffline(finalRegistration, blockers, warnings),
    blockers: [...new Set(blockers)].slice(0, 40),
    warnings: [...new Set(warnings)].slice(0, 40),
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
  const activeAttractions = await loadActiveAttractions(readArg('--active-attractions-json'));
  const rows = (extractReport.rows ?? []).filter(row => row.extractedTextPath && row.status !== 'extraction_failed');
  const products: OfflineProductAudit[] = [];

  for (const row of rows) {
    const textPath = resolve(row.extractedTextPath as string);
    const rawText = await readTextFile(textPath);
    const sourceProducts = productsFromRawText(rawText);
    for (let index = 0; index < sourceProducts.length; index++) {
      const sourceProduct = sourceProducts[index];
      products.push(await auditProduct({
        sourceFile: row.fileName ?? row.filePath ?? textPath,
        sourceFileName: row.fileName ?? row.filePath ?? textPath,
        productIndex: index,
        rawText: sourceProduct.rawText,
        documentRawText: sourceProduct.documentRawText,
        extractedData: sourceProduct.extractedData,
        title: sourceProduct.title,
        activeAttractions,
      }));
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
      mobileLandingVerified: false,
      mobileLandingVerificationReason: 'offline audit cannot verify live mobile pages; run register-upload-inbox with --register --audit-mobile after DB health passes',
    },
  };

  await writeJson(join(outputDir, 'offline-source-audit.json'), report);
  await writeJson(join(outputDir, 'learning-events.json'), buildLearningEvents(products));
  await writeJson(join(outputDir, 'offline-master-candidates.json'), buildOfflineMasterCandidates(products));
  await writeJson(join(outputDir, 'macro-learning-report.json'), buildMacroLearningReport(products));

  console.log(`[offline-audit] report: ${join(outputDir, 'offline-source-audit.json')}`);
  console.log(`[offline-audit] products=${report.summary.products} publishableOffline=${report.summary.publishableOffline} customerReadyOffline=${report.summary.customerReadyOffline}`);

  if (hasArg('--strict') && report.summary.blocked > 0) process.exit(1);
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
