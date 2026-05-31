import { describe, expect, it } from 'vitest';
import {
  collectVariantCatalogBlockStarts,
  countCatalogItineraryHeaders,
  splitCatalogByItineraryHeaders,
} from './catalog-pre-split';

describe('supplier grade variant catalog split', () => {
  const baekduCatalog = `6/11(목) 까지 항공권 발권조건 2명부터 출발확정
출발일
패턴
세이브
스탠다드
프리미엄
크라운
6월
월
3박4일
759,000
999,000
1,179,000
1,229,000

세이브
실속

연길/백두산(북파) 2박3일

포함 내역
왕복 항공료 및 텍스
일 자
제1일
부산 연길 도문 이도백하
제2일
이도백하 북파 연길
제3일
연길 부산

스탠다드
품격 노노

연길/백두산 (북파) 2박3일

포함 내역
왕복 항공료 및 텍스, 특식2회
일 자
제1일
부산 연길 도문 이도백하
제2일
이도백하 북파 연길
제3일
연길 부산

프리미엄노노노

연길/백두산 (북파) 2박3일

포함 내역
왕복 항공료 및 텍스, 특급호텔숙박
일 자
제1일
부산 연길 도문 이도백하
제2일
이도백하 북파 연길
제3일
연길 부산

크라운
노노노+

연길/백두산 (북파) 2박3일

포함 내역
왕복 항공료 및 텍스, 5D비행체험
일 자
제1일
부산 연길 도문 이도백하
제2일
이도백하 북파 연길
제3일
연길 부산

세이브
실속

연길/백두산(북+서파) 3박4일

포함 내역
왕복 항공료 및 텍스
일 자
제1일
부산 연길 도문 이도백하
제2일
이도백하 서파 이도백하
제3일
이도백하 북파 연길
제4일
연길 부산

스탠다드
품격 노노

연길/백두산(북+서파) 3박4일

포함 내역
왕복 항공료 및 텍스, 특식3회
일 자
제1일
부산 연길 도문 이도백하
제2일
이도백하 서파 이도백하
제3일
이도백하 북파 연길
제4일
연길 부산

프리미엄노노노

연길/백두산(북+서파) 3박4일

포함 내역
왕복 항공료 및 텍스, 특식6회
일 자
제1일
부산 연길 도문 이도백하
제2일
이도백하 서파 이도백하
제3일
이도백하 북파 연길
제4일
연길 부산

크라운
노노노+

연길/백두산(북+서파) 3박4일

포함 내역
왕복 항공료 및 텍스, 특식6회, 리무진차량
일 자
제1일
부산 연길 도문 이도백하
제2일
이도백하 서파 이도백하
제3일
이도백하 북파 연길
제4일
연길 부산`;

  it('detects 8 grade/course blocks without treating price-table columns as products', () => {
    expect(collectVariantCatalogBlockStarts(baekduCatalog)).toHaveLength(8);
    expect(countCatalogItineraryHeaders(baekduCatalog)).toBe(8);
  });

  it('splits into 8 customer products and keeps the common price table as prefix', () => {
    const { sharedPrefix, sections } = splitCatalogByItineraryHeaders(baekduCatalog);
    expect(sections).toHaveLength(8);
    expect(sharedPrefix).toContain('6/11(목)');
    expect(sharedPrefix).toContain('세이브');
    expect(sections[0]).toContain('연길/백두산(북파) 2박3일');
    expect(sections[1]).toContain('특식2회');
    expect(sections[7]).toContain('연길/백두산(북+서파) 3박4일');
    expect(sections[7]).toContain('리무진차량');
  });
});
