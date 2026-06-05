import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  detectCatalogSplitFallback: vi.fn(),
  runUploadV3CatalogPreflight: vi.fn(),
}));

vi.mock('./upload-preflight', () => ({
  detectCatalogSplitFallback: mocks.detectCatalogSplitFallback,
  runUploadV3CatalogPreflight: mocks.runUploadV3CatalogPreflight,
}));

import { prepareUploadRegistrationProducts } from './upload-registration-preparation';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.detectCatalogSplitFallback.mockReturnValue(null);
  mocks.runUploadV3CatalogPreflight.mockResolvedValue({
    preSaveV3Result: { gate_result: { status: 'ready_to_publish' } },
    expectedProductCount: 1,
    actualProductCount: 1,
    productCountMismatch: false,
  });
});

function parsedDocument(overrides: Record<string, unknown> = {}) {
  return {
    filename: 'catalog.txt',
    fileType: 'hwp',
    rawText: 'supplier raw text',
    extractedData: { rawText: 'supplier raw text' },
    parsedAt: new Date(),
    confidence: 0.9,
    ...overrides,
  } as never;
}

describe('prepareUploadRegistrationProducts', () => {
  it('blocks catalog split fallback before V3 preflight and saving', async () => {
    const postAlert = vi.fn();
    mocks.detectCatalogSplitFallback.mockReturnValue({ headerCount: 4, processedCount: 1 });

    const result = await prepareUploadRegistrationProducts({
      parsedDocument: parsedDocument(),
      activeAttractions: [],
      fileName: 'catalog.txt',
      isSupabaseConfigured: true,
      postAlert,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.payload.code).toBe('CATALOG_SPLIT_REQUIRED');
      expect(result.payload.error).toContain('다중 상품 원문');
    }
    expect(postAlert).toHaveBeenCalledWith(expect.objectContaining({
      category: 'catalog-split-fallback',
    }));
    expect(mocks.runUploadV3CatalogPreflight).not.toHaveBeenCalled();
  });

  it('blocks V3 product count mismatches before the registration runner', async () => {
    mocks.runUploadV3CatalogPreflight.mockResolvedValue({
      preSaveV3Result: { gate_result: { status: 'blocked' } },
      expectedProductCount: 4,
      actualProductCount: 1,
      productCountMismatch: true,
    });

    const result = await prepareUploadRegistrationProducts({
      parsedDocument: parsedDocument(),
      activeAttractions: [],
      fileName: 'catalog.txt',
      isSupabaseConfigured: true,
      postAlert: vi.fn(),
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.payload.code).toBe('PRODUCT_COUNT_MISMATCH');
      expect(result.payload.expectedProductCount).toBe(4);
      expect(result.payload.actualProductCount).toBe(1);
    }
  });

  it('returns products, catalog group id, and V3 result for registration', async () => {
    const result = await prepareUploadRegistrationProducts({
      parsedDocument: parsedDocument({
        multiProducts: [
          { extractedData: { title: 'A', rawText: 'A' }, itineraryData: null },
          { extractedData: { title: 'B', rawText: 'B' }, itineraryData: null },
        ],
      }),
      activeAttractions: [],
      fileName: 'catalog.txt',
      isSupabaseConfigured: true,
      postAlert: vi.fn(),
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.productsToSave).toHaveLength(2);
      expect(result.catalogGroupId).toEqual(expect.any(String));
      expect(result.preSaveV3Result.gate_result.status).toBe('ready_to_publish');
    }
  });
});
