import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildSupplierRawDeterministicItinerary, extractSupplierRawDeterministicFacts } from '@/lib/supplier-raw-deterministic-facts';
import { recoverCatalogSplitFromRawText } from './catalog-split-recovery';
import { recoverUploadPriceData } from './price-recovery';

describe('recoverCatalogSplitFromRawText', () => {
  it('recovers newline PKG catalog sections before upload route blocks customer delivery', () => {
    const raw = `공통 가격표
스팟특가
6/20,21,28
999,-
1,159,-

PKG
클락 알뜰 3색골프 + 단독차량 3박5일
2026.4.1
출 발 일
6/1~10/24 (수,목)

PKG
클락 알뜰 3색골프 + 단독차량 4박6일
2026.4.1
출 발 일
6/1~10/24 (토,일)

PKG
클락 품격 풀빌라 더비스타 2색골프 + 단독차량 3박5일
2026.4.1
출 발 일
6/1~10/24 (수,목)

PKG
클락 품격 풀빌라 더비스타 2색골프 + 단독차량 4박6일
2026.4.1
출 발 일
6/1~10/24 (토,일)`;

    const products = recoverCatalogSplitFromRawText(raw);

    expect(products).toHaveLength(4);
    expect(products.map(product => product.extractedData.title)).toEqual([
      '클락 알뜰 3색골프 + 단독차량 3박5일',
      '클락 알뜰 3색골프 + 단독차량 4박6일',
      '클락 품격 풀빌라 더비스타 2색골프 + 단독차량 3박5일',
      '클락 품격 풀빌라 더비스타 2색골프 + 단독차량 4박6일',
    ]);
    expect(products.every(product => product.sectionRawText?.includes('공통 가격표'))).toBe(true);
    expect(products[0].extractedData.destination).toBe('클락');
    expect(products[0].extractedData.duration).toBe(5);
    expect(products[1].extractedData.duration).toBe(6);
  });

  it('splits Xian/Huashan BX catalog by every PKG block before price and itinerary recovery', async () => {
    const raw = readFileSync(
      join(process.cwd(), 'src/lib/product-registration/golden-corpus/fixtures/xian-huashan-bx-multiproduct.txt'),
      'utf8',
    );

    const products = recoverCatalogSplitFromRawText(raw);

    expect(products).toHaveLength(4);
    expect(products.map(product => product.extractedData.title)).toEqual([
      'BX 서안/진시황릉+병마용 3박5일',
      'BX 서안/진시황릉+병마용 4박6일',
      '[노팁/노옵션/노쇼핑] BX 서안/화산 품격 패키지 3박5일',
      '[노팁/노옵션/노쇼핑] BX 서안/화산 품격 패키지 4박6일',
    ]);

    const premiumThreeNight = products[2]!;
    const premiumFourNight = products[3]!;
    const basicThreeNight = products[0]!;
    const premiumThreeNightRawText = premiumThreeNight.sectionRawText ?? '';
    const premiumFourNightRawText = premiumFourNight.sectionRawText ?? '';
    expect(premiumThreeNightRawText).not.toContain('품격 패키지 4박6일');
    const basicThreeNightFacts = extractSupplierRawDeterministicFacts(basicThreeNight.sectionRawText ?? '');
    expect(basicThreeNightFacts.inclusions).toContain('호텔(2인1실)');
    expect(basicThreeNightFacts.excludes).toEqual([
      '개인경비',
      '매너팁',
      '기사/가이드경비($50/인)',
      '강력추천옵션($150/인)',
    ]);
    expect(basicThreeNightFacts.optionalTours.map(tour => `${tour.name}:${tour.priceLabel}`)).toEqual([
      '장안가쇼:$70/인',
      '발마사지:$30/인',
      '전신마사지:$40/인',
      '화산(서봉):$180/인',
      '화산북봉:$120/인',
      '화산서약묘:$40/인',
      '실크로드쇼:$50/인',
      '한양능박물관 등:$35/인',
    ]);

    const threeNightPrice = await recoverUploadPriceData(
      { ...premiumThreeNight.extractedData, rawText: premiumThreeNightRawText },
      { rawText: premiumThreeNightRawText, year: 2026, enableGeminiFallback: false },
    );
    expect(threeNightPrice.ok).toBe(true);
    expect(threeNightPrice.source).toBe('supplier_raw_facts');
    expect(threeNightPrice.minPrice).toBe(979000);
    expect(threeNightPrice.priceDates.map(row => row.date)).toEqual([
      '2026-07-01',
      '2026-07-08',
      '2026-07-29',
      '2026-08-19',
    ]);
    expect(threeNightPrice.priceRows).toHaveLength(4);

    const fourNightPrice = await recoverUploadPriceData(
      { ...premiumFourNight.extractedData, rawText: premiumFourNightRawText },
      { rawText: premiumFourNightRawText, year: 2026, enableGeminiFallback: false },
    );
    expect(fourNightPrice.ok).toBe(true);
    expect(fourNightPrice.minPrice).toBe(1049000);
    expect(fourNightPrice.priceDates.map(row => row.date)).toEqual([
      '2026-07-04',
      '2026-07-18',
      '2026-08-22',
    ]);

    const threeNightItinerary = buildSupplierRawDeterministicItinerary(premiumThreeNightRawText);
    const fourNightItinerary = buildSupplierRawDeterministicItinerary(premiumFourNightRawText);
    const fourNightScheduleText = fourNightItinerary?.days.flatMap(day => day.schedule.map(item => item.activity)).join('\n') ?? '';
    expect(threeNightItinerary?.days.map(day => day.day)).toEqual([1, 2, 3, 4, 5]);
    expect(fourNightItinerary?.days.map(day => day.day)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(threeNightItinerary?.meta.nights).toBe(3);
    expect(fourNightItinerary?.meta.nights).toBe(4);
    expect(threeNightItinerary?.meta.flight_out).toBe('BX341');
    expect(threeNightItinerary?.meta.flight_in).toBe('BX342');
    expect(fourNightItinerary?.meta.flight_out).toBe('BX341');
    expect(fourNightItinerary?.meta.flight_in).toBe('BX342');
    expect(fourNightScheduleText).not.toContain('중국 패키지 상품 취소규정 안내');
    expect(fourNightScheduleText).not.toMatch(/^(서안|화산|부산)$/m);
  });
});
