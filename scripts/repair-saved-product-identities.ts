#!/usr/bin/env tsx

import { createHash } from 'node:crypto';
import process from 'node:process';
import dotenv from 'dotenv';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

import type { ExtractedData } from '@/lib/parser';
import { mapTravelPackageToLandingData } from '@/lib/map-travel-package-to-lp';
import { renderPackage, type RenderPackageInput } from '@/lib/render-contract';
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
  created_at: string | null;
  updated_at: string | null;
  internal_code: string | null;
  short_code: string | null;
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
  land_operator_id: string | null;
  departing_location_id: string | null;
  filename: string | null;
  file_type: string | null;
  raw_text: string | null;
  raw_text_hash: string | null;
  confidence: number | null;
};

type ProductRow = Record<string, unknown> & {
  internal_code?: string | null;
  supplier_code?: string | null;
  departure_region?: string | null;
  display_name?: string | null;
  status?: string | null;
  net_price?: number | null;
  margin_rate?: number | null;
};

type RepairResult = {
  id: string;
  title: string;
  oldCode: string | null;
  newCode: string | null;
  destination: string | null;
  destinationCode: string | null;
  status: 'candidate' | 'repaired' | 'skipped' | 'failed';
  safe: boolean;
  reasons: string[];
  priceRows: number;
  priceDates: number;
  itineraryDays: number;
};

const ACTIVE_STATUSES = new Set(['approved', 'active', 'published', 'selling', 'available']);
const ARCHIVED_STATUSES = new Set(['archived', 'inactive', 'INACTIVE', 'rejected', 'expired']);
const MANAGED_STATUSES = ['approved', 'active', 'pending', 'pending_review', 'draft', 'selling', 'available'];

function parseOptions(args: string[]): Options {
  const rawLimit = Number(args.find(arg => arg.startsWith('--limit='))?.split('=')[1] ?? 200);
  return {
    apply: args.includes('--apply'),
    json: args.includes('--json'),
    includeArchived: args.includes('--include-archived'),
    limit: Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, 2000) : 200,
  };
}

function asArray<T = unknown>(value: unknown): T[] {
  return Array.isArray(value) ? value as T[] : [];
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function hasIdentityIssue(pkg: PackageRow): boolean {
  const code = String(pkg.internal_code ?? pkg.short_code ?? '');
  return !pkg.destination?.trim() || pkg.destination === 'UNK' || /(?:^|-)UNK(?:-|$)/.test(code);
}

function parseInternalCode(code: string | null): {
  departureCode: string | null;
  supplierCode: string | null;
  destinationCode: string | null;
  durationDays: number | null;
} {
  const parts = String(code ?? '').split('-');
  if (parts.length < 5) {
    return { departureCode: null, supplierCode: null, destinationCode: null, durationDays: null };
  }
  const duration = Number(parts[3]?.replace(/\D/g, ''));
  return {
    departureCode: parts[0] || null,
    supplierCode: parts[1] || null,
    destinationCode: parts[2] || null,
    durationDays: Number.isFinite(duration) && duration > 0 ? duration : null,
  };
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

function renderFailure(pkg: Record<string, unknown>): string | null {
  try {
    const view = renderPackage(pkg as unknown as RenderPackageInput);
    const landing = mapTravelPackageToLandingData(pkg, null);
    if (!Array.isArray(view.days) || view.days.length === 0) return 'renderPackage.days=0';
    if (!landing.priceFrom || landing.priceFrom <= 0) return 'landing.priceFrom=0';
    if (!Array.isArray(landing.price_dates) || landing.price_dates.length === 0) return 'landing.price_dates=0';
    if (!Array.isArray(landing.itinerary?.days) || landing.itinerary.days.length === 0) return 'landing.itinerary.days=0';
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

async function issueInternalCode(input: {
  supabase: SupabaseClient;
  departureCode: string;
  supplierCode: string;
  destinationCode: string;
  durationDays: number;
}): Promise<string> {
  const { data, error } = await input.supabase.rpc('generate_internal_code', {
    p_departure_code: input.departureCode,
    p_supplier_code: input.supplierCode,
    p_destination_code: input.destinationCode,
    p_duration_days: input.durationDays,
  });
  if (error) throw new Error(`internal_code generation failed: ${error.message}`);
  if (!data || typeof data !== 'string') throw new Error('internal_code generation returned empty result');
  return data;
}

function buildProductUpsert(input: {
  oldProduct: ProductRow | null;
  pkg: PackageRow;
  newCode: string;
  supplierCode: string;
  departureRegion: string;
  netPrice: number;
  title: string;
  confidence: number;
  productStatus: string;
}): ProductRow {
  const now = new Date().toISOString();
  const { selling_price: _sellingPrice, ...copyableOldProduct } = input.oldProduct ?? {};
  return {
    ...copyableOldProduct,
    internal_code: input.newCode,
    display_name: input.title,
    departure_region: input.oldProduct?.departure_region ?? input.departureRegion,
    supplier_code: input.oldProduct?.supplier_code ?? input.supplierCode,
    net_price: input.netPrice,
    margin_rate: input.oldProduct?.margin_rate ?? 0.2,
    discount_amount: input.oldProduct?.discount_amount ?? 0,
    ai_tags: input.oldProduct?.ai_tags ?? [],
    status: input.productStatus,
    ai_confidence_score: Math.round(input.confidence * 100),
    land_operator_id: input.oldProduct?.land_operator_id ?? input.pkg.land_operator_id,
    departing_location_id: input.oldProduct?.departing_location_id ?? input.pkg.departing_location_id,
    source_filename: input.oldProduct?.source_filename ?? input.pkg.filename,
    raw_extracted_text: input.oldProduct?.raw_extracted_text ?? input.pkg.raw_text?.slice(0, 50000) ?? null,
    updated_at: now,
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
  const policy = await getRegistrationPolicy();

  let query = supabase
    .from('travel_packages')
    .select([
      'id',
      'title',
      'display_title',
      'status',
      'audit_status',
      'created_at',
      'updated_at',
      'internal_code',
      'short_code',
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
      'land_operator_id',
      'departing_location_id',
      'filename',
      'file_type',
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
    .filter(hasIdentityIssue)
    .filter(pkg => options.includeArchived || !ARCHIVED_STATUSES.has(String(pkg.status ?? '')))
    .slice(0, options.limit);

  const results: RepairResult[] = [];

  for (const pkg of packages) {
    const reasons: string[] = [];
    const rawText = String(pkg.raw_text ?? '').trim();
    const parsedCode = parseInternalCode(pkg.internal_code);

    if (rawText.length < 50) reasons.push('raw_text too short');
    if (!pkg.internal_code) reasons.push('internal_code missing');

    const destinationResolution = resolveUploadDestinationAndCodes({
      destination: pkg.destination,
      departureAirport: pkg.departure_airport,
      durationDays: pkg.duration ?? parsedCode.durationDays,
      productRawText: `${pkg.title}\n${rawText}`,
      documentRawText: rawText,
    });

    if (destinationResolution.failures.length > 0) reasons.push(...destinationResolution.failures);
    if (destinationResolution.destinationCode === 'UNK') reasons.push('new destination code still UNK');

    const supplierCode = parsedCode.supplierCode || 'ETC';
    let newCode: string | null = null;
    let priceRows = 0;
    let priceDates = 0;
    let itineraryDays = 0;

    try {
      if (reasons.length === 0) {
        newCode = await issueInternalCode({
          supabase,
          departureCode: destinationResolution.departureCode,
          supplierCode,
          destinationCode: destinationResolution.destinationCode,
          durationDays: destinationResolution.durationDays,
        });
        if (!newCode || /(?:^|-)UNK(?:-|$)/.test(newCode)) reasons.push('generated internal_code is unsafe');
        if (newCode === pkg.internal_code) reasons.push('generated internal_code equals old code');
      }

      let registration = null;
      let finalized = null;
      if (reasons.length === 0 && newCode) {
        registration = await registerProductFromRaw({
          rawText,
          documentRawText: rawText,
          extractedData: buildExtractedData(pkg, rawText),
          itineraryData: pkg.itinerary_data as never,
          title: pkg.title,
          activeAttractions: [],
          destinationResolution,
          destinationCode: destinationResolution.destinationCode,
          internalCode: newCode,
          enableGeminiFallback: false,
          priceYear: 2026,
          confidence: pkg.confidence,
        });
        priceRows = registration.pricing.productPrices.length;
        priceDates = registration.pricing.priceDates.length;
        itineraryDays = registration.itinerary.itineraryDataToSave?.days?.length ?? 0;

        const netPrice = registration.pricing.minPrice ?? registration.extractedData.price ?? pkg.price ?? 0;
        finalized = finalizeUploadRegistration({
          registration,
          rawText,
          title: registration.identity.title ?? pkg.title,
          netPrice,
          internalCode: newCode,
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
        if (itineraryDays === 0) reasons.push('reprocessed itinerary missing');

        const projectedPackage = {
          ...pkg,
          title: registration.identity.title ?? pkg.title,
          display_title: registration.identity.title ?? pkg.display_title ?? pkg.title,
          internal_code: newCode,
          destination: registration.identity.destination ?? destinationResolution.destination,
          duration: registration.identity.durationDays ?? pkg.duration,
          nights: registration.identity.durationDays != null ? Math.max(0, registration.identity.durationDays - 1) : pkg.nights,
          price: netPrice,
          price_dates: registration.pricing.priceDates,
          itinerary: registration.extractedData.itinerary ?? [],
          itinerary_data: registration.itinerary.itineraryDataToSave,
        } satisfies Record<string, unknown>;
        const projectedRenderFailure = renderFailure(projectedPackage);
        if (projectedRenderFailure) reasons.push(`projected render failed: ${projectedRenderFailure}`);
      }

      const safe = reasons.length === 0 && Boolean(newCode && registration && finalized);
      if (safe && options.apply && newCode && registration && finalized) {
        const { data: oldProductData, error: oldProductError } = await supabase
          .from('products')
          .select('*')
          .eq('internal_code', pkg.internal_code as string)
          .maybeSingle();
        if (oldProductError) throw new Error(oldProductError.message);

        const { data: existingNewProduct, error: existingNewProductError } = await supabase
          .from('products')
          .select('internal_code')
          .eq('internal_code', newCode)
          .maybeSingle();
        if (existingNewProductError) throw new Error(existingNewProductError.message);
        if (existingNewProduct) throw new Error(`new internal_code already exists: ${newCode}`);

        const netPrice = registration.pricing.minPrice ?? registration.extractedData.price ?? pkg.price ?? 0;
        const productUpsert = buildProductUpsert({
          oldProduct: oldProductData as ProductRow | null,
          pkg,
          newCode,
          supplierCode,
          departureRegion: destinationResolution.departureRegion,
          netPrice,
          title: registration.identity.title ?? pkg.title,
          confidence: finalized.confidenceV3,
          productStatus: ACTIVE_STATUSES.has(String(pkg.status ?? '')) ? 'active' : finalized.productStatus,
        });
        const { error: productUpsertError } = await supabase
          .from('products')
          .upsert(productUpsert, { onConflict: 'internal_code' });
        if (productUpsertError) throw new Error(productUpsertError.message);

        const rowsToInsert = registration.pricing.productPrices.map(row => ({
          ...row,
          product_id: newCode as string,
          adult_selling_price: row.adult_selling_price ?? row.net_price,
        }));
        await replaceProductPricesForProduct({
          supabase,
          productId: newCode,
          rows: rowsToInsert,
        });

        const now = new Date().toISOString();
        const packageUpdate = {
          title: registration.identity.title ?? pkg.title,
          display_title: registration.identity.title ?? pkg.display_title ?? pkg.title,
          internal_code: newCode,
          destination: registration.identity.destination ?? destinationResolution.destination,
          duration: registration.identity.durationDays ?? pkg.duration,
          nights: registration.identity.durationDays != null ? Math.max(0, registration.identity.durationDays - 1) : pkg.nights,
          airline: registration.identity.airline ?? pkg.airline,
          price: netPrice,
          price_dates: registration.pricing.priceDates,
          price_tiers: registration.extractedData.price_tiers ?? [],
          price_list: registration.extractedData.price_list ?? [],
          itinerary: registration.extractedData.itinerary ?? [],
          itinerary_data: registration.itinerary.itineraryDataToSave,
          inclusions: finalized.draftRow.inclusions ?? [],
          excludes: finalized.draftRow.excludes ?? [],
          accommodations: registration.extractedData.accommodations ?? [],
          optional_tours: registration.extractedData.optional_tours ?? [],
          notices_parsed: finalized.draftRow.notices_parsed ?? [],
          confidence: finalized.confidenceV3,
          audit_status: 'clean',
          audit_checked_at: now,
          audit_report: {
            source: 'saved-product-identity-repair',
            checked_at: now,
            old_internal_code: pkg.internal_code,
            new_internal_code: newCode,
            destination_source: destinationResolution.source,
            destination_code: destinationResolution.destinationCode,
            price_rows: priceRows,
            price_dates: priceDates,
            itinerary_days: itineraryDays,
            raw_text_hash: sha256(rawText),
          },
          parser_version: 'central-identity-repair',
          raw_text_hash: sha256(rawText),
          updated_at: now,
        };

        const { error: packageUpdateError } = await supabase
          .from('travel_packages')
          .update(packageUpdate)
          .eq('id', pkg.id);
        if (packageUpdateError) throw new Error(packageUpdateError.message);
      }

      results.push({
        id: pkg.id,
        title: pkg.title,
        oldCode: pkg.internal_code,
        newCode,
        destination: destinationResolution.destination,
        destinationCode: destinationResolution.destinationCode,
        status: safe ? (options.apply ? 'repaired' : 'candidate') : 'skipped',
        safe,
        reasons,
        priceRows,
        priceDates,
        itineraryDays,
      });
    } catch (error) {
      results.push({
        id: pkg.id,
        title: pkg.title,
        oldCode: pkg.internal_code,
        newCode,
        destination: destinationResolution.destination,
        destinationCode: destinationResolution.destinationCode,
        status: 'failed',
        safe: false,
        reasons: [error instanceof Error ? error.message : String(error)],
        priceRows,
        priceDates,
        itineraryDays,
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
      unresolvedDestination: results.filter(row => row.reasons.some(reason => reason.includes('destination_code:UNK'))).length,
      missingPrice: results.filter(row => row.reasons.some(reason => reason.includes('price'))).length,
      missingItinerary: results.filter(row => row.reasons.some(reason => reason.includes('itinerary'))).length,
    },
    results,
  };

  if (options.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(`Saved product identity repair (${report.mode})`);
    console.log(`- scanned: ${report.scanned}`);
    console.log(`- candidates: ${report.summary.candidates}`);
    console.log(`- repaired: ${report.summary.repaired}`);
    console.log(`- skipped: ${report.summary.skipped}`);
    console.log(`- failed: ${report.summary.failed}`);
    for (const row of results.slice(0, 30)) {
      const marker = row.safe ? 'OK' : 'SKIP';
      console.log(`- ${marker} ${row.oldCode ?? row.id} -> ${row.newCode ?? '-'} ${row.title}`);
      if (row.reasons.length > 0) console.log(`  ${row.reasons.slice(0, 3).join(' | ')}`);
    }
  }

  if (results.some(row => row.status === 'failed')) process.exitCode = 1;
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
