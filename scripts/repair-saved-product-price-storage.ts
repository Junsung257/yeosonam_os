#!/usr/bin/env tsx

import { createHash } from 'node:crypto';
import process from 'node:process';
import dotenv from 'dotenv';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

import type { ExtractedData } from '@/lib/parser';
import { finalizeUploadRegistration } from '@/lib/product-registration/finalize-registration';
import { getRegistrationPolicy } from '@/lib/registration-policy';
import { registerProductFromRaw } from '@/lib/product-registration/register-product-from-raw';
import { replaceProductPricesForProduct } from '@/lib/product-registration/product-price-replacement';
import { resolveUploadDestinationAndCodes } from '@/lib/product-registration/destination-resolution';

type Options = {
  apply: boolean;
  json: boolean;
  includeArchived: boolean;
  limit: number;
};

type PackageRow = {
  id: string;
  title: string;
  display_title: string | null;
  status: string | null;
  audit_status: string | null;
  internal_code: string | null;
  destination: string | null;
  duration: number | null;
  nights: number | null;
  departure_airport: string | null;
  departure_days: string | null;
  airline: string | null;
  accommodations: string[] | null;
  inclusions: string[] | null;
  excludes: string[] | null;
  optional_tours: unknown;
  notices_parsed: unknown;
  cancellation_policy: unknown;
  category_attrs: Record<string, unknown> | null;
  price: number | null;
  price_tiers: unknown;
  price_dates: unknown;
  price_list: unknown;
  itinerary: string[] | null;
  itinerary_data: unknown;
  min_participants: number | null;
  trip_style: string | null;
  category: ExtractedData['category'] | null;
  product_type: string | null;
  guide_tip: string | null;
  single_supplement: string | null;
  small_group_surcharge: string | null;
  surcharges: unknown;
  normalized_surcharges: unknown;
  excluded_dates: string[] | null;
  product_tags: string[] | null;
  product_highlights: string[] | null;
  product_summary: string | null;
  ticketing_deadline: string | null;
  land_operator: string | null;
  raw_text: string | null;
  raw_text_hash: string | null;
  confidence: number | null;
};

type ProductPriceRow = {
  product_id: string | null;
  target_date: string | null;
  net_price: number | null;
};

type ProductPriceComparable = {
  target_date: string | null;
  net_price: number | null;
};

type RepairResult = {
  id: string;
  code: string | null;
  title: string;
  status: 'candidate' | 'repaired' | 'skipped' | 'failed';
  safe: boolean;
  before: string | null;
  reasons: string[];
  priceRows: number;
  priceDates: number;
};

const MANAGED_STATUSES = ['approved', 'active', 'pending', 'pending_review', 'draft', 'selling', 'available'];
const ARCHIVED_STATUSES = new Set(['archived', 'inactive', 'INACTIVE', 'rejected', 'expired']);

function parseOptions(args: string[]): Options {
  const rawLimit = Number(args.find(arg => arg.startsWith('--limit='))?.split('=')[1] ?? 100);
  return {
    apply: args.includes('--apply'),
    json: args.includes('--json'),
    includeArchived: args.includes('--include-archived'),
    limit: Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, 2000) : 100,
  };
}

function asArray<T = unknown>(value: unknown): T[] {
  return Array.isArray(value) ? value as T[] : [];
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function hasUnsafeInternalCode(code: string | null): boolean {
  return !code || /(?:^|-)UNK(?:-|$)/.test(code);
}

function priceDateRows(value: unknown): Array<{ date: string; price: number }> {
  return asArray<{ date?: unknown; price?: unknown }>(value)
    .map(row => ({
      date: typeof row.date === 'string' ? row.date : '',
      price: Number(row.price),
    }))
    .filter(row => row.date && Number.isFinite(row.price) && row.price > 0);
}

function priceStorageMismatch(
  priceDates: Array<{ date: string; price: number }>,
  productPrices: ProductPriceComparable[],
): string | null {
  const priceDateByDate = new Map(priceDates.map(row => [row.date, row.price]));
  const pricesByDate = new Map<string, number[]>();
  for (const row of productPrices) {
    const date = typeof row.target_date === 'string' ? row.target_date : '';
    const price = Number(row.net_price);
    if (!date || !Number.isFinite(price) || price <= 0) continue;
    const prices = pricesByDate.get(date) ?? [];
    prices.push(price);
    pricesByDate.set(date, prices);
  }
  if (priceDateByDate.size === 0) {
    return pricesByDate.size > 0
      ? 'price_dates missing all product_prices dates'
      : 'price_dates and product_prices missing';
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

function buildExtractedData(pkg: PackageRow, rawText: string): ExtractedData {
  return {
    title: pkg.display_title?.trim() || pkg.title,
    category: pkg.category ?? 'package',
    product_type: pkg.product_type ?? undefined,
    trip_style: pkg.trip_style ?? undefined,
    destination: pkg.destination ?? undefined,
    duration: pkg.duration ?? undefined,
    nights: pkg.nights ?? undefined,
    departure_days: pkg.departure_days ?? undefined,
    departure_airport: pkg.departure_airport ?? undefined,
    airline: pkg.airline ?? undefined,
    min_participants: pkg.min_participants ?? undefined,
    ticketing_deadline: pkg.ticketing_deadline ?? undefined,
    price: pkg.price ?? undefined,
    price_tiers: asArray(pkg.price_tiers),
    price_list: asArray(pkg.price_list),
    guide_tip: pkg.guide_tip ?? undefined,
    single_supplement: pkg.single_supplement ?? undefined,
    small_group_surcharge: pkg.small_group_surcharge ?? undefined,
    surcharges: asArray(pkg.surcharges),
    normalized_surcharges: asArray(pkg.normalized_surcharges),
    excluded_dates: pkg.excluded_dates ?? [],
    inclusions: pkg.inclusions ?? [],
    excludes: pkg.excludes ?? [],
    optional_tours: asArray(pkg.optional_tours),
    itinerary: pkg.itinerary ?? [],
    accommodations: pkg.accommodations ?? [],
    notices_parsed: asArray(pkg.notices_parsed),
    cancellation_policy: asArray(pkg.cancellation_policy),
    category_attrs: pkg.category_attrs ?? {},
    land_operator: pkg.land_operator ?? undefined,
    product_tags: pkg.product_tags ?? [],
    product_highlights: pkg.product_highlights ?? [],
    product_summary: pkg.product_summary ?? undefined,
    rawText,
  };
}

async function loadProductPriceRowsByCode(
  supabase: SupabaseClient,
  codes: string[],
): Promise<Map<string, ProductPriceRow[]>> {
  const priceRowsByCode = new Map<string, ProductPriceRow[]>();
  for (const code of codes) {
    for (let from = 0; ; from += 1000) {
      const { data, error } = await supabase
        .from('product_prices')
        .select('product_id,target_date,net_price')
        .eq('product_id', code)
        .range(from, from + 999);
      if (error) throw new Error(error.message);
      const page = (data ?? []) as ProductPriceRow[];
      const rows = priceRowsByCode.get(code) ?? [];
      rows.push(...page);
      priceRowsByCode.set(code, rows);
      if (page.length < 1000) break;
    }
  }
  return priceRowsByCode;
}

async function main(): Promise<void> {
  const options = parseOptions(process.argv.slice(2));
  dotenv.config({ path: '.env.local' });
  dotenv.config({ path: '.env' });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) throw new Error('Missing Supabase URL or service role key');

  const supabase = createClient(url, key, { auth: { persistSession: false } });
  const policy = await getRegistrationPolicy();

  let query = supabase
    .from('travel_packages')
    .select([
      'id',
      'title',
      'display_title',
      'status',
      'audit_status',
      'internal_code',
      'destination',
      'duration',
      'nights',
      'departure_airport',
      'departure_days',
      'airline',
      'accommodations',
      'inclusions',
      'excludes',
      'optional_tours',
      'notices_parsed',
      'cancellation_policy',
      'category_attrs',
      'price',
      'price_tiers',
      'price_dates',
      'price_list',
      'itinerary',
      'itinerary_data',
      'min_participants',
      'trip_style',
      'category',
      'product_type',
      'guide_tip',
      'single_supplement',
      'small_group_surcharge',
      'surcharges',
      'normalized_surcharges',
      'excluded_dates',
      'product_tags',
      'product_highlights',
      'product_summary',
      'ticketing_deadline',
      'land_operator',
      'raw_text',
      'raw_text_hash',
      'confidence',
    ].join(','))
    .not('raw_text', 'is', null)
    .order('created_at', { ascending: false })
    .limit(options.limit * 3);
  if (!options.includeArchived) query = query.in('status', MANAGED_STATUSES);

  const { data, error } = await query;
  if (error) throw new Error(error.message);

  const packages = ((data ?? []) as unknown as PackageRow[])
    .filter(pkg => !hasUnsafeInternalCode(pkg.internal_code))
    .filter(pkg => options.includeArchived || !ARCHIVED_STATUSES.has(String(pkg.status ?? '')))
    .slice(0, options.limit);
  const codes = packages.map(pkg => pkg.internal_code).filter((code): code is string => Boolean(code));

  const priceRowsByCode = await loadProductPriceRowsByCode(supabase, codes);

  const results: RepairResult[] = [];
  for (const pkg of packages) {
    const rawText = String(pkg.raw_text ?? '').trim();
    const existingPriceDates = priceDateRows(pkg.price_dates);
    const existingProductPrices = priceRowsByCode.get(pkg.internal_code as string) ?? [];
    const before = priceStorageMismatch(existingPriceDates, existingProductPrices);
    const reasons: string[] = [];
    let priceRows = 0;
    let priceDates = 0;

    if (!before) {
      results.push({
        id: pkg.id,
        code: pkg.internal_code,
        title: pkg.title,
        status: 'skipped',
        safe: false,
        before,
        reasons: ['price storage already aligned'],
        priceRows,
        priceDates,
      });
      continue;
    }
    if (rawText.length < 50) reasons.push('raw_text too short');

    try {
      const destinationResolution = resolveUploadDestinationAndCodes({
        destination: pkg.destination,
        departureAirport: pkg.departure_airport,
        durationDays: pkg.duration,
        productRawText: `${pkg.title}\n${rawText}`,
        documentRawText: rawText,
      });
      if (destinationResolution.failures.length > 0) reasons.push(...destinationResolution.failures);

      let registration = null;
      let finalized = null;
      if (reasons.length === 0) {
        registration = await registerProductFromRaw({
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
        priceRows = registration.pricing.productPrices.length;
        priceDates = registration.pricing.priceDates.length;
        const netPrice = registration.pricing.minPrice ?? registration.extractedData.price ?? pkg.price ?? 0;
        finalized = finalizeUploadRegistration({
          registration,
          rawText,
          title: registration.identity.title ?? pkg.title,
          netPrice,
          internalCode: pkg.internal_code,
          policy,
          priceRows: registration.pricing.productPrices,
          itineraryInput: registration.itinerary.itineraryInput,
          itineraryDataToSave: registration.itinerary.itineraryDataToSave,
          scheduleItemCount: registration.itinerary.scheduleItemCount,
        });
        if (!registration.deliverability.ok) reasons.push(...registration.deliverability.blockers);
        if (finalized.uploadGate === 'BLOCKED') reasons.push(...finalized.validation.errors);
        if (priceRows === 0) reasons.push('reprocessed product_prices missing');
        if (priceDates === 0) reasons.push('reprocessed price_dates missing');
        const after = priceStorageMismatch(registration.pricing.priceDates, registration.pricing.productPrices);
        if (after) reasons.push(`reprocessed price storage mismatch: ${after}`);
      }

      const safe = reasons.length === 0 && Boolean(registration && finalized);
      if (safe && options.apply && registration && finalized) {
        const rowsToInsert = registration.pricing.productPrices.map(row => ({
          ...row,
          product_id: pkg.internal_code as string,
          adult_selling_price: row.adult_selling_price ?? row.net_price,
        }));
        await replaceProductPricesForProduct({
          supabase,
          productId: pkg.internal_code as string,
          rows: rowsToInsert,
        });

        const netPrice = registration.pricing.minPrice ?? registration.extractedData.price ?? pkg.price ?? 0;
        const now = new Date().toISOString();
        const { error: packageUpdateError } = await supabase
          .from('travel_packages')
          .update({
            price: netPrice,
            price_dates: registration.pricing.priceDates,
            price_tiers: registration.extractedData.price_tiers ?? [],
            price_list: registration.extractedData.price_list ?? [],
            confidence: finalized.confidenceV3,
            audit_checked_at: now,
            audit_report: {
              source: 'saved-product-price-storage-repair',
              checked_at: now,
              before,
              product_prices: priceRows,
              price_dates: priceDates,
              raw_text_hash: sha256(rawText),
            },
            raw_text_hash: sha256(rawText),
            updated_at: now,
          })
          .eq('id', pkg.id);
        if (packageUpdateError) throw new Error(packageUpdateError.message);

        const { error: productUpdateError } = await supabase
          .from('products')
          .update({
            net_price: netPrice,
            ai_confidence_score: Math.round(finalized.confidenceV3 * 100),
            updated_at: now,
          })
          .eq('internal_code', pkg.internal_code as string);
        if (productUpdateError) throw new Error(productUpdateError.message);
      }

      results.push({
        id: pkg.id,
        code: pkg.internal_code,
        title: pkg.title,
        status: safe ? (options.apply ? 'repaired' : 'candidate') : 'skipped',
        safe,
        before,
        reasons,
        priceRows,
        priceDates,
      });
    } catch (error) {
      results.push({
        id: pkg.id,
        code: pkg.internal_code,
        title: pkg.title,
        status: 'failed',
        safe: false,
        before,
        reasons: [error instanceof Error ? error.message : String(error)],
        priceRows,
        priceDates,
      });
    }
  }

  const report = {
    mode: options.apply ? 'apply' : 'dry-run',
    scanned: packages.length,
    summary: {
      candidates: results.filter(row => row.status === 'candidate').length,
      repaired: results.filter(row => row.status === 'repaired').length,
      skipped: results.filter(row => row.status === 'skipped').length,
      failed: results.filter(row => row.status === 'failed').length,
      missingPrice: results.filter(row => row.reasons.some(reason => reason.includes('price'))).length,
      deliverabilityBlocked: results.filter(row => row.reasons.some(reason => reason.includes('source audit') || reason.includes('deliverability'))).length,
    },
    results,
  };

  if (options.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(`Saved product price storage repair (${report.mode})`);
    console.log(`- scanned: ${report.scanned}`);
    console.log(`- candidates: ${report.summary.candidates}`);
    console.log(`- repaired: ${report.summary.repaired}`);
    console.log(`- skipped: ${report.summary.skipped}`);
    console.log(`- failed: ${report.summary.failed}`);
    for (const row of results.filter(result => result.safe || result.status === 'failed').slice(0, 30)) {
      console.log(`- ${row.status.toUpperCase()} ${row.code ?? row.id} ${row.title} (${row.priceRows}/${row.priceDates})`);
      if (row.reasons.length > 0) console.log(`  ${row.reasons.slice(0, 3).join(' | ')}`);
    }
  }

  if (results.some(row => row.status === 'failed')) process.exitCode = 1;
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
