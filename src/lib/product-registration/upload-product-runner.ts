import type { SupabaseClient } from '@supabase/supabase-js';

import type { AlertInput } from '@/lib/admin-alerts';
import type { AttractionData } from '@/lib/attraction-matcher';
import { getRegistrationPolicy } from '@/lib/registration-policy';
import type { ItineraryDataLike } from '@/lib/itinerary-attraction-enricher';
import { maybeTriggerMrtSync } from '@/lib/parser/mrt-lazy-sync';
import { recordHotelsFromItinerary } from '@/lib/parser/hotel-canonical-learner';
import { extractProductRawTextSection, stripSharedCatalogPrefixForProductDetail } from '@/lib/parser/catalog-pre-split';
import type { MultiProductResult, ParsedDocument } from '@/lib/parser';
import { issueUploadInternalCode } from '@/lib/product-registration/destination-resolution';
import { finalizeUploadRegistration } from '@/lib/product-registration/finalize-registration';
import { buildUploadPersistenceRows } from '@/lib/product-registration/persistence-rows';
import { registerProductFromRaw } from '@/lib/product-registration/register-product-from-raw';
import { runMicroAutoQA } from '@/lib/product-registration/auto-qa';
import type { UploadInputAnalysis } from '@/lib/product-registration-input-guard';
import type { ImprovementLedgerEvent } from '@/lib/product-registration/improvement-ledger';
import { persistImprovementLedgerEvents } from '@/lib/product-registration/improvement-ledger-persistence';
import { recordUploadSectionSignals } from '@/lib/product-registration/section-signal-recording';
import {
  formatStandardRegistrationSchemaIssues,
  validateStandardProductRegistrationObject,
} from '@/lib/product-registration/standard-registration-schema';
import {
  claimUploadProductSection,
  updateUploadProductSectionJob,
} from '@/lib/product-registration/upload-section-idempotency';
import type { StandardProductRegistrationObject } from '@/lib/product-registration/types';
import {
  logUploadPostSaveAuditStatus,
  recordUploadAiQualityLog,
  scheduleUploadPostRegistrationTasks,
  type UploadSafeAfter,
} from '@/lib/product-registration/upload-post-registration-tasks';
import {
  persistUploadRegistrationRows,
  rollbackInsertedUploadProduct,
} from '@/lib/product-registration/upload-persistence';
import { scheduleUploadReviewInsert } from '@/lib/product-registration/upload-review-queue';
import type {
  UploadFilenameRule,
  UploadLandOperatorRow,
} from '@/lib/product-registration/upload-supplier-context';
import type { UploadGate } from '@/lib/upload-validator';

type PostAlert = (input: AlertInput) => Promise<unknown> | unknown;

export type ProcessUploadProductsResult = {
  savedIds: string[];
  savedTitles: string[];
  savedInternalCodes: string[];
  savedConfidences: number[];
  saveErrors: { title: string; error: string }[];
  totalPriceRowsSaved: number;
  savedPriceRowsByPackageId: Map<string, number>;
  unmatchedRowsToInsert: {
    activity: string;
    package_id: string;
    package_title: string;
    day_number: number;
    country: string | null;
  }[];
  matchedCanonicalNames: Set<string>;
  extractedCandidateRows: { activity: string; destination?: string }[];
  attractionSeededCount: number;
  attractionReflectedCount: number;
  improvementEvents: ImprovementLedgerEvent[];
  improvementEventsSaved: number;
  improvementEventsSaveError: string | null;
  skippedDuplicateSections: number;
};

export async function processUploadRegistrationProducts(input: {
  supabase: SupabaseClient;
  isSupabaseConfigured: boolean;
  safeAfter: UploadSafeAfter;
  postAlert: PostAlert;
  requestBaseUrl: string;
  parsedDocument: ParsedDocument;
  productsToSave: MultiProductResult[];
  filenameRule: UploadFilenameRule;
  fileName: string;
  fileHash: string;
  normalizedCatalogHash: string;
  activeAttractions: AttractionData[];
  effectiveSupplierCode: string;
  effectiveLandOperatorId: string | null;
  irLandOperatorName: string;
  tempDestination: string | null;
  productRegistrationV2GateFailures: string[];
  rawNormalizerFailedReason: string | null;
  marginRate: number;
  departingLocationId: string | null;
  catalogGroupId: string | null;
  landOperators: UploadLandOperatorRow[];
  irCanaryPrimary: boolean;
  forceReprocess: boolean;
  inputAnalysisForTrust?: UploadInputAnalysis | null;
  originalRawText?: string | null;
  parserRawText?: string | null;
  documentRawText?: string | null;
  analysisNormalizedText?: string | null;
}): Promise<ProcessUploadProductsResult> {
  const savedIds: string[] = [];
  const savedTitles: string[] = [];
  const savedInternalCodes: string[] = [];
  const savedConfidences: number[] = [];
  const saveErrors: { title: string; error: string }[] = [];
  let totalPriceRowsSaved = 0;
  const savedPriceRowsByPackageId = new Map<string, number>();
  const unmatchedRowsToInsert: ProcessUploadProductsResult['unmatchedRowsToInsert'] = [];
  const matchedCanonicalNames = new Set<string>();
  const extractedCandidateRows: { activity: string; destination?: string }[] = [];
  const attractionSeededCount = 0;
  const attractionReflectedCount = 0;
  const improvementEvents: ImprovementLedgerEvent[] = [];
  let skippedDuplicateSections = 0;

  const attachPersistedIdsToEvents = (
    events: ImprovementLedgerEvent[],
    ids: { productId?: string | null; packageId?: string | null },
  ): ImprovementLedgerEvent[] => events.map(event => ({
    ...event,
    productId: ids.productId ?? event.productId,
    packageId: ids.packageId ?? event.packageId,
  }));

  for (let productIndex = 0; productIndex < input.productsToSave.length; productIndex++) {
    const product = input.productsToSave[productIndex];
    const ed = product.extractedData;
    const title = ed.title || input.filenameRule.cleanName || input.fileName;
    const productRawText =
      product.sectionRawText
      ?? extractProductRawTextSection(
        input.parsedDocument.rawText ?? '',
        title,
        productIndex,
        input.productsToSave.length,
      );
    const productV3RawText = stripSharedCatalogPrefixForProductDetail(productRawText);

    let internalCode: string | null = null;
    let productInserted = false;
    let sectionJobId: string | null = null;

    try {
      const rawForDeterm = productRawText || input.parsedDocument.rawText || '';
      const registrationDocumentRawText = input.documentRawText ?? input.parsedDocument.rawText ?? rawForDeterm;
      const sectionClaim = await claimUploadProductSection({
        supabase: input.supabase,
        isSupabaseConfigured: input.isSupabaseConfigured,
        forceReprocess: input.forceReprocess,
        uploadId: input.fileHash,
        documentRawText: registrationDocumentRawText,
        sectionRawText: rawForDeterm,
        supplierCode: input.effectiveSupplierCode,
        title,
      });
      sectionJobId = sectionClaim.jobId;
      if (!sectionClaim.shouldProcess) {
        skippedDuplicateSections++;
        console.log('[Upload API] duplicate section skipped:', {
          title,
          reason: sectionClaim.reason,
          productId: sectionClaim.productId,
          packageId: sectionClaim.packageId,
        });
        continue;
      }

      const autoGatePolicy = await getRegistrationPolicy();
      const registrationResult: StandardProductRegistrationObject = await registerProductFromRaw({
        rawText: rawForDeterm,
        originalRawText: input.originalRawText ?? rawForDeterm,
        parserRawText: input.parserRawText ?? input.parsedDocument.rawText ?? rawForDeterm,
        analysisNormalizedText: input.analysisNormalizedText ?? input.inputAnalysisForTrust?.normalizedText ?? null,
        documentRawText: registrationDocumentRawText,
        extractedData: ed,
        itineraryData: (product.itineraryData ?? null) as ItineraryDataLike | null,
        title,
        activeAttractions: input.activeAttractions,
        supplierCode: input.effectiveSupplierCode,
        supplierHint: input.irLandOperatorName,
        sourceType: input.parsedDocument.fileType,
        tempDestination: input.tempDestination,
        v3RawText: productV3RawText,
        extraFailures: input.productRegistrationV2GateFailures.map(reason => `Product Registration V2 gate failed: ${reason}`),
        enableGeminiFallback: true,
      });
      Object.assign(ed, registrationResult.extractedData);
      recordUploadSectionSignals({ rawText: rawForDeterm, extractedData: ed }).catch(e => {
        console.warn('[Upload API] section signal recording failed:', e instanceof Error ? e.message : e);
      });
      const sanitizeResult = registrationResult.sanitization;
      if (sanitizeResult.incidents.length > 0) {
        console.warn(
          `[Upload API] Customer-Leak ${sanitizeResult.incidents.length} incidents (score=${sanitizeResult.leakScore.toFixed(2)}):`,
          sanitizeResult.incidents.map(i => `${i.severity}/${i.patternId}@${i.field}`).join(' | '),
        );
      }

      const preSaveAutoQA = runMicroAutoQA({
        uploadId: input.fileHash,
        rawText: rawForDeterm,
        sectionRawText: productRawText,
        registration: registrationResult,
      });
      if (preSaveAutoQA.status === 'AUTO_FIXED' && preSaveAutoQA.repairedRegistration.deliverability.ok) {
        Object.assign(registrationResult, preSaveAutoQA.repairedRegistration);
        Object.assign(ed, registrationResult.extractedData);
      }

      const schemaValidation = validateStandardProductRegistrationObject(registrationResult);
      if (!schemaValidation.ok) {
        const errorReason = `Standard registration schema blocked: ${formatStandardRegistrationSchemaIssues(schemaValidation)}`;
        improvementEvents.push(...preSaveAutoQA.attempts);
        saveErrors.push({ title, error: errorReason });
        scheduleUploadReviewInsert({
          supabase: input.supabase,
          isSupabaseConfigured: input.isSupabaseConfigured,
          severity: 'critical',
          errorReason,
          sourceFilename: input.fileName,
          fileHash: input.fileHash,
          normalizedContentHash: input.normalizedCatalogHash,
          rawText: productRawText,
          originalRawText: input.originalRawText,
          parserRawText: input.parserRawText,
          documentRawText: registrationDocumentRawText,
          sectionRawText: productRawText,
          analysisNormalizedText: input.analysisNormalizedText ?? input.inputAnalysisForTrust?.normalizedText,
          parsedDraftJson: ed as unknown as Record<string, unknown>,
          productTitle: title,
          landOperatorId: input.effectiveLandOperatorId,
          inputAnalysis: input.inputAnalysisForTrust,
        });
        void updateUploadProductSectionJob({
          supabase: input.supabase,
          isSupabaseConfigured: input.isSupabaseConfigured,
          jobId: sectionJobId,
          status: 'blocked',
          errorMessage: errorReason,
        });
        console.warn('[Upload API] standard registration schema blocked insert:', errorReason);
        continue;
      }

      const priceRecovery = registrationResult.priceRecovery;
      const priceRows = registrationResult.pricing.productPrices;
      const projectedPriceDates = registrationResult.pricing.priceDates;
      const itineraryNormalization = registrationResult.itinerary;
      const itineraryInput = itineraryNormalization.itineraryInput;
      const itineraryDataToSave = itineraryNormalization.itineraryDataToSave;
      const scheduleItemCount = itineraryNormalization.scheduleItemCount;
      const deliverability = registrationResult.deliverability;

      if (!deliverability.ok) {
        const errorReason = `Customer landing/A4 blocked: ${deliverability.blockers.join(' | ')}`;
        const autoQA = preSaveAutoQA.status === 'PASS'
          ? runMicroAutoQA({
              uploadId: input.fileHash,
              rawText: rawForDeterm,
              sectionRawText: productRawText,
              registration: registrationResult,
              uploadFailed: true,
            })
          : preSaveAutoQA;
        improvementEvents.push(...autoQA.attempts);
        saveErrors.push({ title, error: errorReason });
        scheduleUploadReviewInsert({
          supabase: input.supabase,
          isSupabaseConfigured: input.isSupabaseConfigured,
          severity: 'critical',
          errorReason,
          sourceFilename: input.fileName,
          fileHash: input.fileHash,
          normalizedContentHash: input.normalizedCatalogHash,
          rawText: productRawText,
          originalRawText: input.originalRawText,
          parserRawText: input.parserRawText,
          documentRawText: registrationDocumentRawText,
          sectionRawText: productRawText,
          analysisNormalizedText: input.analysisNormalizedText ?? input.inputAnalysisForTrust?.normalizedText,
          parsedDraftJson: ed as unknown as Record<string, unknown>,
          productTitle: title,
          landOperatorId: input.effectiveLandOperatorId,
          inputAnalysis: input.inputAnalysisForTrust,
        });
        void updateUploadProductSectionJob({
          supabase: input.supabase,
          isSupabaseConfigured: input.isSupabaseConfigured,
          jobId: sectionJobId,
          status: 'blocked',
          errorMessage: errorReason,
        });
        console.warn('[Upload API] customer deliverable guard blocked insert:', errorReason);
        continue;
      }

      const destinationResolution = registrationResult.destination;
      const departureCode = destinationResolution.departureCode;
      const destinationCode = destinationResolution.destinationCode;
      const durationDays = destinationResolution.durationDays;
      const departureRegion = destinationResolution.departureRegion;
      console.log(`[Upload API] code resolved from registration: ${departureCode}-${input.effectiveSupplierCode}-${destinationCode}-${durationDays}d`);

      if (input.isSupabaseConfigured) {
        internalCode = await issueUploadInternalCode({
          departureCode,
          supplierCode: input.effectiveSupplierCode,
          destinationCode,
          durationDays,
        });
        console.log('[Upload API] internal_code issued:', internalCode);
      }

      let netPrice = priceRecovery.minPrice ?? ed.price ?? 0;
      if (netPrice <= 0) netPrice = 1;
      console.log(`[Upload API] price rows recovered: ${priceRows.length}`);

      const finalizedRegistration = finalizeUploadRegistration({
        registration: registrationResult,
        rawText: productRawText,
        title,
        netPrice,
        internalCode: internalCode ?? null,
        policy: autoGatePolicy,
        priceRows,
        itineraryInput,
        itineraryDataToSave,
        scheduleItemCount,
        rawNormalizerFailedReason: input.rawNormalizerFailedReason,
      });

      const validation = finalizedRegistration.validation;
      const uploadGate: UploadGate = finalizedRegistration.uploadGate;
      const v2WithAttraction = finalizedRegistration.v2WithAttraction;
      const confidenceV3 = finalizedRegistration.confidenceV3;
      const v3FailedChecks = finalizedRegistration.failedChecks;
      itineraryNormalization.matchedCanonicalNames.forEach(name => matchedCanonicalNames.add(name));
      extractedCandidateRows.push(...itineraryNormalization.extractedCandidateRows);
      const l1Gate = finalizedRegistration.l1Gate;
      const productStatus = finalizedRegistration.productStatus;
      const pkgStatus = finalizedRegistration.pkgStatus;

      if (uploadGate === 'BLOCKED') {
        const errorReason = `BLOCKED: ${validation.errors.join(' | ') || finalizedRegistration.failedChecks.map(check => check.message).join(' | ') || 'final upload gate blocked'}`;
        const autoQA = runMicroAutoQA({
          uploadId: input.fileHash,
          rawText: rawForDeterm,
          sectionRawText: productRawText,
          registration: registrationResult,
          uploadFailed: true,
          trustScore: confidenceV3 * 100,
        });
        improvementEvents.push(...autoQA.attempts);
        saveErrors.push({ title, error: errorReason });
        scheduleUploadReviewInsert({
          supabase: input.supabase,
          isSupabaseConfigured: input.isSupabaseConfigured,
          severity: 'critical',
          errorReason,
          sourceFilename: input.fileName,
          fileHash: input.fileHash,
          normalizedContentHash: input.normalizedCatalogHash,
          rawText: productRawText,
          originalRawText: input.originalRawText,
          parserRawText: input.parserRawText,
          documentRawText: registrationDocumentRawText,
          sectionRawText: productRawText,
          analysisNormalizedText: input.analysisNormalizedText ?? input.inputAnalysisForTrust?.normalizedText,
          parsedDraftJson: ed as unknown as Record<string, unknown>,
          productTitle: title,
          landOperatorId: input.effectiveLandOperatorId,
          inputAnalysis: input.inputAnalysisForTrust,
        });
        void updateUploadProductSectionJob({
          supabase: input.supabase,
          isSupabaseConfigured: input.isSupabaseConfigured,
          jobId: sectionJobId,
          status: 'blocked',
          errorMessage: errorReason,
        });
        console.warn('[Upload API] finalized upload gate blocked insert:', errorReason);
        continue;
      }
      if (l1Gate.reasons.length > 0) {
        console.warn('[Upload API] L1 Gate BLOCK:', l1Gate.codes.join(','), l1Gate.reasons.join('; '));
      } else if (l1Gate.warnings.length > 0) {
        console.log('[Upload API] L1 Gate WARN:', l1Gate.warnings.slice(0, 3).join('; '));
      }
      const legacyProductsGate = finalizedRegistration.legacyProductsGate;
      if (legacyProductsGate) {
        const legacySummary = [
          legacyProductsGate.reasons.length > 0 ? `reasons: ${legacyProductsGate.reasons.join(', ')}` : null,
          legacyProductsGate.warnings.length > 0 ? `warnings: ${legacyProductsGate.warnings.join(', ')}` : null,
        ].filter(Boolean).join(' | ');
        if (legacySummary) {
          console.log(`[Upload API] Customer-Ready (products): ${legacySummary} -> ${productStatus}`);
        }
      }
      console.log(`[Upload API] status finalized: products=${productStatus}, travel_packages=${pkgStatus} (confidence=${(confidenceV3 * 100).toFixed(0)}%)`);

      const persistenceRows = buildUploadPersistenceRows({
        registration: registrationResult,
        finalized: finalizedRegistration,
        title,
        internalCode,
        departureRegion,
        supplierCode: input.effectiveSupplierCode,
        netPrice,
        marginRate: input.marginRate,
        sourceFilename: input.fileName,
        landOperatorId: input.effectiveLandOperatorId,
        landOperatorName: input.landOperators.find(lo => lo.id === input.effectiveLandOperatorId)?.name ?? null,
        filenameSupplierRaw: input.filenameRule.supplierRaw ?? null,
        departingLocationId: input.departingLocationId,
        fileType: input.parsedDocument.fileType,
        productRawText,
        documentRawText: registrationDocumentRawText,
        priceRows,
        priceDates: projectedPriceDates,
        marketingCopies: [],
        catalogGroupId: input.catalogGroupId,
        filenameMarginRate: input.filenameRule.marginRate ?? null,
      });

      const persistenceResult = await persistUploadRegistrationRows({
        supabase: input.supabase,
        isSupabaseConfigured: input.isSupabaseConfigured,
        internalCode,
        rows: persistenceRows,
      });
      productInserted = persistenceResult.productInserted;
      totalPriceRowsSaved += persistenceResult.priceRowsSaved;
      const pkgResult = persistenceResult.packageRow as { id: string } | null;

      if (pkgResult?.id) {
        if (preSaveAutoQA.status === 'AUTO_FIXED') {
          improvementEvents.push(...attachPersistedIdsToEvents(preSaveAutoQA.attempts, {
            productId: internalCode,
            packageId: pkgResult.id,
          }));
        } else {
          const autoQA = runMicroAutoQA({
            uploadId: input.fileHash,
            productId: internalCode,
            packageId: pkgResult.id,
            rawText: rawForDeterm,
            sectionRawText: productRawText,
            registration: registrationResult,
            trustScore: confidenceV3 * 100,
          });
          improvementEvents.push(...autoQA.attempts);
        }

        savedIds.push(pkgResult.id);
        savedTitles.push(title);
        savedConfidences.push(confidenceV3);
        savedPriceRowsByPackageId.set(pkgResult.id, priceRows.length);
        void updateUploadProductSectionJob({
          supabase: input.supabase,
          isSupabaseConfigured: input.isSupabaseConfigured,
          jobId: sectionJobId,
          status: 'completed',
          productId: internalCode,
          packageId: pkgResult.id,
        });

        const llmMeta = (ed as { _llm_meta?: Record<string, unknown> })._llm_meta ?? {};
        void recordUploadAiQualityLog({
          supabase: input.supabase,
          packageId: pkgResult.id,
          internalCode,
          confidence: confidenceV3,
          fillScore: v2WithAttraction.fillScore,
          crossValidationScore: v2WithAttraction.crossValidationScore,
          leakScore: v2WithAttraction.leakScore,
          autoGate: v2WithAttraction.autoGate,
          failedChecks: v3FailedChecks,
          leakIncidents: sanitizeResult.incidents,
          llmMeta,
          attractionMatchedCount: itineraryNormalization.matchedScheduleItemCount,
          attractionUnmatchedCount: itineraryNormalization.unmatchedCandidateCount,
        });

        const intakeLandOperatorName =
          input.landOperators.find(lo => lo.id === input.effectiveLandOperatorId)?.name
          ?? input.filenameRule.supplierRaw
          ?? input.effectiveSupplierCode
          ?? '(unknown)';
        const intakeCommissionRate =
          input.filenameRule.marginRate != null ? input.filenameRule.marginRate * 100 : input.marginRate * 100;
        const intakeRawText = productV3RawText || productRawText || input.parsedDocument.rawText || '';
        scheduleUploadPostRegistrationTasks({
          safeAfter: input.safeAfter,
          supabase: input.supabase,
          isSupabaseConfigured: input.isSupabaseConfigured,
          postAlert: input.postAlert,
          packageId: pkgResult.id,
          packageTitle: title,
          packageRow: pkgResult as unknown as Record<string, unknown>,
          itineraryData: itineraryDataToSave,
          internalCode,
          destination: ed.destination ?? null,
          sourceType: input.parsedDocument.fileType,
          activeAttractions: input.activeAttractions,
          rawText: intakeRawText,
          documentRawText: registrationDocumentRawText ?? '',
          landOperatorName: intakeLandOperatorName,
          landOperatorId: input.effectiveLandOperatorId,
          commissionRate: intakeCommissionRate,
          confidence: confidenceV3,
          rejected: v2WithAttraction.autoGate === 'rejected',
          leakIncidents: sanitizeResult.incidents,
          irCanaryPrimary: input.irCanaryPrimary,
          auditBaseUrl: input.requestBaseUrl,
        });
      }

      if (internalCode) {
        savedInternalCodes.push(internalCode);
      }

      console.log('[Upload API] travel_packages INSERT complete:', pkgResult?.id, 'FK:', internalCode, `(${pkgStatus})`);
      void maybeTriggerMrtSync(ed.destination ?? null);
      void recordHotelsFromItinerary({
        itineraryData: itineraryDataToSave ?? product.itineraryData,
        destination: ed.destination ?? null,
        country: null,
      });

      if (pkgResult?.id && itineraryNormalization.unmatchedCandidates.length > 0) {
        for (const unmatched of itineraryNormalization.unmatchedCandidates) {
          unmatchedRowsToInsert.push({
            activity: unmatched.activity,
            package_id: pkgResult.id,
            package_title: title,
            day_number: unmatched.day_number,
            country: ed.destination || null,
          });
        }
      }

      await logUploadPostSaveAuditStatus({
        supabase: input.supabase,
        isSupabaseConfigured: input.isSupabaseConfigured,
        packageId: pkgResult?.id,
      });
    } catch (saveErr) {
      const rollback = await rollbackInsertedUploadProduct({
        supabase: input.supabase,
        isSupabaseConfigured: input.isSupabaseConfigured,
        internalCode,
        productInserted,
      });
      if (rollback.error) {
        console.error('[Upload API] rollback failed; manual check needed:', rollback.error, internalCode);
      } else if (rollback.rolledBack) {
        console.log('[Upload API] rollback complete:', internalCode);
      }

      const errMsg = saveErr instanceof Error ? saveErr.message : String(saveErr);
      void updateUploadProductSectionJob({
        supabase: input.supabase,
        isSupabaseConfigured: input.isSupabaseConfigured,
        jobId: sectionJobId,
        status: 'failed',
        productId: internalCode,
        errorMessage: errMsg,
      });
      console.error('[Upload API] product save failed:', { title, error: errMsg });
      scheduleUploadReviewInsert({
        supabase: input.supabase,
        isSupabaseConfigured: input.isSupabaseConfigured,
        severity: 'high',
        errorReason: errMsg,
        sourceFilename: input.fileName,
        fileHash: input.fileHash,
        normalizedContentHash: input.normalizedCatalogHash,
        rawText: productRawText,
        originalRawText: input.originalRawText,
        parserRawText: input.parserRawText,
        documentRawText: input.documentRawText ?? input.parsedDocument.rawText,
        sectionRawText: productRawText,
        analysisNormalizedText: input.analysisNormalizedText ?? input.inputAnalysisForTrust?.normalizedText,
        parsedDraftJson: ed as unknown as Record<string, unknown>,
        productTitle: title,
        landOperatorId: input.effectiveLandOperatorId,
        inputAnalysis: input.inputAnalysisForTrust,
      });
      saveErrors.push({ title, error: errMsg });
    }
  }

  let improvementEventsSaved = 0;
  let improvementEventsSaveError: string | null = null;
  try {
    const ledgerPersistence = await persistImprovementLedgerEvents({
      supabase: input.supabase,
      isSupabaseConfigured: input.isSupabaseConfigured,
      events: improvementEvents,
    });
    improvementEventsSaved = ledgerPersistence.saved;
    improvementEventsSaveError = ledgerPersistence.error;
    if (ledgerPersistence.error) {
      console.warn('[Upload API] improvement ledger save failed:', ledgerPersistence.error);
    }
  } catch (error) {
    improvementEventsSaveError = error instanceof Error ? error.message : String(error);
    console.warn('[Upload API] improvement ledger save threw:', improvementEventsSaveError);
  }

  return {
    savedIds,
    savedTitles,
    savedInternalCodes,
    savedConfidences,
    saveErrors,
    totalPriceRowsSaved,
    savedPriceRowsByPackageId,
    unmatchedRowsToInsert,
    matchedCanonicalNames,
    extractedCandidateRows,
    attractionSeededCount,
    attractionReflectedCount,
    improvementEvents,
    improvementEventsSaved,
    improvementEventsSaveError,
    skippedDuplicateSections,
  };
}
