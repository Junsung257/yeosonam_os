import type { SupabaseClient } from '@supabase/supabase-js';

import type { AlertInput } from '@/lib/admin-alerts';
import type { AttractionData } from '@/lib/attraction-matcher';
import type { ParsedDocument } from '@/lib/parser';
import type { UploadInputAnalysis } from '@/lib/product-registration-input-guard';
import type { UploadSourceMetadataResult } from '@/lib/upload-source-metadata';
import { recordUploadDocumentHash } from './upload-document-hashes';
import {
  scheduleUploadL3BackfillTasks,
  type UploadSafeAfter,
} from './upload-post-registration-tasks';
import type { ProcessUploadProductsResult } from './upload-product-runner';
import { buildUploadResponsePayload } from './upload-response';
import { flushUploadAttractionReviewQueue } from './unmatched-queue';

type PostAlert = (input: AlertInput) => Promise<unknown> | unknown;

export async function completeUploadRegistration(input: {
  supabase: SupabaseClient;
  isSupabaseConfigured: boolean;
  bulkMode: boolean;
  safeAfter: UploadSafeAfter;
  postAlert: PostAlert;
  parsedDocument: ParsedDocument;
  classification: unknown;
  inputAnalysisForTrust: UploadInputAnalysis | null;
  uploadSourceMetadata: UploadSourceMetadataResult | null;
  registrationProductsResult: ProcessUploadProductsResult;
  productsToSaveLength: number;
  activeAttractions: AttractionData[];
  fileHash: string;
  fileName: string;
  normalizedCatalogHash: string;
  preSaveV3Status: string | null;
  filenameSupplierRaw: string | null | undefined;
  marginRate: number;
  baseUrl: string;
}): Promise<Record<string, unknown>> {
  const result = input.registrationProductsResult;

  await flushUploadAttractionReviewQueue({
    supabaseAdmin: input.supabase,
    isSupabaseConfigured: input.isSupabaseConfigured,
    bulkMode: input.bulkMode,
    unmatchedRows: result.unmatchedRowsToInsert,
    extractedCandidateRows: result.extractedCandidateRows,
    matchedCanonicalNames: result.matchedCanonicalNames,
    activeAttractions: input.activeAttractions,
    fallbackPackageId: result.savedIds[0] ?? null,
    fallbackPackageTitle: result.savedTitles[0] ?? null,
  });

  if (result.savedIds.length > 0) {
    scheduleUploadL3BackfillTasks({
      safeAfter: input.safeAfter,
      packageIds: result.savedIds,
      isSupabaseConfigured: input.isSupabaseConfigured,
      postAlert: input.postAlert,
    });
  }

  if (result.savedInternalCodes.length > 0) {
    const hashRecord = await recordUploadDocumentHash({
      supabase: input.supabase,
      isSupabaseConfigured: input.isSupabaseConfigured,
      fileHash: input.fileHash,
      fileName: input.fileName,
      normalizedHash: input.normalizedCatalogHash,
      productId: result.savedInternalCodes[0],
    });
    if (!hashRecord.ok) console.warn('[Upload API] document_hashes record failed:', hashRecord.message);
    else console.log('[Upload API] document_hashes record complete:', input.fileHash.slice(0, 12));
  }

  return buildUploadResponsePayload({
    supabase: input.supabase,
    isSupabaseConfigured: input.isSupabaseConfigured,
    savedIds: result.savedIds,
    savedTitles: result.savedTitles,
    savedInternalCodes: result.savedInternalCodes,
    savedConfidences: result.savedConfidences,
    saveErrors: result.saveErrors,
    totalPriceRowsSaved: result.totalPriceRowsSaved,
    savedPriceRowsByPackageId: result.savedPriceRowsByPackageId,
    productsToSaveLength: input.productsToSaveLength,
    parsedDocument: input.parsedDocument,
    fileHash: input.fileHash,
    classification: input.classification,
    inputAnalysisForTrust: input.inputAnalysisForTrust,
    preSaveV3Status: input.preSaveV3Status,
    matchedAttractionCount: result.matchedCanonicalNames.size,
    unmatchedAttractionCount: result.unmatchedRowsToInsert.length,
    attractionSeededCount: result.attractionSeededCount,
    attractionReflectedCount: result.attractionReflectedCount,
    uploadSourceMetadata: input.uploadSourceMetadata,
    filenameSupplierRaw: input.filenameSupplierRaw,
    marginRate: input.marginRate,
    fileName: input.fileName,
    baseUrl: input.baseUrl,
  });
}
