/**
 * POST /api/packages/reextract
 * body: { packageId: string }
 *
 * Reprocesses a saved package from immutable raw_text through the central
 * product-registration engine. This path is for admin repair/review only; it
 * must not promote a pending package to customer-visible status automatically.
 */

import { createHash } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';

import { withAdminGuard } from '@/lib/admin-guard';
import type { ExtractedData } from '@/lib/parser';
import { getRegistrationPolicy } from '@/lib/registration-policy';
import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';
import { finalizeUploadRegistration } from '@/lib/product-registration/finalize-registration';
import { loadUploadRegistrationContext } from '@/lib/product-registration/upload-context-loader';
import { persistImprovementLedgerEvents } from '@/lib/product-registration/improvement-ledger-persistence';
import { registerProductFromRaw } from '@/lib/product-registration/register-product-from-raw';
import { runMicroAutoQA } from '@/lib/product-registration/auto-qa';
import type { ItineraryDataLike } from '@/lib/product-registration/itinerary-normalization';

const PUBLIC_PACKAGE_STATUSES = new Set(['approved', 'active', 'published']);

type PackageReextractRow = {
  id: string;
  title: string;
  display_title: string | null;
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
  surcharges: unknown;
  normalized_surcharges: unknown;
  itinerary: string[] | null;
  itinerary_data: ItineraryDataLike | null;
  price: number | null;
  raw_text: string | null;
  internal_code: string | null;
  status: string | null;
  audit_status: string | null;
  filename: string | null;
  file_type: string | null;
  land_operator: string | null;
  land_operator_id: string | null;
  category: ExtractedData['category'] | null;
  product_type: string | null;
  trip_style: string | null;
  guide_tip: string | null;
  single_supplement: string | null;
  small_group_surcharge: string | null;
  excluded_dates: string[] | null;
  cancellation_policy: unknown;
  category_attrs: Record<string, unknown> | null;
  product_tags: string[] | null;
  product_highlights: string[] | null;
  product_summary: string | null;
  min_participants: number | null;
  ticketing_deadline: string | null;
};

function isPublicPackageStatus(status: string | null | undefined): boolean {
  return PUBLIC_PACKAGE_STATUSES.has(String(status ?? '').toLowerCase());
}

function toArray<T>(value: T[] | null | undefined): T[] {
  return Array.isArray(value) ? value : [];
}

function jsonArray<T = unknown>(value: unknown): T[] {
  return Array.isArray(value) ? value as T[] : [];
}

function buildExtractedData(pkg: PackageReextractRow, rawText: string): ExtractedData {
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
    price_tiers: [],
    price_list: [],
    guide_tip: pkg.guide_tip ?? undefined,
    single_supplement: pkg.single_supplement ?? undefined,
    small_group_surcharge: pkg.small_group_surcharge ?? undefined,
    surcharges: jsonArray(pkg.surcharges),
    normalized_surcharges: jsonArray(pkg.normalized_surcharges),
    excluded_dates: toArray(pkg.excluded_dates),
    inclusions: toArray(pkg.inclusions),
    excludes: toArray(pkg.excludes),
    optional_tours: jsonArray(pkg.optional_tours),
    itinerary: toArray(pkg.itinerary),
    accommodations: toArray(pkg.accommodations),
    notices_parsed: jsonArray(pkg.notices_parsed),
    cancellation_policy: jsonArray(pkg.cancellation_policy),
    category_attrs: pkg.category_attrs ?? {},
    land_operator: pkg.land_operator ?? undefined,
    product_tags: toArray(pkg.product_tags),
    product_highlights: toArray(pkg.product_highlights),
    product_summary: pkg.product_summary ?? undefined,
    rawText,
  };
}

function nextPackageStatus(input: {
  currentStatus: string | null;
  finalizedStatus: 'approved' | 'pending';
}): string {
  if (input.finalizedStatus === 'pending') return 'pending';
  if (isPublicPackageStatus(input.currentStatus)) return 'approved';
  return input.currentStatus || 'pending';
}

const postHandler = async (request: NextRequest) => {
  if (!isSupabaseConfigured) {
    return NextResponse.json({ error: 'Supabase is not configured.' }, { status: 500 });
  }

  const { packageId } = await request.json() as { packageId?: string };
  if (!packageId) {
    return NextResponse.json({ error: 'packageId is required.' }, { status: 400 });
  }

  const { data: pkgData, error: fetchError } = await supabaseAdmin
    .from('travel_packages')
    .select([
      'id',
      'title',
      'display_title',
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
      'surcharges',
      'normalized_surcharges',
      'itinerary',
      'itinerary_data',
      'price',
      'raw_text',
      'internal_code',
      'status',
      'audit_status',
      'filename',
      'file_type',
      'land_operator',
      'land_operator_id',
      'category',
      'product_type',
      'trip_style',
      'guide_tip',
      'single_supplement',
      'small_group_surcharge',
      'excluded_dates',
      'cancellation_policy',
      'category_attrs',
      'product_tags',
      'product_highlights',
      'product_summary',
      'min_participants',
      'ticketing_deadline',
    ].join(', '))
    .eq('id', packageId)
    .maybeSingle();

  if (fetchError || !pkgData) {
    return NextResponse.json({ error: fetchError?.message ?? 'Package not found.' }, { status: 404 });
  }

  const pkg = pkgData as unknown as PackageReextractRow;
  const rawText = String(pkg.raw_text ?? '').trim();
  if (rawText.length < 50) {
    return NextResponse.json({ error: 'Saved raw_text is missing or too short for central reprocessing.' }, { status: 400 });
  }
  if (!pkg.internal_code) {
    return NextResponse.json({ error: 'internal_code is required to refresh product_prices.' }, { status: 400 });
  }

  const [{ activeAttractions }, policy] = await Promise.all([
    loadUploadRegistrationContext({
      supabase: supabaseAdmin,
      isSupabaseConfigured,
      bulkMode: false,
    }),
    getRegistrationPolicy(),
  ]);

  const registration = await registerProductFromRaw({
    rawText,
    documentRawText: rawText,
    extractedData: buildExtractedData(pkg, rawText),
    itineraryData: pkg.itinerary_data ?? null,
    title: pkg.title,
    activeAttractions,
    supplierHint: pkg.land_operator,
    internalCode: pkg.internal_code,
    enableGeminiFallback: true,
  });

  const priceRows = registration.pricing.productPrices;
  const priceDates = registration.pricing.priceDates;
  const netPrice = registration.pricing.minPrice ?? registration.extractedData.price ?? pkg.price ?? 0;
  const finalized = finalizeUploadRegistration({
    registration,
    rawText,
    title: registration.identity.title ?? pkg.display_title ?? pkg.title,
    netPrice,
    internalCode: pkg.internal_code,
    policy,
    priceRows,
    itineraryInput: registration.itinerary.itineraryInput,
    itineraryDataToSave: registration.itinerary.itineraryDataToSave,
    scheduleItemCount: registration.itinerary.scheduleItemCount,
  });

  if (!registration.deliverability.ok || finalized.uploadGate === 'BLOCKED') {
    const blockers = [
      ...registration.deliverability.blockers,
      ...finalized.validation.errors,
      ...finalized.failedChecks.map(check => check.message),
    ];
    return NextResponse.json({
      ok: false,
      status: 'blocked',
      blockers: [...new Set(blockers)],
      title: registration.identity.title,
      priceRows: priceRows.length,
      priceDates: priceDates.length,
    }, { status: 422 });
  }

  const refreshedPackageStatus = nextPackageStatus({
    currentStatus: pkg.status,
    finalizedStatus: finalized.pkgStatus,
  });
  const refreshedAuditStatus = refreshedPackageStatus === 'pending'
    ? 'blocked'
    : pkg.audit_status;

  const packageUpdate = {
    title: registration.identity.title ?? pkg.title,
    display_title: registration.identity.title ?? pkg.display_title ?? pkg.title,
    destination: registration.identity.destination ?? pkg.destination,
    duration: registration.identity.durationDays ?? pkg.duration,
    nights: registration.identity.durationDays != null
      ? Math.max(0, registration.identity.durationDays - 1)
      : pkg.nights,
    airline: registration.identity.airline ?? pkg.airline,
    price: netPrice,
    price_dates: priceDates,
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
    status: refreshedPackageStatus,
    audit_status: refreshedAuditStatus,
    parser_version: 'central-reextract',
    raw_text_hash: createHash('sha256').update(rawText).digest('hex'),
    updated_at: new Date().toISOString(),
  };

  const productUpdate = {
    display_name: registration.identity.title ?? pkg.title,
    net_price: netPrice,
    ai_confidence_score: Math.round(finalized.confidenceV3 * 100),
    status: finalized.productStatus,
    flight_info: registration.extractedData.flight_info ?? null,
    updated_at: new Date().toISOString(),
  };

  const priceRowsToInsert = priceRows.map(row => ({
    ...row,
    adult_selling_price: row.adult_selling_price ?? row.net_price,
    product_id: pkg.internal_code as string,
  }));

  const { error: priceDeleteError } = await supabaseAdmin
    .from('product_prices')
    .delete()
    .eq('product_id', pkg.internal_code);
  if (priceDeleteError) {
    return NextResponse.json({ error: `product_prices delete failed: ${priceDeleteError.message}` }, { status: 500 });
  }

  if (priceRowsToInsert.length > 0) {
    const { error: priceInsertError } = await supabaseAdmin
      .from('product_prices')
      .insert(priceRowsToInsert);
    if (priceInsertError) {
      return NextResponse.json({ error: `product_prices insert failed: ${priceInsertError.message}` }, { status: 500 });
    }
  }

  const { error: packageUpdateError } = await supabaseAdmin
    .from('travel_packages')
    .update(packageUpdate)
    .eq('id', pkg.id);
  if (packageUpdateError) {
    return NextResponse.json({ error: packageUpdateError.message }, { status: 500 });
  }

  const { error: productUpdateError } = await supabaseAdmin
    .from('products')
    .update(productUpdate)
    .eq('internal_code', pkg.internal_code);
  if (productUpdateError) {
    return NextResponse.json({ error: productUpdateError.message }, { status: 500 });
  }

  const autoQA = runMicroAutoQA({
    uploadId: `reextract:${pkg.id}`,
    productId: pkg.internal_code,
    packageId: pkg.id,
    rawText,
    sectionRawText: rawText,
    registration,
    trustScore: finalized.confidenceV3 * 100,
  });
  const ledgerResult = await persistImprovementLedgerEvents({
    supabase: supabaseAdmin,
    isSupabaseConfigured,
    events: autoQA.attempts,
  });

  return NextResponse.json({
    ok: true,
    packageId: pkg.id,
    internalCode: pkg.internal_code,
    title: registration.identity.title,
    status: refreshedPackageStatus,
    auditStatus: refreshedAuditStatus,
    priceRows: priceRowsToInsert.length,
    priceDates: priceDates.length,
    itineraryDays: registration.itinerary.itineraryDataToSave?.days?.length ?? 0,
    removedPollutedScheduleItems: registration.itinerary.removedPollutedScheduleItems.length,
    deliverability: registration.deliverability,
    v3DraftStatus: registration.evidence.v3DraftStatus,
    learningEngine: {
      captured: autoQA.attempts.length,
      persisted: ledgerResult.saved,
      error: ledgerResult.error,
    },
  });
};

export const POST = withAdminGuard(postHandler);
