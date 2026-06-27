import { normalizeOptionalTours } from '@/lib/package-acl';
import type { ProductPriceRowInput } from '@/lib/upload-validator';
import type { FinalizeUploadRegistrationResult } from './finalize-registration';
import { buildCustomerSourceRawText } from './source-evidence-raw-text';
import type { ProductRegistrationResult } from './types';

export type UploadPersistenceRowsInput = {
  registration: ProductRegistrationResult;
  finalized: FinalizeUploadRegistrationResult;
  title: string;
  internalCode: string | null;
  departureRegion: string;
  supplierCode: string;
  netPrice: number;
  marginRate: number;
  sourceFilename: string;
  landOperatorId: string | null;
  landOperatorName?: string | null;
  filenameSupplierRaw?: string | null;
  departingLocationId: string | null;
  fileType: string | null;
  productRawText: string;
  documentRawText: string;
  priceRows: ProductPriceRowInput[];
  priceDates: unknown[];
  marketingCopies: unknown[];
  catalogGroupId: string | null;
  filenameMarginRate?: number | null;
};

export type UploadPersistenceRows = {
  productRow: Record<string, unknown> | null;
  productPriceRows: Array<ProductPriceRowInput & { product_id: string }>;
  travelPackageRow: Record<string, unknown>;
};

function maskSensitiveRawText(rawText: string, landOperatorName?: string | null): string {
  let masked = rawText;
  if (landOperatorName) {
    masked = masked.replace(new RegExp(landOperatorName, 'g'), '[LAND_OPERATOR]');
  }
  masked = masked
    .replace(/\b\d{2,3}-\d{3,4}-\d{4}\b/g, '[PHONE]')
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[EMAIL]')
    .replace(/\b\d{2,6}-\d{2,6}-\d{2,8}\b/g, '[ACCOUNT]');
  return masked;
}

function parseTripStyleNights(value: unknown): number | null {
  const match = String(value ?? '').match(/([1-9]\d*)\s*\uBC15\s*[1-9]\d*\s*\uC77C/u);
  if (!match) return null;
  const nights = Number(match[1]);
  return Number.isFinite(nights) && nights >= 0 ? nights : null;
}

function resolveNightsForPersistence(ed: ProductRegistrationResult['extractedData']): number | null {
  const explicit = (ed as { nights?: number | null }).nights;
  if (typeof explicit === 'number' && Number.isFinite(explicit) && explicit >= 0) return explicit;

  const tripStyleNights = parseTripStyleNights((ed as { trip_style?: unknown }).trip_style);
  if (tripStyleNights != null) return tripStyleNights;

  return ed.duration ? Math.max(0, ed.duration - 1) : null;
}

function stripInternalDistributionCopy(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const cleaned = value
    .replace(/\*?\s*선발\s*특가\s*\d{1,2}\s*\/\s*\d{1,2}\s*까지\s*\d{1,2}\s*\/\s*\d{1,2}\s*배포/gi, ' ')
    .replace(/\*?\s*선발권\s*\d{1,2}\s*\/\s*\d{1,2}\s*까지\s*\d{1,2}[./]\d{1,2}\s*배포/gi, ' ')
    .replace(/\d{2,4}[./]\d{1,2}[./]\d{1,2}\s*배포/gi, ' ')
    .replace(/\d{1,2}\s*[./]\s*\d{1,2}\s*배포/gi, ' ')
    .replace(/\d{1,2}\s*\/\s*까지/gi, ' ')
    .replace(/\b(?:배포|문서배포|자료배포)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned.length > 0 ? cleaned : null;
}

function resolveCustomerDisplayTitle(input: {
  extractedDisplayTitle?: string | null;
  title: string;
}): string {
  return stripInternalDistributionCopy(input.extractedDisplayTitle)
    ?? stripInternalDistributionCopy(input.title)
    ?? input.title.trim();
}

function resolveCustomerProductSummary(value: unknown): string | null {
  return stripInternalDistributionCopy(value);
}

export function buildUploadPersistenceRows(input: UploadPersistenceRowsInput): UploadPersistenceRows {
  const ed = input.registration.extractedData;
  const draftRow = input.finalized.draftRow;
  const confidenceV3 = input.finalized.confidenceV3;
  const productStatus = input.finalized.productStatus;
  const pkgStatus = input.finalized.pkgStatus;
  const customerSourceRaw = buildCustomerSourceRawText({
    productRawText: input.productRawText,
    documentRawText: maskSensitiveRawText(
      input.documentRawText,
      input.landOperatorName ?? input.filenameSupplierRaw,
    ),
    priceDates: input.priceDates as Array<{ date?: string | null; price?: number | null }> | null,
    priceRows: input.priceRows,
  });
  const productRow = input.internalCode
    ? {
        internal_code: input.internalCode,
        display_name: input.title,
        departure_region: input.departureRegion,
        supplier_code: input.supplierCode,
        departure_date: ed.ticketing_deadline ?? null,
        net_price: input.netPrice,
        margin_rate: input.marginRate,
        discount_amount: 0,
        ai_tags: ed.product_tags ?? [],
        internal_memo: null,
        source_filename: input.sourceFilename,
        land_operator_id: input.landOperatorId,
        departing_location_id: input.departingLocationId,
        status: productStatus,
        ai_confidence_score: Math.round(confidenceV3 * 100),
        theme_tags: ed.theme_tags ?? [],
        selling_points: ed.selling_points ?? null,
        flight_info: ed.flight_info ?? null,
        raw_extracted_text: maskSensitiveRawText(
          input.documentRawText,
          input.landOperatorName ?? input.filenameSupplierRaw,
        ).slice(0, 50000),
        thumbnail_urls: [],
      }
    : null;

  return {
    productRow,
    productPriceRows: input.internalCode
      ? input.priceRows.map(row => ({
          ...row,
          adult_selling_price: row.adult_selling_price ?? row.net_price,
          product_id: input.internalCode as string,
        }))
      : [],
    travelPackageRow: {
      title: input.title,
      destination: ed.destination,
      duration: ed.duration,
      nights: resolveNightsForPersistence(ed),
      price: ed.price,
      filename: input.sourceFilename,
      file_type: input.fileType,
      raw_text: customerSourceRaw.rawText,
      raw_text_hash: customerSourceRaw.rawTextHash,
      display_title: resolveCustomerDisplayTitle({
        extractedDisplayTitle: (ed as { display_title?: string | null }).display_title,
        title: input.title,
      }),
      hero_tagline: (ed as { hero_tagline?: string | null }).hero_tagline ?? null,
      itinerary: ed.itinerary ?? [],
      inclusions: draftRow.inclusions ?? [],
      excludes: draftRow.excludes ?? [],
      accommodations: ed.accommodations ?? [],
      special_notes: (ed as { specialNotes?: unknown }).specialNotes,
      notices_parsed: draftRow.notices_parsed ?? [],
      confidence: confidenceV3,
      category: ed.category ?? 'package',
      product_type: draftRow.product_type ?? ed.product_type,
      trip_style: ed.trip_style,
      departure_days: ed.departure_days,
      departure_airport: ed.departure_airport ?? '부산/김해',
      airline: ed.airline,
      min_participants: ed.min_participants ?? 4,
      ticketing_deadline: ed.ticketing_deadline ?? null,
      guide_tip: ed.guide_tip,
      single_supplement: ed.single_supplement,
      small_group_surcharge: ed.small_group_surcharge,
      price_tiers: ed.price_tiers ?? [],
      price_dates: input.priceDates,
      price_list: ed.price_list ?? [],
      surcharges: ed.surcharges ?? [],
      excluded_dates: ed.excluded_dates ?? [],
      optional_tours: normalizeOptionalTours(ed.optional_tours) ?? [],
      cancellation_policy: ed.cancellation_policy ?? [],
      category_attrs: ed.category_attrs ?? {},
      land_operator: input.filenameSupplierRaw ?? ed.land_operator ?? null,
      land_operator_id: input.landOperatorId,
      departing_location_id: input.departingLocationId,
      commission_rate: input.filenameMarginRate != null ? input.filenameMarginRate * 100 : null,
      product_tags: ed.product_tags ?? [],
      product_highlights: ed.product_highlights ?? [],
      product_summary: resolveCustomerProductSummary(ed.product_summary),
      itinerary_data: draftRow.itinerary_data,
      parser_version: (draftRow as { parser_version?: string }).parser_version ?? null,
      status: pkgStatus,
      marketing_copies: input.marketingCopies,
      internal_code: input.internalCode ?? null,
      catalog_id: input.catalogGroupId,
    },
  };
}
