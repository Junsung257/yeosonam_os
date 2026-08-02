import { NextRequest } from 'next/server';
import { describe, expect, it } from 'vitest';

import { prepareUploadRequestIntake } from './upload-request-intake';

const LONG_PRODUCT_TEXT = [
  '연길 백두산 3박4일 상품입니다.',
  '출발일과 날짜별 판매가, 포함사항, 불포함사항, 항공편, 호텔, 상세 일정이 이어집니다.',
  '고객에게 안내할 취소 규정과 예약 조건도 원문 그대로 포함되어 있습니다.',
].join('\n');

function jsonRequest(body: Record<string, unknown>): NextRequest {
  return new NextRequest('http://localhost/api/upload', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('prepareUploadRequestIntake commercial metadata gate', () => {
  it('blocks text registration when both land operator and commission evidence are missing', async () => {
    const result = await prepareUploadRequestIntake(jsonRequest({ rawText: LONG_PRODUCT_TEXT }));

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.status).toBe(422);
    expect(result.payload.code).toBe('LAND_OPERATOR_REQUIRED');
    expect((result.payload.uploadMetadata as { commissionRate?: number } | undefined)?.commissionRate).toBe(9);
  });

  it('auto-fills 9% when an explicit land operator omits commission', async () => {
    const result = await prepareUploadRequestIntake(jsonRequest({
      rawText: LONG_PRODUCT_TEXT,
      landOperator: '투어폰',
    }));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.uploadSourceMetadata.landOperator).toBe('투어폰');
    expect(result.uploadSourceMetadata.commissionRate).toBe(9);
    expect(result.uploadSourceMetadata.commissionRateWasDefaulted).toBe(true);
    expect(result.uploadSourceMetadata.issues).toContainEqual(expect.objectContaining({
      code: 'commission_rate_defaulted',
      severity: 'review',
    }));
  });

  it('accepts explicit commercial metadata without changing the supplier source text', async () => {
    const result = await prepareUploadRequestIntake(jsonRequest({
      rawText: LONG_PRODUCT_TEXT,
      landOperator: '투어폰',
      commissionRate: 9,
    }));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.uploadSourceMetadata.landOperator).toBe('투어폰');
    expect(result.uploadSourceMetadata.commissionRate).toBe(9);
    expect(result.uploadSourceMetadata.commissionRateWasDefaulted).toBe(false);
    expect(result.originalRawText).toBe(LONG_PRODUCT_TEXT);
  });

  it('reads explicit commercial metadata from multipart HWP uploads', async () => {
    const formData = new FormData();
    formData.append('file', new File(['hwp-binary-placeholder'], '상품.hwp'));
    formData.append('landOperator', '투어폰');
    formData.append('commissionRate', '9');

    const result = await prepareUploadRequestIntake(new NextRequest('http://localhost/api/upload', {
      method: 'POST',
      body: formData,
    }));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.fileName).toBe('상품.hwp');
    expect(result.uploadSourceMetadata.landOperator).toBe('투어폰');
    expect(result.uploadSourceMetadata.commissionRate).toBe(9);
  });

  it('accepts a filename only when it contains both land operator and commission evidence', async () => {
    const formData = new FormData();
    formData.append('file', new File(['hwp-binary-placeholder'], '[투어폰_9%]연길상품.hwp'));

    const result = await prepareUploadRequestIntake(new NextRequest('http://localhost/api/upload', {
      method: 'POST',
      body: formData,
    }));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.uploadSourceMetadata.landOperator).toBe('투어폰');
    expect(result.uploadSourceMetadata.commissionRate).toBe(9);
    expect(result.uploadSourceMetadata.source).toBe('filename');
  });

  it('rejects an out-of-range filename commission before reading the file', async () => {
    const formData = new FormData();
    formData.append('file', new File(['hwp-binary-placeholder'], '[투어폰_999%]연길상품.hwp'));

    const result = await prepareUploadRequestIntake(new NextRequest('http://localhost/api/upload', {
      method: 'POST',
      body: formData,
    }));

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.status).toBe(422);
    expect(result.payload.code).toBe('COMMISSION_RATE_OUT_OF_RANGE');
  });

  it('rejects a non-numeric explicit commission instead of applying the fallback', async () => {
    const result = await prepareUploadRequestIntake(jsonRequest({
      rawText: LONG_PRODUCT_TEXT,
      landOperator: '투어폰',
      commissionRate: 'not-a-number',
    }));

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.status).toBe(422);
    expect(result.payload.code).toBe('COMMISSION_RATE_INVALID');
  });
});
