import { calculateConfidenceV2, type ExtractedData, type ValidationCheck } from '@/lib/parser';
import { evaluateCustomerReadyGate, type GateResult } from '@/lib/parser/customer-ready-gate';
import {
  mapTravelPackageUploadStatus,
  prepareRegistrationWrite,
  type RegistrationWriteResult,
} from '@/lib/registration-write-pipeline';
import type { RegistrationPolicy } from '@/lib/registration-policy';
import {
  classifyUploadGate,
  validateExtractedProduct,
  type UploadGate,
  type ValidationResult,
  type ProductPriceRowInput,
} from '@/lib/upload-validator';
import type { ProductRegistrationResult } from './types';
import type { ItineraryDataLike } from './itinerary-normalization';

export type FinalizeUploadRegistrationInput = {
  registration: ProductRegistrationResult;
  rawText: string;
  title: string;
  netPrice: number;
  internalCode: string | null;
  policy: RegistrationPolicy;
  priceRows: ProductPriceRowInput[];
  itineraryInput: ItineraryDataLike | null;
  itineraryDataToSave: ItineraryDataLike | null;
  scheduleItemCount: number;
  rawNormalizerFailedReason?: string | null;
};

export type FinalizeUploadRegistrationResult = {
  validation: ValidationResult;
  uploadGate: UploadGate;
  confidenceV3: number;
  v2WithAttraction: ReturnType<typeof calculateConfidenceV2>;
  legacyProductsGate: GateResult | undefined;
  failedChecks: ValidationCheck[];
  regWrite: RegistrationWriteResult;
  draftRow: RegistrationWriteResult['row'];
  l1Gate: RegistrationWriteResult['l1'];
  productStatus: RegistrationWriteResult['productsStatus'];
  pkgStatus: 'approved' | 'pending';
};

export function finalizeUploadRegistration(
  input: FinalizeUploadRegistrationInput,
): FinalizeUploadRegistrationResult {
  const ed = input.registration.extractedData as ExtractedData;
  const itineraryStats = input.registration.itinerary;
  const v2WithAttraction = calculateConfidenceV2(ed, {
    leakScore: input.registration.sanitization.leakScore,
    itineraryData: input.itineraryInput as unknown as {
      days?: Array<{ schedule?: Array<{ type?: string }>; hotel?: { name?: string | null } }>;
      meta?: { airline?: string | null; flight_out?: string | null; flight_in?: string | null };
    } | undefined,
    policy: input.policy,
    attractionStats: {
      matchedCount: itineraryStats.matchedScheduleItemCount,
      unmatchedCount: itineraryStats.unmatchedCandidateCount,
      scheduleItemCount: input.scheduleItemCount,
    },
  });

  const confidenceV3 = v2WithAttraction.confidence;
  const validation = validateExtractedProduct(ed);
  const uploadGate = classifyUploadGate(validation, confidenceV3, input.priceRows.length);
  const rawNormalizerFailureCovered = Boolean(
    input.rawNormalizerFailedReason
    && ed.airline
    && ed.inclusions?.length
    && ed.excludes?.length
    && input.priceRows.length > 0
    && input.registration.pricing.priceDates.length > 0
    && ((input.itineraryDataToSave as { days?: unknown[] } | null)?.days?.length ?? 0) > 0
    && (input.itineraryDataToSave as { meta?: { flight_out?: string | null; flight_in?: string | null } } | null)?.meta?.flight_out
    && (input.itineraryDataToSave as { meta?: { flight_out?: string | null; flight_in?: string | null } } | null)?.meta?.flight_in
  );
  const failedChecks: ValidationCheck[] = [
    ...v2WithAttraction.checks.filter(check => !check.passed),
    ...(input.rawNormalizerFailedReason && !rawNormalizerFailureCovered
      ? [{
          id: 'raw_upload_normalizer_failed',
          passed: false,
          severity: 'critical' as const,
          message: `Raw upload normalizer failed; customer exposure requires review: ${input.rawNormalizerFailedReason}`,
        }]
      : []),
  ];

  let legacyProductsGate: GateResult | undefined;
  try {
    legacyProductsGate = evaluateCustomerReadyGate({
      ed,
      netPrice: input.netPrice,
      priceRowCount: input.priceRows.length,
      confidence: confidenceV3,
      hasItinerary: !!input.itineraryDataToSave?.days?.length,
      hasThumbnail: false,
    });
  } catch {
    legacyProductsGate = undefined;
  }

  const regWrite = prepareRegistrationWrite({
    row: {
      title: input.title,
      destination: ed.destination,
      product_type: ed.product_type,
      raw_text: input.rawText,
      inclusions: ed.inclusions ?? [],
      excludes: ed.excludes ?? [],
      notices_parsed: ed.notices_parsed ?? [],
      itinerary_data: input.itineraryDataToSave,
      surcharges: ed.surcharges ?? [],
      customer_notes: (ed as { customer_notes?: string | null }).customer_notes,
      internal_notes: (ed as { internal_notes?: string | null }).internal_notes,
    },
    rawText: input.rawText,
    internalCode: input.internalCode,
    confidence: confidenceV3,
    legacyProductsGate,
  });

  let productStatus = regWrite.productsStatus;
  let pkgStatus = mapTravelPackageUploadStatus(regWrite.travelPackageStatus);
  if (uploadGate === 'BLOCKED') {
    productStatus = 'REVIEW_NEEDED';
    pkgStatus = 'pending';
  }
  if (uploadGate === 'REVIEW_NEEDED' && productStatus === 'approved') {
    productStatus = 'draft';
    pkgStatus = 'pending';
  }
  if (input.registration.evidence.v3DraftStatus === 'blocked') {
    productStatus = 'REVIEW_NEEDED';
    pkgStatus = 'pending';
  } else if (input.registration.evidence.v3DraftStatus === 'needs_review' && productStatus === 'approved') {
    productStatus = 'draft';
    pkgStatus = 'pending';
  }

  return {
    validation,
    uploadGate,
    confidenceV3,
    v2WithAttraction,
    legacyProductsGate,
    failedChecks,
    regWrite,
    draftRow: regWrite.row,
    l1Gate: regWrite.l1,
    productStatus,
    pkgStatus,
  };
}
