import { describe, expect, it } from 'vitest';

import { parseUploadSourceMetadata } from './upload-source-metadata';

describe('parseUploadSourceMetadata', () => {
  it('extracts a metadata-only first line and removes it from parser raw text', () => {
    const result = parseUploadSourceMetadata({
      rawText: '투어폰 9%\n연길/백두산 2박3일\n가격표와 일정이 이어집니다.',
    });

    expect(result.landOperator).toBe('투어폰');
    expect(result.commissionRate).toBe(9);
    expect(result.marginRate).toBe(0.09);
    expect(result.source).toBe('raw_text');
    expect(result.metadataOnlyLineRemoved).toBe(true);
    expect(result.parserRawText).not.toContain('투어폰 9%');
    expect(result.parserRawText).toContain('연길/백두산');
  });

  it('extracts bracket metadata from a source label without stripping product text', () => {
    const result = parseUploadSourceMetadata({
      sourceLabel: '[투어폰_9%] 연길 백두산',
      rawText: '연길/백두산 상품 원문입니다. 가격표와 일정이 충분히 들어있습니다.',
    });

    expect(result.landOperator).toBe('투어폰');
    expect(result.commissionRate).toBe(9);
    expect(result.cleanSourceLabel).toBe('연길 백두산');
    expect(result.metadataOnlyLineRemoved).toBe(false);
  });

  it('extracts underscore filename metadata', () => {
    const result = parseUploadSourceMetadata({
      fileName: '투어폰_연길_9%.txt',
      rawText: '연길/백두산 상품 원문입니다. 가격표와 일정이 충분히 들어있습니다.',
    });

    expect(result.landOperator).toBe('투어폰');
    expect(result.commissionRate).toBe(9);
    expect(result.cleanSourceLabel).toBe('연길');
    expect(result.source).toBe('filename');
  });

  it('uses explicit fields before filename or raw text metadata', () => {
    const result = parseUploadSourceMetadata({
      explicitLandOperator: '투어폰',
      explicitCommissionRate: 9,
      fileName: '[다른랜드_15%] 연길.txt',
      rawText: '또다른랜드 20%\n연길 상품 원문입니다. 가격표와 일정이 충분히 들어있습니다.',
    });

    expect(result.landOperator).toBe('투어폰');
    expect(result.commissionRate).toBe(9);
    expect(result.source).toBe('explicit');
  });

  it('defaults commission rate to 10 percent when missing', () => {
    const result = parseUploadSourceMetadata({
      rawText: '연길/백두산 상품 원문입니다. 가격표와 일정이 충분히 들어있습니다.',
    });

    expect(result.landOperator).toBeUndefined();
    expect(result.commissionRate).toBe(10);
    expect(result.marginRate).toBe(0.1);
    expect(result.source).toBe('default');
  });

  it('flags out-of-range commission rates', () => {
    const result = parseUploadSourceMetadata({
      rawText: '투어폰 999%\n연길/백두산 상품 원문입니다. 가격표와 일정이 충분히 들어있습니다.',
    });

    expect(result.landOperator).toBe('투어폰');
    expect(result.commissionRate).toBe(999);
    expect(result.issues.some(issue => issue.code === 'commission_rate_out_of_range')).toBe(true);
  });
});
