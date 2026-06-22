import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  checkParsedDocumentNormalizedDuplicate: vi.fn(),
  computeNormalizedContentHash: vi.fn(() => 'normalized-hash'),
  getLandOperatorProfile: vi.fn(async () => null),
  getRegionCacheContext: vi.fn(async () => ''),
  getRelevantReflections: vi.fn(async () => []),
  isStandardProductMarkdown: vi.fn(() => false),
  parseDocument: vi.fn(),
  parseStandardProductMarkdown: vi.fn(),
  applyUploadV2Preflight: vi.fn(async () => ({ applied: false, gateFailures: [] as string[] })),
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

  it('routes readable Korean YSN standard markdown directly to the deterministic parser', async () => {
    const standardRaw = 'YSN-PRODUCT-MD v1\n\n## 기본정보\n- 상품명: 테스트 상품';
    const standardParsed = {
      filename: 'standard.md',
      fileType: 'hwp' as const,
      rawText: standardRaw,
      extractedData: {
        title: '테스트 상품',
        rawText: standardRaw,
        _llm_meta: { provider: 'standard-markdown', tokens_input: 0 },
      },
      parsedAt: new Date(),
      confidence: 0.98,
    };
    mocks.isStandardProductMarkdown.mockReturnValue(true);
    mocks.parseStandardProductMarkdown.mockReturnValue(standardParsed);

    const result = await parseUploadDocumentForRegistration({
      buffer: Buffer.from(standardRaw),
      fileName: 'standard.md',
      directRawText: standardRaw,
      tempDestination: null,
      prelimLandOperatorId: null,
      supabase: {} as never,
      isSupabaseConfigured: false,
      fileHash: 'hash',
    });

    expect(mocks.parseDocument).not.toHaveBeenCalled();
    expect(mocks.parseStandardProductMarkdown).toHaveBeenCalledWith(standardRaw, 'standard.md');
    expect(result.parsedDocument).toBe(standardParsed);
    expect(result.parsedDocument.extractedData._llm_meta?.provider).toBe('standard-markdown');
    expect(result.parsedDocument.extractedData._llm_meta?.tokens_input).toBe(0);
  });

  it('uses the raw text bypass document for catalog-looking direct text uploads', async () => {
    const result = await parseUploadDocumentForRegistration({
      buffer: Buffer.from('catalog raw text'),
      fileName: 'catalog.txt',
      directRawText: 'catalog raw text\nDAY 1 부산 출발\nDAY 2 광저우 관광\n---\n광저우 5일\nDAY 1 부산 출발\nDAY 2 천저우 관광',
      tempDestination: null,
      prelimLandOperatorId: null,
      supabase: {} as never,
      isSupabaseConfigured: false,
      fileHash: 'hash',
    });

    expect(mocks.parseDocument).not.toHaveBeenCalled();
    expect(result.parsedDocument.rawText).toContain('광저우 5일');
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
