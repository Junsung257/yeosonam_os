import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import {
  buildUploadOneByOneInputCsv,
  buildUploadOneByOneInputPack,
  type UploadInputAuditReport,
} from './upload-one-by-one-input-pack';
import { recoverCatalogSplitFromRawText } from './catalog-split-recovery';

function hashText(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

function auditFor(rawText: string): UploadInputAuditReport {
  return {
    generatedAt: '2026-07-31T00:00:00.000Z',
    sourceReport: 'report.json',
    products: [{
      sourceFile: 'sample.hwp',
      productIndex: 0,
      rawTextHash: hashText(rawText),
      title: '검증 상품',
      destination: '검증 목적지',
      blockerCategory: null,
      publishableOffline: true,
      customerReadyOffline: true,
      commercialMetadataReady: false,
      commercialMetadataIssues: ['land_operator_required', 'commission_rate_required'],
      registrationReadyOffline: false,
      blockers: [],
    }],
  };
}

describe('buildUploadOneByOneInputPack', () => {
  it('keeps a single product text byte-for-byte and verifies its audit hash', () => {
    const rawText = '상품명: 검증 상품\r\n포함사항: 왕복항공\r\n일정: 제1일 출발 후 호텔 투숙 및 휴식\r\n주의사항: 원문 그대로 보존합니다.';
    const pack = buildUploadOneByOneInputPack(
      auditFor(rawText),
      [{ sourceFile: 'sample.hwp', extractedTextPath: 'sample.txt', rawText }],
      '2026-07-31T01:00:00.000Z',
    );

    expect(pack.entries).toHaveLength(1);
    expect(pack.entries[0].text).toBe(rawText);
    expect(pack.entries[0].rawTextHash).toBe(hashText(rawText));
    expect(pack.summary.rawTextHashesVerified).toBe(1);
    expect(pack.summary.minimumProductsFor95Percent).toBe(1);
  });

  it('fails closed when reconstructed text differs from the audited hash', () => {
    const rawText = '상품명: 검증 상품\n포함사항: 왕복항공\n일정: 제1일 출발 후 호텔 투숙 및 휴식\n주의사항: 충분히 긴 원문입니다.';
    const audit = auditFor(rawText);
    audit.products[0].rawTextHash = 'a'.repeat(64);

    expect(() => buildUploadOneByOneInputPack(
      audit,
      [{ sourceFile: 'sample.hwp', extractedTextPath: 'sample.txt', rawText }],
    )).toThrow('원문 SHA-256 불일치');
  });

  it('keeps multi-product catalog sections independent and hash-matched', () => {
    const rawText = [
      '[노옵션+노팁] 석가장/태항산(보천&천계산) 4일 - 7C',
      '출 발 일 자',
      '26년 7월 4, 11일 (토요일 출발)',
      '여 행 경 비',
      '699,000원',
      '날 짜',
      '제1일',
      '부산',
      '석가장',
      '제2일',
      '임주',
      '보천',
      '제4일',
      '석가장',
      '부산',
      '[노옵션+노팁] 석가장/태항산(보천&통천협&팔천협) 5일 - 7C',
      '출 발 일 자',
      '26년 7월 7일 (화요일 출발)',
      '여 행 경 비',
      '699,000원',
      '날 짜',
      '제1일',
      '부산',
      '석가장',
      '제2일',
      '임주',
      '보천',
      '제5일',
      '석가장',
      '부산',
    ].join('\n');
    const recovered = recoverCatalogSplitFromRawText(rawText);
    expect(recovered).toHaveLength(2);
    const audit: UploadInputAuditReport = {
      generatedAt: '2026-07-31T00:00:00.000Z',
      sourceReport: 'report.json',
      products: recovered.map((product, productIndex) => ({
        sourceFile: 'catalog.hwp',
        productIndex,
        rawTextHash: hashText(product.sectionRawText ?? rawText),
        title: product.extractedData.title ?? null,
        destination: product.extractedData.destination ?? null,
        blockerCategory: null,
        publishableOffline: true,
        customerReadyOffline: true,
        commercialMetadataReady: false,
        commercialMetadataIssues: ['land_operator_required', 'commission_rate_required'],
        registrationReadyOffline: false,
        blockers: [],
      })),
    };

    const pack = buildUploadOneByOneInputPack(
      audit,
      [{ sourceFile: 'catalog.hwp', extractedTextPath: 'catalog.txt', rawText }],
    );

    expect(pack.entries).toHaveLength(2);
    expect(pack.entries[0].text).not.toContain('보천&통천협');
    expect(pack.entries[1].text).toContain('보천&통천협');
    expect(pack.entries.map(entry => entry.rawTextHash)).toEqual(
      recovered.map(product => hashText(product.sectionRawText ?? rawText)),
    );
  });

  it('fails closed when an audited source is missing', () => {
    const rawText = '상품명: 검증 상품\n포함사항: 왕복항공\n일정: 제1일 출발 후 호텔 투숙 및 휴식\n주의사항: 충분히 긴 원문입니다.';

    expect(() => buildUploadOneByOneInputPack(auditFor(rawText), [])).toThrow(
      '추출 원문이 없는 감사 파일',
    );
  });

  it('emits blank product-specific commercial input columns', () => {
    const rawText = '상품명: 검증 상품\n포함사항: 왕복항공\n일정: 제1일 출발 후 호텔 투숙 및 휴식\n주의사항: 충분히 긴 원문입니다.';
    const pack = buildUploadOneByOneInputPack(
      auditFor(rawText),
      [{ sourceFile: 'sample.hwp', extractedTextPath: 'sample.txt', rawText }],
    );
    const csv = buildUploadOneByOneInputCsv(pack);

    expect(csv).toContain('"랜드사명(필수 입력)","커미션율 %(비우면 기본 9%)"');
    expect(csv).toContain(',"","",');
    expect(csv).not.toContain('"10"');
  });
});
