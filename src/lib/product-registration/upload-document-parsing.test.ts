import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  checkParsedDocumentNormalizedDuplicate: vi.fn(),
  computeNormalizedContentHash: vi.fn(() => 'normalized-hash'),
  countCatalogItineraryHeaders: vi.fn(() => 0),
  getLandOperatorProfile: vi.fn(async () => null),
  getRegionCacheContext: vi.fn(async () => ''),
  getRelevantReflections: vi.fn(async () => []),
  isStandardProductMarkdown: vi.fn(() => false),
  parseDocument: vi.fn(),
  parseStandardProductMarkdown: vi.fn(),
  applyUploadV2Preflight: vi.fn(async () => ({ applied: false, gateFailures: [] as string[] })),
}));

vi.mock('@/lib/parser/catalog-pre-split', () => ({
  countCatalogItineraryHeaders: mocks.countCatalogItineraryHeaders,
}));

vi.mock('@/lib/parser', () => ({
  parseDocument: mocks.parseDocument,
}));

vi.mock('@/lib/parser/upload-text-hash', () => ({
  computeNormalizedContentHash: mocks.computeNormalizedContentHash,
}));

vi.mock('@/lib/land-operator-profile', () => ({
  getLandOperatorProfile: mocks.getLandOperatorProfile,
}));

vi.mock('@/lib/region-cache-context', () => ({
  getRegionCacheContext: mocks.getRegionCacheContext,
}));

vi.mock('@/lib/reflection-memory', () => ({
  getRelevantReflections: mocks.getRelevantReflections,
}));

vi.mock('@/lib/standard-product-markdown', () => ({
  isStandardProductMarkdown: mocks.isStandardProductMarkdown,
  parseStandardProductMarkdown: mocks.parseStandardProductMarkdown,
}));

vi.mock('./upload-document-hashes', () => ({
  checkParsedDocumentNormalizedDuplicate: mocks.checkParsedDocumentNormalizedDuplicate,
}));

vi.mock('./upload-preflight', () => ({
  applyUploadV2Preflight: mocks.applyUploadV2Preflight,
}));

import { parseUploadDocumentForRegistration } from './upload-document-parsing';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.isStandardProductMarkdown.mockReturnValue(false);
  mocks.countCatalogItineraryHeaders.mockReturnValue(0);
  mocks.computeNormalizedContentHash.mockReturnValue('normalized-hash');
  mocks.checkParsedDocumentNormalizedDuplicate.mockResolvedValue({ duplicate: false });
  mocks.applyUploadV2Preflight.mockResolvedValue({ applied: false, gateFailures: [] as string[] });
  mocks.parseDocument.mockResolvedValue({
    filename: 'upload.hwp',
    fileType: 'hwp',
    rawText: 'parsed raw text',
    extractedData: { rawText: 'parsed raw text' },
    parsedAt: new Date(),
    confidence: 0.7,
  });
});

describe('parseUploadDocumentForRegistration', () => {
  it('uses the raw text bypass document for plain direct text uploads', async () => {
    const result = await parseUploadDocumentForRegistration({
      buffer: Buffer.from('direct raw text'),
      fileName: 'direct.txt',
      directRawText: 'direct raw text',
      tempDestination: 'Cebu',
      prelimLandOperatorId: null,
      supabase: {} as never,
      isSupabaseConfigured: false,
      fileHash: 'hash',
    });

    expect(mocks.parseDocument).not.toHaveBeenCalled();
    expect(result.parsedDocument.rawText).toBe('direct raw text');
    expect(result.normalizedCatalogHash).toBe('normalized-hash');
    expect(mocks.checkParsedDocumentNormalizedDuplicate).toHaveBeenCalledWith(expect.objectContaining({
      directRawText: 'direct raw text',
      normalizedCatalogHash: 'normalized-hash',
    }));
  });

  it('runs legacy parseDocument for catalog-looking direct text', async () => {
    mocks.countCatalogItineraryHeaders.mockReturnValue(2);

    await parseUploadDocumentForRegistration({
      buffer: Buffer.from('catalog raw text'),
      fileName: 'catalog.txt',
      directRawText: 'catalog raw text',
      tempDestination: null,
      prelimLandOperatorId: null,
      supabase: {} as never,
      isSupabaseConfigured: false,
      fileHash: 'hash',
    });

    expect(mocks.parseDocument).toHaveBeenCalled();
  });

  it('returns V2 gate failures and duplicate result from the centralized parser', async () => {
    mocks.applyUploadV2Preflight.mockResolvedValue({ applied: false, gateFailures: ['V2 failed'] as string[] });
    mocks.checkParsedDocumentNormalizedDuplicate.mockResolvedValue({
      duplicate: true,
      kind: 'normalized_content',
      hashPreview: 'normalized',
      payload: { success: true, duplicate: true, fileHash: 'hash', internal_code: 'PUS-ETC-CEB-05-0001', message: 'duplicate' },
    });

    const result = await parseUploadDocumentForRegistration({
      buffer: Buffer.from('file text'),
      fileName: 'upload.hwp',
      directRawText: null,
      tempDestination: 'Cebu',
      prelimLandOperatorId: 'land-op',
      supabase: {} as never,
      isSupabaseConfigured: true,
      fileHash: 'hash',
    });

    expect(result.productRegistrationV2GateFailures).toEqual(['V2 failed']);
    expect(result.duplicate.duplicate).toBe(true);
    expect(mocks.getRelevantReflections).toHaveBeenCalled();
    expect(mocks.getRegionCacheContext).toHaveBeenCalledWith('Cebu');
    expect(mocks.getLandOperatorProfile).toHaveBeenCalledWith('land-op');
  });
});
