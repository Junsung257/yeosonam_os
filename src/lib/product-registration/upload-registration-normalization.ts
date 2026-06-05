import type { SupabaseClient } from '@supabase/supabase-js';

import type { AlertInput } from '@/lib/admin-alerts';
import type { ParsedDocument } from '@/lib/parser';
import { isStandardProductMarkdown } from '@/lib/standard-product-markdown';
import { applyUploadRawNormalizer } from './upload-raw-normalizer';
import {
  identifySupplierFromText,
  resolveLandOperatorId,
  type UploadDepartingLocationRow,
  type UploadFilenameRule,
  type UploadLandOperatorRow,
} from './upload-supplier-context';

type PostAlert = (input: AlertInput) => Promise<unknown> | unknown;

export type UploadRegistrationNormalizationResult = {
  parsedDocument: ParsedDocument;
  effectiveSupplierCode: string;
  effectiveLandOperatorId: string | null;
  irLandOperatorName: string;
  departingLocationId: string | null;
  irCanaryPrimary: boolean;
  rawNormalizerFailedReason: string | null;
};

export async function normalizeUploadRegistrationDocument(input: {
  parsedDocument: ParsedDocument;
  normalizedCatalogHash: string;
  isSupabaseConfigured: boolean;
  supabase: SupabaseClient;
  postAlert: PostAlert;
  filenameRule: UploadFilenameRule;
  supplierCode: string;
  marginRate: number;
  fileName: string;
  landOperators: UploadLandOperatorRow[];
  departingLocations: UploadDepartingLocationRow[];
}): Promise<UploadRegistrationNormalizationResult> {
  let effectiveSupplierCode = input.supplierCode;
  let effectiveLandOperatorId = resolveLandOperatorId(input.filenameRule.supplierRaw, input.landOperators);

  if (!input.filenameRule.supplierRaw) {
    const identified = await identifySupplierFromText(input.parsedDocument.rawText, input.landOperators);
    effectiveSupplierCode = identified.supplierCode;
    effectiveLandOperatorId = identified.landOperatorId;
    console.log('[Upload API] supplier identified from text:', identified.identificationSource, effectiveSupplierCode);
  }

  const irLandOperatorName =
    input.landOperators.find(lo => lo.id === effectiveLandOperatorId)?.name
    ?? input.filenameRule.supplierRaw
    ?? effectiveSupplierCode
    ?? '';

  const rawNormalizer = await applyUploadRawNormalizer({
    parsedDocument: input.parsedDocument,
    normalizedCatalogHash: input.normalizedCatalogHash,
    isStructuredMarkdownUpload: isStandardProductMarkdown(input.parsedDocument.rawText ?? ''),
    isSupabaseConfigured: input.isSupabaseConfigured,
    landOperatorName: irLandOperatorName,
    marginRate: input.marginRate,
    supabase: input.supabase,
    filename: input.fileName,
    filenameCleanName: input.filenameRule.cleanName,
    departingLocations: input.departingLocations,
    postAlert: input.postAlert,
  });

  console.log('[Upload API] master data mapped:', {
    supplierRaw: input.filenameRule.supplierRaw,
    effectiveSupplierCode,
    effectiveLandOperatorId,
    departure: rawNormalizer.parsedDocument.extractedData.departure_airport,
    departingLocationId: rawNormalizer.departingLocationId,
  });

  return {
    parsedDocument: rawNormalizer.parsedDocument,
    effectiveSupplierCode,
    effectiveLandOperatorId,
    irLandOperatorName,
    departingLocationId: rawNormalizer.departingLocationId,
    irCanaryPrimary: rawNormalizer.irCanaryPrimary,
    rawNormalizerFailedReason: rawNormalizer.rawNormalizerFailedReason,
  };
}
