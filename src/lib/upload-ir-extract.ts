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
  const norm = await normalizeWithLlm(
    {
      rawText: chunkText,
      landOperator: input.landOperator,
      commissionRate: input.commissionRate,
    },
    { engine },
  );

  if (!norm.success || !norm.ir) {
    return {
      error: `section ${productIndex + 1}: ${(norm.errors ?? ['normalize failed']).slice(0, 2).join('; ')}`,
    };
  }

  const conversion = await convertIntakeToPackage(norm.ir, {
    sb: input.sb,
    status: 'pending',
    filename: input.filename
      ? `${input.filename}#${productIndex + 1}`
      : `ir-canary-${Date.now()}-${productIndex + 1}`,
  });

  const extractedData = packageDraftToExtractedData(conversion.pkg);
  if (norm.tokensUsed) {
    extractedData._llm_meta = {
      provider: engine === 'gemini' ? 'gemini' : 'deepseek',
      tokens_input: norm.tokensUsed.input,
      tokens_output: norm.tokensUsed.output,
      retry_count: norm.retryCount,
    };
  }

  return {
    product: {
      extractedData,
      itineraryData: conversion.pkg.itinerary_data as unknown as TravelItinerary | null,
      sectionRawText: chunkText,
    },
    confidence: conversion.pkg.confidence,
    tokensUsed: norm.tokensUsed,
  };
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
