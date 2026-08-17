import { describe, expect, it } from 'vitest';

import {
  classifySourceDocumentRole,
  diagnoseSourceDocumentBundlePairs,
  resolveSourceDocumentBundles,
  type SourceBundleDocument,
} from './source-bundle-resolver';

function document(overrides: Partial<SourceBundleDocument>): SourceBundleDocument {
  return {
    id: 'source-1',
    tenantId: 'tenant-1',
    supplierKey: 'supplier-a',
    sourceHash: 'a'.repeat(64),
    filename: '부산 내몽고 호화호특 4박5일.hwp',
    text: '',
    cohortKey: 'development',
    uploadBatchKey: 'batch-default',
    ...overrides,
  };
}

describe('source document bundle resolver', () => {
  it('classifies complementary price and itinerary documents', () => {
    expect(classifySourceDocumentRole({
      filename: '(요금표) 부산 내몽고 4박5일.hwp',
      text: '출발일 상품가\n7/8 1,049,000원\n7/15 1,099,000원',
    })).toBe('price_sheet');
    expect(classifySourceDocumentRole({
      filename: '(일정표) 부산 내몽고 4박5일.hwp',
      text: '제1일 부산 출발\n제2일 초원 관광\n포함사항 호텔\n불포함사항 개인경비',
    })).toBe('itinerary_sheet');
  });

  it('resolves only a same-upload, same-tenant, same-cohort mutual best pair', () => {
    const price = document({
      id: 'price',
      sourceHash: '1'.repeat(64),
      filename: '(요금표) 부산 내몽고 호화호특 4박5일 BX3455.hwp',
      text: '출발일 상품가\n2026년 7/8 1,049,000원\n7/15 1,099,000원',
    });
    const itinerary = document({
      id: 'itinerary',
      sourceHash: '2'.repeat(64),
      filename: '(일정표) 부산 내몽고 호화호특 4박5일 BX3455.hwp',
      text: '2026년 제1일 BX3455 부산 출발\n제2일 초원 관광\n포함사항 호텔\n불포함사항 개인경비',
    });

    const result = resolveSourceDocumentBundles([price, itinerary]);

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ priceDocumentId: 'price', itineraryDocumentId: 'itinerary' });
    expect(result[0]!.score).toBeGreaterThanOrEqual(75);
  });

  it('attaches a same-batch supplier terms sheet without treating it as a second product', () => {
    const price = document({
      id: 'price', sourceHash: '1'.repeat(64),
      filename: '(요금표) 부산 다낭 3박5일 BX321.hwp',
      text: '출발일 상품가 2026년 9/1 599,000원 BX321',
    });
    const itinerary = document({
      id: 'itinerary', sourceHash: '2'.repeat(64),
      filename: '(일정표) 부산 다낭 3박5일 BX321.hwp',
      text: '2026년 DAY 1 BX321 부산 출발\nDAY 2 다낭 관광\nDAY 3\nDAY 4\nDAY 5',
    });
    const terms = document({
      id: 'terms', sourceHash: '3'.repeat(64),
      filename: '(약관표) 부산 다낭 공통조건.hwp',
      text: '포함사항 왕복항공료\n불포함사항 가이드비\n취소료는 특별약관에 따릅니다.',
    });

    const result = resolveSourceDocumentBundles([price, itinerary, terms]);
    expect(result).toHaveLength(1);
    expect(result[0]?.members).toEqual([
      { documentId: 'price', role: 'price_sheet' },
      { documentId: 'itinerary', role: 'itinerary_sheet' },
      { documentId: 'terms', role: 'terms_sheet' },
    ]);
    expect(result[0]?.reasons).toContain('ATTACHED_TERMS_SHEETS:1');
  });

  it('does not attach terms from another supplier or conflicting year', () => {
    const price = document({ id: 'price', sourceHash: '4'.repeat(64), filename: '2026 다낭 3박5일 요금표 BX321.hwp', text: '2026년 출발일 상품가 599,000원 BX321' });
    const itinerary = document({ id: 'itinerary', sourceHash: '5'.repeat(64), filename: '2026 다낭 3박5일 일정표 BX321.hwp', text: '2026년 DAY 1 BX321\nDAY 2\nDAY 3\nDAY 4\nDAY 5' });
    const otherSupplierTerms = document({ id: 'terms-other', sourceHash: '6'.repeat(64), supplierKey: 'supplier-b', filename: '공통 약관.hwp', text: '포함사항 항공료\n불포함사항 가이드비' });
    const wrongYearTerms = document({ id: 'terms-wrong-year', sourceHash: '7'.repeat(64), filename: '2027 공통 약관.hwp', text: '2027년 포함사항 항공료\n불포함사항 가이드비' });
    const result = resolveSourceDocumentBundles([price, itinerary, otherSupplierTerms, wrongYearTerms]);
    expect(result).toHaveLength(1);
    expect(result[0]?.members).toHaveLength(2);
  });

  it('never joins documents across tenant, upload batch, or benchmark cohort', () => {
    const price = document({
      id: 'price',
      sourceHash: '3'.repeat(64),
      filename: '(요금표) 부산 내몽고 4박5일.hwp',
      text: '출발일 상품가\n7/8 1,049,000원\n7/15 1,099,000원',
    });
    const itinerary = document({
      id: 'itinerary',
      sourceHash: '4'.repeat(64),
      filename: '(일정표) 부산 내몽고 4박5일.hwp',
      text: '제1일 부산 출발\n제2일 초원 관광',
      cohortKey: 'frozen',
    });

    expect(resolveSourceDocumentBundles([price, itinerary])).toEqual([]);
    expect(resolveSourceDocumentBundles([price, { ...itinerary, cohortKey: 'development', uploadBatchKey: 'batch-2' }])).toEqual([]);
    expect(resolveSourceDocumentBundles([price, { ...itinerary, cohortKey: 'development', tenantId: 'tenant-2' }])).toEqual([]);
  });

  it('does not join a historical same-supplier document without a shared upload batch', () => {
    const price = document({
      id: 'price-history',
      sourceHash: 'e'.repeat(64),
      uploadBatchKey: null,
      filename: '(요금표) 부산 다낭 3박5일 BX321.hwp',
      text: '출발일 상품가 2026년 7월 8일 599,000원',
    });
    const itinerary = document({
      id: 'itinerary-history',
      sourceHash: 'f'.repeat(64),
      uploadBatchKey: null,
      filename: '(일정표) 부산 다낭 3박5일 BX321.hwp',
      text: '제1일 BX321 부산 출발\n제2일 다낭 관광',
    });
    expect(resolveSourceDocumentBundles([price, itinerary])).toEqual([]);
  });

  it('rejects an equal-score ambiguous itinerary choice', () => {
    const price = document({
      id: 'price',
      sourceHash: '5'.repeat(64),
      filename: '(요금표) 부산 다낭 3박5일 BX321.hwp',
      text: '출발일 상품가\n7/8 599,000원\n7/15 629,000원',
    });
    const itinerary = (id: string, hash: string) => document({
      id,
      sourceHash: hash.repeat(64),
      filename: '(일정표) 부산 다낭 3박5일 BX321.hwp',
      text: '제1일 BX321 부산 출발\n제2일 다낭 관광',
    });

    expect(resolveSourceDocumentBundles([price, itinerary('a', '6'), itinerary('b', '7')])).toEqual([]);
  });

  it('rejects conflicting flight codes even when filenames are similar', () => {
    const price = document({
      id: 'price',
      sourceHash: '8'.repeat(64),
      filename: '(요금표) 부산 다낭 3박5일 BX321.hwp',
      text: '출발일 상품가\n7/8 599,000원\n7/15 629,000원',
    });
    const itinerary = document({
      id: 'itinerary',
      sourceHash: '9'.repeat(64),
      filename: '(일정표) 부산 다낭 3박5일 VJ993.hwp',
      text: '제1일 VJ993 부산 출발\n제2일 다낭 관광',
    });

    expect(resolveSourceDocumentBundles([price, itinerary])).toEqual([]);
    expect(diagnoseSourceDocumentBundlePairs([price, itinerary])[0]?.blockers).toContain('FLIGHT_CONFLICT');
  });

  it('requires an authenticated supplier identity even inside an explicit upload batch', () => {
    const price = document({
      id: 'price-batch',
      sourceHash: 'b'.repeat(64),
      supplierKey: null,
      uploadBatchKey: 'batch-1',
      filename: '황산 5일 요금표.hwp',
      text: '출발일 상품가 2026년 4월 17일 1,379,000원 BX3615',
    });
    const itinerary = document({
      id: 'itinerary-batch',
      sourceHash: 'c'.repeat(64),
      supplierKey: null,
      uploadBatchKey: 'batch-1',
      filename: '황산 5일 일정표.hwp',
      text: 'DAY 1\nDAY 2\nDAY 3\nDAY 4\nDAY 5\nBX3615',
    });

    expect(resolveSourceDocumentBundles([price, itinerary])).toEqual([]);
    expect(diagnoseSourceDocumentBundlePairs([price, itinerary])[0]?.blockers)
      .toContain('SUPPLIER_IDENTITY_MISSING_OR_CONFLICT');
    expect(resolveSourceDocumentBundles([
      price,
      {
        ...itinerary,
        id: 'unrelated',
        sourceHash: 'd'.repeat(64),
        filename: '세부 5일 일정표.hwp',
        text: 'DAY 1\nDAY 2\nDAY 3\nDAY 4\nDAY 5\n7C2105',
      },
    ])).toEqual([]);
  });

  it('does not merge same-date products when their source hotel identity conflicts', () => {
    const price = document({
      id: 'price-hotel-a',
      sourceHash: '1'.repeat(64),
      filename: '(요금표) 다낭 3박5일 헤난 타왈라 BX321.hwp',
      text: '다낭 3박5일\nHOTEL: 헤난 타왈라 리조트\n8/28 출발 599,000원\nBX321',
    });
    const itinerary = document({
      id: 'itinerary-hotel-b',
      sourceHash: '2'.repeat(64),
      filename: '(일정표) 다낭 3박5일 프리미어코스트 BX321.hwp',
      text: '다낭 3박5일\nDAY 1\nDAY 2\nDAY 3\nDAY 4\nDAY 5\nHOTEL: 프리미어코스트 호텔\nBX321',
    });

    expect(resolveSourceDocumentBundles([price, itinerary])).toEqual([]);
    expect(diagnoseSourceDocumentBundlePairs([price, itinerary])[0]?.blockers).toContain('HOTEL_CONFLICT');
  });
});
