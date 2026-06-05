import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  applyUploadRawNormalizer: vi.fn(),
  identifySupplierFromText: vi.fn(),
  isStandardProductMarkdown: vi.fn(() => false),
}));

vi.mock('@/lib/standard-product-markdown', () => ({
  isStandardProductMarkdown: mocks.isStandardProductMarkdown,
}));

vi.mock('./upload-raw-normalizer', () => ({
  applyUploadRawNormalizer: mocks.applyUploadRawNormalizer,
}));

vi.mock('./upload-supplier-context', async () => {
  const actual = await vi.importActual<typeof import('./upload-supplier-context')>('./upload-supplier-context');
  return {
    ...actual,
    identifySupplierFromText: mocks.identifySupplierFromText,
  };
});

import { normalizeUploadRegistrationDocument } from './upload-registration-normalization';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.isStandardProductMarkdown.mockReturnValue(false);
  mocks.identifySupplierFromText.mockResolvedValue({
    supplierRaw: 'Land A',
    supplierCode: 'LA',
    landOperatorId: 'op-1',
    identificationSource: 'text_regex',
  });
  mocks.applyUploadRawNormalizer.mockImplementation(async input => ({
    parsedDocument: input.parsedDocument,
    departingLocationId: 'dep-1',
    irCanaryPrimary: false,
    rawNormalizerFailedReason: null,
    landOperatorName: input.landOperatorName,
    deterministicPreflightUsed: false,
  }));
});

function parsedDocument() {
  return {
    filename: 'upload.hwp',
    fileType: 'hwp',
    rawText: 'supplier raw text',
    extractedData: { rawText: 'supplier raw text', departure_airport: 'Busan' },
    parsedAt: new Date(),
    confidence: 0.9,
  } as never;
}

describe('normalizeUploadRegistrationDocument', () => {
  it('identifies supplier from text when filename has no supplier', async () => {
    const result = await normalizeUploadRegistrationDocument({
      parsedDocument: parsedDocument(),
      normalizedCatalogHash: 'normalized',
      isSupabaseConfigured: true,
      supabase: {} as never,
      postAlert: vi.fn(),
      filenameRule: { cleanName: 'upload' },
      supplierCode: 'ETC',
      marginRate: 0.1,
      fileName: 'upload.hwp',
      landOperators: [{ id: 'op-1', name: 'Land A' }],
      departingLocations: [{ id: 'dep-1', name: 'Busan' }],
    });

    expect(mocks.identifySupplierFromText).toHaveBeenCalled();
    expect(mocks.applyUploadRawNormalizer).toHaveBeenCalledWith(expect.objectContaining({
      landOperatorName: 'Land A',
      normalizedCatalogHash: 'normalized',
    }));
    expect(result.effectiveSupplierCode).toBe('LA');
    expect(result.effectiveLandOperatorId).toBe('op-1');
    expect(result.irLandOperatorName).toBe('Land A');
    expect(result.departingLocationId).toBe('dep-1');
  });

  it('uses filename supplier without text inference', async () => {
    const result = await normalizeUploadRegistrationDocument({
      parsedDocument: parsedDocument(),
      normalizedCatalogHash: 'normalized',
      isSupabaseConfigured: true,
      supabase: {} as never,
      postAlert: vi.fn(),
      filenameRule: { cleanName: 'upload', supplierRaw: 'Land A' },
      supplierCode: 'LA',
      marginRate: 0.1,
      fileName: 'upload.hwp',
      landOperators: [{ id: 'op-1', name: 'Land A' }],
      departingLocations: [],
    });

    expect(mocks.identifySupplierFromText).not.toHaveBeenCalled();
    expect(result.effectiveSupplierCode).toBe('LA');
    expect(result.effectiveLandOperatorId).toBe('op-1');
  });
});
