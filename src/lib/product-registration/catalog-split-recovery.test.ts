import { describe, expect, it } from 'vitest';
import { recoverCatalogSplitFromRawText } from './catalog-split-recovery';

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
});
