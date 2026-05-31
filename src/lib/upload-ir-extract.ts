/**
 * upload IR canary — forward normalize + convertIntakeToPackage 로 상품 추출
 *
 * IR_CANARY 샘플에 한해 parseDocument 대신 register-via-ir 와 동일 체인으로
 * extractedData · itineraryData 를 생성한다 (단일·복수 PKG 카탈로그).
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { normalizeWithLlm } from './normalize-with-llm';
import { convertIntakeToPackage, type PackageDraft } from './ir-to-package';
import {
  getIrCanaryConcurrency,
  getIrCanaryMaxProducts,
  isIrCanaryMultiEnabled,
  pickCanaryEngine,
} from './ir-canary';
import { splitCatalogSmart } from './parser/catalog-pre-split';
import type { ExtractedData, MultiProductResult } from './parser';
import type { TravelItinerary } from '@/types/itinerary';
import { NORMALIZER_VERSION, type NormalizedIntake } from './intake-normalizer';
import { collectEvidenceForValues, hashRawText, type SourceEvidenceMap } from '@/lib/source-evidence';
import { buildSupplierFormatFingerprint } from '@/lib/supplier-format-fingerprint';
import { applySupplierRawDeterministicFacts } from '@/lib/supplier-raw-deterministic-facts';
import {
  applyIntakeSectionCacheEntries,
  buildIntakeSectionCacheEntries,
  buildSectionCacheReducedRawText,
  evaluateSectionCacheCoverage,
  type IntakeSectionCacheEntry,
  lookupIntakeSectionCacheEntry,
  storeIntakeSectionCacheEntries,
} from '@/lib/intake-section-cache';

export interface UploadIrExtractInput {
  rawText: string;
  landOperator: string;
  commissionRate: number;
  sb: SupabaseClient;
  filename?: string;
}

export type UploadIrExtractResult =
  | {
      ok: true;
      products: MultiProductResult[];
      confidence: number;
      engine: string;
      tokensUsed?: { input: number; output: number };
      catalogSections?: number;
    }
  | { ok: false; errors: string[] };

function packageDraftToExtractedData(pkg: PackageDraft): ExtractedData {
  return {
    title: pkg.title,
    category: (pkg.category as unknown as ExtractedData['category']) || 'package',
    product_type: pkg.product_type,
    trip_style: pkg.trip_style,
    destination: pkg.destination,
    duration: pkg.duration,
    departure_days: pkg.departure_days ?? undefined,
    departure_airport: pkg.departure_airport,
    airline: pkg.airline,
    min_participants: pkg.min_participants,
    ticketing_deadline: pkg.ticketing_deadline ?? undefined,
    price: pkg.price,
    price_tiers: pkg.price_tiers as unknown as ExtractedData['price_tiers'],
    surcharges: pkg.surcharges as unknown as ExtractedData['surcharges'],
    excluded_dates: pkg.excluded_dates,
    inclusions: pkg.inclusions,
    excludes: pkg.excludes,
    optional_tours: pkg.optional_tours as unknown as ExtractedData['optional_tours'],
    itinerary: pkg.itinerary,
    accommodations: pkg.accommodations,
    notices_parsed: pkg.notices_parsed as unknown as ExtractedData['notices_parsed'],
    product_tags: pkg.product_tags,
    product_highlights: pkg.product_highlights,
    product_summary: pkg.product_summary ?? undefined,
    rawText: pkg.raw_text,
    _llm_meta: {
      provider: 'deepseek',
      tokens_input: 0,
      tokens_output: 0,
    },
  };
}

type NormalizedIntakeRow = {
  ir: NormalizedIntake;
  normalizer_version: string;
  status: string;
};

type SectionCacheTelemetry = {
  hitCount: number;
  reducedChars: number;
  reduceReady: boolean;
  replacedLabels: string[];
};

function canUseSupabase(input: UploadIrExtractInput): boolean {
  return typeof (input.sb as unknown as { from?: unknown })?.from === 'function';
}

function getUploadNormalizerTimeoutMs(): number {
  const raw = process.env.RAW_UPLOAD_NORMALIZER_TIMEOUT_MS;
  const n = raw ? Number(raw) : 45_000;
  if (!Number.isFinite(n) || n < 5_000) return 45_000;
  return Math.min(n, 120_000);
}

function getUploadNormalizerMaxRetries(): number {
  const raw = process.env.RAW_UPLOAD_NORMALIZER_MAX_RETRIES;
  const n = raw ? Number(raw) : 1;
  if (!Number.isFinite(n) || n < 0) return 1;
  return Math.min(n, 3);
}

function getUploadCacheStoreTimeoutMs(): number {
  const raw = process.env.RAW_UPLOAD_CACHE_STORE_TIMEOUT_MS;
  const n = raw ? Number(raw) : 1_500;
  if (!Number.isFinite(n) || n < 100) return 1_500;
  return Math.min(n, 10_000);
}

async function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  label: string,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function mergeSourceEvidence(ir: NormalizedIntake, chunkText: string): NormalizedIntake {
  const rawText = chunkText || ir.rawText;
  const rawTextHash = hashRawText(rawText);
  const fingerprint = buildSupplierFormatFingerprint(rawText);
  const generated = collectEvidenceForValues(
    rawText,
    [
      ['meta.region', ir.meta.region],
      ['meta.country', ir.meta.country],
      ['meta.tripStyle', ir.meta.tripStyle],
      ['meta.minParticipants', ir.meta.minParticipants],
      ['meta.departureAirport', ir.meta.departureAirport],
      ['meta.airline', ir.meta.airline],
      ['meta.departureDays', ir.meta.departureDays],
      ['flights.outbound[0].code', ir.flights?.outbound?.[0]?.code],
      ['flights.inbound[0].code', ir.flights?.inbound?.[0]?.code],
      ...(ir.priceGroups ?? []).flatMap((pg, i) => [
        [`priceGroups[${i}].adultPrice`, pg.adultPrice] as [string, unknown],
        [`priceGroups[${i}].childPrice`, pg.childPrice] as [string, unknown],
      ]),
      ...(ir.inclusions ?? []).map((v, i) => [`inclusions[${i}]`, v] as [string, unknown]),
      ...(ir.excludes ?? []).map((v, i) => [`excludes[${i}]`, v] as [string, unknown]),
    ],
    { rawTextHash },
  );
  const sourceEvidence: SourceEvidenceMap = {
    ...generated,
    ...(ir.sourceEvidence ?? {}),
  };
  return {
    ...ir,
    rawText,
    rawTextHash,
    sourceEvidence,
    sourceMeta: {
      ...(ir.sourceMeta ?? {}),
      formatFingerprint: fingerprint.formatHash,
      sectionFingerprints: fingerprint.sections,
    },
  };
}

async function lookupNormalizedIntakeCache(
  input: UploadIrExtractInput,
  chunkText: string,
): Promise<NormalizedIntake | null> {
  if (!canUseSupabase(input)) return null;
  const rawTextHash = hashRawText(chunkText);
  try {
    const { data, error } = await input.sb
      .from('normalized_intakes')
      .select('ir, normalizer_version, status')
      .eq('raw_text_hash', rawTextHash)
      .neq('status', 'rejected')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error || !data) return null;
    const row = data as NormalizedIntakeRow;
    if (!row.ir?.rawText) return null;
    console.log(`[upload-ir-extract] normalized_intakes exact cache HIT (${rawTextHash.slice(0, 12)})`);
    return mergeSourceEvidence(applySupplierRawDeterministicFacts(row.ir, chunkText), chunkText);
  } catch (e) {
    console.warn('[upload-ir-extract] normalized_intakes cache lookup failed:', e instanceof Error ? e.message : e);
    return null;
  }
}

async function storeNormalizedIntakeCache(
  input: UploadIrExtractInput,
  ir: NormalizedIntake,
): Promise<void> {
  if (!canUseSupabase(input)) return;
  try {
    const sectionEntries = buildIntakeSectionCacheEntries(ir);
    await input.sb.from('normalized_intakes').insert({
      raw_text: ir.rawText,
      raw_text_hash: ir.rawTextHash,
      ir,
      package_id: null,
      land_operator: input.landOperator,
      region: ir.meta.region,
      normalizer_version: ir.normalizerVersion,
      status: 'converted',
      canary_mode: false,
    });
    if (sectionEntries.length > 0) {
      const sectionCache = await storeIntakeSectionCacheEntries(input.sb, sectionEntries);
      if (sectionCache.attempted && sectionCache.warnings.length > 0) {
        console.warn(`[upload-ir-extract] section-cache store skipped: ${sectionCache.warnings.join('; ')}`);
      } else if (sectionCache.stored > 0) {
        console.log(`[upload-ir-extract] section-cache stored=${sectionCache.stored} (${sectionEntries.map(e => e.label).join(',')})`);
      } else {
        console.log(`[upload-ir-extract] section-cache candidates=${sectionEntries.length} (${sectionEntries.map(e => e.label).join(',')})`);
      }
    }
  } catch (e) {
    console.warn('[upload-ir-extract] normalized_intakes cache store failed:', e instanceof Error ? e.message : e);
  }
}

async function storeNormalizedIntakeCacheWithBudget(
  input: UploadIrExtractInput,
  ir: NormalizedIntake,
): Promise<void> {
  try {
    await withTimeout(
      storeNormalizedIntakeCache(input, ir),
      getUploadCacheStoreTimeoutMs(),
      'upload normalized-intake cache store',
    );
  } catch (e) {
    console.warn('[upload-ir-extract] normalized_intakes cache store budget exceeded:', e instanceof Error ? e.message : e);
  }
}

async function lookupReusableSectionCacheEntries(
  input: UploadIrExtractInput,
  fingerprint: ReturnType<typeof buildSupplierFormatFingerprint>,
): Promise<IntakeSectionCacheEntry[]> {
  if (!canUseSupabase(input)) return [];
  const hits = await Promise.all(
    fingerprint.sections.map(section =>
      lookupIntakeSectionCacheEntry(
        input.sb,
        section,
        process.env.RAW_UPLOAD_NORMALIZER_VERSION || NORMALIZER_VERSION,
      ),
    ),
  );
  return hits.filter((hit): hit is IntakeSectionCacheEntry => Boolean(hit));
}

async function convertIrToUploadProduct(
  ir: NormalizedIntake,
  input: UploadIrExtractInput,
  productIndex: number,
  tokensUsed?: { input: number; output: number },
  retryCount?: number,
  sectionCacheTelemetry?: SectionCacheTelemetry,
): Promise<
  | {
      product: MultiProductResult;
      confidence: number;
      tokensUsed?: { input: number; output: number };
    }
  | { error: string }
> {
  const conversion = await convertIntakeToPackage(ir, {
    sb: input.sb,
    status: 'pending',
    filename: input.filename
      ? `${input.filename}#${productIndex + 1}`
      : `ir-canary-${Date.now()}-${productIndex + 1}`,
  });

  const extractedData = packageDraftToExtractedData(conversion.pkg);
  const sectionMeta = sectionCacheTelemetry
    ? {
        section_cache_hit_count: sectionCacheTelemetry.hitCount,
        section_cache_reduced_chars: sectionCacheTelemetry.reducedChars,
        section_cache_reduce_ready: sectionCacheTelemetry.reduceReady,
        section_cache_replaced_labels: sectionCacheTelemetry.replacedLabels,
      }
    : {};
  extractedData._llm_meta = tokensUsed
    ? {
        provider: 'deepseek',
        tokens_input: tokensUsed.input,
        tokens_output: tokensUsed.output,
        retry_count: retryCount,
        ...sectionMeta,
      }
    : {
        provider: 'normalized-intake-cache',
        cache_hit: true,
        tokens_input: 0,
        tokens_output: 0,
        ...sectionMeta,
      };

  return {
    product: {
      extractedData,
      itineraryData: conversion.pkg.itinerary_data as unknown as TravelItinerary | null,
      sectionRawText: ir.rawText,
    },
    confidence: conversion.pkg.confidence,
    tokensUsed,
  };
}

/** 카탈로그 split 결과 → normalize 입력 chunk (parseDocument Map-Reduce 와 동일) */
export function buildCatalogChunkText(
  sharedPrefix: string,
  section: string,
): string {
  const chunk = (sharedPrefix ? `${sharedPrefix}\n\n---\n\n` : '') + section;
  return chunk.trim();
}

async function extractSingleChunk(
  chunkText: string,
  input: UploadIrExtractInput,
  engine: ReturnType<typeof pickCanaryEngine>,
  productIndex: number,
): Promise<
  | {
      product: MultiProductResult;
      confidence: number;
      tokensUsed?: { input: number; output: number };
    }
  | { error: string }
> {
  const cachedIr = await lookupNormalizedIntakeCache(input, chunkText);
  if (cachedIr) {
    return convertIrToUploadProduct(cachedIr, input, productIndex);
  }

  let norm: Awaited<ReturnType<typeof normalizeWithLlm>>;
  let sectionCacheHits: IntakeSectionCacheEntry[] = [];
  let sectionCacheTelemetry: SectionCacheTelemetry = {
    hitCount: 0,
    reducedChars: 0,
    reduceReady: false,
    replacedLabels: [],
  };
  try {
    const fingerprint = buildSupplierFormatFingerprint(chunkText);
    sectionCacheHits = await lookupReusableSectionCacheEntries(input, fingerprint);
    let normalizerRawText = chunkText;
    if (sectionCacheHits.length > 0) {
      const coverage = evaluateSectionCacheCoverage(sectionCacheHits);
      sectionCacheTelemetry = {
        ...sectionCacheTelemetry,
        hitCount: sectionCacheHits.length,
        reduceReady: coverage.canReduceLlmInput,
      };
      console.log(
        `[upload-ir-extract] section-cache hits=${sectionCacheHits.length} (${sectionCacheHits.map(hit => hit?.label).join(',')}) coverage=${coverage.covered}/${coverage.total} reduceReady=${coverage.canReduceLlmInput}`,
      );
      const reduction = buildSectionCacheReducedRawText(chunkText, sectionCacheHits);
      if (reduction) {
        normalizerRawText = reduction.reducedRawText;
        sectionCacheTelemetry = {
          ...sectionCacheTelemetry,
          reducedChars: reduction.reducedCharCount,
          replacedLabels: reduction.replacedLabels,
        };
        console.log(`[upload-ir-extract] section-cache reduced input chars=${reduction.reducedCharCount} labels=${reduction.replacedLabels.join(',')}`);
      }
    }
    norm = await withTimeout(
      normalizeWithLlm(
        {
          rawText: normalizerRawText,
          landOperator: input.landOperator,
          commissionRate: input.commissionRate,
          formatFingerprint: fingerprint.formatHash,
          sectionFingerprints: fingerprint.sections,
        },
        {
          engine,
          maxRetries: getUploadNormalizerMaxRetries(),
          model: process.env.RAW_UPLOAD_NORMALIZER_MODEL || 'deepseek-v4-flash',
        },
      ),
      getUploadNormalizerTimeoutMs(),
      `upload normalizer section ${productIndex + 1}`,
    );
  } catch (e) {
    return {
      error: `section ${productIndex + 1}: ${e instanceof Error ? e.message : 'normalize timeout'}`,
    };
  }

  if (!norm.success || !norm.ir) {
    return {
      error: `section ${productIndex + 1}: ${(norm.errors ?? ['normalize failed']).slice(0, 2).join('; ')}`,
    };
  }

  const cacheMergedIr = sectionCacheHits.length > 0
    ? applyIntakeSectionCacheEntries(norm.ir, sectionCacheHits)
    : norm.ir;
  const factRecoveredIr = applySupplierRawDeterministicFacts(cacheMergedIr, chunkText);
  const enrichedIr = mergeSourceEvidence(factRecoveredIr, chunkText);
  await storeNormalizedIntakeCacheWithBudget(input, enrichedIr);
  const converted = await convertIrToUploadProduct(
    enrichedIr,
    input,
    productIndex,
    norm.tokensUsed,
    norm.retryCount,
    sectionCacheTelemetry,
  );
  if ('product' in converted && converted.product.extractedData._llm_meta) {
    converted.product.extractedData._llm_meta.provider = engine === 'gemini' ? 'gemini' : 'deepseek';
  }
  return converted;
}

async function runWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;

  async function pump(): Promise<void> {
    while (next < items.length) {
      const idx = next++;
      results[idx] = await worker(items[idx], idx);
    }
  }

  const workers = Array.from(
    { length: Math.min(concurrency, items.length) },
    () => pump(),
  );
  await Promise.all(workers);
  return results;
}

/** IR 파이프 → upload 루프가 기대하는 MultiProductResult[] */
export async function tryExtractUploadViaIr(
  input: UploadIrExtractInput,
): Promise<UploadIrExtractResult> {
  const engine = pickCanaryEngine();
  const split = await splitCatalogSmart(input.rawText);
  const sectionCount = split.sections.length;

  if (sectionCount >= 2 && !isIrCanaryMultiEnabled()) {
    return { ok: false, errors: ['IR canary multi-product disabled (IR_CANARY_MULTI=0)'] };
  }

  const maxProducts = getIrCanaryMaxProducts();
  const sections =
    sectionCount > maxProducts ? split.sections.slice(0, maxProducts) : split.sections;

  if (sectionCount > maxProducts) {
    console.warn(
      `[upload-ir-extract] catalog sections=${sectionCount} capped at ${maxProducts}`,
    );
  }

  if (sections.length <= 1) {
    const chunkText = buildCatalogChunkText(split.sharedPrefix, sections[0] ?? input.rawText);
    const single = await extractSingleChunk(chunkText, input, engine, 0);
    if ('error' in single) {
      return { ok: false, errors: [single.error] };
    }
    return {
      ok: true,
      products: [single.product],
      confidence: single.confidence,
      engine,
      tokensUsed: single.tokensUsed,
      catalogSections: 1,
    };
  }

  const concurrency = getIrCanaryConcurrency();
  const chunks = sections.map(section =>
    buildCatalogChunkText(split.sharedPrefix, section),
  );

  console.log(
    `[upload-ir-extract] multi catalog sections=${sections.length} source=${split.source} concurrency=${concurrency}`,
  );

  const batchResults = await runWithConcurrency(
    chunks,
    concurrency,
    (chunkText, index) => extractSingleChunk(chunkText, input, engine, index),
  );

  const errors: string[] = [];
  const products: MultiProductResult[] = [];
  let confidence = 1;
  let tokensInput = 0;
  let tokensOutput = 0;

  for (const result of batchResults) {
    if ('error' in result) {
      errors.push(result.error);
      continue;
    }
    products.push(result.product);
    confidence = Math.min(confidence, result.confidence);
    if (result.tokensUsed) {
      tokensInput += result.tokensUsed.input;
      tokensOutput += result.tokensUsed.output;
    }
  }

  if (products.length !== sections.length) {
    return {
      ok: false,
      errors: [
        ...errors,
        `partial catalog convert: ${products.length}/${sections.length} sections`,
      ],
    };
  }

  return {
    ok: true,
    products,
    confidence,
    engine,
    tokensUsed: tokensInput || tokensOutput ? { input: tokensInput, output: tokensOutput } : undefined,
    catalogSections: sections.length,
  };
}
