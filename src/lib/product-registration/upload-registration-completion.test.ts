import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  buildUploadResponsePayload: vi.fn(async () => ({ success: true })),
  flushUploadAttractionReviewQueue: vi.fn(async () => null),
  recordUploadDocumentHash: vi.fn(async () => ({ ok: true })),
  scheduleUploadL3BackfillTasks: vi.fn(),
}));

vi.mock('./upload-document-hashes', () => ({
  recordUploadDocumentHash: mocks.recordUploadDocumentHash,
}));

vi.mock('./upload-post-registration-tasks', () => ({
  scheduleUploadL3BackfillTasks: mocks.scheduleUploadL3BackfillTasks,
}));

vi.mock('./upload-response', () => ({
  buildUploadResponsePayload: mocks.buildUploadResponsePayload,
}));

vi.mock('./unmatched-queue', () => ({
  flushUploadAttractionReviewQueue: mocks.flushUploadAttractionReviewQueue,
}));

import { completeUploadRegistration } from './upload-registration-completion';

beforeEach(() => {
  vi.clearAllMocks();
});

function baseResult() {
  return {
    savedIds: ['pkg-1'],
    savedTitles: ['Cebu Package'],
    savedInternalCodes: ['PUS-ETC-CEB-05-0001'],
    savedConfidences: [0.91],
    saveErrors: [],
    totalPriceRowsSaved: 3,
    savedPriceRowsByPackageId: new Map([['pkg-1', 3]]),
    unmatchedRowsToInsert: [],
    matchedCanonicalNames: new Set<string>(['Temple']),
    extractedCandidateRows: [],
    attractionSeededCount: 0,
    attractionReflectedCount: 0,
  };
}

describe('completeUploadRegistration', () => {
  it('centralizes post-save queueing, hash recording, and response assembly', async () => {
    const payload = await completeUploadRegistration({
      supabase: {} as never,
      isSupabaseConfigured: true,
      bulkMode: false,
      safeAfter: task => { void task(); },
      postAlert: vi.fn(),
      parsedDocument: {
        filename: 'cebu.txt',
        fileType: 'hwp',
        rawText: 'raw text',
        extractedData: { rawText: 'raw text' },
        parsedAt: new Date(),
        confidence: 0.9,
      },
      classification: { productCount: 1 },
      inputAnalysisForTrust: null,
      uploadSourceMetadata: null,
      registrationProductsResult: baseResult(),
      productsToSaveLength: 1,
      activeAttractions: [],
      fileHash: 'abcdef123456',
      fileName: 'cebu.txt',
      normalizedCatalogHash: 'normalized',
      preSaveV3Status: 'ready_to_publish',
      filenameSupplierRaw: null,
      marginRate: 0.1,
      baseUrl: 'http://localhost:3000',
    });

    expect(payload).toEqual({ success: true });
    expect(mocks.flushUploadAttractionReviewQueue).toHaveBeenCalledWith(expect.objectContaining({
      fallbackPackageId: 'pkg-1',
      fallbackPackageTitle: 'Cebu Package',
    }));
    expect(mocks.scheduleUploadL3BackfillTasks).toHaveBeenCalledWith(expect.objectContaining({
      packageIds: ['pkg-1'],
    }));
    expect(mocks.recordUploadDocumentHash).toHaveBeenCalledWith(expect.objectContaining({
      fileHash: 'abcdef123456',
      normalizedHash: 'normalized',
      productId: 'PUS-ETC-CEB-05-0001',
    }));
    expect(mocks.buildUploadResponsePayload).toHaveBeenCalledWith(expect.objectContaining({
      savedIds: ['pkg-1'],
      savedInternalCodes: ['PUS-ETC-CEB-05-0001'],
      matchedAttractionCount: 1,
      unmatchedAttractionCount: 0,
      totalPriceRowsSaved: 3,
    }));
  });

  it('does not record document hashes when no product was saved', async () => {
    const result = baseResult();
    result.savedIds = [];
    result.savedInternalCodes = [];

    await completeUploadRegistration({
      supabase: {} as never,
      isSupabaseConfigured: true,
      bulkMode: false,
      safeAfter: task => { void task(); },
      postAlert: vi.fn(),
      parsedDocument: {
        filename: 'blocked.txt',
        fileType: 'hwp',
        rawText: 'raw text',
        extractedData: { rawText: 'raw text' },
        parsedAt: new Date(),
        confidence: 0.2,
      },
      classification: { productCount: 1 },
      inputAnalysisForTrust: null,
      uploadSourceMetadata: null,
      registrationProductsResult: result,
      productsToSaveLength: 1,
      activeAttractions: [],
      fileHash: 'blockedhash',
      fileName: 'blocked.txt',
      normalizedCatalogHash: 'normalized',
      preSaveV3Status: 'blocked',
      filenameSupplierRaw: null,
      marginRate: 0.1,
      baseUrl: 'http://localhost:3000',
    });

    expect(mocks.recordUploadDocumentHash).not.toHaveBeenCalledWith(expect.objectContaining({
      fileHash: 'blockedhash',
    }));
  });
});
