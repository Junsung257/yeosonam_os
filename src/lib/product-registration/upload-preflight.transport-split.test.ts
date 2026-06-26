import { describe, expect, it } from 'vitest';

import { createSourceLineIndex, planProductRegistrationV3, runProductRegistrationV3 } from '@/lib/product-registration-v3';
import { stripSharedCatalogPrefixForProductDetail } from '@/lib/parser/catalog-pre-split';

import { recoverCatalogSplitFromRawText } from './catalog-split-recovery';
import { recoverUploadPriceData } from './price-recovery';
import { runUploadV3CatalogPreflight } from './upload-preflight';

const guangzhouTransportVariantRaw = `
공유 가격표
수요일【3박5일】

광저우,천저우 5일
리무진버스 이동
노팁,노옵션+쇼핑2회
광저우,천저우 5일
고속열차 이동
노팁,노옵션,노쇼핑
9월 2일
1,179,000
1,369,000
9월 9일
9월 16일
1,199,000
1,399,000
9월 23일
[추석 연휴]
1,449,000
1,669,000
9월 30일
1,299,000
별도문의
10월 7일
[한글날 연휴]
1,399,000
1,579,000
10월 14일
1,229,000
1,449,000

토요일【4박6일】

광저우,천저우
+단하산 6일
리무진버스 이동
노팁,노옵션+쇼핑2회
광저우,천저우
+소선령 6일
고속열차 이동
노팁,노옵션,노쇼핑
9월 5일
1,299,000
1,479,000
9월 12일
9월 19일
9월 26일
1,329,000
1,499,000
10월 3일
[개천절 연휴]
1,499,000
별도문의
10월 10일
10월 17일
1,349,000
1,549,000
BX0000 PUS 22:00 CAN 01:05+1
BX0000 CAN 02:05 PUS 06:30

리무진
버스이동
광저우 천심 5일 #망산 #고의촌
최소출발
6명
포함 내역
항공료 및 택스, 호텔, 차량, 가이드
불포함 내역
매너팁 및 개인경비
일자
제 1 일 부산 출발 광저우 도착
제 2 일 망산 관광
제 5 일 광저우 출발 부산 도착

고속철 이동
광저우 천심 5일 #망산 #고의촌 #동천선경
최소출발
6명
포함 내역
항공료 및 택스, 호텔, 차량, 가이드
불포함 내역
매너팁 및 개인경비
일자
제 1 일 부산 출발 광저우 도착
제 2 일 고속철 이동 후 망산 관광
제 5 일 광저우 출발 부산 도착

리무진 버스이동
광저우 판하 천심 6일 #판하 #망산
최소출발
6명
포함 내역
항공료 및 택스, 호텔, 차량, 가이드
불포함 내역
매너팁 및 개인경비
일자
제 1 일 부산 출발 광저우 도착
제 2 일 판하 관광
제 6 일 광저우 출발 부산 도착

고속철 이동
광저우 판하 천심 6일 #판하 #망산 #동천선경
최소출발
6명
포함 내역
항공료 및 택스, 호텔, 차량, 가이드
불포함 내역
매너팁 및 개인경비
일자
제 1 일 부산 출발 광저우 도착
제 2 일 고속철 이동 후 판하 관광
제 6 일 광저우 출발 부산 도착
`.trim();

describe('upload V3 preflight transport variant split', () => {
  it('keeps recovered Guangzhou transport variants aligned with V3 expected product count', async () => {
    const productsToSave = recoverCatalogSplitFromRawText(guangzhouTransportVariantRaw);
    const plan = planProductRegistrationV3(createSourceLineIndex(guangzhouTransportVariantRaw));

    expect(productsToSave).toHaveLength(4);
    expect(productsToSave.map(product => product.extractedData.duration)).toEqual([5, 5, 6, 6]);
    expect(plan.expected_products).toBe(4);

    const preflight = await runUploadV3CatalogPreflight({
      rawText: guangzhouTransportVariantRaw,
      productsToSave,
      activeAttractions: [],
    });

    expect(preflight.expectedProductCount).toBe(4);
    expect(preflight.actualProductCount).toBe(4);
    expect(preflight.productCountMismatch).toBe(false);
    expect(preflight.preSaveV3Result.structure_plan.expected_products).toBe(4);
    expect(preflight.preSaveV3Result.ledger.variants).toHaveLength(4);
  });

  it('recovers shared price-table dates for each transport variant column', async () => {
    const productsToSave = recoverCatalogSplitFromRawText(guangzhouTransportVariantRaw);
    const recoveries = await Promise.all(productsToSave.map(product => recoverUploadPriceData(product.extractedData, {
      rawText: product.sectionRawText,
      title: product.extractedData.title,
      durationDays: product.extractedData.duration,
      year: 2026,
      enableGeminiFallback: false,
    })));

    expect(recoveries.map(recovery => recovery.source)).toEqual([
      'supplier_transport_variant_shared_price_table',
      'supplier_transport_variant_shared_price_table',
      'supplier_transport_variant_shared_price_table',
      'supplier_transport_variant_shared_price_table',
    ]);
    expect(recoveries.map(recovery => recovery.minPrice)).toEqual([
      1179000,
      1369000,
      1299000,
      1479000,
    ]);
    expect(recoveries.map(recovery => recovery.priceDates.length)).toEqual([7, 6, 7, 6]);
    expect(recoveries[0].priceDates.map(row => row.date)).toContain('2026-09-02');
    expect(recoveries[1].priceDates.map(row => row.date)).not.toContain('2026-09-30');
    expect(recoveries[2].priceDates.map(row => row.date)).toContain('2026-10-03');
    expect(recoveries[3].priceDates.map(row => row.date)).not.toContain('2026-10-03');
  });

  it('uses product-detail text for per-package V3 sidecar checks', async () => {
    const productsToSave = recoverCatalogSplitFromRawText(guangzhouTransportVariantRaw);
    const v3Inputs = productsToSave.map(product => stripSharedCatalogPrefixForProductDetail(product.sectionRawText));

    expect(v3Inputs.every(raw => !raw.includes('수요일【3박5일】'))).toBe(true);
    expect(v3Inputs.every(raw => !raw.includes('토요일【4박6일】'))).toBe(true);

    const sidecarResults = await Promise.all(v3Inputs.map(raw => runProductRegistrationV3(raw, {
      attractions: [],
      sourceType: 'test',
    })));

    expect(sidecarResults.map(result => result.structure_plan.expected_products)).toEqual([1, 1, 1, 1]);
    expect(sidecarResults.map(result => result.ledger.variants.length)).toEqual([1, 1, 1, 1]);
  });
});
