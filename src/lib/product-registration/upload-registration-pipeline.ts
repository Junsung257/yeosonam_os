import type { SupabaseClient } from '@supabase/supabase-js';

import type { AlertInput } from '@/lib/admin-alerts';
import { archiveUploadRawProduct } from './upload-archive';
import { loadUploadRegistrationContext } from './upload-context-loader';
import { checkInitialUploadDuplicate } from './upload-document-hashes';
import { parseUploadDocumentForRegistration } from './upload-document-parsing';
import { processUploadRegistrationProducts } from './upload-product-runner';
import type { UploadSafeAfter } from './upload-post-registration-tasks';
import { completeUploadRegistration } from './upload-registration-completion';
import { normalizeUploadRegistrationDocument } from './upload-registration-normalization';
import { prepareUploadRegistrationProducts } from './upload-registration-preparation';
import type { UploadRequestIntakeSuccess } from './upload-request-intake';
import { resolveUploadSourceForRegistration } from './upload-source-resolution';

type PostAlert = (input: AlertInput) => Promise<unknown> | unknown;

export type UploadRegistrationPipelineResult = {
  status: number;
  payload: Record<string, unknown>;
};

export async function runUploadRegistrationPipeline(input: {
  intake: UploadRequestIntakeSuccess;
  supabase: SupabaseClient;
  isSupabaseConfigured: boolean;
  safeAfter: UploadSafeAfter;
  postAlert: PostAlert;
  requestBaseUrl: string;
  publicBaseUrl: string;
}): Promise<UploadRegistrationPipelineResult> {
  const {
    buffer,
    fileHash,
    fileName,
    directRawText,
    uploadSourceMetadata,
    inputAnalysisForTrust,
    archiveMode,
    bulkMode,
    forceReprocess,
  } = input.intake;

  const initialDuplicate = await checkInitialUploadDuplicate({
    supabase: input.supabase,
    isSupabaseConfigured: input.isSupabaseConfigured,
    forceReprocess,
    fileHash,
    directRawText,
  });
  if (initialDuplicate.duplicate) {
    console.log('[Upload API] duplicate input skipped:', initialDuplicate.kind, initialDuplicate.hashPreview);
    return { status: 200, payload: initialDuplicate.payload };
  }
  if (forceReprocess) {
    console.log('[Upload API] force=1 duplicate guard bypassed');
  }

  const uploadContext = await loadUploadRegistrationContext({
    supabase: input.supabase,
    isSupabaseConfigured: input.isSupabaseConfigured,
    bulkMode,
  });
  const landOps = uploadContext.landOperators;
  const depLocs = uploadContext.departingLocations;

  const uploadSource = resolveUploadSourceForRegistration({
    fileName,
    uploadSourceMetadata,
    landOperators: landOps ?? [],
  });
  const {
    filenameRule,
    supplierCode,
    marginRate,
    tempDestination: tempDest,
    prelimLandOperatorId,
  } = uploadSource;

  console.log('[Upload API] source resolved:', { filenameRule, supplierCode, marginRate });

  if (archiveMode) {
    const archiveResult = await archiveUploadRawProduct({
      supabase: input.supabase,
      isSupabaseConfigured: input.isSupabaseConfigured,
      buffer,
      fileName,
      filenameRule,
      landOperators: landOps,
    });

    console.log(`[Upload API] archive saved: ${archiveResult.sku} -> ${archiveResult.status}`);
    return {
      status: 200,
      payload: {
        success: true,
        mode: 'archive',
        sku: archiveResult.sku,
        status: archiveResult.status,
        expired: archiveResult.expired,
        message: archiveResult.expired
          ? `Archive complete (expired: ${archiveResult.departureDate})`
          : 'Archive complete (draft saved)',
      },
    };
  }

  const parsedForRegistration = await parseUploadDocumentForRegistration({
    buffer,
    fileName,
    directRawText,
    tempDestination: tempDest,
    prelimLandOperatorId,
    supabase: input.supabase,
    isSupabaseConfigured: input.isSupabaseConfigured,
    fileHash,
  });
  if (parsedForRegistration.duplicate.duplicate) {
    console.log('[Upload API] parsed document duplicate skipped:', parsedForRegistration.duplicate.kind, parsedForRegistration.duplicate.hashPreview);
    return { status: 200, payload: parsedForRegistration.duplicate.payload };
  }

  let parsedDocument = parsedForRegistration.parsedDocument;
  const productRegistrationV2GateFailures = parsedForRegistration.productRegistrationV2GateFailures;
  const normalizedCatalogHash = parsedForRegistration.normalizedCatalogHash;
  const classification = { productCount: 1, isTravel: true, documentType: 'package' as const, estimatedConfidence: 0.9 };

  console.log('[Upload API] parsed document ready:', {
    title: parsedDocument.extractedData.title,
    confidence: parsedDocument.confidence,
    multiCount: parsedDocument.multiProducts?.length ?? 1,
  });

  const normalizedRegistrationDocument = await normalizeUploadRegistrationDocument({
    parsedDocument,
    normalizedCatalogHash,
    isSupabaseConfigured: input.isSupabaseConfigured,
    supabase: input.supabase,
    postAlert: input.postAlert,
    filenameRule,
    supplierCode,
    marginRate,
    fileName,
    landOperators: landOps ?? [],
    departingLocations: depLocs ?? [],
  });
  parsedDocument = normalizedRegistrationDocument.parsedDocument;
  const {
    effectiveSupplierCode,
    effectiveLandOperatorId,
    irLandOperatorName,
    departingLocationId,
    irCanaryPrimary,
    rawNormalizerFailedReason,
  } = normalizedRegistrationDocument;

  const activeAttractions = uploadContext.activeAttractions;
  const preparedRegistrationProducts = await prepareUploadRegistrationProducts({
    parsedDocument,
    activeAttractions,
    fileName,
    isSupabaseConfigured: input.isSupabaseConfigured,
    postAlert: input.postAlert,
  });
  if (!preparedRegistrationProducts.ok) {
    return {
      status: preparedRegistrationProducts.status,
      payload: preparedRegistrationProducts.payload,
    };
  }
  const { productsToSave, catalogGroupId, preSaveV3Result } = preparedRegistrationProducts;

  const registrationProductsResult = await processUploadRegistrationProducts({
    supabase: input.supabase,
    isSupabaseConfigured: input.isSupabaseConfigured,
    safeAfter: input.safeAfter,
    postAlert: input.postAlert,
    requestBaseUrl: input.requestBaseUrl,
    parsedDocument,
    productsToSave,
    filenameRule,
    fileName,
    fileHash,
    normalizedCatalogHash,
    activeAttractions,
    effectiveSupplierCode,
    effectiveLandOperatorId,
    irLandOperatorName,
    tempDestination: tempDest,
    productRegistrationV2GateFailures,
    rawNormalizerFailedReason,
    marginRate,
    departingLocationId,
    catalogGroupId,
    landOperators: landOps,
    irCanaryPrimary,
    forceReprocess,
  });

  const responsePayload = await completeUploadRegistration({
    supabase: input.supabase,
    isSupabaseConfigured: input.isSupabaseConfigured,
    bulkMode,
    safeAfter: input.safeAfter,
    postAlert: input.postAlert,
    registrationProductsResult,
    productsToSaveLength: productsToSave.length,
    activeAttractions,
    parsedDocument,
    classification,
    inputAnalysisForTrust,
    preSaveV3Status: preSaveV3Result.gate_result.status,
    uploadSourceMetadata,
    filenameSupplierRaw: filenameRule.supplierRaw ?? null,
    marginRate,
    fileHash,
    fileName,
    normalizedCatalogHash,
    baseUrl: input.publicBaseUrl,
    requestBaseUrl: input.requestBaseUrl,
  });

  return { status: 200, payload: responsePayload };
}
