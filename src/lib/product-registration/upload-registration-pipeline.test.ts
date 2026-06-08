import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  archiveUploadRawProduct: vi.fn(),
  checkInitialUploadDuplicate: vi.fn(),
  completeUploadRegistration: vi.fn(),
  loadUploadRegistrationContext: vi.fn(),
  normalizeUploadRegistrationDocument: vi.fn(),
  parseUploadDocumentForRegistration: vi.fn(),
  prepareUploadRegistrationProducts: vi.fn(),
  processUploadRegistrationProducts: vi.fn(),
  resolveUploadSourceForRegistration: vi.fn(),
}));

vi.mock('./upload-archive', () => ({
  archiveUploadRawProduct: mocks.archiveUploadRawProduct,
}));

vi.mock('./upload-context-loader', () => ({
  loadUploadRegistrationContext: mocks.loadUploadRegistrationContext,
}));

vi.mock('./upload-document-hashes', () => ({
  checkInitialUploadDuplicate: mocks.checkInitialUploadDuplicate,
}));

vi.mock('./upload-document-parsing', () => ({
  parseUploadDocumentForRegistration: mocks.parseUploadDocumentForRegistration,
}));

vi.mock('./upload-product-runner', () => ({
  processUploadRegistrationProducts: mocks.processUploadRegistrationProducts,
}));

vi.mock('./upload-registration-completion', () => ({
  completeUploadRegistration: mocks.completeUploadRegistration,
}));

vi.mock('./upload-registration-normalization', () => ({
  normalizeUploadRegistrationDocument: mocks.normalizeUploadRegistrationDocument,
}));

vi.mock('./upload-registration-preparation', () => ({
  prepareUploadRegistrationProducts: mocks.prepareUploadRegistrationProducts,
}));

vi.mock('./upload-source-resolution', () => ({
  resolveUploadSourceForRegistration: mocks.resolveUploadSourceForRegistration,
}));

import { runUploadRegistrationPipeline } from './upload-registration-pipeline';
import type { UploadRequestIntakeSuccess } from './upload-request-intake';

function intake(overrides: Partial<UploadRequestIntakeSuccess> = {}): UploadRequestIntakeSuccess {
  return {
    ok: true,
    buffer: Buffer.from('supplier raw text'),
    fileHash: 'file-hash',
    fileName: 'upload.txt',
    directRawText: 'supplier raw text',
    uploadSourceMetadata: {
      commissionRate: 10,
      marginRate: 0.1,
      cleanSourceLabel: 'upload',
      metadataOnlyLineRemoved: false,
      source: 'default',
      issues: [],
    },
    inputAnalysisForTrust: null,
    archiveMode: false,
    bulkMode: false,
    forceReprocess: false,
    ...overrides,
  };
}

function parsedDocument() {
  return {
    filename: 'upload.txt',
    fileType: 'hwp',
    rawText: 'supplier raw text',
    extractedData: { title: 'Sample Package', rawText: 'supplier raw text' },
    parsedAt: new Date(),
    confidence: 0.8,
  };
}

function run(input = intake()) {
  return runUploadRegistrationPipeline({
    intake: input,
    supabase: {} as never,
    isSupabaseConfigured: true,
    safeAfter: task => { void task(); },
    postAlert: vi.fn(),
    requestBaseUrl: 'http://localhost:3000',
    publicBaseUrl: 'http://localhost:3000',
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.checkInitialUploadDuplicate.mockResolvedValue({ duplicate: false });
  mocks.loadUploadRegistrationContext.mockResolvedValue({
    landOperators: [{ id: 'op-1', name: 'Land A' }],
    departingLocations: [{ id: 'dep-1', name: 'Busan' }],
    activeAttractions: [],
  });
  mocks.resolveUploadSourceForRegistration.mockReturnValue({
    filenameRule: { cleanName: 'upload', supplierRaw: 'Land A' },
    supplierCode: 'LA',
    marginRate: 0.1,
    tempDestination: 'Cebu',
    prelimLandOperatorId: 'op-1',
  });
  mocks.archiveUploadRawProduct.mockResolvedValue({
    sku: 'ARCH-upload',
    status: 'DRAFT',
    expired: false,
    departureDate: null,
  });
  mocks.parseUploadDocumentForRegistration.mockResolvedValue({
    duplicate: { duplicate: false },
    parsedDocument: parsedDocument(),
    normalizedCatalogHash: 'normalized-hash',
    productRegistrationV2GateFailures: [],
  });
  mocks.normalizeUploadRegistrationDocument.mockImplementation(async input => ({
    parsedDocument: input.parsedDocument,
    effectiveSupplierCode: 'LA',
    effectiveLandOperatorId: 'op-1',
    irLandOperatorName: 'Land A',
    departingLocationId: 'dep-1',
    irCanaryPrimary: false,
    rawNormalizerFailedReason: null,
  }));
  mocks.prepareUploadRegistrationProducts.mockResolvedValue({
    ok: true,
    productsToSave: [{ extractedData: { title: 'Sample Package' }, itineraryData: null }],
    catalogGroupId: null,
    preSaveV3Result: { gate_result: { status: 'ready_to_publish' } },
  });
  mocks.processUploadRegistrationProducts.mockResolvedValue({
    savedIds: ['pkg-1'],
    savedTitles: ['Sample Package'],
    savedInternalCodes: ['PUS-LA-CEB-05-0001'],
    savedConfidences: [0.9],
    saveErrors: [],
    totalPriceRowsSaved: 1,
    savedPriceRowsByPackageId: new Map([['pkg-1', 1]]),
    unmatchedRowsToInsert: [],
    matchedCanonicalNames: new Set(),
    extractedCandidateRows: [],
    attractionSeededCount: 0,
    attractionReflectedCount: 0,
    improvementEvents: [],
    improvementEventsSaved: 0,
    improvementEventsSaveError: null,
    skippedDuplicateSections: 0,
  });
  mocks.completeUploadRegistration.mockResolvedValue({ success: true, dbIds: ['pkg-1'] });
});

describe('runUploadRegistrationPipeline', () => {
  it('stops before context loading when the initial duplicate guard matches', async () => {
    mocks.checkInitialUploadDuplicate.mockResolvedValue({
      duplicate: true,
      kind: 'file_hash',
      hashPreview: 'file-hash',
      payload: { success: true, duplicate: true, fileHash: 'file-hash', internal_code: 'PUS-LA-CEB-05-0001', message: 'duplicate' },
    });

    const result = await run();

    expect(result.status).toBe(200);
    expect(result.payload).toEqual(expect.objectContaining({ duplicate: true }));
    expect(mocks.loadUploadRegistrationContext).not.toHaveBeenCalled();
    expect(mocks.processUploadRegistrationProducts).not.toHaveBeenCalled();
    expect(mocks.completeUploadRegistration).not.toHaveBeenCalled();
  });

  it('archives without parsing, normalization, or registration runner work', async () => {
    const result = await run(intake({ archiveMode: true, directRawText: null }));

    expect(result.payload).toEqual(expect.objectContaining({
      success: true,
      mode: 'archive',
      sku: 'ARCH-upload',
    }));
    expect(mocks.archiveUploadRawProduct).toHaveBeenCalledTimes(1);
    expect(mocks.parseUploadDocumentForRegistration).not.toHaveBeenCalled();
    expect(mocks.normalizeUploadRegistrationDocument).not.toHaveBeenCalled();
    expect(mocks.processUploadRegistrationProducts).not.toHaveBeenCalled();
  });

  it('blocks preparation failures before the registration runner can persist anything', async () => {
    mocks.prepareUploadRegistrationProducts.mockResolvedValue({
      ok: false,
      status: 422,
      payload: {
        success: false,
        code: 'CATALOG_SPLIT_REQUIRED',
        error: 'split required',
      },
    });

    const result = await run();

    expect(result.status).toBe(422);
    expect(result.payload).toEqual(expect.objectContaining({ code: 'CATALOG_SPLIT_REQUIRED' }));
    expect(mocks.processUploadRegistrationProducts).not.toHaveBeenCalled();
    expect(mocks.completeUploadRegistration).not.toHaveBeenCalled();
  });

  it('passes only the standardized prepared products into the registration runner', async () => {
    await run();

    expect(mocks.processUploadRegistrationProducts).toHaveBeenCalledWith(expect.objectContaining({
      productsToSave: [{ extractedData: { title: 'Sample Package' }, itineraryData: null }],
      effectiveSupplierCode: 'LA',
      effectiveLandOperatorId: 'op-1',
      irLandOperatorName: 'Land A',
      tempDestination: 'Cebu',
      normalizedCatalogHash: 'normalized-hash',
      forceReprocess: false,
    }));
    expect(mocks.completeUploadRegistration).toHaveBeenCalledWith(expect.objectContaining({
      registrationProductsResult: expect.objectContaining({
        savedIds: ['pkg-1'],
        totalPriceRowsSaved: 1,
      }),
      productsToSaveLength: 1,
      preSaveV3Status: 'ready_to_publish',
    }));
  });
});
