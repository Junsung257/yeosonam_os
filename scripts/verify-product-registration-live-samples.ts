#!/usr/bin/env tsx

import { createHash } from 'node:crypto';
import process from 'node:process';
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';

import type { ExtractedData } from '@/lib/parser';
import { mapTravelPackageToLandingData } from '@/lib/map-travel-package-to-lp';
import { renderPackage } from '@/lib/render-contract';
import type { RenderPackageInput } from '@/lib/render-contract';
import { loadProductRegistrationLearningReport } from '@/lib/product-registration/learning-engine-report';
import { registerProductFromRaw } from '@/lib/product-registration/register-product-from-raw';
import { resolveUploadDestinationAndCodes } from '@/lib/product-registration/destination-resolution';
import type { ProductPriceRowInput } from '@/lib/upload-validator';

type CliOptions = {
  strict: boolean;
  json: boolean;
  limit: number;
  days: number;
  includeArchived: boolean;
  publicOnly: boolean;
};

type PackageRow = {
  id: string;
  title: string;
  status: string | null;
  created_at: string | null;
  internal_code: string | null;
  destination: string | null;
  duration: number | null;
  departure_airport: string | null;
  airline: string | null;
  accommodations: string[] | null;
  inclusions: string[] | null;
  excludes: string[] | null;
  optional_tours: unknown;
  notices_parsed: unknown;
  price_tiers: unknown;
  price_dates: unknown;
  itinerary: string[] | null;
  itinerary_data: unknown;
  min_participants: number | null;
  trip_style: string | null;
  raw_text: string | null;
  raw_text_hash: string | null;
  confidence: number | null;
};

type ProductPriceRow = {
  product_id: string | null;
  target_date: string | null;
  net_price: number | null;
  adult_selling_price: number | null;
  note: string | null;
};

const PUBLIC_STATUSES = new Set(['approved', 'active', 'published']);
const ARCHIVED_STATUSES = new Set(['archived', 'inactive']);

function readNumberArg(args: string[], name: string, fallback: number): number {
  const raw = args.find(arg => arg.startsWith(`${name}=`))?.split('=')[1];
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function parseOptions(args: string[]): CliOptions {
  return {
    strict: args.includes('--strict'),
    json: args.includes('--json'),
    limit: Math.min(readNumberArg(args, '--limit', 20), 100),
    days: Math.min(readNumberArg(args, '--days', 365), 3650),
    includeArchived: args.includes('--include-archived'),
    publicOnly: args.includes('--public-only'),
  };
}

function isPublicStatus(status: string | null): boolean {
  return PUBLIC_STATUSES.has(String(status ?? '').toLowerCase());
}

function isArchivedStatus(status: string | null): boolean {
  return ARCHIVED_STATUSES.has(String(status ?? '').toLowerCase());
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function asArray<T = unknown>(value: unknown): T[] {
  return Array.isArray(value) ? value as T[] : [];
}

function priceAlignment(input: {
  priceDates: Array<{ date?: unknown; price?: unknown }>;
  productPrices: Array<Pick<ProductPriceRowInput, 'target_date' | 'net_price'>>;
}): string | null {
  const priceDateByDate = new Map<string, number>();
  for (const row of input.priceDates) {
    const date = typeof row.date === 'string' ? row.date : null;
    const price = Number(row.price);
    if (date && Number.isFinite(price) && price > 0) priceDateByDate.set(date, price);
  }

  const pricesByDate = new Map<string, number[]>();
  for (const row of input.productPrices) {
    const date = typeof row.target_date === 'string' ? row.target_date : null;
    const price = Number(row.net_price);
    if (!date || !Number.isFinite(price) || price <= 0) continue;
    const prices = pricesByDate.get(date) ?? [];
    prices.push(price);
    pricesByDate.set(date, prices);
  }

  if (priceDateByDate.size === 0) {
    return pricesByDate.size > 0 ? 'price_dates missing all product_prices dates' : null;
  }
  for (const date of pricesByDate.keys()) {
    if (!priceDateByDate.has(date)) return `price_dates missing date ${date}`;
  }
  for (const [date, price] of priceDateByDate.entries()) {
    const prices = pricesByDate.get(date);
    if (!prices?.length) return `product_prices missing date ${date}`;
    const minPrice = Math.min(...prices);
    if (minPrice !== price) return `${date} product_prices min ${minPrice} != price_dates ${price}`;
  }
  return null;
}

function renderFailure(pkg: PackageRow): string | null {
  try {
    const renderInput = pkg as unknown as RenderPackageInput;
    const view = renderPackage(renderInput);
    const landing = mapTravelPackageToLandingData(renderInput as unknown as Record<string, unknown>, null);
    if (!Array.isArray(view.days) || view.days.length === 0) return 'renderPackage.days=0';
    if (!landing.priceFrom || landing.priceFrom <= 0) return 'landing.priceFrom=0';
    if (!Array.isArray(landing.price_dates) || landing.price_dates.length === 0) return 'landing.price_dates=0';
    if (!Array.isArray(landing.itinerary?.days) || landing.itinerary.days.length === 0) return 'landing.itinerary.days=0';
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

function buildExtractedData(pkg: PackageRow, rawText: string): ExtractedData {
  return {
    title: pkg.title,
    destination: pkg.destination ?? undefined,
    duration: pkg.duration ?? undefined,
    departure_airport: pkg.departure_airport ?? undefined,
    airline: pkg.airline ?? undefined,
    accommodations: pkg.accommodations ?? undefined,
    inclusions: pkg.inclusions ?? undefined,
    excludes: pkg.excludes ?? undefined,
    optional_tours: asArray(pkg.optional_tours),
    notices_parsed: asArray(pkg.notices_parsed),
    price_tiers: asArray(pkg.price_tiers),
    min_participants: pkg.min_participants ?? undefined,
    trip_style: pkg.trip_style ?? undefined,
    rawText,
  };
}

async function main(): Promise<void> {
  const options = parseOptions(process.argv.slice(2));
  dotenv.config({ path: '.env.local' });
  dotenv.config({ path: '.env' });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) throw new Error('Missing Supabase URL or service role key');

  const supabase = createClient(url, key, { auth: { persistSession: false } });
  const since = new Date(Date.now() - options.days * 24 * 60 * 60 * 1000).toISOString();

  const learningReport = await loadProductRegistrationLearningReport({
    supabase,
    isSupabaseConfigured: true,
    limit: 1000,
    fullRegressionVerified: true,
  });

  const { data: packages, error } = await supabase
    .from('travel_packages')
    .select('id,title,status,created_at,internal_code,destination,duration,departure_airport,airline,accommodations,inclusions,excludes,optional_tours,notices_parsed,price_tiers,price_dates,itinerary,itinerary_data,min_participants,trip_style,raw_text,raw_text_hash,confidence')
    .not('raw_text', 'is', null)
    .gte('created_at', since)
    .order('created_at', { ascending: false })
    .limit(options.limit * 3);

  if (error) throw new Error(error.message);

  const sampledPackages = ((packages ?? []) as PackageRow[])
    .filter(pkg => options.includeArchived || !isArchivedStatus(pkg.status))
    .filter(pkg => !options.publicOnly || isPublicStatus(pkg.status))
    .filter(pkg => typeof pkg.raw_text === 'string' && pkg.raw_text.trim().length >= 50)
    .slice(0, options.limit);

  const internalCodes = sampledPackages
    .map(pkg => pkg.internal_code)
    .filter((code): code is string => Boolean(code));
  const productPriceRowsByCode = new Map<string, ProductPriceRow[]>();

  if (internalCodes.length > 0) {
    const { data: priceRows, error: priceError } = await supabase
      .from('product_prices')
      .select('product_id,target_date,net_price,adult_selling_price,note')
      .in('product_id', internalCodes);
    if (priceError) throw new Error(priceError.message);
    for (const row of (priceRows ?? []) as ProductPriceRow[]) {
      if (!row.product_id) continue;
      const rows = productPriceRowsByCode.get(row.product_id) ?? [];
      rows.push(row);
      productPriceRowsByCode.set(row.product_id, rows);
    }
  }

  const sampleResults = [];
  for (const pkg of sampledPackages) {
    const rawText = pkg.raw_text ?? '';
    const rawTextHash = sha256(rawText);
    const destinationResolution = resolveUploadDestinationAndCodes({
      destination: pkg.destination,
      departureAirport: pkg.departure_airport,
      durationDays: pkg.duration,
      productRawText: rawText,
      documentRawText: rawText,
    });
    const registration = await registerProductFromRaw({
      rawText,
      documentRawText: rawText,
      extractedData: buildExtractedData(pkg, rawText),
      itineraryData: pkg.itinerary_data as never,
      title: pkg.title,
      activeAttractions: [],
      destinationResolution,
      destinationCode: destinationResolution.destinationCode,
      internalCode: pkg.internal_code,
      enableGeminiFallback: false,
      priceYear: 2026,
      confidence: pkg.confidence,
    });

    const persistedPriceRows = productPriceRowsByCode.get(pkg.internal_code ?? '') ?? [];
    const failures = [
      registration.evidence.rawTextHash !== rawTextHash ? 'raw_text_hash_mismatch' : null,
      registration.evidence.spans.length === 0 ? 'evidence_spans_missing' : null,
      registration.priceRecovery.priceRows.length === 0 ? 'reprocessed_price_rows_zero' : null,
      registration.priceRecovery.priceDates.length === 0 ? 'reprocessed_price_dates_zero' : null,
      registration.priceRecovery.ok ? null : `price_recovery:${registration.priceRecovery.failures.join('|')}`,
      registration.deliverability.ok ? null : `deliverability:${registration.deliverability.blockers.join('|')}`,
      priceAlignment({
        priceDates: registration.priceRecovery.priceDates,
        productPrices: registration.priceRecovery.priceRows,
      }),
      priceAlignment({
        priceDates: asArray(pkg.price_dates),
        productPrices: persistedPriceRows.map(row => ({
          target_date: row.target_date,
          net_price: row.net_price ?? 0,
        })),
      }),
      renderFailure(pkg),
    ].filter((item): item is string => Boolean(item));

    sampleResults.push({
      id: pkg.id,
      title: pkg.title,
      status: pkg.status,
      code: pkg.internal_code,
      rawTextHash,
      storedRawTextHashMatches: !pkg.raw_text_hash || pkg.raw_text_hash === rawTextHash,
      reprocessed: {
        priceRows: registration.priceRecovery.priceRows.length,
        priceDates: registration.priceRecovery.priceDates.length,
        evidenceSpans: registration.evidence.spans.length,
        deliverabilityOk: registration.deliverability.ok,
        publishable: registration.publishable,
      },
      persisted: {
        priceDates: asArray(pkg.price_dates).length,
        productPrices: persistedPriceRows.length,
      },
      failures,
      ok: failures.length === 0,
    });
  }

  const failedSamples = sampleResults.filter(result => !result.ok);
  const unsafePromotionItems = learningReport.promotion.workItems.filter(item =>
    item.evidenceRawTextHashes.length < 3,
  );
  const theoryFailures = [
    learningReport.safety.readOnly ? null : 'learning_report_not_read_only',
    learningReport.safety.productionMutation ? 'learning_report_allows_production_mutation' : null,
    learningReport.safety.rawTextStored ? 'learning_report_stores_raw_text' : null,
    unsafePromotionItems.length > 0 ? `promotion_items_without_3_independent_sources:${unsafePromotionItems.length}` : null,
  ].filter((item): item is string => Boolean(item));

  const summary = {
    sampled: sampleResults.length,
    passed: sampleResults.length - failedSamples.length,
    failed: failedSamples.length,
    learningEvents: learningReport.micro.eventsPersisted,
    macroCandidates: learningReport.macro.candidates.length,
    promotionWorkItems: learningReport.promotion.workItems.length,
    score: learningReport.score,
    safety: learningReport.safety,
    theoryFailures,
    direction: theoryFailures.length === 0 && failedSamples.length === 0
      ? 'aligned'
      : 'needs_review',
  };

  const report = {
    summary,
    learning: {
      micro: learningReport.micro,
      macro: {
        shouldRun: learningReport.macro.shouldRun,
        runReasons: learningReport.macro.runReasons,
        topCandidates: learningReport.macro.candidates.slice(0, 10),
      },
      promotionWorkItems: learningReport.promotion.workItems.slice(0, 10),
      nextAction: learningReport.nextAction,
    },
    samples: sampleResults,
    failedSamples,
  };

  if (options.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log('Product registration live sample learning verification');
    console.log(`- samples: ${summary.passed}/${summary.sampled} passed`);
    console.log(`- learning events: ${summary.learningEvents}`);
    console.log(`- macro candidates: ${summary.macroCandidates}`);
    console.log(`- promotion work items: ${summary.promotionWorkItems}`);
    console.log(`- score: micro ${summary.score.micro}, macro ${summary.score.macro}, combined ${summary.score.combined}`);
    console.log(`- direction: ${summary.direction}`);
    if (summary.theoryFailures.length > 0) console.log(`- theory failures: ${summary.theoryFailures.join(', ')}`);
    if (failedSamples.length > 0) {
      console.log('');
      console.log('Failed samples');
      for (const sample of failedSamples) {
        console.log(`- ${sample.code ?? sample.id} ${sample.title}: ${sample.failures.join('; ')}`);
      }
    }
  }

  await supabase.removeAllChannels();

  if (options.strict && (failedSamples.length > 0 || theoryFailures.length > 0)) {
    process.exit(1);
  }
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
