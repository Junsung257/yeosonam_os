import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  buildUploadPersistenceRows: vi.fn(),
  finalizeUploadRegistration: vi.fn(),
  issueUploadInternalCode: vi.fn(),
  persistUploadRegistrationRows: vi.fn(),
  persistImprovementLedgerEvents: vi.fn(),
  registerProductFromRaw: vi.fn(),
  runMicroAutoQA: vi.fn(),
  rollbackInsertedUploadProduct: vi.fn(),
  scheduleUploadReviewInsert: vi.fn(),
  claimUploadProductSection: vi.fn(),
  updateUploadProductSectionJob: vi.fn(),
}));

vi.mock('@/lib/registration-policy', () => ({
  getRegistrationPolicy: vi.fn(async () => ({ autoApprove: false })),
}));

vi.mock('@/lib/parser/mrt-lazy-sync', () => ({
  maybeTriggerMrtSync: vi.fn(),
}));

vi.mock('@/lib/parser/hotel-canonical-learner', () => ({
  recordHotelsFromItinerary: vi.fn(),
}));

vi.mock('@/lib/parser/catalog-pre-split', () => ({
  extractProductRawTextSection: vi.fn(() => 'fallback product raw text'),
  stripSharedCatalogPrefixForProductDetail: vi.fn((rawText: string | null | undefined) => rawText ?? ''),
}));

vi.mock('@/lib/product-registration/destination-resolution', () => ({
  issueUploadInternalCode: mocks.issueUploadInternalCode,
}));

vi.mock('@/lib/product-registration/finalize-registration', () => ({
  finalizeUploadRegistration: mocks.finalizeUploadRegistration,
}));

vi.mock('@/lib/product-registration/persistence-rows', () => ({
  buildUploadPersistenceRows: mocks.buildUploadPersistenceRows,
}));

vi.mock('@/lib/product-registration/register-product-from-raw', () => ({
  registerProductFromRaw: mocks.registerProductFromRaw,
}));

vi.mock('@/lib/product-registration/auto-qa', () => ({
  runMicroAutoQA: mocks.runMicroAutoQA,
}));

vi.mock('@/lib/product-registration/improvement-ledger-persistence', () => ({
  persistImprovementLedgerEvents: mocks.persistImprovementLedgerEvents,
}));

vi.mock('@/lib/product-registration/section-signal-recording', () => ({
  recordUploadSectionSignals: vi.fn(async () => undefined),
}));

vi.mock('@/lib/product-registration/upload-post-registration-tasks', () => ({
  logUploadPostSaveAuditStatus: vi.fn(async () => undefined),
  recordUploadAiQualityLog: vi.fn(async () => undefined),
  scheduleUploadPostRegistrationTasks: vi.fn(),
}));

vi.mock('@/lib/product-registration/upload-persistence', () => ({
  persistUploadRegistrationRows: mocks.persistUploadRegistrationRows,
  rollbackInsertedUploadProduct: mocks.rollbackInsertedUploadProduct,
}));

vi.mock('@/lib/product-registration/upload-review-queue', () => ({
  scheduleUploadReviewInsert: mocks.scheduleUploadReviewInsert,
}));

vi.mock('@/lib/product-registration/upload-section-idempotency', () => ({
  claimUploadProductSection: mocks.claimUploadProductSection,
  updateUploadProductSectionJob: mocks.updateUploadProductSectionJob,
}));

import { processUploadRegistrationProducts } from './upload-product-runner';

describe('processUploadRegistrationProducts', () => {
  it('does not persist a finalized registration blocked by the upload gate', async () => {
    mocks.claimUploadProductSection.mockResolvedValue({
      shouldProcess: true,
      jobId: 'job-1',
      rawTextHash: 'raw-hash',
      sectionRawTextHash: 'section-hash',
      normalizedTitle: 'blocked cebu package',
      reason: 'claimed',
    });
    mocks.issueUploadInternalCode.mockResolvedValue('PUS-ETC-CEB-05-0001');
    mocks.registerProductFromRaw.mockResolvedValue({
      extractedData: {
        title: 'Blocked Cebu Package',
        destination: 'Cebu',
        duration: 5,
        price: 859000,
        rawText: 'raw text',
      },
      sanitization: { incidents: [], leakScore: 0 },
      priceRecovery: { minPrice: 859000 },
      pricing: {
        productPrices: [{
          target_date: '2026-07-24',
          day_of_week: null,
          net_price: 859000,
          adult_selling_price: null,
          child_price: null,
          note: null,
        }],
        priceDates: [{ date: '2026-07-24', price: 859000, confirmed: false }],
        minPrice: 859000,
        failures: [],
      },
      itinerary: {
        itineraryInput: { days: [{ day: 1, schedule: [] }] },
        itineraryDataToSave: { days: [{ day: 1, schedule: [] }] },
        scheduleItemCount: 0,
        matchedCanonicalNames: [],
        extractedCandidateRows: [],
        matchedScheduleItemCount: 0,
        unmatchedCandidateCount: 0,
        unmatchedCandidates: [],
      },
      deliverability: { ok: true, blockers: [] },
      evidence: {
        rawTextLength: 21,
        rawTextHash: '0'.repeat(64),
        priceSource: 'test',
        v3DraftStatus: null,
        v3RawTextHash: null,
        spans: [],
      },
      destination: {
        departureCode: 'PUS',
        destinationCode: 'CEB',
        durationDays: 5,
        departureRegion: 'Busan',
      },
    });
    mocks.finalizeUploadRegistration.mockReturnValue({
      validation: { isValid: false, errors: ['title missing'], warnings: [] },
      uploadGate: 'BLOCKED',
      v2WithAttraction: {
        confidence: 0.2,
        fillScore: 0,
        crossValidationScore: 0,
        leakScore: 0,
        autoGate: 'rejected',
        checks: [],
      },
      confidenceV3: 0.2,
      failedChecks: [],
      l1Gate: { reasons: [], warnings: [], codes: [] },
      legacyProductsGate: undefined,
      productStatus: 'REVIEW_NEEDED',
      pkgStatus: 'pending',
    });
    mocks.rollbackInsertedUploadProduct.mockResolvedValue({ rolledBack: false, error: null });
    mocks.persistImprovementLedgerEvents.mockResolvedValue({ saved: 1, error: null });
    mocks.runMicroAutoQA.mockReturnValue({
      attempts: [{
        uploadId: 'hash',
        productId: null,
        packageId: null,
        attemptNo: 0,
        attemptPhase: 'normal_registration',
        rawTextHash: 'raw-hash',
        sectionRawTextHash: null,
        parserVersion: 'test',
        detectedFormat: 'unknown',
        blockersBefore: ['blocked'],
        blockersAfter: ['blocked'],
        normalizedBlockerSignatures: ['blocked'],
        evidenceSpans: [],
        comparedFields: [],
        autoFixesApplied: [],
        packagesAudit: { status: 'unknown', failures: [], warnings: [] },
        a4Audit: { status: 'unknown', failures: [], warnings: [] },
        finalStatus: 'BLOCKED',
        fixtureCandidate: true,
        ruleCandidate: true,
        createdAt: '2026-06-07T00:00:00.000Z',
      }],
    });

    const result = await processUploadRegistrationProducts({
      supabase: {} as never,
      isSupabaseConfigured: true,
      safeAfter: task => { void task(); },
      postAlert: vi.fn(),
      requestBaseUrl: 'http://localhost:3000',
      parsedDocument: {
        filename: 'blocked.txt',
        fileType: 'hwp',
        rawText: 'full product raw text',
        extractedData: { rawText: 'full product raw text' },
        parsedAt: new Date(),
        confidence: 0,
      },
      productsToSave: [{
        extractedData: { title: 'Blocked Cebu Package', rawText: 'section raw text' },
        itineraryData: null,
        sectionRawText: 'section raw text',
      }],
      filenameRule: {
        cleanName: 'blocked',
      },
      fileName: 'blocked.txt',
      fileHash: 'hash',
      normalizedCatalogHash: 'normalized',
      activeAttractions: [],
      effectiveSupplierCode: 'ETC',
      effectiveLandOperatorId: null,
      irLandOperatorName: 'ETC',
      tempDestination: 'Cebu',
      productRegistrationV2GateFailures: [],
      rawNormalizerFailedReason: null,
      marginRate: 0.1,
      departingLocationId: null,
      catalogGroupId: null,
      landOperators: [],
      irCanaryPrimary: false,
      forceReprocess: false,
    });

    expect(result.savedIds).toEqual([]);
    expect(result.saveErrors).toEqual([{ title: 'Blocked Cebu Package', error: 'BLOCKED: title missing' }]);
    expect(result.improvementEvents).toHaveLength(1);
    expect(result.improvementEventsSaved).toBe(1);
    expect(result.improvementEventsSaveError).toBeNull();
    expect(mocks.persistImprovementLedgerEvents).toHaveBeenCalledWith(expect.objectContaining({
      isSupabaseConfigured: true,
      events: expect.arrayContaining([expect.objectContaining({ finalStatus: 'BLOCKED' })]),
    }));
    expect(mocks.runMicroAutoQA).toHaveBeenCalledWith(expect.objectContaining({
      uploadFailed: true,
      trustScore: 20,
    }));
    expect(mocks.scheduleUploadReviewInsert).toHaveBeenCalledTimes(1);
    expect(mocks.updateUploadProductSectionJob).toHaveBeenCalledWith(expect.objectContaining({
      jobId: 'job-1',
      status: 'blocked',
      errorMessage: 'BLOCKED: title missing',
    }));
    expect(mocks.buildUploadPersistenceRows).not.toHaveBeenCalled();
    expect(mocks.persistUploadRegistrationRows).not.toHaveBeenCalled();
  });
});
